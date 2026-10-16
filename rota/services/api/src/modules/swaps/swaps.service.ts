/**
 * =============================================================================
 * Rota API — Swaps Service
 * =============================================================================
 * AGENTS.md §3.2 (A-01, A-10), §4 (L-05):
 * Business rules for the direct-handoff swap workflow.
 *
 * State machine:
 *   pending → declined (target declines)
 *   pending → withdrawn (requester withdraws)
 *   pending → expired (job or shift cancellation)
 *   pending → approved (manager approves after target accepts)
 *   pending → rejected (manager rejects)
 *
 * Rules enforced here:
 *   - Only requester can withdraw (A-10)
 *   - Only target can accept/decline (A-10)
 *   - Manager/Owner approves only after target_accepted_at is set (A-10)
 *   - Approver ≠ requester and ≠ target, except Owner self-approval (A-10)
 *   - Approval atomically transfers the assignment with overlap re-check (A-10)
 *   - Partial unique index swaps_one_pending catches duplicate submits (A-10)
 * =============================================================================
 */

import {
  swapsRepo,
  SwapNotFoundError,
  SwapStateError,
  OverlapError,
} from './swaps.repo.js';
import { shiftsRepo } from '../shifts/shifts.repo.js';
import { getShardDb } from '../../db/index.js';
import type { SwapRequestDto } from '@rota/contracts';

export class SwapError extends Error {
  constructor(
    public code:
      | 'NOT_FOUND'
      | 'FORBIDDEN'
      | 'VALIDATION_ERROR'
      | 'SWAP_DUPLICATE'
      | 'SWAP_NOT_PENDING'
      | 'SWAP_NOT_ACCEPTED'
      | 'SWAP_NOT_YOURS'
      | 'SHIFT_NOT_PUBLISHED'
      | 'SHIFT_IN_PAST'
      | 'NOT_ASSIGNED'
      | 'OVERLAPPING_SHIFT'
      | 'APPROVER_CONFLICT'
      | 'SHIFT_CANCELLED',
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'SwapError';
  }
}

