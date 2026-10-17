/**
 * =============================================================================
 * Rota API — Shared Tenant Authorization Service
 * =============================================================================
 * AGENTS.md §3.2:
 * - A-01: Enforce every permission on the server. Staff cannot mutate/cancel/delete shifts.
 * - A-02: Scope every team-owned query by team_id from the authenticated membership.
 *         Team A cannot access Team B data.
 * - A-03: Send every request through this shared authorization service.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { getShardDb, getShardReadDbForUser } from '../db/index.js';
import { redisCache } from '../db/redis.js';
import { getTeamCacheVersion } from '../db/cacheVersion.js';
import type { Role } from '@rota/contracts';

export interface ActiveMembership {
  id: string;
  teamId: string;
  userId: string;
  role: Role;
  status: 'active' | 'invited' | 'suspended' | 'removed';
}

declare module 'fastify' {
  interface FastifyRequest {
    membership?: ActiveMembership;
    teamRole?: Role;
  }
}

/**
 * Validates that the authenticated user belongs to the requested team,
 * extracts their active role, and attaches `request.membership`.
 */
export async function requireTeamMember(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const user = request.user;
  if (!user) {
    return reply.status(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        requestId: request.id,
      },
    });
  }

  const teamId =
    (request.params as Record<string, string> | null | undefined)?.['teamId'] ||
    (request.headers['x-team-id'] as string | undefined);

  if (!teamId) {
    return reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Team identifier is required (path parameter or X-Team-Id header)',
        requestId: request.id,
      },
    });
  }

  // Rule D-03: Fast-path check from roster cache if present
  try {
    const v = await getTeamCacheVersion(teamId);
    const cacheKey = `team:${teamId}:roster:v${v}`;
    const cached = await redisCache.get(cacheKey);
    if (cached) {
      const roster = JSON.parse(cached) as Array<{
        id: string;
        teamId: string;
        userId: string;
        role: Role;
        status: string;
      }>;
      const cachedMember = roster.find((m) => m.userId === user.id && m.status === 'active');
      if (cachedMember) {
        request.membership = {
          id: cachedMember.id,
          teamId: cachedMember.teamId,
          userId: cachedMember.userId,
          role: cachedMember.role,
          status: 'active',
        };
        request.teamRole = cachedMember.role;
        return;
      }
    }
  } catch {
    // Fallback to database on cache error
  }

  // Fallback to database: route reads to read replica or primary based on read-your-own-writes (TRD §2)
  const shardDb = await getShardReadDbForUser(teamId, user.id);

  // Rule A-02: Look up authenticated membership strictly on the resolved shard
  const membership = await shardDb
    .selectFrom('team_memberships')
    .selectAll()
    .where('team_id', '=', teamId)
    .where('user_id', '=', user.id)
    .where('status', '=', 'active')
    .executeTakeFirst();

  if (!membership) {
    // Cross-team isolation failure (Rule A-02)
    return reply.status(403).send({
      error: {
        code: 'FORBIDDEN',
        message: 'Access denied: You are not an active member of this team',
        requestId: request.id,
      },
    });
  }

  request.membership = {
    id: membership.id,
    teamId: membership.team_id,
    userId: membership.user_id,
    role: membership.role as Role,
    status: membership.status as 'active',
  };
  request.teamRole = membership.role as Role;
}

/**
 * Enforces role-based permissions (Rules A-01, A-03).
 */
export function requireRoles(allowedRoles: Role[]) {
  return async function roleGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const membership = request.membership;

    if (!membership) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Active membership required',
          requestId: request.id,
        },
      });
    }

    if (!allowedRoles.includes(membership.role)) {
      // Rule A-01: Staff calling manager/owner routes rejected
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: `Insufficient permissions. Required roles: ${allowedRoles.join(', ')}`,
          requestId: request.id,
        },
      });
    }
  };
}
