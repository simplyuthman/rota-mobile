/**
 * =============================================================================
 * Rota API — Teams Repository
 * =============================================================================
 * AGENTS.md §4 (L-05) & §2.2:
 * SQL for team creation and routing.
 * Crosses control-plane (directory, user_team_index) and shard (teams, memberships, subscriptions).
 */

import { controlPlane, getShardDb, getShardId } from '../../db/index.js';
import { config } from '../../config/env.js';
import type { TeamsTable, TeamMembershipsTable } from '../../db/schema.js';
import type { Selectable } from 'kysely';

export type TeamRow = Selectable<TeamsTable>;
export type MembershipRow = Selectable<TeamMembershipsTable>;

export const teamsRepo = {
  async createTeam(data: {
    id: string;
    name: string;
    timezone: string;
    userId: string;
  }): Promise<{ team: TeamRow; membership: MembershipRow }> {
    const shardId = getShardId(data.id);
    const shardDb = getShardDb(data.id);

    // 1. Register on Control Plane
    await controlPlane
      .insertInto('team_directory')
      .values({
        team_id: data.id,
        shard_id: shardId,
      })
      .execute();

    await controlPlane
      .insertInto('user_team_index')
      .values({
        user_id: data.userId,
        team_id: data.id,
        role: 'owner',
        status: 'active',
      })
      .execute();

    // 2. Insert into Shard inside transaction
    return await shardDb.transaction().execute(async (trx) => {
      const team = await trx
        .insertInto('teams')
        .values({
          id: data.id,
          name: data.name,
          timezone: data.timezone,
          created_by_user_id: data.userId,
          status: 'active',
          updated_at: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const membership = await trx
        .insertInto('team_memberships')
        .values({
          team_id: data.id,
          user_id: data.userId,
          role: 'owner',
          status: 'active',
          activated_at: new Date(),
          updated_at: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const starter = config.plans.starter;
      const trialEndsAt = new Date(Date.now() + config.trialDaysMs);

      // Start 14-day Starter trial (AGENTS.md A-11, §2.2)
      await trx
        .insertInto('subscriptions')
        .values({
          team_id: data.id,
          plan: 'starter',
          status: 'trialing',
          currency: 'USD',
          base_price_cents: starter.basePriceCents,
          included_seats: starter.includedSeats,
          extra_seat_price_cents: null,
          purchased_seats: starter.seatCeiling,
          current_recurring_cents: starter.basePriceCents,
          trial_ends_at: trialEndsAt,
          period_start: new Date(),
          period_end: trialEndsAt,
          updated_at: new Date(),
        })
        .execute();

      return { team, membership };
    });
  },

  async findTeamById(teamId: string): Promise<TeamRow | undefined> {
    const shardDb = getShardDb(teamId);
    return await shardDb
      .selectFrom('teams')
      .selectAll()
      .where('id', '=', teamId)
      .executeTakeFirst();
  },
};
