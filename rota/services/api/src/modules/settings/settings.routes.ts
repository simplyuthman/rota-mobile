/**
 * =============================================================================
 * Rota API — Settings Routes
 * =============================================================================
 * AGENTS.md §3.4 (P-06, P-07, P-08) & §4 (L-05):
 * HTTP endpoints for cross-device user settings:
 *   - GET /me/settings
 *   - PATCH /me/settings
 * =============================================================================
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { UpdateUserSettingsRequestSchema } from '@rota/contracts';
import { requireAuth } from '../../middleware/auth.js';
import { settingsService, SettingsError } from './settings.service.js';

const GetSettingsQuerySchema = z.object({
  timezone: z.string().optional(),
});

export const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /me/settings
   * Retrieves the authenticated user's settings.
   * Auto-initializes if device timezone is provided on first launch (Rule P-07).
   */
  fastify.get(
    '/me/settings',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const query = GetSettingsQuerySchema.parse(request.query);
      const userId = request.userId!;

      try {
        const settings = await settingsService.getSettings(userId, query.timezone);
        return reply.status(200).send(settings);
      } catch (err) {
        if (err instanceof SettingsError) {
          return reply.status(err.statusCode).send({
            error: {
              code: err.code,
              message: err.message,
              requestId: request.id,
            },
          });
        }
        throw err;
      }
    }
  );

  /**
   * PATCH /me/settings
   * Updates only changed fields, stamping each in field_updated_at (Rule P-08).
   */
  fastify.patch(
    '/me/settings',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const body = UpdateUserSettingsRequestSchema.parse(request.body);
      const userId = request.userId!;

      try {
        const updated = await settingsService.patchSettings(userId, body);
        return reply.status(200).send(updated);
      } catch (err) {
        if (err instanceof SettingsError) {
          return reply.status(err.statusCode).send({
            error: {
              code: err.code,
              message: err.message,
              requestId: request.id,
            },
          });
        }
        throw err;
      }
    }
  );
};
