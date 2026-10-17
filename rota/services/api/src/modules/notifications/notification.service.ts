/**
 * =============================================================================
 * Rota API — Notification Service & Worker Execution
 * =============================================================================
 * AGENTS.md §3.4 (P-04, P-05, P-06) & §4 (L-01, L-02):
 * - notification_jobs is the source of truth; BullMQ / worker only executes
 * - Enforce quiet hours on the server in recipient's time zone
 * - Security events (new sign-in, logout-all, password change) bypass quiet hours
 * - Pre-send re-check drops stale notifications (e.g. cancelled shift)
 * - Delayed items collapse into one digest push
 * - Push tokens upsert and reassign user_id on shared phones
 * =============================================================================
 */

import { pushDevicesRepo, type PushDeviceRow } from './push-devices.repo.js';
import { notificationsRepo, type NotificationJobRow } from './notifications.repo.js';
import { settingsRepo } from '../settings/settings.repo.js';
import { evaluateQuietHours } from './quiet-hours.js';
import { getPushAdapter } from '../../adapters/push/index.js';
import { getShardDb } from '../../db/index.js';
import type { RegisterPushTokenRequest } from '@rota/contracts';

export class NotificationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'NotificationError';
  }
}

export const notificationService = {
  // ── Push Device Registration (Rule P-04) ───────────────────────────────────

  async registerPushToken(
    userId: string,
    input: RegisterPushTokenRequest
  ): Promise<PushDeviceRow> {
    return pushDevicesRepo.upsert({
      userId,
      provider: input.provider,
      token: input.token,
      platform: input.platform,
      deviceLabel: input.deviceLabel,
    });
  },

  async deactivatePushToken(userId: string, token: string): Promise<boolean> {
    return pushDevicesRepo.deactivate(userId, token);
  },

  async deactivateAllForUser(userId: string): Promise<number> {
    return pushDevicesRepo.deactivateAllForUser(userId);
  },

  // ── Enqueue Notification Job (Rules L-02, P-05, P-06) ──────────────────────

  async enqueueNotificationJob(params: {
    teamId: string;
    outboxEventId: string;
    userId: string;
    category: 'shift' | 'swap' | 'billing' | 'activity' | 'security';
    eventType: string;
    payload: { type: string; teamId: string; entityId: string };
    collapseKey?: string | null;
    now?: Date;
  }): Promise<NotificationJobRow | undefined> {
    const now = params.now ?? new Date();

    // 1. Load recipient user settings from control plane DB
    const settings = await settingsRepo.findByUserId(params.userId);

    // 2. Check category toggle in notification_preferences
    if (settings) {
      const prefs = (settings.notification_preferences as Record<string, boolean>) || {};
      const categoryKeyMap: Record<string, string> = {
        shift: 'shift_changes',
        swap: 'swaps',
        billing: 'billing',
        activity: 'activity',
        security: 'security',
      };
      const prefKey = categoryKeyMap[params.category];

      // If user toggled this category off (security cannot be toggled off)
      if (params.category !== 'security' && prefKey && prefs[prefKey] === false) {
        return undefined; // Drop notification if user muted category
      }
    }

    // 3. Evaluate quiet hours in the user's timezone (Rule P-06)
    let scheduledFor = now;
    let isDelayed = false;

    if (params.category === 'security') {
      // Security events ALWAYS bypass quiet hours immediately (Rule P-06)
      scheduledFor = now;
    } else if (settings && settings.quiet_hours_enabled) {
      const { inQuietHours, nextQuietHoursEnd } = evaluateQuietHours({
        enabled: settings.quiet_hours_enabled,
        start: settings.quiet_hours_start,
        end: settings.quiet_hours_end,
        timezone: settings.timezone,
        now,
      });

      if (inQuietHours && nextQuietHoursEnd) {
        scheduledFor = nextQuietHoursEnd;
        isDelayed = true;
      }
    }

    const collapseKey =
      params.collapseKey ??
      (isDelayed ? `digest:${params.userId}:${params.category}` : null);

    // 4. Create notification job with UNIQUE (outbox_event_id, user_id, category)
    const job = await notificationsRepo.createJob({
      teamId: params.teamId,
      outboxEventId: params.outboxEventId,
      userId: params.userId,
      category: params.category,
      eventType: params.eventType,
      payload: params.payload, // Rule P-05: {type, teamId, entityId} only
      collapseKey,
      scheduledFor,
    });

    if (!job) {
      // Duplicate outbox publish was ignored via unique constraint
      return undefined;
    }

    // 5. Digest collapse for delayed items (Rule L-02)
    if (isDelayed && collapseKey) {
      await notificationsRepo.collapseDelayedJobs({
        teamId: params.teamId,
        userId: params.userId,
        collapseKey,
        keepJobId: job.id,
      });
    }

    return job;
  },

  // ── Process Job Execution & Pre-send Re-check (Rule L-02) ──────────────────

  async processJob(teamId: string, jobId: string): Promise<{ status: string; reason?: string }> {
    const job = await notificationsRepo.findById(teamId, jobId);
    if (!job) {
      return { status: 'not_found' };
    }

    if (job.status !== 'pending' && job.status !== 'failed') {
      return { status: job.status, reason: 'Job already processed or cancelled' };
    }

    // Pre-send re-check (Rule L-02): verify the entity still matches the event
    const payload = job.payload as { type?: string; teamId?: string; entityId?: string };
    const shardDb = getShardDb(teamId);

    if (payload.type === 'shift' && payload.entityId) {
      const shift = await shardDb
        .selectFrom('shifts')
        .select(['id', 'status'])
        .where('id', '=', payload.entityId)
        .where('team_id', '=', teamId)
        .executeTakeFirst();

      // If shift was cancelled or deleted while notification was waiting, drop it!
      if (!shift || shift.status === 'cancelled') {
        await notificationsRepo.markCancelled(teamId, jobId, 'stale_entity_cancelled');
        return { status: 'cancelled', reason: 'Shift cancelled or missing before send' };
      }
    } else if (payload.type === 'swap' && payload.entityId) {
      const swap = await shardDb
        .selectFrom('swap_requests')
        .select(['id', 'status'])
        .where('id', '=', payload.entityId)
        .where('team_id', '=', teamId)
        .executeTakeFirst();

      if (!swap || swap.status === 'expired') {
        await notificationsRepo.markCancelled(teamId, jobId, 'stale_entity_expired');
        return { status: 'cancelled', reason: 'Swap expired or missing before send' };
      }
    }

    await notificationsRepo.markProcessing(teamId, jobId);

    // Load recipient's active push tokens from control plane DB
    const devices = await pushDevicesRepo.findActiveByUserId(job.user_id);

    if (devices.length === 0) {
      // User has no registered devices yet
      await notificationsRepo.markSent(teamId, jobId, 'no_active_devices');
      return { status: 'sent', reason: 'No active push devices' };
    }

    const adapter = getPushAdapter();
    let sentCount = 0;
    let lastProviderId: string | undefined;

    for (const device of devices) {
      const result = await adapter.sendPush({
        to: device.token_ciphertext ?? device.token_hash,
        title: 'Rota Update',
        body: `New update on your team schedule (${job.event_type.replace(/[._]/g, ' ')})`,
        data: {
          type: payload.type || 'activity',
          teamId: payload.teamId || teamId,
          entityId: payload.entityId || job.id,
        },
      });

      if (result.success) {
        sentCount++;
        lastProviderId = result.messageId;
      }
    }

    if (sentCount > 0) {
      await notificationsRepo.markSent(teamId, jobId, lastProviderId);
      return { status: 'sent', reason: `Sent to ${sentCount} devices` };
    } else {
      await notificationsRepo.markFailed(teamId, jobId, 'ALL_DEVICES_FAILED');
      return { status: 'failed', reason: 'All push sends failed' };
    }
  },

  // ── Due Job Processing (Repeatable 1-minute job) ───────────────────────────

  async processDueJobsForTeam(teamId: string, limit: number = 50): Promise<number> {
    const dueJobs = await notificationsRepo.findDueJobs(teamId, limit);
    let processed = 0;

    for (const job of dueJobs) {
      await this.processJob(teamId, job.id);
      processed++;
    }

    return processed;
  },
};
