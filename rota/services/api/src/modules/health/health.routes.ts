/**
 * =============================================================================
 * Rota API — Health Routes
 * =============================================================================
 * GET /health/live  — liveness probe (always 200 if process is running)
 * GET /health/ready — readiness probe (checks DB + Redis connectivity)
 *
 * These are registered before auth middleware so load balancers and k8s
 * probes can reach them without a token.
 * =============================================================================
 */

import type { FastifyInstance } from 'fastify';
import { checkDatabaseHealth } from '../../db/index.js';
import { checkRedisHealth } from '../../db/redis.js';

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /health/live
   * Returns 200 immediately. Signals the process is running.
   */
  fastify.get('/health/live', async (_request, reply) => {
    await reply.status(200).send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  /**
   * GET /health/ready
   * Returns 200 when all database and Redis connections are healthy.
   * Returns 503 if any dependency is unavailable.
   */
  fastify.get('/health/ready', async (request, reply) => {
    const [db, redis] = await Promise.all([checkDatabaseHealth(), checkRedisHealth()]);

    const healthy =
      db.controlPlane && db.shard0 && db.shard1 && redis.cache && redis.queue;

    const payload = {
      status: healthy ? 'ok' : 'degraded',
      db,
      redis,
    };

    if (!healthy) {
      request.log.warn({ payload }, 'Health check failed');
      await reply.status(503).send(payload);
    } else {
      await reply.status(200).send(payload);
    }
  });
}
