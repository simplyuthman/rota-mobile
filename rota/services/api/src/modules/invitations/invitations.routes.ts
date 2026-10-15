/**
 * =============================================================================
 * Rota API — Invitations Routes
 * =============================================================================
 * AGENTS.md §3.2 (A-05, A-06), §3.3 (S-08) & §4 (L-05):
 * HTTP endpoints for creating, inspecting, and accepting invitations.
 */

import type { FastifyPluginAsync } from 'fastify';
import { CreateInvitationRequestSchema, AcceptInvitationRequestSchema } from '@rota/contracts';
import { invitationsService } from './invitations.service.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireTeamMember, requireRoles } from '../../middleware/tenant.js';
import { rateLimits } from '../../middleware/rateLimit.js';

export const invitationRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /teams/:teamId/invitations
   * Only the Owner invites (Rule A-05).
   * Rate limited: 20/hr per team (Rule S-08).
   */
  fastify.post<{
    Params: { teamId: string };
  }>(
    '/teams/:teamId/invitations',
    {
      preHandler: [
        requireAuth,
        requireTeamMember,
        requireRoles(['owner']),
        rateLimits.invitesTeam,
      ],
    },
    async (request, reply) => {
      const body = CreateInvitationRequestSchema.parse(request.body);
      const { teamId } = request.params;

      const invitation = await invitationsService.createInvitation(
        teamId,
        request.membership!.id,
        request.userId!,
        request.teamRole!,
        {
          email: body.email ?? null,
          role: body.intendedRole,
        }
      );

      return reply.status(201).send({ invitation });
    }
  );

  /**
   * GET /invitations/:token
   * Public preview of invite details before acceptance.
   */
  fastify.get<{
    Params: { token: string };
  }>('/invitations/:token', async (request, reply) => {
    const { token } = request.params;
    const details = await invitationsService.getInvitationByToken(token);
    return reply.status(200).send({ invitation: details });
  });

  /**
   * POST /invitations/accept
   * Atomic seat limit check and acceptance (Rule A-06).
   * Requires verified email if invite was bound to email (Rule S-07).
   */
  fastify.post(
    '/invitations/accept',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const body = AcceptInvitationRequestSchema.parse(request.body);

      const result = await invitationsService.acceptInvitation(
        request.userId!,
        body.token
      );

      return reply.status(200).send(result);
    }
  );
};
