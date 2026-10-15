/**
 * =============================================================================
 * Rota API — Request ID Middleware
 * =============================================================================
 * Injects a unique request ID (UUID v4) into every request.
 * The ID is:
 *   - Taken from the incoming X-Request-Id header if present and valid,
 *     otherwise generated fresh.
 *   - Set on the Fastify request object as request.id.
 *   - Returned in every response as X-Request-Id.
 *   - Included in every log line (pino picks it up from request.id).
 *
 * AGENTS.md O-01: Log every request with request ID, user ID, route,
 * response time, and result.
 * =============================================================================
 */

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requestIdPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('onRequest', async (request, reply) => {
    const incoming = request.headers['x-request-id'];
    const id =
      typeof incoming === 'string' && UUID_REGEX.test(incoming)
        ? incoming
        : randomUUID();

    // Fastify exposes request.id for pino logging.
    // @ts-ignore: Fastify's RequestGenericInterface doesn't expose id as writable
    // See: https://github.com/fastify/fastify/discussions/3802
    request.id = id;
    void reply.header('X-Request-Id', id);
  });
}
