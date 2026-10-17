/**
 * =============================================================================
 * Rota API — Shifts Repository
 * =============================================================================
 * AGENTS.md §3.2 (A-07, A-09), §3.5 (D-02), §4 (L-05):
 * All SQL for shift CRUD and the overlap-safe assignment insertion.
 *
 * Overlap check pattern (A-09):
 *   Inside ONE transaction:
 *     1. SELECT pg_advisory_xact_lock(hashtextextended($membershipId::text, 0))
 *     2. Check for existing 'assigned' entries whose shift range overlaps the
 *        new shift (Draft or Published shifts, status='assigned')
 *     3. If overlap → throw OverlapError (409 OVERLAPPING_SHIFT)
 *     4. Insert shift_assignments row
 *   No override. No setting.
 * =============================================================================
 */

import { sql } from 'kysely';
import { getShardDb } from '../../db/index.js';
import type { Selectable } from 'kysely';
import type { ShiftsTable, ShiftAssignmentsTable } from '../../db/schema.js';

export type ShiftRow = Selectable<ShiftsTable>;
export type ShiftAssignmentRow = Selectable<ShiftAssignmentsTable>;

export class OverlapError extends Error {
  constructor(message = 'Shift assignment overlaps an existing assignment') {
    super(message);
    this.name = 'OverlapError';
  }
}

