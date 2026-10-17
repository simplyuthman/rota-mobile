/**
 * =============================================================================
 * Rota API — Notifications Repository
 * =============================================================================
 * AGENTS.md §3.4 (P-05, P-06) & §4 (L-02):
 * All SQL for notification_jobs on shard databases:
 *   - UNIQUE (outbox_event_id, user_id, category) prevents duplicate sends
 *   - Payload restricted to {type, teamId, entityId}
 *   - Delayed items collapse into one digest push (collapse_key)
 * =============================================================================
 */

import { sql } from 'kysely';
import { getShardDb } from '../../db/index.js';
import type { Selectable } from 'kysely';
import type { NotificationJobsTable } from '../../db/schema.js';

export type NotificationJobRow = Selectable<NotificationJobsTable>;

export const notificationsRepo = {
  async createJob(params: {
    teamId: string;
    outboxEventId: string;
    userId: string;
    category: 'shift' | 'swap' | 'billing' | 'activity' | 'security';
    eventType: string;
    payload: { type: string; teamId: string; entityId: string };
    collapseKey?: string | null;
    scheduledFor?: Date;
  }): Promise<NotificationJobRow | undefined> {
    const db = getShardDb(params.teamId);

    // Rule L-02: UNIQUE (outbox_event_id, user_id, category) prevents duplicates
    return db
      .insertInto('notification_jobs')
      .values({
        team_id: params.teamId,
        outbox_event_id: params.outboxEventId,
        user_id: params.userId,
        category: params.category,
        event_type: params.eventType,
        payload: params.payload, // Rule P-05: {type, teamId, entityId} only
        collapse_key: params.collapseKey ?? null,
        scheduled_for: params.scheduledFor ?? new Date(),
        status: 'pending',
        attempts: 0,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict((oc: any) =>
        oc.columns(['outbox_event_id', 'user_id', 'category']).doNothing()
      )
      .returningAll()
      .executeTakeFirst();
  },

  async findById(teamId: string, jobId: string): Promise<NotificationJobRow | undefined> {
    const db = getShardDb(teamId);
    return db
      .selectFrom('notification_jobs')
      .selectAll()
      .where('team_id', '=', teamId)
      .where('id', '=', jobId)
      .executeTakeFirst();
  },

  async findDueJobs(teamId: string, limit: number = 50): Promise<NotificationJobRow[]> {
    const db = getShardDb(teamId);
    return db
      .selectFrom('notification_jobs')
      .selectAll()
      .where('team_id', '=', teamId)
      .where('status', 'in', ['pending', 'failed'])
      .where('scheduled_for', '<=', new Date())
      .orderBy('scheduled_for', 'asc')
      .limit(limit)
      .execute();
  },

  async collapseDelayedJobs(params: {
    teamId: string;
    userId: string;
    collapseKey: string;
    keepJobId: string;
  }): Promise<number> {
    const db = getShardDb(params.teamId);

    // Rule L-02: Superseded delayed rows become cancelled with last_error_code='collapsed'
    const result = await db
      .updateTable('notification_jobs')
      .set({
        status: 'cancelled',
        last_error_code: 'collapsed',
      })
      .where('team_id', '=', params.teamId)
      .where('user_id', '=', params.userId)
      .where('collapse_key', '=', params.collapseKey)
      .where('id', '!=', params.keepJobId)
      .where('status', 'in', ['pending', 'failed'])
      .where('scheduled_for', '>', new Date())
      .execute();

    return Number(result[0]?.numUpdatedRows ?? 0);
  },

  async markProcessing(teamId: string, jobId: string): Promise<void> {
    const db = getShardDb(teamId);
    await db
      .updateTable('notification_jobs')
      .set({
        status: 'processing',
        attempts: sql`attempts + 1`,
      })
      .where('team_id', '=', teamId)
      .where('id', '=', jobId)
      .execute();
  },

  async markSent(teamId: string, jobId: string, providerMessageId?: string): Promise<void> {
    const db = getShardDb(teamId);
    await db
      .updateTable('notification_jobs')
      .set({
        status: 'sent',
        sent_at: new Date(),
        provider_message_id: providerMessageId ?? null,
      })
      .where('team_id', '=', teamId)
      .where('id', '=', jobId)
      .execute();
  },

  async markCancelled(teamId: string, jobId: string, reason: string): Promise<void> {
    const db = getShardDb(teamId);
    await db
      .updateTable('notification_jobs')
      .set({
        status: 'cancelled',
        last_error_code: reason,
      })
      .where('team_id', '=', teamId)
      .where('id', '=', jobId)
      .execute();
  },

  async markFailed(teamId: string, jobId: string, errorCode: string): Promise<void> {
    const db = getShardDb(teamId);
    await db
      .updateTable('notification_jobs')
      .set({
        status: 'failed',
        last_error_code: errorCode,
      })
      .where('team_id', '=', teamId)
      .where('id', '=', jobId)
      .execute();
  },
};
