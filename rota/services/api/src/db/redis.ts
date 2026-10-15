/**
 * =============================================================================
 * Rota API — Redis Connections
 * =============================================================================
 * Two separate Redis instances are required (AGENTS.md §2.1, L-04):
 *
 *   redisCache — allkeys-lru eviction. Every key MUST have a TTL.
 *     Used for: roster, calendar, feed first page, revoked sids, rate limits.
 *
 *   redisQueue — noeviction. Managed by BullMQ.
 *     Used for: notification jobs, webhook processor, outbox relay.
 *
 * M-13: NEVER cache subscription state, payment status, credit balances,
 *       or webhook idempotency records.
 * =============================================================================
 */

import { Redis } from 'ioredis';
import { env } from '../config/env.js';

export type RedisClient = InstanceType<typeof Redis>;

const makeRedisClient = (url: string, name: string): RedisClient => {
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
    connectionName: name,
  });

  client.on('error', (err: Error) => {
    // Logged by pino in the app; do not throw here to avoid crashing on transient errors.
    // eslint-disable-next-line no-console
    console.error(`[redis:${name}] error`, err.message);
  });

  return client;
};

/**
 * Cache Redis instance.
 * Policy: allkeys-lru. Every key written here MUST have a TTL.
 */
export const redisCache = makeRedisClient(env.REDIS_CACHE_URL, 'cache');

/**
 * Queue Redis instance.
 * Policy: noeviction. Do not use for caching — use redisCache.
 */
export const redisQueue = makeRedisClient(env.REDIS_QUEUE_URL, 'queue');

/**
 * Checks connectivity to both Redis instances.
 * Called from GET /health/ready.
 */
export async function checkRedisHealth(): Promise<{ cache: boolean; queue: boolean }> {
  const ping = async (client: RedisClient): Promise<boolean> => {
    try {
      const result = await client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  };

  const [cache, queue] = await Promise.all([ping(redisCache), ping(redisQueue)]);
  return { cache, queue };
}

/** Gracefully closes both Redis connections. Call on SIGTERM. */
export async function closeRedis(): Promise<void> {
  await Promise.all([redisCache.quit(), redisQueue.quit()]);
}
