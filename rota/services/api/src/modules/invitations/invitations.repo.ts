/**
 * =============================================================================
 * Rota API — Invitations Repository
 * =============================================================================
 * AGENTS.md §3.2 (A-06), §3.3 (S-06) & §4 (L-05, L-09):
 * SQL queries for invitations and atomic seat-limit enforcement on the shard.
 */

import { sql } from 'kysely';
import { controlPlane, getShardDb } from '../../db/index.js';
import type { InvitationsTable, TeamMembershipsTable } from '../../db/schema.js';
import type { Selectable } from 'kysely';

export type InvitationRow = Selectable<InvitationsTable>;
export type MembershipRow = Selectable<TeamMembershipsTable>;

export class SeatLimitError extends Error {
  constructor(message = 'Team seat limit reached') {
    super(message);
    this.name = 'SeatLimitError';
  }
}

export const invitationsRepo = {
  async createInvitation(data: {
    teamId: string;
    emailNormalized: string | null;
    intendedRole: 'manager' | 'staff';
    tokenHash: string;
    invitedByMembershipId: string;
    expiresAt: Date;
  }): Promise<InvitationRow> {
    const shardDb = getShardDb(data.teamId);
    return await shardDb
      .insertInto('invitations')
      .values({
        team_id: data.teamId,
        email_normalized: data.emailNormalized,
        intended_role: data.intendedRole,
        token_hash: data.tokenHash,
        invited_by_membership_id: data.invitedByMembershipId,
        status: 'pending',
        expires_at: data.expiresAt,
        accepted_by_user_id: null,
        accepted_at: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  async findInvitationByTokenHash(
    teamId: string,
    tokenHash: string
  ): Promise<InvitationRow | undefined> {
    const shardDb = getShardDb(teamId);
    return await shardDb
      .selectFrom('invitations')
      .selectAll()
      .where('team_id', '=', teamId)
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();
  },

  async findInvitationById(teamId: string, id: string): Promise<InvitationRow | undefined> {
    const shardDb = getShardDb(teamId);
    return await shardDb
      .selectFrom('invitations')
      .selectAll()
      .where('team_id', '=', teamId)
      .where('id', '=', id)
      .executeTakeFirst();
  },

  /**
   * Atomic seat-limit check and invitation acceptance (Rule A-06).
   * Runs in one database transaction on the team's shard:
   * 1. SELECT purchased_seats FROM subscriptions WHERE team_id = $1 FOR UPDATE;
   * 2. SELECT count(*) FROM team_memberships WHERE team_id = $1 AND status = 'active';
   * 3. count >= purchased_seats -> ROLLBACK, throw SeatLimitError (409 SEAT_LIMIT)
   * 4. UPDATE invitation status='accepted'
   * 5. INSERT/UPDATE team_memberships status='active'
   * 6. COMMIT
   */
  async acceptInvitationAtomic(params: {
    teamId: string;
    invitationId: string;
    userId: string;
    role: 'manager' | 'staff';
  }): Promise<MembershipRow> {
    const shardDb = getShardDb(params.teamId);

    const membership = await shardDb.transaction().execute(async (trx) => {
      // 1. Lock subscription row
      const sub = await trx
        .selectFrom('subscriptions')
        .select('purchased_seats')
        .where('team_id', '=', params.teamId)
        .forUpdate()
        .executeTakeFirst();

      const purchasedSeats = sub?.purchased_seats ?? 5; // default starter 5 if not yet created

      // 2. Count active memberships (Owner and Managers count as seats, A-06)
      const countRes = await trx
        .selectFrom('team_memberships')
        .select(sql<string>`count(*)`.as('active_count'))
        .where('team_id', '=', params.teamId)
        .where('status', '=', 'active')
        .executeTakeFirstOrThrow();

      const activeCount = parseInt(countRes.active_count, 10);

      // 3. Enforce limit
      if (activeCount >= purchasedSeats) {
        throw new SeatLimitError(`Seat limit reached (${activeCount}/${purchasedSeats})`);
      }

      // 4. Mark invitation accepted
      await trx
        .updateTable('invitations')
        .set({
          status: 'accepted',
          accepted_by_user_id: params.userId,
          accepted_at: new Date(),
        })
        .where('team_id', '=', params.teamId)
        .where('id', '=', params.invitationId)
        .execute();

      // 5. Activate or insert membership
      const existing = await trx
        .selectFrom('team_memberships')
        .selectAll()
        .where('team_id', '=', params.teamId)
        .where('user_id', '=', params.userId)
        .executeTakeFirst();

      let activeMembership: MembershipRow;

      if (existing) {
        activeMembership = await trx
          .updateTable('team_memberships')
          .set({
            role: params.role,
            status: 'active',
            activated_at: new Date(),
            updated_at: new Date(),
          })
          .where('id', '=', existing.id)
          .returningAll()
          .executeTakeFirstOrThrow();
      } else {
        activeMembership = await trx
          .insertInto('team_memberships')
          .values({
            team_id: params.teamId,
            user_id: params.userId,
            role: params.role,
            status: 'active',
            activated_at: new Date(),
            updated_at: new Date(),
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      }

      return activeMembership;
    });

    // 6. Update user_team_index on control plane (non-transactional cross-DB sync)
    await controlPlane
      .insertInto('user_team_index')
      .values({
        user_id: params.userId,
        team_id: params.teamId,
        role: params.role,
        status: 'active',
      })
      .onConflict((oc) =>
        oc.columns(['user_id', 'team_id']).doUpdateSet({
          role: params.role,
          status: 'active',
        })
      )
      .execute();

    return membership;
  },
};