export const shiftsRepo = {
  // ── Reads ──────────────────────────────────────────────────────────────────

  async findShiftById(
    teamId: string,
    shiftId: string
  ): Promise<ShiftRow | undefined> {
    const db = getShardDb(teamId);
    return db
      .selectFrom('shifts')
      .selectAll()
      .where('team_id', '=', teamId)
      .where('id', '=', shiftId)
      .executeTakeFirst();
  },

  async listShifts(
    teamId: string,
    opts: { status?: 'draft' | 'published' | 'cancelled' | undefined; limit?: number | undefined }
  ): Promise<ShiftRow[]> {
    const db = getShardDb(teamId);
    let query = db
      .selectFrom('shifts')
      .selectAll()
      .where('team_id', '=', teamId)
      .orderBy('starts_at', 'asc')
      .limit(opts.limit ?? 100);

    if (opts.status) {
      query = query.where('status', '=', opts.status);
    }

    return query.execute();
  },

  async getAssignment(
    teamId: string,
    shiftId: string,
    membershipId: string
  ): Promise<ShiftAssignmentRow | undefined> {
    const db = getShardDb(teamId);
    return db
      .selectFrom('shift_assignments')
      .selectAll()
      .where('team_id', '=', teamId)
      .where('shift_id', '=', shiftId)
      .where('membership_id', '=', membershipId)
      .where('status', '=', 'assigned')
      .executeTakeFirst();
  },

  async listAssignments(
    teamId: string,
    shiftId: string
  ): Promise<ShiftAssignmentRow[]> {
    const db = getShardDb(teamId);
    return db
      .selectFrom('shift_assignments')
      .selectAll()
      .where('team_id', '=', teamId)
      .where('shift_id', '=', shiftId)
      .where('status', '=', 'assigned')
      .execute();
  },

  async listActiveAssignmentsForShifts(
    teamId: string,
    shiftIds: string[]
  ): Promise<ShiftAssignmentRow[]> {
    if (shiftIds.length === 0) return [];
    const db = getShardDb(teamId);
    return db
      .selectFrom('shift_assignments')
      .selectAll()
      .where('team_id', '=', teamId)
      .where('shift_id', 'in', shiftIds)
      .where('status', '=', 'assigned')
      .execute();
  },

  // ── Writes ─────────────────────────────────────────────────────────────────

  async createShift(params: {
    teamId: string;
    title: string;
    locationLabel: string | null;
    notes: string | null;
    startsAt: Date;
    endsAt: Date;
    status: 'draft' | 'published';
    createdByMembershipId: string;
    publishedAt: Date | null;
  }): Promise<ShiftRow> {
    const db = getShardDb(params.teamId);
    return db
      .insertInto('shifts')
      .values({
        team_id: params.teamId,
        title: params.title,
        location_label: params.locationLabel,
        notes: params.notes,
        starts_at: params.startsAt,
        ends_at: params.endsAt,
        status: params.status,
        created_by_membership_id: params.createdByMembershipId,
        updated_by_membership_id: null,
        published_at: params.publishedAt,
        cancelled_at: null,
        updated_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  async updateShift(
    teamId: string,
    shiftId: string,
    updatedByMembershipId: string,
    data: {
      title?: string | undefined;
      locationLabel?: string | null | undefined;
      notes?: string | null | undefined;
      startsAt?: Date | undefined;
      endsAt?: Date | undefined;
    }
  ): Promise<ShiftRow> {
    const db = getShardDb(teamId);
    return db
      .updateTable('shifts')
      .set({
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.locationLabel !== undefined ? { location_label: data.locationLabel } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.startsAt !== undefined ? { starts_at: data.startsAt } : {}),
        ...(data.endsAt !== undefined ? { ends_at: data.endsAt } : {}),
        updated_by_membership_id: updatedByMembershipId,
        updated_at: new Date(),
      })
      .where('team_id', '=', teamId)
      .where('id', '=', shiftId)
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  async publishShift(
    teamId: string,
    shiftId: string,
    updatedByMembershipId: string
  ): Promise<ShiftRow> {
    const db = getShardDb(teamId);
    return db.transaction().execute(async (trx) => {
      const shift = await trx
        .updateTable('shifts')
        .set({
          status: 'published',
          published_at: new Date(),
          updated_by_membership_id: updatedByMembershipId,
          updated_at: new Date(),
        })
        .where('team_id', '=', teamId)
        .where('id', '=', shiftId)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Find active assignments for participant list
      const assignments = await trx
        .selectFrom('shift_assignments')
        .select(['membership_id'])
        .where('team_id', '=', teamId)
        .where('shift_id', '=', shiftId)
        .where('status', '=', 'assigned')
        .execute();

      const participantIds = assignments.map((a) => a.membership_id);

      // Rule D-05: Activity event in the same transaction as the change
      // Notes are strictly excluded from activity events (Rules A-07, D-03)
      await trx
        .insertInto('activity_events')
        .values({
          team_id: teamId,
          actor_membership_id: updatedByMembershipId,
          event_type: 'shift.published',
          subject_type: 'shift',
          subject_id: shift.id,
          params: {
            shiftId: shift.id,
            shiftTitle: shift.title,
            startsAt: shift.starts_at.toISOString(),
            endsAt: shift.ends_at.toISOString(),
            locationLabel: shift.location_label,
          },
          visibility: 'team',
          participant_membership_ids: participantIds,
        })
        .execute();

      return shift;
    });
  },

  /**
   * Cancels a shift and expires all its pending swaps in the SAME transaction (A-10, D-05).
   */
  async cancelShift(
    teamId: string,
    shiftId: string,
    updatedByMembershipId: string
  ): Promise<ShiftRow> {
    const db = getShardDb(teamId);
    return db.transaction().execute(async (trx) => {
      const shift = await trx
        .updateTable('shifts')
        .set({
          status: 'cancelled',
          cancelled_at: new Date(),
          updated_by_membership_id: updatedByMembershipId,
          updated_at: new Date(),
        })
        .where('team_id', '=', teamId)
        .where('id', '=', shiftId)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Rule A-10: Cancelling a shift expires its pending swaps in the same transaction
      await trx
        .updateTable('swap_requests')
        .set({
          status: 'expired',
          expired_reason: 'shift_cancelled',
          updated_at: new Date(),
        })
        .where('team_id', '=', teamId)
        .where('shift_id', '=', shiftId)
        .where('status', '=', 'pending')
        .execute();

      // Rule D-05: Record shift cancellation activity event in the same transaction
      await trx
        .insertInto('activity_events')
        .values({
          team_id: teamId,
          actor_membership_id: updatedByMembershipId,
          event_type: 'shift.cancelled',
          subject_type: 'shift',
          subject_id: shift.id,
          params: {
            shiftId: shift.id,
            shiftTitle: shift.title,
          },
          visibility: 'team',
          participant_membership_ids: [],
        })
        .execute();

      return shift;
    });
  },

  /**
   * Atomically assigns a member to a shift, enforcing the overlap rule (A-09).
   *
   * Protocol inside ONE transaction:
   *   1. Acquire the per-membership advisory lock:
   *      SELECT pg_advisory_xact_lock(hashtextextended($membershipId::text, 0))
   *   2. Check for any active assignment whose shift range overlaps the target range.
   *      Includes Draft and Published shifts (status IN ('draft','published'))
   *      with assignment status = 'assigned'.
   *   3. If overlap found → throw OverlapError (→ 409 OVERLAPPING_SHIFT).
   *   4. Insert or upsert the shift_assignments row.
   *
   * No override. No setting. (A-09)
   */
  async assignMemberToShift(params: {
    teamId: string;
    shiftId: string;
    membershipId: string;
    assignedByMembershipId: string;
    shiftStartsAt: Date;
    shiftEndsAt: Date;
  }): Promise<ShiftAssignmentRow> {
    const db = getShardDb(params.teamId);

    return db.transaction().execute(async (trx) => {
      // Step 1: Advisory lock keyed on the membership_id — prevents two concurrent
      // managers from assigning the same person to overlapping shifts simultaneously.
      // hashtextextended(text, seed) returns bigint, which pg_advisory_xact_lock accepts.
      await sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${params.membershipId}::text, 0))
      `.execute(trx);

      // Step 2: Overlap check — any 'assigned' assignment for this member
      // on a shift that overlaps the target window (Draft or Published shifts).
      // Two ranges [A_start, A_end) and [B_start, B_end) overlap iff
      //   A_start < B_end AND A_end > B_start
      const overlapping = await trx
        .selectFrom('shift_assignments as sa')
        .innerJoin('shifts as s', (join) =>
          join
            .onRef('s.id', '=', 'sa.shift_id')
            .onRef('s.team_id', '=', 'sa.team_id')
        )
        .select('sa.id')
        .where('sa.team_id', '=', params.teamId)
        .where('sa.membership_id', '=', params.membershipId)
        .where('sa.status', '=', 'assigned')
        .where('sa.shift_id', '!=', params.shiftId) // exclude self (for re-assignment)
        .where('s.status', 'in', ['draft', 'published'])
        .where('s.starts_at', '<', params.shiftEndsAt)
        .where('s.ends_at', '>', params.shiftStartsAt)
        .limit(1)
        .execute();

      if (overlapping.length > 0) {
        throw new OverlapError(
          'This member already has an overlapping shift assignment. Overlaps are never allowed.'
        );
      }

      // Step 3: Insert (or upsert if somehow already exists)
      const existing = await trx
        .selectFrom('shift_assignments')
        .selectAll()
        .where('team_id', '=', params.teamId)
        .where('shift_id', '=', params.shiftId)
        .where('membership_id', '=', params.membershipId)
        .executeTakeFirst();

      if (existing) {
        return trx
          .updateTable('shift_assignments')
          .set({ status: 'assigned', assigned_at: new Date() })
          .where('id', '=', existing.id)
          .returningAll()
          .executeTakeFirstOrThrow();
      }

      return trx
        .insertInto('shift_assignments')
        .values({
          team_id: params.teamId,
          shift_id: params.shiftId,
          membership_id: params.membershipId,
          status: 'assigned',
          assigned_by_membership_id: params.assignedByMembershipId,
          assigned_at: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  },

  /** Remove an assignment (sets status='removed'). */
  async removeAssignment(
    teamId: string,
    shiftId: string,
    membershipId: string
  ): Promise<void> {
    const db = getShardDb(teamId);
    await db
      .updateTable('shift_assignments')
      .set({ status: 'removed' })
      .where('team_id', '=', teamId)
      .where('shift_id', '=', shiftId)
      .where('membership_id', '=', membershipId)
      .execute();
  },
};
