/**
 * =============================================================================
 * Rota API — Database Connections & Shard Router
 * =============================================================================
 * Creates three Kysely instances at startup:
 *   - controlPlane   → control_plane database
 *   - shard0         → rota_shard_0
 *   - shard1         → rota_shard_1
 *
 * Also exports read variants (may point to the same primary in dev) and a
 * getShardDb() function for team-scoped routing.
 *
 * Shard routing:
 *   Uses CRC-32 of the team_id string, modulo 2.
 *   This is a deterministic, documented hash (AGENTS.md §2.2, SHARDING.md).
 *   The computed shard_id is ALWAYS compared against team_directory after
 *   the first request to guard against hash function changes.
 *
 * Read-your-own-writes (TRD §2):
 *   After a user's write, their reads use the primary for 5 seconds.
 *   The read-URL may point to the primary in dev; the code path exists
 *   so it can be switched to a replica URL in production.
 *
 * Decision record: docs/decisions/001-data-layer.md
 * =============================================================================
 */

import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import { env } from '../config/env.js';
import { redisCache } from './redis.js';
import type { ControlPlaneDB, ShardDB } from './schema.js';

export type ShardTransaction = Transaction<ShardDB>;

// ─── Pool Configuration & Rationale (Phase 8, AGENTS.md §2.2, D-07) ───────────

export interface PoolConfigOptions {
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  statementTimeoutMillis: number;
}

/**
 * Pool sizing rationale (AGENTS.md §2.2, TRD §2, SHARDING.md):
 * - Control Plane: Max 10 connections. Serves auth, tokens, billing quotes, and directory.
 * - Shard 0 & 1 Primaries: Max 20 connections each. Serves all transactional writes & critical reads.
 * - Shard 0 & 1 Replicas: Max 20 connections each. Offloads staff feeds and published rosters.
 * - Statement Timeout: 10,000 ms to terminate long-running runaway queries before they hold locks.
 * - Connection Timeout: 5,000 ms to fail fast under catastrophic pool saturation.
 * - Idle Timeout: 30,000 ms to release unused connections gracefully back to PostgreSQL.
 */
export interface PoolConfigMap {
  controlPlane: PoolConfigOptions;
  controlPlaneRead: PoolConfigOptions;
  shard0: PoolConfigOptions;
  shard0Read: PoolConfigOptions;
  shard1: PoolConfigOptions;
  shard1Read: PoolConfigOptions;
}

export const POOL_CONFIG: PoolConfigMap = {
  controlPlane: {
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statementTimeoutMillis: 10_000,
  },
  controlPlaneRead: {
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statementTimeoutMillis: 10_000,
  },
  shard0: {
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statementTimeoutMillis: 10_000,
  },
  shard0Read: {
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statementTimeoutMillis: 10_000,
  },
  shard1: {
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statementTimeoutMillis: 10_000,
  },
  shard1Read: {
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statementTimeoutMillis: 10_000,
  },
};

function makePool(connectionString: string, cfg: PoolConfigOptions): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: cfg.max,
    idleTimeoutMillis: cfg.idleTimeoutMillis,
    connectionTimeoutMillis: cfg.connectionTimeoutMillis,
    statement_timeout: cfg.statementTimeoutMillis,
  });
}

// ─── Control-plane connections ────────────────────────────────────────────────

export const controlPlanePool = makePool(env.DATABASE_CONTROL_URL, POOL_CONFIG.controlPlane);
export const controlPlane = new Kysely<ControlPlaneDB>({
  dialect: new PostgresDialect({ pool: controlPlanePool }),
});

export function getControlPlaneDb(): Kysely<ControlPlaneDB> {
  return controlPlane;
}

export const controlPlaneReadPool = makePool(env.DATABASE_CONTROL_READ_URL, POOL_CONFIG.controlPlaneRead);
export const controlPlaneRead = new Kysely<ControlPlaneDB>({
  dialect: new PostgresDialect({ pool: controlPlaneReadPool }),
});

// ─── Shard connections ────────────────────────────────────────────────────────

export const shard0Pool = makePool(env.DATABASE_SHARD_0_URL, POOL_CONFIG.shard0);
export const shard0 = new Kysely<ShardDB>({
  dialect: new PostgresDialect({ pool: shard0Pool }),
});

export const shard0ReadPool = makePool(env.DATABASE_SHARD_0_READ_URL, POOL_CONFIG.shard0Read);
export const shard0Read = new Kysely<ShardDB>({
  dialect: new PostgresDialect({ pool: shard0ReadPool }),
});

export const shard1Pool = makePool(env.DATABASE_SHARD_1_URL, POOL_CONFIG.shard1);
export const shard1 = new Kysely<ShardDB>({
  dialect: new PostgresDialect({ pool: shard1Pool }),
});

export const shard1ReadPool = makePool(env.DATABASE_SHARD_1_READ_URL, POOL_CONFIG.shard1Read);
export const shard1Read = new Kysely<ShardDB>({
  dialect: new PostgresDialect({ pool: shard1ReadPool }),
});

// ─── Shard routing ────────────────────────────────────────────────────────────

/**
 * CRC-32 polynomial table, pre-computed.
 * Standard CRC-32 (ISO 3309) used across languages and platforms.
 * Documented in SHARDING.md as the stable hash function for team routing.
 */
