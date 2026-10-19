/**
 * =============================================================================
 * Rota API — Activity Events Repository
 * =============================================================================
 * AGENTS.md §3.2 (A-08), §3.5 (D-01, D-03, D-05), §4 (L-05):
 * All SQL for activity feed pagination, filtering, and insertion.
 *
 * Feed Cursor Pattern (Rule D-01):
 *   Tuple comparison (created_at, id) < ($cursorCreatedAt::timestamptz, $cursorId::uuid)
 *   Order: created_at DESC, id DESC
 *   Uses index activity_team_cursor_idx (team_id, created_at DESC, id DESC)
 *
 * Visibility Filter Pattern (Rule A-08):
 *   - team: all active members
 *   - managers: owner and manager roles
 *   - owner: owner role only (billing events)
 *   - participants: owner, managers, or members whose id is in participant_membership_ids
 * =============================================================================
 */

import { sql } from 'kysely';
import { getShardDb } from '../../db/index.js';
import type { ShardTransaction } from '../../db/index.js';

export interface ActivityEventRow {
  id: string;
  team_id: string;
  actor_membership_id: string | null;
  event_type: string;
  subject_type: string | null;
  subject_id: string | null;
  params: unknown;
  visibility: 'team' | 'managers' | 'owner' | 'participants';
  participant_membership_ids: string[];
  created_at: Date;
  created_at_text: string;
}

export interface ActivityFilterOptions {
  viewerRole: 'owner' | 'manager' | 'staff';
  viewerMembershipId: string;
  cursorCreatedAt?: string | null;
  cursorId?: string | null;
  limit: number;
}

export const activityRepo = {
  /**
   * Cursor-paginated query with server-side visibility filtering (Rules D-01, A-08).
   * Fetches limit + 1 rows to detect if next page exists.
   */
  async getFeedPage(
    teamId: string,
    opts: ActivityFilterOptions
  ): Promise<ActivityEventRow[]> {
    const db = getShardDb(teamId);
    const cursorCreatedAt = opts.cursorCreatedAt ?? null;
    const cursorId = opts.cursorId ?? null;
    const fetchLimit = opts.limit + 1;

    const result = await sql<ActivityEventRow>`
      SELECT id, team_id, actor_membership_id, event_type, subject_type, subject_id, params,
             visibility, participant_membership_ids, created_at, created_at::text AS created_at_text
      FROM activity_events
      WHERE team_id = ${teamId}::uuid
        AND (${cursorCreatedAt}::timestamptz IS NULL OR (created_at, id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid))
        AND (visibility = 'team'
          OR (visibility = 'managers' AND ${opts.viewerRole} IN ('owner', 'manager'))
          OR (visibility = 'owner' AND ${opts.viewerRole} = 'owner')
          OR (visibility = 'participants'
              AND (${opts.viewerRole} IN ('owner', 'manager') OR ${opts.viewerMembershipId}::uuid = ANY(participant_membership_ids))))
      ORDER BY created_at DESC, id DESC
      LIMIT ${fetchLimit}
    `.execute(db);

    return result.rows;
  },

  /**
   * Fetches the newest 50 raw events for a team (Rule D-03).
   * Unfiltered at SQL level; used to populate the 30-second Redis first-page cache.
   */
  async getRawFirstPage(teamId: string, limit = 50): Promise<ActivityEventRow[]> {
    const db = getShardDb(teamId);
    const result = await sql<ActivityEventRow>`
      SELECT id, team_id, actor_membership_id, event_type, subject_type, subject_id, params,
             visibility, participant_membership_ids, created_at, created_at::text AS created_at_text
      FROM activity_events
      WHERE team_id = ${teamId}::uuid
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}
    `.execute(db);

    return result.rows;
  },

  /**
   * Inserts an activity event inside the transaction of the change it describes (Rules D-05, A-08).
   */
  async insertEvent(
    teamId: string,
    event: {
      actorMembershipId?: string | null;
      eventType: string;
      subjectType?: string | null;
      subjectId?: string | null;
      params?: Record<string, unknown>;
      visibility: 'team' | 'managers' | 'owner' | 'participants';
      participantMembershipIds?: string[];
    },
    trx?: ShardTransaction
  ): Promise<ActivityEventRow> {
    const executor = trx ?? getShardDb(teamId);
    const paramsJson = JSON.stringify(event.params ?? {});
    const participants = event.participantMembershipIds ?? [];

    const result = await sql<ActivityEventRow>`
      INSERT INTO activity_events (
        team_id, actor_membership_id, event_type, subject_type, subject_id,
        params, visibility, participant_membership_ids
      ) VALUES (
        ${teamId}::uuid,
        ${event.actorMembershipId ?? null}::uuid,
        ${event.eventType},
        ${event.subjectType ?? null},
        ${event.subjectId ?? null}::uuid,
        ${paramsJson}::jsonb,
        ${event.visibility},
        ${participants}::uuid[]
      )
      RETURNING id, team_id, actor_membership_id, event_type, subject_type, subject_id, params,
                visibility, participant_membership_ids, created_at, created_at::text AS created_at_text
    `.execute(executor);

    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to insert activity event');
    }
    return row;
  },

  /**
   * Counts events in a team (useful for verifying 10k seed).
   */
  async countEvents(teamId: string): Promise<number> {
    const db = getShardDb(teamId);
    const result = await sql<{ count: string }>`
      SELECT count(*)::text AS count
      FROM activity_events
      WHERE team_id = ${teamId}::uuid
    `.execute(db);

    return parseInt(result.rows[0]?.count ?? '0', 10);
  },

  /**
   * Backfills any existing published shifts that are missing from activity_events.
   */
  async backfillPublishedShifts(teamId: string): Promise<number> {
    const db = getShardDb(teamId);
    const result = await sql`
      INSERT INTO activity_events (
        team_id, actor_membership_id, event_type, subject_type, subject_id,
        params, visibility, participant_membership_ids, created_at
      )
      SELECT
        s.team_id,
        s.updated_by_membership_id,
        'shift.published',
        'shift',
        s.id,
        json_build_object(
          'shiftId', s.id,
          'shiftTitle', s.title,
          'startsAt', to_char(s.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'endsAt', to_char(s.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'locationLabel', s.location_label
        )::jsonb,
        'team',
        COALESCE(
          (SELECT array_agg(sa.membership_id) FROM shift_assignments sa WHERE sa.shift_id = s.id AND sa.status = 'assigned'),
          ARRAY[]::uuid[]
        ),
        COALESCE(s.published_at, s.updated_at, s.created_at)
      FROM shifts s
      WHERE s.team_id = ${teamId}::uuid
        AND s.status = 'published'
        AND NOT EXISTS (
          SELECT 1 FROM activity_events ae
          WHERE ae.team_id = s.team_id
            AND ae.subject_id = s.id
            AND ae.event_type = 'shift.published'
        )
    `.execute(db);
    return Number(result.numAffectedRows ?? 0);
  },
};
