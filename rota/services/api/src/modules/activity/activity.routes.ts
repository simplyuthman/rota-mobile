/**
 * =============================================================================
 * Rota API — Activity Feed Routes
 * =============================================================================
 * AGENTS.md §3.2 (A-02, A-08), §3.5 (D-01, D-03) & §4 (L-05):
 * Thin HTTP layer: parse Zod query schema, authorize team member, delegate to service.
 *
 * Routes:
 *   GET /teams/:teamId/activity — Cursor-paginated activity feed
 * =============================================================================
 */

import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../../middleware/auth.js';
import { requireTeamMember } from '../../middleware/tenant.js';
import { rateLimits } from '../../middleware/rateLimit.js';
import { activityService } from './activity.service.js';
import { ActivityFeedQuerySchema } from '@rota/contracts';

export const activityRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Params: { teamId: string };
    Querystring: { cursor?: string; limit?: string };
  }>(
    '/teams/:teamId/activity',
    { preHandler: [requireAuth, requireTeamMember, rateLimits.feedUser] },
    async (request, reply) => {
      const { teamId } = request.params;
      const membership = request.membership!;

      const parsedQuery = ActivityFeedQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedQuery.error.errors.map((e: { message: string }) => e.message).join(', '),
            requestId: request.id,
          },
        });
      }

      const response = await activityService.getFeed(
        teamId,
        membership.role,
        membership.id,
        parsedQuery.data
      );

      return reply.send(response);
    }
  );
};
