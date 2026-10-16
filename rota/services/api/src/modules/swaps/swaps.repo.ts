/**
 * =============================================================================
 * Rota API — Swaps Repository
 * =============================================================================
 * AGENTS.md §3.2 (A-10) & §4 (L-05):
 * All SQL for swap request lifecycle:
 *   - Create (partial-unique index swaps_one_pending guards duplicates)
 *   - Accept/decline by target
 *   - Approve/reject by manager — atomically with assignment swap under locks
 *   - Expire pending swaps (job) and on shift cancellation
 *
 * Approve transaction protocol (A-10):
 *   1. BEGIN
 *   2. SELECT … FROM swap_requests WHERE id = $1 FOR UPDATE
 *   3. SELECT … FROM shifts WHERE id = $shiftId FOR UPDATE (re-check shift status)
 *   4. Advisory lock on target membership (for overlap check inside approve)
 *   5. Re-check eligibility: target_accepted_at SET, approver ≠ requester & target
 *   6. Re-check no overlap for target after assignment change
 *   7. Remove requester's old assignment, insert target's new assignment
 *   8. Set swap status = 'approved', reviewed_by, reviewed_at
 *   9. Insert activity_events + domain_outbox_events (D-05)
 *   10. COMMIT
 * =============================================================================
 */

import { sql } from 'kysely';
import { getShardDb } from '../../db/index.js';
import type { Selectable, Transaction, Kysely } from 'kysely';
import type { SwapRequestsTable, ShardDB } from '../../db/schema.js';

export type SwapRow = Selectable<SwapRequestsTable>;

export class SwapNotFoundError extends Error {
  constructor() { super('Swap request not found'); this.name = 'SwapNotFoundError'; }
}
export class SwapStateError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'SwapStateError';
  }
}
export class OverlapError extends Error {
  constructor(message: string) { super(message); this.name = 'OverlapError'; }
}

