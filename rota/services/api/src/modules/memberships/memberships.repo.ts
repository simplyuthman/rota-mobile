/**
 * =============================================================================
 * Rota API — Memberships Repository
 * =============================================================================
 * AGENTS.md §4 (L-05) & §3.2 (A-04, A-06):
 * SQL queries for team memberships on shard.
 */

import { getShardDb, controlPlane } from '../../db/index.js';
import type { TeamMembershipsTable } from '../../db/schema.js';
import type { Selectable } from 'kysely';
import type { Role } from '@rota/contracts';

export type MembershipRow = Selectable<TeamMembershipsTable>;

export const membershipsRepo = {
  async listTeamMemberships(teamId: string): Promise<MembershipRow[]> {
    const shardDb = getShardDb(teamId);
    return await shardDb
      .selectFrom('team_memberships')
      .selectAll()
      .where('team_id', '=', teamId)
      .execute();
  },

  async findMembershipById(
    teamId: string,
    memberId: string
  ): Promise<MembershipRow | undefined> {
    const shardDb = getShardDb(teamId);
    return await shardDb
      .selectFrom('team_memberships')
      .selectAll()
      .where('team_id', '=', teamId)
      .where('id', '=', memberId)
      .executeTakeFirst();
  },

  async findOwnerMembership(teamId: string): Promise<MembershipRow | undefined> {
    const shardDb = getShardDb(teamId);
    return await shardDb
      .selectFrom('team_memberships')
      .selectAll()
      .where('team_id', '=', teamId)
      .where('role', '=', 'owner')
      .where('status', '=', 'active')
      .executeTakeFirst();
  },

  async updateMembership(
    teamId: string,
    memberId: string,
    data: { role?: Role | undefined; status?: ('active' | 'suspended' | 'removed') | undefined }
  ): Promise<MembershipRow> {
    const shardDb = getShardDb(teamId);

    const updated = await shardDb
      .updateTable('team_memberships')
      .set({
        ...(data.role ? { role: data.role } : {}),
        ...(data.status ? { status: data.status } : {}),
        updated_at: new Date(),
      })
      .where('team_id', '=', teamId)
      .where('id', '=', memberId)
      .returningAll()
      .executeTakeFirstOrThrow();

    // Synchronize user_team_index on control plane (reconcilable cache)
    await controlPlane
      .updateTable('user_team_index')
      .set({
        ...(data.role ? { role: data.role } : {}),
        ...(data.status ? { status: data.status } : {}),
      })
      .where('team_id', '=', teamId)
      .where('user_id', '=', updated.user_id)
      .execute();

    return updated;
  },
};
