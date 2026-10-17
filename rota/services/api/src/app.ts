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
import { recordUserWrite, isUserInWriteWindow } from './db/index.js';
import { requestIdHook } from './middleware/requestId.js';
import { errorHandler } from './middleware/errorHandler.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { teamRoutes } from './modules/teams/teams.routes.js';
import { membershipRoutes } from './modules/memberships/memberships.routes.js';
import { invitationRoutes } from './modules/invitations/invitations.routes.js';
import { shiftRoutes } from './modules/shifts/shifts.routes.js';
import { swapRoutes } from './modules/swaps/swaps.routes.js';
import { activityRoutes } from './modules/activity/activity.routes.js';
import { settingsRoutes } from './modules/settings/settings.routes.js';
import { notificationRoutes } from './modules/notifications/notifications.routes.js';

import { subscriptionRoutes } from './modules/subscriptions/subscriptions.routes.js';
import { webhookRoutes } from './modules/webhooks/webhooks.routes.js';

export async function buildApp() {
  const fastify = Fastify({
    // pino logger with request-level correlation (O-01)
    logger: {
      level: config.isDevelopment ? 'debug' : 'info',
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

  // ── Global Hooks & Error Handler (Root Level) ───────────────────────────
  fastify.addHook('onRequest', requestIdHook);
  fastify.setErrorHandler(errorHandler);

  // ── Read-Your-Own-Writes Hook (TRD §2, AGENTS.md §2.2) ───────────────────
  fastify.addHook('onResponse', async (request, reply) => {
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
      reply.statusCode >= 200 &&
      reply.statusCode < 400 &&
      request.user?.id
    ) {
      await recordUserWrite(request.user.id);
    }
  });

  fastify.addHook('onSend', async (request, reply) => {
    if (request.method === 'GET' && request.user?.id) {
      const inWindow = await isUserInWriteWindow(request.user.id);
      reply.header('x-read-source', inWindow ? 'primary' : 'replica');
    }
  });

  // ── Plugins ──────────────────────────────────────────────────────────────
  await fastify.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key', 'verif-hash', 'X-Team-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After', 'x-read-source'],
    credentials: true,
  });

  // ── Routes ───────────────────────────────────────────────────────────────
  // All routes are mounted under /v1 except health probes (TRD §5)
  await fastify.register(healthRoutes);
  await fastify.register(webhookRoutes);

  await fastify.register(
    async (v1) => {
      await v1.register(authRoutes);
      await v1.register(teamRoutes);
      await v1.register(membershipRoutes);
      await v1.register(invitationRoutes);
      await v1.register(shiftRoutes);
      await v1.register(swapRoutes);
      await v1.register(activityRoutes);
      await v1.register(settingsRoutes);
      await v1.register(notificationRoutes);
      await v1.register(subscriptionRoutes);
    },
    { prefix: '/v1' }
  );

  return fastify;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
