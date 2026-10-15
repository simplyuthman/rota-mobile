/**
 * =============================================================================
 * Rota API — Memberships Service
 * =============================================================================
 * AGENTS.md §3.2 (A-04):
 * Owner is protected: cannot change own role, deactivate self, or set another member to Owner
 * Returns 409 OWNER_IMMUTABLE. Never rely on the unique index to catch this.
 */

import { membershipsRepo } from './memberships.repo.js';
import type { Role, TeamMembershipDto } from '@rota/contracts';

export class MembershipError extends Error {
  constructor(
    public code: 'OWNER_IMMUTABLE' | 'NOT_FOUND' | 'FORBIDDEN' | 'VALIDATION_ERROR',
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'MembershipError';
  }
}

export const membershipsService = {
  async listMembers(teamId: string): Promise<TeamMembershipDto[]> {
    const rows = await membershipsRepo.listTeamMemberships(teamId);
    return rows.map((m) => ({
      id: m.id,
      teamId: m.team_id,
      userId: m.user_id,
      role: m.role as Role,
      status: m.status as 'active',
      activatedAt: m.activated_at ? m.activated_at.toISOString() : null,
      createdAt: m.created_at.toISOString(),
    }));
  },

  async updateMemberRoleOrStatus(
    teamId: string,
    memberId: string,
    actingUserId: string,
    data: { role?: Role | undefined; status?: ('active' | 'suspended' | 'removed') | undefined }
  ): Promise<TeamMembershipDto> {
    const targetMember = await membershipsRepo.findMembershipById(teamId, memberId);
    if (!targetMember) {
      throw new MembershipError('NOT_FOUND', 'Membership not found', 404);
    }

    const isTargetOwner = targetMember.role === 'owner';

    // ── Rule A-04 Enforcement ────────────────────────────────────────────────

    // 1. Owner cannot change their own role
    if (isTargetOwner && data.role && data.role !== 'owner') {
      throw new MembershipError(
        'OWNER_IMMUTABLE',
        'Owner cannot change their own role.',
        409
      );
    }

    // 2. Owner cannot deactivate their own membership
    if (isTargetOwner && data.status && data.status !== 'active') {
      throw new MembershipError(
        'OWNER_IMMUTABLE',
        'Owner cannot deactivate or remove their own membership.',
        409
      );
    }

    // 3. Cannot set another member to Owner (ownership transfer out of scope)
    if (!isTargetOwner && data.role === 'owner') {
      throw new MembershipError(
        'OWNER_IMMUTABLE',
        'Cannot assign owner role to another member.',
        409
      );
    }

    const updated = await membershipsRepo.updateMembership(teamId, memberId, data);

    return {
      id: updated.id,
      teamId: updated.team_id,
      userId: updated.user_id,
      role: updated.role as Role,
      status: updated.status as 'active',
      activatedAt: updated.activated_at ? updated.activated_at.toISOString() : null,
      createdAt: updated.created_at.toISOString(),
    };
  },
};
