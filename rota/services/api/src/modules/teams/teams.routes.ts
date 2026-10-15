/**
 * =============================================================================
 * Rota API — Teams Routes
 * =============================================================================
 * AGENTS.md §2.2, §3.2 (A-02, A-11) & §4 (L-05):
 * HTTP endpoints for team creation and details.
 */

import type { FastifyPluginAsync } from 'fastify';
import { CreateTeamRequestSchema } from '@rota/contracts';
import { teamsService } from './teams.service.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireTeamMember } from '../../middleware/tenant.js';

export const teamRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /teams
   * Creates a team with a 14-day Starter trial and sets the creator as Owner.
   */
  fastify.post(
    '/teams',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const body = CreateTeamRequestSchema.parse(request.body);
      const team = await teamsService.createTeam(request.userId!, body);
      return reply.status(201).send({ team });
    }
  );

  /**
   * GET /teams/:teamId
   * Retrieves team details. Enforces team membership (Rule A-02).
   */
  fastify.get<{
    Params: { teamId: string };
  }>(
    '/teams/:teamId',
    {
      preHandler: [requireAuth, requireTeamMember],
    },
    async (request, reply) => {
      const { teamId } = request.params;
      const team = await teamsService.getTeamById(teamId, request.teamRole!);
      return reply.status(200).send({ team });
    }
  );
};
