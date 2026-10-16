/**
 * =============================================================================
 * Rota API — Shifts Routes
 * =============================================================================
 * AGENTS.md §3.2 (A-01, A-02, A-07) & §4 (L-05):
 * Thin HTTP layer: parse Zod schemas, run auth middleware, delegate to service.
 *
 * Routes:
 *   GET    /teams/:teamId/shifts              — list shifts
 *   POST   /teams/:teamId/shifts              — create shift (Owner/Manager)
 *   GET    /teams/:teamId/shifts/:shiftId     — get one shift
 *   PATCH  /teams/:teamId/shifts/:shiftId     — update draft shift (Owner/Manager)
 *   POST   /teams/:teamId/shifts/:shiftId/publish  — publish (Owner/Manager)
 *   DELETE /teams/:teamId/shifts/:shiftId     — cancel (Owner/Manager) [A-01]
 *   POST   /teams/:teamId/shifts/:shiftId/assignments/:membershipId — assign
 * =============================================================================
 */

import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../../middleware/auth.js';
import { requireTeamMember, requireRoles } from '../../middleware/tenant.js';
import { shiftsService, ShiftError } from './shifts.service.js';
import {
  CreateShiftRequestSchema,
  UpdateShiftRequestSchema,
  PublishShiftRequestSchema,
} from '@rota/contracts';

export const shiftRoutes: FastifyPluginAsync = async (fastify) => {
  // ── List shifts ─────────────────────────────────────────────────────────────
  fastify.get<{ Params: { teamId: string } }>(
    '/teams/:teamId/shifts',
    { preHandler: [requireAuth, requireTeamMember] },
    async (request, reply) => {
      const { teamId } = request.params;
      const role = request.membership!.role;
      const shifts = await shiftsService.listShifts(teamId, role);
      return reply.send({ shifts });
    }
  );

  // ── Create shift (Owner/Manager) ────────────────────────────────────────────
  fastify.post<{ Params: { teamId: string } }>(
    '/teams/:teamId/shifts',
    { preHandler: [requireAuth, requireTeamMember, requireRoles(['owner', 'manager'])] },
    async (request, reply) => {
      const { teamId } = request.params;
      const parsed = CreateShiftRequestSchema.safeParse(request.body);
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
        const shift = await shiftsService.createShift(
          teamId,
          request.membership!.id,
          parsed.data
        );
        return reply.status(201).send({ shift });
      } catch (err) {
        if (err instanceof ShiftError) {
          return reply.status(err.statusCode).send({
            error: { code: err.code, message: err.message, requestId: request.id },
          });
        }
        throw err;
      }
    }
  );

  // ── Get one shift ───────────────────────────────────────────────────────────
  fastify.get<{ Params: { teamId: string; shiftId: string } }>(
    '/teams/:teamId/shifts/:shiftId',
    { preHandler: [requireAuth, requireTeamMember] },
    async (request, reply) => {
      const { teamId, shiftId } = request.params;
      const role = request.membership!.role;

      try {
        const shift = await shiftsService.getShift(teamId, shiftId, role);
        return reply.send({ shift });
      } catch (err) {
        if (err instanceof ShiftError) {
          return reply.status(err.statusCode).send({
            error: { code: err.code, message: err.message, requestId: request.id },
          });
        }
        throw err;
      }
    }
  );

  // ── Update draft shift (Owner/Manager) ──────────────────────────────────────
  fastify.patch<{ Params: { teamId: string; shiftId: string } }>(
    '/teams/:teamId/shifts/:shiftId',
    { preHandler: [requireAuth, requireTeamMember, requireRoles(['owner', 'manager'])] },
    async (request, reply) => {
      const { teamId, shiftId } = request.params;
      const parsed = UpdateShiftRequestSchema.safeParse(request.body);
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
        const shift = await shiftsService.updateShift(
          teamId,
          shiftId,
          request.membership!.id,
          parsed.data
        );
        return reply.send({ shift });
      } catch (err) {
        if (err instanceof ShiftError) {
          return reply.status(err.statusCode).send({
            error: { code: err.code, message: err.message, requestId: request.id },
          });
        }
        throw err;
      }
    }
  );

  // ── Publish shift (Owner/Manager) ───────────────────────────────────────────
  fastify.post<{ Params: { teamId: string; shiftId: string } }>(
    '/teams/:teamId/shifts/:shiftId/publish',
    { preHandler: [requireAuth, requireTeamMember, requireRoles(['owner', 'manager'])] },
    async (request, reply) => {
      const { teamId, shiftId } = request.params;
      const parsed = PublishShiftRequestSchema.safeParse(request.body ?? {});
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
        const shift = await shiftsService.publishShift(
          teamId,
          shiftId,
          request.membership!.id,
          parsed.data.assignMembershipId
        );
        return reply.send({ shift });
      } catch (err) {
        if (err instanceof ShiftError) {
          return reply.status(err.statusCode).send({
            error: { code: err.code, message: err.message, requestId: request.id },
          });
        }
        throw err;
      }
    }
  );

  // ── Cancel/Delete shift (Owner/Manager only) — Rule A-01 ───────────────────
  fastify.delete<{ Params: { teamId: string; shiftId: string } }>(
    '/teams/:teamId/shifts/:shiftId',
    { preHandler: [requireAuth, requireTeamMember, requireRoles(['owner', 'manager'])] },
    async (request, reply) => {
      const { teamId, shiftId } = request.params;

      try {
        const shift = await shiftsService.cancelShift(
          teamId,
          shiftId,
          request.membership!.id
        );
        return reply.send({ shift });
      } catch (err) {
        if (err instanceof ShiftError) {
          return reply.status(err.statusCode).send({
            error: { code: err.code, message: err.message, requestId: request.id },
          });
        }
        throw err;
      }
    }
  );

  // ── Assign member to shift (Owner/Manager) ──────────────────────────────────
  fastify.post<{ Params: { teamId: string; shiftId: string; membershipId: string } }>(
    '/teams/:teamId/shifts/:shiftId/assignments/:membershipId',
    { preHandler: [requireAuth, requireTeamMember, requireRoles(['owner', 'manager'])] },
    async (request, reply) => {
      const { teamId, shiftId, membershipId } = request.params;

      try {
        await shiftsService.assignMember(
          teamId,
          shiftId,
          membershipId,
          request.membership!.id
        );
        return reply.status(201).send({ message: 'Member assigned to shift' });
      } catch (err) {
        if (err instanceof ShiftError) {
          return reply.status(err.statusCode).send({
            error: { code: err.code, message: err.message, requestId: request.id },
          });
        }
        throw err;
      }
    }
  );
};