function toDto(row: NonNullable<Awaited<ReturnType<typeof swapsRepo.findById>>>): SwapRequestDto {
  return {
    id: row.id,
    teamId: row.team_id,
    shiftId: row.shift_id,
    requesterMembershipId: row.requester_membership_id,
    targetMembershipId: row.target_membership_id,
    status: row.status,
    targetAcceptedAt: row.target_accepted_at?.toISOString() ?? null,
    expiredReason: row.expired_reason,
    message: row.message,
    reviewedByMembershipId: row.reviewed_by_membership_id,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    decisionNote: row.decision_note,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export const swapsService = {
  async listSwaps(
    teamId: string,
    membershipId: string,
    role: 'owner' | 'manager' | 'staff'
  ): Promise<SwapRequestDto[]> {
    const rows = await swapsRepo.listForMember(teamId, membershipId, role);
    return rows.map(toDto);
  },

  async getSwap(
    teamId: string,
    swapId: string,
    membershipId: string,
    role: 'owner' | 'manager' | 'staff'
  ): Promise<SwapRequestDto> {
    const row = await swapsRepo.findById(teamId, swapId);
    if (!row) throw new SwapError('NOT_FOUND', 'Swap request not found', 404);

    // Staff: only participants can view (A-08)
    if (
      role === 'staff' &&
      row.requester_membership_id !== membershipId &&
      row.target_membership_id !== membershipId
    ) {
      throw new SwapError('NOT_FOUND', 'Swap request not found', 404);
    }

    return toDto(row);
  },

  /**
   * Creates a swap request (A-10):
   * - Shift must be published and in the future.
   * - Requester must be currently assigned.
   * - Target must be a different active member.
   * - One pending swap per shift+requester enforced by DB index swaps_one_pending.
   */
  async createSwap(params: {
    teamId: string;
    shiftId: string;
    requesterMembershipId: string;
    targetMembershipId: string;
    message?: string | undefined;
    idempotencyKey?: string | undefined;
  }): Promise<SwapRequestDto> {
    if (params.requesterMembershipId === params.targetMembershipId) {
      throw new SwapError('VALIDATION_ERROR', 'Cannot request a swap with yourself', 400);
    }

    const shift = await shiftsRepo.findShiftById(params.teamId, params.shiftId);
    if (!shift) throw new SwapError('NOT_FOUND', 'Shift not found', 404);
    if (shift.status !== 'published') {
      throw new SwapError('SHIFT_NOT_PUBLISHED', 'Swaps can only be requested for published shifts', 409);
    }
    if (shift.starts_at <= new Date()) {
      throw new SwapError('SHIFT_IN_PAST', 'Shift has already started', 409);
    }

    // Requester must be assigned
    const assignment = await shiftsRepo.getAssignment(
      params.teamId,
      params.shiftId,
      params.requesterMembershipId
    );
    if (!assignment) {
      throw new SwapError('NOT_ASSIGNED', 'You are not assigned to this shift', 409);
    }

    // Verify target is an active member of this team
    const db = getShardDb(params.teamId);
    const targetMember = await db
      .selectFrom('team_memberships')
      .select(['id', 'status'])
      .where('team_id', '=', params.teamId)
      .where('id', '=', params.targetMembershipId)
      .where('status', '=', 'active')
      .executeTakeFirst();

    if (!targetMember) {
      throw new SwapError('NOT_FOUND', 'Target member not found in this team', 404);
    }

    try {
      const row = await swapsRepo.create({
        teamId: params.teamId,
        shiftId: params.shiftId,
        requesterMembershipId: params.requesterMembershipId,
        targetMembershipId: params.targetMembershipId,
        message: params.message ?? null,
        idempotencyKey: params.idempotencyKey ?? null,
      });
      return toDto(row);
    } catch (err) {
      // Postgres unique violation on swaps_one_pending index
      const pg = err as { code?: string };
      if (pg.code === '23505') {
        throw new SwapError('SWAP_DUPLICATE', 'A pending swap already exists for this shift', 409);
      }
      throw err;
    }
  },

  /**
   * Target responds: accept or decline (A-10).
   */
  async respondToSwap(params: {
    teamId: string;
    swapId: string;
    membershipId: string;
    action: 'accept' | 'decline';
  }): Promise<SwapRequestDto> {
    const swap = await swapsRepo.findById(params.teamId, params.swapId);
    if (!swap) throw new SwapError('NOT_FOUND', 'Swap request not found', 404);

    if (swap.target_membership_id !== params.membershipId) {
      throw new SwapError('FORBIDDEN', 'Only the target member can respond to this swap', 403);
    }

    if (swap.status !== 'pending') {
      throw new SwapError('SWAP_NOT_PENDING', `Swap is already ${swap.status}`, 409);
    }

    if (params.action === 'accept') {
      const row = await swapsRepo.acceptByTarget(params.teamId, params.swapId);
      return toDto(row);
    } else {
      const row = await swapsRepo.declineByTarget(params.teamId, params.swapId);
      return toDto(row);
    }
  },

  /**
   * Manager/Owner reviews (approve or reject) after target acceptance (A-10).
   */
  async reviewSwap(params: {
    teamId: string;
    swapId: string;
    approverMembershipId: string;
    approverRole: 'owner' | 'manager';
    action: 'approve' | 'reject';
    decisionNote?: string | undefined;
  }): Promise<SwapRequestDto> {
    const swap = await swapsRepo.findById(params.teamId, params.swapId);
    if (!swap) throw new SwapError('NOT_FOUND', 'Swap request not found', 404);

    if (swap.status !== 'pending') {
      throw new SwapError('SWAP_NOT_PENDING', `Swap is already ${swap.status}`, 409);
    }

    if (params.action === 'reject') {
      // Check approver isn't in conflict even for reject
      if (
        params.approverRole !== 'owner' &&
        (params.approverMembershipId === swap.requester_membership_id ||
          params.approverMembershipId === swap.target_membership_id)
      ) {
        throw new SwapError('APPROVER_CONFLICT', 'Approver cannot be the requester or target', 403);
      }
      const row = await swapsRepo.rejectByManager({
        teamId: params.teamId,
        swapId: params.swapId,
        approverMembershipId: params.approverMembershipId,
        decisionNote: params.decisionNote ?? null,
      });
      return toDto(row);
    }

    // Approve path
    if (!swap.target_accepted_at) {
      throw new SwapError('SWAP_NOT_ACCEPTED', 'Target has not yet accepted the swap', 409);
    }

    // Detect self-approval (Owner requester with no manager, A-10)
    const isSelfApproved =
      params.approverRole === 'owner' &&
      params.approverMembershipId === swap.requester_membership_id;

    try {
      const row = await swapsRepo.approveAtomic({
        teamId: params.teamId,
        swapId: params.swapId,
        approverMembershipId: params.approverMembershipId,
        approverRole: params.approverRole,
        decisionNote: params.decisionNote ?? null,
        isSelfApproved,
      });
      return toDto(row);
    } catch (err) {
      if (err instanceof SwapNotFoundError) {
        throw new SwapError('NOT_FOUND', 'Swap not found', 404);
      }
      if (err instanceof SwapStateError) {
        const code = err.code as SwapError['code'];
        throw new SwapError(code, err.message, 409);
      }
      if (err instanceof OverlapError) {
        throw new SwapError('OVERLAPPING_SHIFT', err.message, 409);
      }
      throw err;
    }
  },

  /**
   * Requester withdraws a pending swap (A-10).
   */
  async withdrawSwap(
    teamId: string,
    swapId: string,
    requesterMembershipId: string
  ): Promise<SwapRequestDto> {
    const swap = await swapsRepo.findById(teamId, swapId);
    if (!swap) throw new SwapError('NOT_FOUND', 'Swap request not found', 404);

    if (swap.requester_membership_id !== requesterMembershipId) {
      throw new SwapError('FORBIDDEN', 'Only the requester can withdraw this swap', 403);
    }

    if (swap.status !== 'pending') {
      throw new SwapError('SWAP_NOT_PENDING', `Swap is already ${swap.status}`, 409);
    }

    const row = await swapsRepo.withdraw(teamId, swapId, requesterMembershipId);
    return toDto(row);
  },

  /**
   * Called when a shift is cancelled — expires all its pending swaps
   * in the SAME transaction (A-10). Returns the number of swaps expired.
   */
  async expireSwapsForShift(teamId: string, shiftId: string): Promise<void> {
    await swapsRepo.expirePendingSwapsForShift(teamId, shiftId, 'shift_cancelled');
  },
};
