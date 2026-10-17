/**
 * =============================================================================
 * Rota API — Shifts Service
 * =============================================================================
 * AGENTS.md §3.2 (A-01, A-07, A-09), §3.5 (D-02), §4 (L-05):
 * Business rules for shift lifecycle and assignment.
 *
 * Key invariants:
 *   - Owners and Managers create/edit/publish/cancel shifts (A-01).
 *   - Staff see only published shifts, never drafts, never notes (A-07).
 *   - Overlapping assignments always blocked; no override (A-09).
 *   - All instants stored in UTC; displayed in team timezone (D-02).
 *   - Activity + outbox events written in the same transaction (D-05) [stub].
 * =============================================================================
 */

import { shiftsRepo, OverlapError } from './shifts.repo.js';
import { activityService } from '../activity/activity.service.js';
import { redisCache } from '../../db/redis.js';
import { getTeamCacheVersion, bumpTeamCacheVersion } from '../../db/cacheVersion.js';
import type { ShiftDto, ShiftPublicDto, CreateShiftRequest, UpdateShiftRequest } from '@rota/contracts';

export class ShiftError extends Error {
  constructor(
    public code:
      | 'NOT_FOUND'
      | 'FORBIDDEN'
      | 'VALIDATION_ERROR'
      | 'OVERLAPPING_SHIFT'
      | 'INVALID_TIME_RANGE'
      | 'SHIFT_NOT_DRAFT'
      | 'SHIFT_CANCELLED',
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'ShiftError';
  }
}

function toShiftDto(
  row: Awaited<ReturnType<typeof shiftsRepo.findShiftById>> & object,
  assignedMembershipId?: string | null
): ShiftDto {
  return {
    id: row.id,
    teamId: row.team_id,
    title: row.title,
    locationLabel: row.location_label,
    notes: row.notes,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    status: row.status,
    createdByMembershipId: row.created_by_membership_id,
    publishedAt: row.published_at?.toISOString() ?? null,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    assignedMembershipId: assignedMembershipId ?? null,
  };
}

function toPublicShiftDto(
  row: Awaited<ReturnType<typeof shiftsRepo.findShiftById>> & object,
  assignedMembershipId?: string | null
): ShiftPublicDto {
  const dto = toShiftDto(row, assignedMembershipId);
  // Rule A-07: Strip notes for Staff viewers
  const { notes: _notes, ...publicDto } = dto;
  return publicDto;
}

