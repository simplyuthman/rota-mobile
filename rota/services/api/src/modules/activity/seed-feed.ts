/**
 * =============================================================================
 * Rota API — Activity Feed 10,000-Row Seed Script
 * =============================================================================
 * AGENTS.md §3.5 (D-06) & IMPLEMENTATION-PLAN.md Phase 5:
 * Generates at least 10,000 realistic activity events for a given team
 * in a single atomic SQL operation using generate_series().
 *
 * Rules:
 *   - Fast execution (<1 second for 10,000 rows)
 *   - Visibility distribution:
 *       ~25% team (shifts published)
 *       ~25% managers (drafts created)
 *       ~25% owner (billing events)
 *       ~25% participants (swap events)
 *   - Microsecond precision timestamps across 30 days
 *   - Params never contain shift notes (Rule A-07, D-03)
 * =============================================================================
 */

import { sql } from 'kysely';
import { getShardDb } from '../../db/index.js';

export interface SeedFeedOptions {
  teamId: string;
  count?: number;
  actorMembershipId?: string | null;
  participantMembershipIds?: string[];
}

export async function seedFeed(options: SeedFeedOptions): Promise<{ totalInserted: number }> {
  const {
    teamId,
    count = 10000,
    actorMembershipId = null,
    participantMembershipIds = [],
  } = options;

  const db = getShardDb(teamId);

  await sql`
    INSERT INTO activity_events (
      team_id,
      actor_membership_id,
      event_type,
      subject_type,
      subject_id,
      params,
      visibility,
      participant_membership_ids,
      created_at
    )
    SELECT
      ${teamId}::uuid AS team_id,
      ${actorMembershipId ?? null}::uuid AS actor_membership_id,
      CASE (s % 4)
        WHEN 0 THEN 'shift.published'
        WHEN 1 THEN 'shift.draft_created'
        WHEN 2 THEN 'billing.subscription_renewed'
        ELSE 'swap.requested'
      END AS event_type,
      CASE (s % 4)
        WHEN 0 THEN 'shift'
        WHEN 1 THEN 'shift'
        WHEN 2 THEN 'subscription'
        ELSE 'swap_request'
      END AS subject_type,
      gen_random_uuid() AS subject_id,
      jsonb_build_object(
        'index', s,
        'code', 'EVT-' || s,
        'amountCents', CASE WHEN (s % 4) = 2 THEN 5000 ELSE NULL END
      ) AS params,
      CASE (s % 4)
        WHEN 0 THEN 'team'
        WHEN 1 THEN 'managers'
        WHEN 2 THEN 'owner'
        ELSE 'participants'
      END AS visibility,
      ${participantMembershipIds}::uuid[] AS participant_membership_ids,
      now() - interval '30 days' + (s * interval '250 seconds') + ((s % 1000) * interval '1 microsecond') AS created_at
    FROM generate_series(1, ${count}) AS s;
  `.execute(db);

  return { totalInserted: count };
}