const CRC32_TABLE = (function buildTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

/**
 * Computes CRC-32 of a UTF-8 string.
 * Returns an unsigned 32-bit integer.
 */
export function crc32(str: string): number {
  const bytes = new TextEncoder().encode(str);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    const index = (crc ^ byte) & 0xff;
    const tableValue = CRC32_TABLE[index];
    if (tableValue === undefined) throw new Error(`CRC32 table missing index ${index}`);
    crc = (crc >>> 8) ^ tableValue;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Returns the shard ID (0 or 1) for a given team ID.
 * Uses CRC-32 mod 2 — documented in SHARDING.md.
 */
export function getShardId(teamId: string): 0 | 1 {
  return (crc32(teamId) % 2) as 0 | 1;
}

/**
 * Returns the write Kysely instance for a given team ID.
 * Always validate team membership on the shard after routing (A-02).
 */
export function getShardDb(teamId: string): Kysely<ShardDB> {
  return getShardId(teamId) === 0 ? shard0 : shard1;
}

/**
 * Returns the default read Kysely instance for a given team ID (replica).
 */
export function getShardReadDb(teamId: string): Kysely<ShardDB> {
  return getShardId(teamId) === 0 ? shard0Read : shard1Read;
}

// ─── Read-Your-Own-Writes (TRD §2, AGENTS.md §2.2) ────────────────────────────

/**
 * Records that a user completed a write operation.
 * Sets user:{userId}:last_write in Redis with a 5-second TTL.
 */
export async function recordUserWrite(userId: string): Promise<void> {
  try {
    await redisCache.set(`user:${userId}:last_write`, Date.now().toString(), 'EX', 5);
  } catch {
    // Non-fatal if Redis is transiently unreachable
  }
}

/**
 * Checks whether the given user is within their 5-second read-your-own-writes window.
 */
export async function isUserInWriteWindow(userId: string): Promise<boolean> {
  try {
    const val = await redisCache.get(`user:${userId}:last_write`);
    return val !== null;
  } catch {
    // Fail safe to primary if Redis is down
    return true;
  }
}

export interface ReadRouteResolution {
  shardId: 0 | 1;
  isPrimary: boolean;
  reason: 'write_window' | 'replica_default';
  db: Kysely<ShardDB>;
}

/**
 * Resolves whether a read query for a given team and user routes to Primary or Replica.
 * In accordance with TRD §2: 5 seconds after a user's write, their reads use the primary.
 */
export async function resolveReadRoute(teamId: string, userId?: string): Promise<ReadRouteResolution> {
  const shardId = getShardId(teamId);
  if (userId) {
    const inWindow = await isUserInWriteWindow(userId);
    if (inWindow) {
      return {
        shardId,
        isPrimary: true,
        reason: 'write_window',
        db: shardId === 0 ? shard0 : shard1,
      };
    }
  }
  return {
    shardId,
    isPrimary: false,
    reason: 'replica_default',
    db: shardId === 0 ? shard0Read : shard1Read,
  };
}

/**
 * Returns the read Kysely instance for a given team ID, honoring read-your-own-writes.
 */
export async function getShardReadDbForUser(teamId: string, userId?: string): Promise<Kysely<ShardDB>> {
  const route = await resolveReadRoute(teamId, userId);
  return route.db;
}

// ─── Pool Metrics & Diagnostics ───────────────────────────────────────────────

export function getPoolMetrics() {
  return {
    controlPlane: {
      totalCount: controlPlanePool.totalCount,
      idleCount: controlPlanePool.idleCount,
      waitingCount: controlPlanePool.waitingCount,
      max: POOL_CONFIG.controlPlane.max,
    },
    shard0: {
      totalCount: shard0Pool.totalCount,
      idleCount: shard0Pool.idleCount,
      waitingCount: shard0Pool.waitingCount,
      max: POOL_CONFIG.shard0.max,
    },
    shard0Read: {
      totalCount: shard0ReadPool.totalCount,
      idleCount: shard0ReadPool.idleCount,
      waitingCount: shard0ReadPool.waitingCount,
      max: POOL_CONFIG.shard0Read.max,
    },
    shard1: {
      totalCount: shard1Pool.totalCount,
      idleCount: shard1Pool.idleCount,
      waitingCount: shard1Pool.waitingCount,
      max: POOL_CONFIG.shard1.max,
    },
    shard1Read: {
      totalCount: shard1ReadPool.totalCount,
      idleCount: shard1ReadPool.idleCount,
      waitingCount: shard1ReadPool.waitingCount,
      max: POOL_CONFIG.shard1Read.max,
    },
  };
}

// ─── Health check ─────────────────────────────────────────────────────────────

/**
 * Checks connectivity to all three write databases.
 * Called from GET /health/ready.
 */
export async function checkDatabaseHealth(): Promise<{
  controlPlane: boolean;
  shard0: boolean;
  shard1: boolean;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const check = async (db: Kysely<any>): Promise<boolean> => {
    try {
      await sql`SELECT 1`.execute(db);
      return true;
    } catch {
      return false;
    }
  };

  const [cp, s0, s1] = await Promise.allSettled([
    check(controlPlane),
    check(shard0),
    check(shard1),
  ]);

  return {
    controlPlane: cp.status === 'fulfilled' && cp.value,
    shard0: s0.status === 'fulfilled' && s0.value,
    shard1: s1.status === 'fulfilled' && s1.value,
  };
}

/** Gracefully destroys all connection pools. Call on SIGTERM. */
export async function closeDatabases(): Promise<void> {
  await Promise.all([
    controlPlane.destroy(),
    controlPlaneRead.destroy(),
    shard0.destroy(),
    shard0Read.destroy(),
    shard1.destroy(),
    shard1Read.destroy(),
  ]);
}
