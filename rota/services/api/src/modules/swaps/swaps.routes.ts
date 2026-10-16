/**
 * =============================================================================
 * Rota API — Swaps Routes
 * =============================================================================
 * AGENTS.md §3.2 (A-01, A-10) & §4 (L-05):
 * Thin HTTP layer: parse Zod schemas, run auth middleware, delegate to service.
 *
 * Routes:
 *   GET  /teams/:teamId/swaps                    — list swaps (role-filtered)
 *   POST /teams/:teamId/shifts/:shiftId/swaps    — create swap request
 *   GET  /teams/:teamId/swaps/:swapId            — get one swap
 *   POST /teams/:teamId/swaps/:swapId/respond    — target: accept/decline
 *   POST /teams/:teamId/swaps/:swapId/review     — manager: approve/reject
 *   POST /teams/:teamId/swaps/:swapId/withdraw   — requester: withdraw
 * =============================================================================
 */

import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../../middleware/auth.js';
import { requireTeamMember, requireRoles } from '../../middleware/tenant.js';
import { swapsService, SwapError } from './swaps.service.js';
import {
  CreateSwapRequestSchema,
  RespondSwapRequestSchema,
  ReviewSwapRequestSchema,
} from '@rota/contracts';

export const swapRoutes: FastifyPluginAsync = async (fastify) => {
  // ── List swaps (role-filtered) ──────────────────────────────────────────────
  fastify.get<{ Params: { teamId: string } }>(
    '/teams/:teamId/swaps',
    { preHandler: [requireAuth, requireTeamMember] },
    async (request, reply) => {
      const { teamId } = request.params;
      const { id: membershipId, role } = request.membership!;
      const swaps = await swapsService.listSwaps(teamId, membershipId, role);
      return reply.send({ swaps });
    }
  );

  // ── Create swap request ─────────────────────────────────────────────────────
  fastify.post<{ Params: { teamId: string; shiftId: string } }>(
    '/teams/:teamId/shifts/:shiftId/swaps',
    { preHandler: [requireAuth, requireTeamMember] },
    async (request, reply) => {
      const { teamId, shiftId } = request.params;
      const parsed = CreateSwapRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.errors.map((e) => e.message).join(', '),
            requestId: request.id,
          },
        });
      }

      try {
        const swap = await swapsService.createSwap({
          teamId,
          shiftId,
          requesterMembershipId: request.membership!.id,
          targetMembershipId: parsed.data.targetMembershipId,
          message: parsed.data.message,
          idempotencyKey: parsed.data.idempotencyKey,
        });
        return reply.status(201).send({ swap });
      } catch (err) {
        if (err instanceof SwapError) {
          return reply.status(err.statusCode).send({
            error: { code: err.code, message: err.message, requestId: request.id },
          });
        }
        throw err;
      }
    }
  );

  // ── Get one swap ────────────────────────────────────────────────────────────
  fastify.get<{ Params: { teamId: string; swapId: string } }>(
    '/teams/:teamId/swaps/:swapId',
    { preHandler: [requireAuth, requireTeamMember] },
    async (request, reply) => {
      const { teamId, swapId } = request.params;
      const { id: membershipId, role } = request.membership!;

      try {
        const swap = await swapsService.getSwap(teamId, swapId, membershipId, role);
        return reply.send({ swap });
      } catch (err) {
        if (err instanceof SwapError) {
          return reply.status(err.statusCode).send({
            error: { code: err.code, message: err.message, requestId: request.id },
          });
        }
        throw err;
      }
    }
  );

  // ── Respond to swap (target: accept / decline) ──────────────────────────────
  fastify.post<{ Params: { teamId: string; swapId: string } }>(
    '/teams/:teamId/swaps/:swapId/respond',
    { preHandler: [requireAuth, requireTeamMember] },
    async (request, reply) => {
      const { teamId, swapId } = request.params;
      const parsed = RespondSwapRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.errors.map((e) => e.message).join(', '),
            requestId: request.id,
          },
        });
      }

      try {
        const swap = await swapsService.respondToSwap({
          teamId,
          swapId,
          membershipId: request.membership!.id,
          action: parsed.data.action,
        });
        return reply.send({ swap });
      } catch (err) {
        if (err instanceof SwapError) {
          return reply.status(err.statusCode).send({
            error: { code: err.code, message: err.message, requestId: request.id },
          });
        }
        throw err;
      }
    }
  );

  // ── Review swap (Owner/Manager: approve / reject) ───────────────────────────
  fastify.post<{ Params: { teamId: string; swapId: string } }>(
    '/teams/:teamId/swaps/:swapId/review',
    { preHandler: [requireAuth, requireTeamMember, requireRoles(['owner', 'manager'])] },
    async (request, reply) => {
      const { teamId, swapId } = request.params;
      const parsed = ReviewSwapRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.errors.map((e) => e.message).join(', '),
            requestId: request.id,
          },
        });
      }

      const { id: membershipId, role } = request.membership!;

      try {
        const swap = await swapsService.reviewSwap({
          teamId,
          swapId,
          approverMembershipId: membershipId,
          approverRole: role as 'owner' | 'manager',
          action: parsed.data.action,
          decisionNote: parsed.data.decisionNote,
        });
        return reply.send({ swap });
      } catch (err) {
        if (err instanceof SwapError) {
          return reply.status(err.statusCode).send({
            error: { code: err.code, message: err.message, requestId: request.id },
          });
        }
        throw err;
      }
    }
  );

  // ── Withdraw swap (requester only) ──────────────────────────────────────────
  fastify.post<{ Params: { teamId: string; swapId: string } }>(
    '/teams/:teamId/swaps/:swapId/withdraw',
    { preHandler: [requireAuth, requireTeamMember] },
    async (request, reply) => {
      const { teamId, swapId } = request.params;

      try {
        const swap = await swapsService.withdrawSwap(
          teamId,
          swapId,
          request.membership!.id
        );
        return reply.send({ swap });
      } catch (err) {
        if (err instanceof SwapError) {
          return reply.status(err.statusCode).send({
            error: { code: err.code, message: err.message, requestId: request.id },
          });
        }
        throw err;
      }
    }
  );
};