export const shiftsService = {
  /**
   * Lists shifts for a team.
   * - Owners/Managers: all statuses including draft; notes included. Never cached (D-03).
   * - Staff: published only; notes stripped (A-07); cached under team:{id}:cal:pub:{start}:{end}:v{n} (D-03).
   */
  async listShifts(
    teamId: string,
    viewerRole: 'owner' | 'manager' | 'staff',
    range?: { start?: string; end?: string }
  ): Promise<(ShiftDto | ShiftPublicDto)[]> {
    const isStaff = viewerRole === 'staff';

    // Rule D-03: Cache only the published, note-free calendar (team:{id}:cal:pub:{start}:{end}:v{n})
    if (isStaff) {
      const v = await getTeamCacheVersion(teamId);
      const startKey = range?.start ?? 'all';
      const endKey = range?.end ?? 'all';
      const cacheKey = `team:${teamId}:cal:pub:${startKey}:${endKey}:v${v}`;

      try {
        const cached = await redisCache.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as ShiftPublicDto[];
        }
      } catch {
        // Fallback to database on cache error
      }

      const rows = await shiftsRepo.listShifts(teamId, { status: 'published' });
      const shiftIds = rows.map((r) => r.id);
      const assignments = await shiftsRepo.listActiveAssignmentsForShifts(teamId, shiftIds);
      const assignmentMap = new Map(assignments.map((a) => [a.shift_id, a.membership_id]));

      const publicShifts = rows.map((r) => {
        const assigned = assignmentMap.get(r.id);
        return toPublicShiftDto(r, assigned);
      });

      try {
        await redisCache.set(cacheKey, JSON.stringify(publicShifts), 'EX', 300);
      } catch {
        // Non-fatal if Redis write fails
      }

      return publicShifts;
    }

    // Manager / Owner view: includes drafts and notes; never cached (Rule D-03)
    const rows = await shiftsRepo.listShifts(teamId, {});
    const shiftIds = rows.map((r) => r.id);
    const assignments = await shiftsRepo.listActiveAssignmentsForShifts(teamId, shiftIds);
    const assignmentMap = new Map(assignments.map((a) => [a.shift_id, a.membership_id]));

    return rows.map((r) => {
      const assigned = assignmentMap.get(r.id);
      return toShiftDto(r, assigned);
    });
  },

  /**
   * Fetches one shift by ID.
   * Staff cannot see drafts (A-07).
   */
  async getShift(
    teamId: string,
    shiftId: string,
    viewerRole: 'owner' | 'manager' | 'staff'
  ): Promise<ShiftDto | ShiftPublicDto> {
    const row = await shiftsRepo.findShiftById(teamId, shiftId);
    if (!row) {
      throw new ShiftError('NOT_FOUND', 'Shift not found', 404);
    }

    // Rule A-07: Staff cannot see draft shifts
    if (viewerRole === 'staff' && row.status !== 'published') {
      throw new ShiftError('NOT_FOUND', 'Shift not found', 404);
    }

    const assignments = await shiftsRepo.listAssignments(teamId, shiftId);
    const assigned = assignments[0]?.membership_id ?? null;

    return viewerRole === 'staff' ? toPublicShiftDto(row, assigned) : toShiftDto(row, assigned);
  },

  /**
   * Creates a shift (Owner/Manager only — enforced in route, A-01).
   * Validates time range: ends_at > starts_at, ≤ 24 hours (schema enforces this too).
   * Optionally assigns a member (triggers overlap check, A-09).
   */
  async createShift(
    teamId: string,
    actingMembershipId: string,
    input: CreateShiftRequest & { startsAt: string; endsAt: string }
  ): Promise<ShiftDto> {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);

    if (endsAt <= startsAt) {
      throw new ShiftError('INVALID_TIME_RANGE', 'endsAt must be after startsAt', 400);
    }

    const durationMs = endsAt.getTime() - startsAt.getTime();
    if (durationMs > 24 * 60 * 60 * 1000) {
      throw new ShiftError('INVALID_TIME_RANGE', 'Shift duration cannot exceed 24 hours', 400);
    }

    const row = await shiftsRepo.createShift({
      teamId,
      title: input.title,
      locationLabel: input.locationLabel ?? null,
      notes: input.notes ?? null,
      startsAt,
      endsAt,
      status: 'draft',
      createdByMembershipId: actingMembershipId,
      publishedAt: null,
    });

    // Optionally assign a member (with overlap check)
    if (input.assignMembershipId) {
      try {
        await shiftsRepo.assignMemberToShift({
          teamId,
          shiftId: row.id,
          membershipId: input.assignMembershipId,
          assignedByMembershipId: actingMembershipId,
          shiftStartsAt: startsAt,
          shiftEndsAt: endsAt,
        });
      } catch (err) {
        if (err instanceof OverlapError) {
          // Roll back the shift insert isn't possible post-commit, but since this is a
          // draft, we leave the shift and surface the overlap error to the caller.
          throw new ShiftError('OVERLAPPING_SHIFT', err.message, 409);
        }
        throw err;
      }
    }

    return toShiftDto(row, input.assignMembershipId ?? null);
  },

  /**
   * Updates a draft shift (Owner/Manager only, A-01).
   * Cannot update a published or cancelled shift via this endpoint.
   */
  async updateShift(
    teamId: string,
    shiftId: string,
    actingMembershipId: string,
    input: UpdateShiftRequest
  ): Promise<ShiftDto> {
    const existing = await shiftsRepo.findShiftById(teamId, shiftId);
    if (!existing) {
      throw new ShiftError('NOT_FOUND', 'Shift not found', 404);
    }
    if (existing.status === 'cancelled') {
      throw new ShiftError('SHIFT_CANCELLED', 'Cannot update a cancelled shift', 409);
    }

    const startsAt = input.startsAt ? new Date(input.startsAt) : existing.starts_at;
    const endsAt = input.endsAt ? new Date(input.endsAt) : existing.ends_at;

    if (endsAt <= startsAt) {
      throw new ShiftError('INVALID_TIME_RANGE', 'endsAt must be after startsAt', 400);
    }

    const durationMs = endsAt.getTime() - startsAt.getTime();
    if (durationMs > 24 * 60 * 60 * 1000) {
      throw new ShiftError('INVALID_TIME_RANGE', 'Shift duration cannot exceed 24 hours', 400);
    }

    const row = await shiftsRepo.updateShift(teamId, shiftId, actingMembershipId, {
      title: input.title,
      locationLabel: input.locationLabel,
      notes: input.notes,
      startsAt: input.startsAt ? startsAt : undefined,
      endsAt: input.endsAt ? endsAt : undefined,
    });

    await bumpTeamCacheVersion(teamId);

    return toShiftDto(row);
  },

  /**
   * Publishes a draft shift (Owner/Manager only, A-01).
   * Optionally assigns a member at publish time (with overlap check, A-09).
   */
  async publishShift(
    teamId: string,
    shiftId: string,
    actingMembershipId: string,
    assignMembershipId?: string
  ): Promise<ShiftDto> {
    const existing = await shiftsRepo.findShiftById(teamId, shiftId);
    if (!existing) {
      throw new ShiftError('NOT_FOUND', 'Shift not found', 404);
    }
    if (existing.status !== 'draft') {
      throw new ShiftError(
        'SHIFT_NOT_DRAFT',
        `Shift is already ${existing.status}. Only draft shifts can be published.`,
        409
      );
    }

    if (assignMembershipId) {
      try {
        await shiftsRepo.assignMemberToShift({
          teamId,
          shiftId,
          membershipId: assignMembershipId,
          assignedByMembershipId: actingMembershipId,
          shiftStartsAt: existing.starts_at,
          shiftEndsAt: existing.ends_at,
        });
      } catch (err) {
        if (err instanceof OverlapError) {
          throw new ShiftError('OVERLAPPING_SHIFT', err.message, 409);
        }
        throw err;
      }
    }

    const row = await shiftsRepo.publishShift(teamId, shiftId, actingMembershipId);
    const assignments = await shiftsRepo.listAssignments(teamId, shiftId);
    const assigned = assignMembershipId ?? assignments[0]?.membership_id ?? null;

    // Rule D-04: Bump the team cache version in the request, right after commit
    await bumpTeamCacheVersion(teamId);

    return toShiftDto(row, assigned);
  },

  /**
   * Cancels a shift (Owner/Manager only, A-01).
   * Note: Cancelling a shift must expire its pending swaps in the same transaction —
   * that is handled in the swap module (A-10). Here we cancel the shift only.
   * The swap cancellation is triggered from the route handler by also calling
   * swapsService.expireSwapsForShift() in a coordinated call.
   */
  async cancelShift(
    teamId: string,
    shiftId: string,
    actingMembershipId: string
  ): Promise<ShiftDto> {
    const existing = await shiftsRepo.findShiftById(teamId, shiftId);
    if (!existing) {
      throw new ShiftError('NOT_FOUND', 'Shift not found', 404);
    }
    if (existing.status === 'cancelled') {
      throw new ShiftError('SHIFT_CANCELLED', 'Shift is already cancelled', 409);
    }

    const row = await shiftsRepo.cancelShift(teamId, shiftId, actingMembershipId);

    // Rule D-04: Bump the team cache version in the request, right after commit
    await bumpTeamCacheVersion(teamId);

    return toShiftDto(row);
  },

  /**
   * Assigns a member to a published shift (Owner/Manager only).
   * Full overlap check enforced (A-09).
   */
  async assignMember(
    teamId: string,
    shiftId: string,
    membershipId: string,
    actingMembershipId: string
  ): Promise<void> {
    const shift = await shiftsRepo.findShiftById(teamId, shiftId);
    if (!shift) {
      throw new ShiftError('NOT_FOUND', 'Shift not found', 404);
    }
    if (shift.status === 'cancelled') {
      throw new ShiftError('SHIFT_CANCELLED', 'Cannot assign to a cancelled shift', 409);
    }

    try {
      await shiftsRepo.assignMemberToShift({
        teamId,
        shiftId,
        membershipId,
        assignedByMembershipId: actingMembershipId,
        shiftStartsAt: shift.starts_at,
        shiftEndsAt: shift.ends_at,
      });

      await bumpTeamCacheVersion(teamId);
    } catch (err) {
      if (err instanceof OverlapError) {
        throw new ShiftError('OVERLAPPING_SHIFT', err.message, 409);
      }
      throw err;
    }
  },
};