export const swapsRepo = {
  // ── Reads ──────────────────────────────────────────────────────────────────

  async findById(teamId: string, swapId: string): Promise<SwapRow | undefined> {
    const db = getShardDb(teamId);
    return db
      .selectFrom('swap_requests')
      .selectAll()
      .where('team_id', '=', teamId)
      .where('id', '=', swapId)
      .executeTakeFirst();
  },

  async listForMember(
    teamId: string,
    membershipId: string,
    role: 'owner' | 'manager' | 'staff'
  ): Promise<SwapRow[]> {
    const db = getShardDb(teamId);
    let query = db
      .selectFrom('swap_requests')
      .selectAll()
      .where('team_id', '=', teamId)
      .orderBy('created_at', 'desc')
      .limit(50);

    // Staff only see swaps they are requester or target of (participant-level, A-08)
    if (role === 'staff') {
      query = query.where((eb) =>
        eb.or([
          eb('requester_membership_id', '=', membershipId),
          eb('target_membership_id', '=', membershipId),
        ])
      );
    }

    return query.execute();
  },

  // ── Create ─────────────────────────────────────────────────────────────────

  async create(params: {
    teamId: string;
    shiftId: string;
    requesterMembershipId: string;
    targetMembershipId: string;
    message: string | null;
    idempotencyKey: string | null;
  }): Promise<SwapRow> {
    const db = getShardDb(params.teamId);
    return db
      .insertInto('swap_requests')
      .values({
        team_id: params.teamId,
        shift_id: params.shiftId,
        requester_membership_id: params.requesterMembershipId,
        target_membership_id: params.targetMembershipId,
        status: 'pending',
        target_accepted_at: null,
        expired_reason: null,
        message: params.message,
        reviewed_by_membership_id: null,
        reviewed_at: null,
        decision_note: null,
        idempotency_key: params.idempotencyKey,
        updated_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  // ── Target respond: accept / decline ────────────────────────────────────────

  async acceptByTarget(teamId: string, swapId: string): Promise<SwapRow> {
    const db = getShardDb(teamId);
    return db
      .updateTable('swap_requests')
      .set({
        target_accepted_at: new Date(),
        updated_at: new Date(),
      })
      .where('team_id', '=', teamId)
      .where('id', '=', swapId)
      .where('status', '=', 'pending')
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  async declineByTarget(teamId: string, swapId: string): Promise<SwapRow> {
    const db = getShardDb(teamId);
    return db
      .updateTable('swap_requests')
      .set({
        status: 'declined',
        updated_at: new Date(),
      })
      .where('team_id', '=', teamId)
      .where('id', '=', swapId)
      .where('status', '=', 'pending')
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  // ── Manager/Owner approve — full atomic transaction (A-10) ─────────────────

  /**
   * Approves a swap atomically.
   *
   * Steps inside ONE transaction:
   *   1. Lock swap row FOR UPDATE; re-read state.
   *   2. Lock shift row FOR UPDATE; verify shift is published and in future.
   *   3. Verify target_accepted_at is set (cannot approve without target consent).
   *   4. Verify approver ≠ requester and ≠ target
   *      (exception: Owner is requester with no manager → tag self_approved).
   *   5. Take advisory lock on target membership_id (overlap check).
   *   6. Check target has no overlap with this shift time.
   *   7. Remove requester assignment; insert target assignment.
   *   8. Mark swap approved.
   *   9. Insert activity_event + domain_outbox_event (D-05).
   */
  async approveAtomic(params: {
    teamId: string;
    swapId: string;
    approverMembershipId: string;
    approverRole: 'owner' | 'manager';
    decisionNote: string | null;
    isSelfApproved: boolean;
  }): Promise<SwapRow> {
    const db = getShardDb(params.teamId);

    return db.transaction().execute(async (trx) => {
      // Step 1: Lock swap row
      const swap = await trx
        .selectFrom('swap_requests')
        .selectAll()
        .where('team_id', '=', params.teamId)
        .where('id', '=', params.swapId)
        .forUpdate()
        .executeTakeFirst();

      if (!swap) throw new SwapNotFoundError();

      if (swap.status !== 'pending') {
        throw new SwapStateError(
          'SWAP_NOT_PENDING',
          `Cannot approve a swap with status '${swap.status}'`
        );
      }

      if (!swap.target_accepted_at) {
        throw new SwapStateError(
          'SWAP_NOT_ACCEPTED',
          'Cannot approve until the target member has accepted'
        );
      }

      // Step 2: Lock shift row
      const shift = await trx
        .selectFrom('shifts')
        .selectAll()
        .where('team_id', '=', params.teamId)
        .where('id', '=', swap.shift_id)
        .forUpdate()
        .executeTakeFirst();

      if (!shift || shift.status !== 'published') {
        throw new SwapStateError(
          'SHIFT_NOT_PUBLISHED',
          'Swap can only be approved for a published shift'
        );
      }

      if (shift.starts_at <= new Date()) {
        throw new SwapStateError(
          'SHIFT_IN_PAST',
          'Cannot approve a swap for a shift that has already started'
        );
      }

      // Step 4: Approver must not be requester or target (A-10)
      if (
        !params.isSelfApproved &&
        (params.approverMembershipId === swap.requester_membership_id ||
          params.approverMembershipId === swap.target_membership_id)
      ) {
        throw new SwapStateError(
          'APPROVER_CONFLICT',
          'Approver cannot be the requester or the target'
        );
      }

      // Step 5: Advisory lock on target (overlap check)
      await sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${swap.target_membership_id}::text, 0))
      `.execute(trx);

      // Step 6: Overlap check for target
      const overlapping = await trx
        .selectFrom('shift_assignments as sa')
        .innerJoin('shifts as s', (join) =>
          join
            .onRef('s.id', '=', 'sa.shift_id')
            .onRef('s.team_id', '=', 'sa.team_id')
        )
        .select('sa.id')
        .where('sa.team_id', '=', params.teamId)
        .where('sa.membership_id', '=', swap.target_membership_id)
        .where('sa.status', '=', 'assigned')
        .where('sa.shift_id', '!=', shift.id) // exclude the shift being swapped
        .where('s.status', 'in', ['draft', 'published'])
        .where('s.starts_at', '<', shift.ends_at)
        .where('s.ends_at', '>', shift.starts_at)
        .limit(1)
        .execute();

      if (overlapping.length > 0) {
        throw new OverlapError(
          'Target member has an overlapping assignment; swap cannot be approved'
        );
      }

      // Step 7: Transfer assignment: remove requester, insert target
      await trx
        .updateTable('shift_assignments')
        .set({ status: 'removed' })
        .where('team_id', '=', params.teamId)
        .where('shift_id', '=', shift.id)
        .where('membership_id', '=', swap.requester_membership_id)
        .where('status', '=', 'assigned')
        .execute();

      await trx
        .insertInto('shift_assignments')
        .values({
          team_id: params.teamId,
          shift_id: shift.id,
          membership_id: swap.target_membership_id,
          status: 'assigned',
          assigned_by_membership_id: params.approverMembershipId,
          assigned_at: new Date(),
        })
        .execute();

      // Step 8: Mark swap approved
      const updatedSwap = await trx
        .updateTable('swap_requests')
        .set({
          status: params.isSelfApproved ? 'approved' : 'approved',
          expired_reason: params.isSelfApproved ? 'self_approved' : null,
          reviewed_by_membership_id: params.approverMembershipId,
          reviewed_at: new Date(),
          decision_note: params.decisionNote,
          updated_at: new Date(),
        })
        .where('id', '=', params.swapId)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Step 9: Activity + outbox events (D-05)
      await trx
        .insertInto('activity_events')
        .values({
          team_id: params.teamId,
          actor_membership_id: params.approverMembershipId,
          event_type: 'swap_approved',
          subject_type: 'swap_request',
          subject_id: params.swapId,
          params: {
            swapId: params.swapId,
            shiftId: shift.id,
            requesterMembershipId: swap.requester_membership_id,
            targetMembershipId: swap.target_membership_id,
            selfApproved: params.isSelfApproved,
          },
          // Participants visibility (A-08)
          visibility: 'participants',
          participant_membership_ids: [
            swap.requester_membership_id,
            swap.target_membership_id,
            params.approverMembershipId,
          ],
        })
        .execute();

      await trx
        .insertInto('domain_outbox_events')
        .values({
          team_id: params.teamId,
          event_type: 'swap_approved',
          aggregate_type: 'swap_request',
          aggregate_id: params.swapId,
          payload: {
            teamId: params.teamId,
            shiftId: shift.id,
            requesterMembershipId: swap.requester_membership_id,
            targetMembershipId: swap.target_membership_id,
          },
          published_at: null,
          attempts: 0,
        })
        .execute();

      return updatedSwap;
    });
  },

  // ── Reject by manager ───────────────────────────────────────────────────────

  async rejectByManager(params: {
    teamId: string;
    swapId: string;
    approverMembershipId: string;
    decisionNote: string | null;
  }): Promise<SwapRow> {
    const db = getShardDb(params.teamId);
    return db
      .updateTable('swap_requests')
      .set({
        status: 'rejected',
        reviewed_by_membership_id: params.approverMembershipId,
        reviewed_at: new Date(),
        decision_note: params.decisionNote,
        updated_at: new Date(),
      })
      .where('team_id', '=', params.teamId)
      .where('id', '=', params.swapId)
      .where('status', '=', 'pending')
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  // ── Withdraw (by requester) ─────────────────────────────────────────────────

  async withdraw(teamId: string, swapId: string, requesterMembershipId: string): Promise<SwapRow> {
    const db = getShardDb(teamId);
    return db
      .updateTable('swap_requests')
      .set({ status: 'withdrawn', updated_at: new Date() })
      .where('team_id', '=', teamId)
      .where('id', '=', swapId)
      .where('requester_membership_id', '=', requesterMembershipId)
      .where('status', '=', 'pending')
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  // ── Expire (job or shift cancellation) ─────────────────────────────────────

  /**
   * Expires pending swaps for a specific shift in the SAME transaction as
   * shift cancellation (A-10: cancelling a shift expires pending swaps).
   * Pass `trx` when called from the shift cancellation context.
   */
  async expirePendingSwapsForShift(
    teamId: string,
    shiftId: string,
    reason: string,
    trx?: Transaction<ShardDB> | Kysely<ShardDB>
  ): Promise<void> {
    const executor = trx ?? getShardDb(teamId);
    await (executor as ReturnType<typeof getShardDb>)
      .updateTable('swap_requests')
      .set({
        status: 'expired',
        expired_reason: reason,
        updated_at: new Date(),
      })
      .where('team_id', '=', teamId)
      .where('shift_id', '=', shiftId)
      .where('status', '=', 'pending')
      .execute();
  },

  /** Expire pending swaps past their natural expiry (shift start or 7-day cutoff). */
  async expireStaleSwaps(teamId: string): Promise<number> {
    const db = getShardDb(teamId);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await db
      .updateTable('swap_requests')
      .set({ status: 'expired', expired_reason: 'natural_expiry', updated_at: new Date() })
      .where('team_id', '=', teamId)
      .where('status', '=', 'pending')
      .where((eb) =>
        eb.or([
          // Swap older than 7 days
          eb('created_at', '<', sevenDaysAgo),
          // Shift has already started
          eb(
            'shift_id',
            'in',
            db
              .selectFrom('shifts')
              .select('id')
              .where('team_id', '=', teamId)
              .where('starts_at', '<=', new Date())
          ),
        ])
      )
      .executeTakeFirst();

    return typeof result?.numUpdatedRows === 'bigint' ? Number(result.numUpdatedRows) : 0;
  },
};
