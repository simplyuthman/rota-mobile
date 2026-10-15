/**
 * =============================================================================
 * Rota API — Fastify Application
 * =============================================================================
 * Creates and configures the Fastify server. Does NOT call listen() —
 * that is done in the entry point (server.ts) so this module is testable
 * with inject().
 *
 * Plugin registration order:
 *   1. requestIdPlugin   — inject/propagate X-Request-Id
 *   2. @fastify/cors     — allow configured origins
 *   3. errorHandlerPlugin — convert errors to the standard envelope
 *   4. Routes            — /health/* (more modules added in Phase 2+)
 * =============================================================================
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config/env.js';
import { requestIdPlugin } from './middleware/requestId.js';
import { errorHandlerPlugin } from './middleware/errorHandler.js';
import { healthRoutes } from './modules/health/health.routes.js';

export async function buildApp() {
  const fastify = Fastify({
    // pino logger with request-level correlation (O-01)
    logger: {
      level: config.isDevelopment ? 'debug' : 'info',
      ...(config.isDevelopment
        ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }
        : {}),
      // Redact sensitive fields from logs (O-01, S-02)
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.token',
          'req.body.refreshToken',
          'req.body.magicLink',
        ],
        censor: '[REDACTED]',
      },
    },
    // Trust X-Forwarded-For from reverse proxies (used for rate-limit IP keys)
    trustProxy: true,
    // Disallow unknown content types on request body parsing
    ajv: {
      customOptions: { coerceTypes: false, useDefaults: true },
    },
  });

  // ── Plugins ──────────────────────────────────────────────────────────────
  await fastify.register(requestIdPlugin);

  await fastify.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    credentials: true,
  });

  await fastify.register(errorHandlerPlugin);

  // ── Routes ───────────────────────────────────────────────────────────────
  // All routes are mounted under /v1 except health probes (TRD §5)
  await fastify.register(healthRoutes);
  // Phase 2+ modules will be registered here with prefix: '/v1'

  return fastify;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
