/**
 * =============================================================================
 * Rota API — Memberships Routes
 * =============================================================================
 * AGENTS.md §3.2 (A-02, A-04) & §4 (L-05):
 * HTTP endpoints for listing and updating team members.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { RoleSchema } from '@rota/contracts';
import { membershipsService } from './memberships.service.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireTeamMember, requireRoles } from '../../middleware/tenant.js';

const UpdateMemberSchema = z.object({
  role: RoleSchema.optional(),
  status: z.enum(['active', 'suspended', 'removed']).optional(),
});

export const membershipRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /teams/:teamId/members
   * List all members of the team.
   */
  fastify.get<{
    Params: { teamId: string };
  }>(
    '/teams/:teamId/members',
    {
      preHandler: [requireAuth, requireTeamMember],
    },
    async (request, reply) => {
      const { teamId } = request.params;
      const members = await membershipsService.listMembers(teamId);
      return reply.status(200).send({ members });
    }
  );

  /**
   * PATCH /teams/:teamId/members/:memberId
   * Updates role or status. Enforces Owner immutability (Rule A-04).
   */
  fastify.patch<{
    Params: { teamId: string; memberId: string };
  }>(
    '/teams/:teamId/members/:memberId',
    {
      preHandler: [requireAuth, requireTeamMember, requireRoles(['owner'])],
    },
    async (request, reply) => {
      const { teamId, memberId } = request.params;
      const body = UpdateMemberSchema.parse(request.body);

      const member = await membershipsService.updateMemberRoleOrStatus(
        teamId,
        memberId,
        request.userId!,
        body
      );

      return reply.status(200).send({ member });
    }
  );
};
