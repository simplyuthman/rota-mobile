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
import type { ControlPlaneDB, ShardDB } from './schema.js';

export type ShardTransaction = Transaction<ShardDB>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates a Kysely pool for a given connection string.
 * All pool settings are conservative defaults for Phase 1.
 * They will be tuned and justified in Phase 8 (AGENTS.md §2.2, D-07).
 */
function makePool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

// ─── Control-plane connections ────────────────────────────────────────────────

/** Write connection for the control-plane database. */
export const controlPlane = new Kysely<ControlPlaneDB>({
  dialect: new PostgresDialect({ pool: makePool(env.DATABASE_CONTROL_URL) }),
});

/**
 * Read connection for the control-plane database.
 * In dev this points to the same primary as controlPlane.
 * In production, point DATABASE_CONTROL_READ_URL to a read replica.
 */
export const controlPlaneRead = new Kysely<ControlPlaneDB>({
  dialect: new PostgresDialect({ pool: makePool(env.DATABASE_CONTROL_READ_URL) }),
});

// ─── Shard connections ────────────────────────────────────────────────────────

export const shard0 = new Kysely<ShardDB>({
  dialect: new PostgresDialect({ pool: makePool(env.DATABASE_SHARD_0_URL) }),
});

export const shard0Read = new Kysely<ShardDB>({
  dialect: new PostgresDialect({ pool: makePool(env.DATABASE_SHARD_0_READ_URL) }),
});

export const shard1 = new Kysely<ShardDB>({
  dialect: new PostgresDialect({ pool: makePool(env.DATABASE_SHARD_1_URL) }),
});

export const shard1Read = new Kysely<ShardDB>({
  dialect: new PostgresDialect({ pool: makePool(env.DATABASE_SHARD_1_READ_URL) }),
});

// ─── Shard routing ────────────────────────────────────────────────────────────

/**
 * CRC-32 polynomial table, pre-computed.
 * This is the standard CRC-32 (ISO 3309) used across languages and platforms.
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
 *
 * This function MUST NOT be changed without:
 *   1. A new migration to update team_directory rows.
 *   2. A new decision record in docs/decisions/.
 *   3. An update to SHARDING.md.
 */
function crc32(str: string): number {
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
 * The result is authoritative only after it is recorded in team_directory.
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
 * Returns the read Kysely instance for a given team ID.
 * Subject to the read-your-own-writes policy (5s after a write → primary).
 */
export function getShardReadDb(teamId: string): Kysely<ShardDB> {
  return getShardId(teamId) === 0 ? shard0Read : shard1Read;
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
