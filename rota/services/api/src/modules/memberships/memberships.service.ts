/**
 * =============================================================================
 * Rota API — Memberships Service
 * =============================================================================
 * AGENTS.md §3.2 (A-04):
 * Owner is protected: cannot change own role, deactivate self, or set another member to Owner
 * Returns 409 OWNER_IMMUTABLE. Never rely on the unique index to catch this.
 */

import { membershipsRepo } from './memberships.repo.js';
import { controlPlane } from '../../db/index.js';
import { redisCache } from '../../db/redis.js';
import { getTeamCacheVersion, bumpTeamCacheVersion } from '../../db/cacheVersion.js';
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
  /**
   * Lists active team memberships with user display names and emails.
   * Cached under team:{teamId}:roster:v{n} with a 300s TTL (Rule D-03).
   */
  async listMembers(teamId: string): Promise<TeamMembershipDto[]> {
    const v = await getTeamCacheVersion(teamId);
    const cacheKey = `team:${teamId}:roster:v${v}`;

    try {
      const cached = await redisCache.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as TeamMembershipDto[];
      }
    } catch {
      // Fallback to database on cache error
    }

    const rows = await membershipsRepo.listTeamMemberships(teamId);
    const userIds = rows.map((m) => m.user_id);
    const users =
      userIds.length > 0
        ? await controlPlane
            .selectFrom('users')
            .select(['id', 'display_name', 'email'])
            .where('id', 'in', userIds)
            .execute()
        : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const result = rows.map((m) => {
      const u = userMap.get(m.user_id);
      return {
        id: m.id,
        teamId: m.team_id,
        userId: m.user_id,
        role: m.role as Role,
        status: m.status as 'active',
        displayName: u?.display_name ?? null,
        email: u?.email ?? null,
        activatedAt: m.activated_at ? m.activated_at.toISOString() : null,
        createdAt: m.created_at.toISOString(),
      };
    });

    try {
      await redisCache.set(cacheKey, JSON.stringify(result), 'EX', 300);
    } catch {
      // Non-fatal if cache write fails
    }

    return result;
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

    // Rule D-04: Invalidate roster cache on membership mutation
    await bumpTeamCacheVersion(teamId);

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
