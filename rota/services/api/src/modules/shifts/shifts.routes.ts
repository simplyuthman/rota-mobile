/**
 * =============================================================================
 * Rota API — Shifts Routes
 * =============================================================================
 * AGENTS.md §3.2 (A-01, A-02, A-07) & §4 (L-05):
 * HTTP endpoints for shift management.
 * Enforces Rule A-01: Staff cannot delete or mutate shifts (403 FORBIDDEN).
 */

import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../../middleware/auth.js';
import { requireTeamMember, requireRoles } from '../../middleware/tenant.js';
import { getShardDb } from '../../db/index.js';

export const shiftRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * DELETE /teams/:teamId/shifts/:shiftId
   * Cancels/deletes a shift.
   * Gated strictly to Owner and Manager (Rule A-01).
   */
  fastify.delete<{
    Params: { teamId: string; shiftId: string };
  }>(
    '/teams/:teamId/shifts/:shiftId',
    {
      preHandler: [requireAuth, requireTeamMember, requireRoles(['owner', 'manager'])],
    },
    async (request, reply) => {
      const { teamId, shiftId } = request.params;
      const shardDb = getShardDb(teamId);

      const shift = await shardDb
        .selectFrom('shifts')
        .selectAll()
        .where('team_id', '=', teamId)
        .where('id', '=', shiftId)
        .executeTakeFirst();

      if (!shift) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Shift not found',
            requestId: request.id,
          },
        });
      }

      await shardDb
        .updateTable('shifts')
        .set({
          status: 'cancelled',
          cancelled_at: new Date(),
          updated_at: new Date(),
          updated_by_membership_id: request.membership!.id,
        })
        .where('team_id', '=', teamId)
        .where('id', '=', shiftId)
        .execute();

      return reply.status(200).send({ message: 'Shift cancelled successfully' });
    }
  );
};
