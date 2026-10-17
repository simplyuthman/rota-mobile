/**
 * =============================================================================
 * Rota API — Tier 7 Graduation Evidence Integration Tests
 * =============================================================================
 * Proves the critical graduation criteria for Tier 7 (Push Notifications & Tap Router):
 *
 * 1. Evidence 1 (Rule L-02):
 *    - UNIQUE (outbox_event_id, user_id, category) blocks duplicate sends on
 *      repeated outbox publish.
 *
 * 2. Evidence 2 (Rule L-02):
 *    - Repeatable re-enqueue / due job runner recovers and processes jobs.
 *
 * 3. Evidence 3 (Rule L-02):
 *    - Pre-send re-check drops stale send if shift was cancelled ('stale_entity_cancelled').
 *
 * 4. Evidence 4 (Rule L-02):
 *    - Delayed items collapse into one digest push ('collapse_key', last_error_code='collapsed').
 *
 * 5. Evidence 5 (Rule P-06):
 *    - Security events bypass quiet hours immediately; standard events schedule for quiet hours end.
 *
 * 6. Evidence 6 (Rule P-04):
 *    - Shared phone push token reassignment via POST /me/push-tokens.
 *
 * 7. Evidence 7 (Rule P-05):
 *    - Push payload invariant: payload contains strictly {type, teamId, entityId} with zero notes.
 *
 * 8. Evidence 8:
 *    - Live POST /v1/me/push-test endpoint dispatches through the push adapter.
 * =============================================================================
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { getShardDb } from '../src/db/index.js';
import { notificationService } from '../src/modules/notifications/notification.service.js';
import { notificationsRepo } from '../src/modules/notifications/notifications.repo.js';
import { pushDevicesRepo } from '../src/modules/notifications/push-devices.repo.js';
import { getPushAdapter, ExpoPushAdapter } from '../src/adapters/push/index.js';
import type { App } from '../src/app.js';

describe('Tier 7 Graduation Evidence: Push Notifications Pipeline & Routing Contracts', () => {
  let app: App;
  let counter = 0;
  const nextEmail = (prefix: string) => `tier7-${prefix}-${Date.now()}-${counter++}@example.com`;

  beforeAll(async () => {
    app = await buildApp();
  });

  beforeEach(() => {
    const adapter = getPushAdapter() as ExpoPushAdapter;
    adapter.clearSent();
  });

  async function signupUser(email: string, displayName: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: {
        email,
        password: 'Password123!',
        displayName,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    return {
      user: body.user,
      session: body.session,
      authHeaders: { authorization: `Bearer ${body.session.accessToken}` },
    };
  }

  async function createTeam(authHeaders: Record<string, string>, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/teams',
      headers: authHeaders,
      payload: {
        name,
        timezone: 'Europe/London',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    return body.team;
  }

  async function createOutboxEvent(teamId: string, eventType: string = 'shift.published') {
    const shardDb = getShardDb(teamId);
    const outboxId = randomUUID();
    await shardDb
      .insertInto('domain_outbox_events')
      .values({
        id: outboxId,
        team_id: teamId,
        event_type: eventType,
        aggregate_type: 'test',
        aggregate_id: randomUUID(),
        payload: {},
        attempts: 0,
      })
      .execute();
    return outboxId;
  }

  async function getOwnerMembershipId(teamId: string, userId: string) {
    const shardDb = getShardDb(teamId);
    const membership = await shardDb
      .selectFrom('team_memberships')
      .select('id')
      .where('team_id', '=', teamId)
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();
    return membership.id;
  }

  // ---------------------------------------------------------------------------
  // Evidence 1: Rule L-02 — UNIQUE (outbox_event_id, user_id, category) deduplication
  // ---------------------------------------------------------------------------
  it('Evidence 1 (Rule L-02): UNIQUE (outbox_event_id, user_id, category) blocks duplicate sends on repeated outbox publish', async () => {
    const owner = await signupUser(nextEmail('dedupe-owner'), 'Owner Dedupe');
    const team = await createTeam(owner.authHeaders, 'Dedupe Team');
    const outboxEventId = await createOutboxEvent(team.id);

    // 1. First publish of outbox event -> creates notification job
    const job1 = await notificationService.enqueueNotificationJob({
      teamId: team.id,
      outboxEventId,
      userId: owner.user.id,
      category: 'shift',
      eventType: 'shift.published',
      payload: {
        type: 'shift',
        teamId: team.id,
        entityId: randomUUID(),
      },
    });
    expect(job1).toBeDefined();
    expect(job1?.status).toBe('pending');

    // 2. Duplicate publish of the exact same outbox event & category -> returns undefined (on conflict do nothing)
    const job2 = await notificationService.enqueueNotificationJob({
      teamId: team.id,
      outboxEventId,
      userId: owner.user.id,
      category: 'shift',
      eventType: 'shift.published',
      payload: {
        type: 'shift',
        teamId: team.id,
        entityId: randomUUID(),
      },
    });
    expect(job2).toBeUndefined();

    // 3. Verify exactly 1 row exists in notification_jobs on shard database
    const shardDb = getShardDb(team.id);
    const rows = await shardDb
      .selectFrom('notification_jobs')
      .selectAll()
      .where('outbox_event_id', '=', outboxEventId)
      .where('user_id', '=', owner.user.id)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(job1!.id);
  });

  // ---------------------------------------------------------------------------
  // Evidence 2: Rule L-02 — Repeatable re-enqueue / due job runner processes jobs
  // ---------------------------------------------------------------------------
  it('Evidence 2 (Rule L-02): Repeatable due job runner recovers and processes pending notification jobs', async () => {
    const owner = await signupUser(nextEmail('runner-owner'), 'Owner Runner');
    const team = await createTeam(owner.authHeaders, 'Runner Team');
    const outboxEventId = await createOutboxEvent(team.id, 'member.joined');

    // Register active push token for owner
    await pushDevicesRepo.upsert({
      userId: owner.user.id,
      provider: 'expo',
      token: `ExponentPushToken[runner-${Date.now()}]`,
      platform: 'android',
    });

    // Enqueue a job scheduled for now
    const job = await notificationService.enqueueNotificationJob({
      teamId: team.id,
      outboxEventId,
      userId: owner.user.id,
      category: 'activity',
      eventType: 'member.joined',
      payload: {
        type: 'activity',
        teamId: team.id,
        entityId: randomUUID(),
      },
    });
    expect(job).toBeDefined();
    expect(job?.status).toBe('pending');

    // Run due job processor (simulates 1-minute repeatable worker)
    const processed = await notificationService.processDueJobsForTeam(team.id);
    expect(processed).toBeGreaterThanOrEqual(1);

    // Verify job status updated to 'sent'
    const updatedJob = await notificationsRepo.findById(team.id, job!.id);
    expect(updatedJob?.status).toBe('sent');
    expect(updatedJob?.sent_at).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Evidence 3: Rule L-02 — Pre-send re-check drops stale send on cancelled shift
  // ---------------------------------------------------------------------------
  it('Evidence 3 (Rule L-02): Pre-send re-check drops stale notification if shift was cancelled', async () => {
    const owner = await signupUser(nextEmail('presend-owner'), 'Owner PreSend');
    const team = await createTeam(owner.authHeaders, 'PreSend Team');
    const membershipId = await getOwnerMembershipId(team.id, owner.user.id);
    const outboxEventId = await createOutboxEvent(team.id);

    // Create a shift on the team
    const shardDb = getShardDb(team.id);
    const shiftId = randomUUID();
    const startsAt = new Date(Date.now() + 86400000);
    const endsAt = new Date(startsAt.getTime() + 8 * 3600000);

    await shardDb
      .insertInto('shifts')
      .values({
        id: shiftId,
        team_id: team.id,
        title: 'Morning Shift',
        starts_at: startsAt,
        ends_at: endsAt,
        status: 'published',
        created_by_membership_id: membershipId,
      })
      .execute();

    // Register push device for owner
    await pushDevicesRepo.upsert({
      userId: owner.user.id,
      provider: 'expo',
      token: `ExponentPushToken[presend-${Date.now()}]`,
      platform: 'android',
    });

    // Enqueue notification for this shift
    const job = await notificationService.enqueueNotificationJob({
      teamId: team.id,
      outboxEventId,
      userId: owner.user.id,
      category: 'shift',
      eventType: 'shift.published',
      payload: {
        type: 'shift',
        teamId: team.id,
        entityId: shiftId,
      },
    });
    expect(job).toBeDefined();

    // Cancel shift before worker processes the job
    await shardDb
      .updateTable('shifts')
      .set({ status: 'cancelled' })
      .where('id', '=', shiftId)
      .where('team_id', '=', team.id)
      .execute();

    // Worker attempts to process the job -> pre-send re-check detects shift is cancelled!
    const result = await notificationService.processJob(team.id, job!.id);
    expect(result.status).toBe('cancelled');
    expect(result.reason).toContain('cancelled');

    // Verify job marked cancelled with stale_entity_cancelled
    const updatedJob = await notificationsRepo.findById(team.id, job!.id);
    expect(updatedJob?.status).toBe('cancelled');
    expect(updatedJob?.last_error_code).toBe('stale_entity_cancelled');

    // Verify push adapter sent 0 notifications
    const adapter = getPushAdapter() as ExpoPushAdapter;
    expect(adapter.getSentNotifications()).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Evidence 4: Rule L-02 — Digest collapse for delayed items
  // ---------------------------------------------------------------------------
  it('Evidence 4 (Rule L-02): Delayed notifications collapse into one digest push (collapse_key)', async () => {
    const owner = await signupUser(nextEmail('collapse-owner'), 'Owner Collapse');
    const team = await createTeam(owner.authHeaders, 'Collapse Team');
    const outbox1 = await createOutboxEvent(team.id);
    const outbox2 = await createOutboxEvent(team.id);

    // Enable quiet hours for owner via HTTP PATCH so notifications are delayed
    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/v1/me/settings',
      headers: owner.authHeaders,
      payload: {
        quietHoursEnabled: true,
        quietHoursStart: '00:00',
        quietHoursEnd: '23:59', // All day quiet hours for testing
        timezone: 'Europe/London',
      },
    });
    expect(patchRes.statusCode).toBe(200);

    // Enqueue first shift notification during quiet hours
    const job1 = await notificationService.enqueueNotificationJob({
      teamId: team.id,
      outboxEventId: outbox1,
      userId: owner.user.id,
      category: 'shift',
      eventType: 'shift.published',
      payload: {
        type: 'shift',
        teamId: team.id,
        entityId: randomUUID(),
      },
    });
    expect(job1).toBeDefined();
    expect(job1?.status).toBe('pending');
    expect(job1?.collapse_key).toBe(`digest:${owner.user.id}:shift`);

    // Enqueue second shift notification during quiet hours with the same collapse key
    const job2 = await notificationService.enqueueNotificationJob({
      teamId: team.id,
      outboxEventId: outbox2,
      userId: owner.user.id,
      category: 'shift',
      eventType: 'shift.published',
      payload: {
        type: 'shift',
        teamId: team.id,
        entityId: randomUUID(),
      },
    });
    expect(job2).toBeDefined();
    expect(job2?.status).toBe('pending');

    // Verify job1 was superseded and collapsed (Rule L-02)
    const updatedJob1 = await notificationsRepo.findById(team.id, job1!.id);
    expect(updatedJob1?.status).toBe('cancelled');
    expect(updatedJob1?.last_error_code).toBe('collapsed');

    // Verify job2 remains pending
    const updatedJob2 = await notificationsRepo.findById(team.id, job2!.id);
    expect(updatedJob2?.status).toBe('pending');
  });

  // ---------------------------------------------------------------------------
  // Evidence 5: Rule P-06 — Security events bypass quiet hours immediately
  // ---------------------------------------------------------------------------
  it('Evidence 5 (Rule P-06): Security events bypass quiet hours immediately, while shift events wait', async () => {
    const owner = await signupUser(nextEmail('quiet-owner'), 'Owner QuietHours');
    const team = await createTeam(owner.authHeaders, 'Quiet Team');
    const shiftOutbox = await createOutboxEvent(team.id);
    const secOutbox = await createOutboxEvent(team.id, 'auth.session.created');

    // Enable quiet hours: 22:00 to 07:00 via HTTP PATCH
    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/v1/me/settings',
      headers: owner.authHeaders,
      payload: {
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        timezone: 'Europe/London',
      },
    });
    expect(patchRes.statusCode).toBe(200);

    // Midnight local time (23:30 UTC in winter is 23:30 London -> in quiet hours)
    const nightTime = new Date('2026-10-17T23:30:00Z');

    // 1. Shift notification at night -> delayed until morning 07:00
    const shiftJob = await notificationService.enqueueNotificationJob({
      teamId: team.id,
      outboxEventId: shiftOutbox,
      userId: owner.user.id,
      category: 'shift',
      eventType: 'shift.published',
      payload: {
        type: 'shift',
        teamId: team.id,
        entityId: randomUUID(),
      },
      now: nightTime,
    });
    expect(shiftJob).toBeDefined();
    expect(new Date(shiftJob!.scheduled_for).getTime()).toBeGreaterThan(nightTime.getTime());

    // 2. Security event (Rule P-06: new sign-in, logout-all, password change) at night -> BYPASSES quiet hours immediately!
    const securityJob = await notificationService.enqueueNotificationJob({
      teamId: team.id,
      outboxEventId: secOutbox,
      userId: owner.user.id,
      category: 'security',
      eventType: 'auth.session.created',
      payload: {
        type: 'security',
        teamId: team.id,
        entityId: randomUUID(),
      },
      now: nightTime,
    });
    expect(securityJob).toBeDefined();
    // Scheduled for now immediately, not next morning
    expect(new Date(securityJob!.scheduled_for).getTime()).toBe(nightTime.getTime());
  });

  // ---------------------------------------------------------------------------
  // Evidence 6: Rule P-04 — Shared phone push token reassignment
  // ---------------------------------------------------------------------------
  it('Evidence 6 (Rule P-04): Shared phone push token reassignment updates user_id on login', async () => {
    const userA = await signupUser(nextEmail('shared-a'), 'User A');
    const userB = await signupUser(nextEmail('shared-b'), 'User B');
    const sharedPushToken = `ExponentPushToken[shared-phone-${Date.now()}]`;

    // 1. User A registers the phone's push token
    const resA = await app.inject({
      method: 'POST',
      url: '/v1/me/push-tokens',
      headers: userA.authHeaders,
      payload: {
        provider: 'expo',
        token: sharedPushToken,
        platform: 'android',
        deviceLabel: 'Shared Kitchen Tablet',
      },
    });
    expect(resA.statusCode).toBe(201);

    const activeA = await pushDevicesRepo.findActiveByUserId(userA.user.id);
    expect(activeA).toHaveLength(1);
    expect(activeA[0]?.device_label).toBe('Shared Kitchen Tablet');

    // 2. User B logs into the same shared phone and registers the same push token
    const resB = await app.inject({
      method: 'POST',
      url: '/v1/me/push-tokens',
      headers: userB.authHeaders,
      payload: {
        provider: 'expo',
        token: sharedPushToken,
        platform: 'android',
        deviceLabel: 'Shared Kitchen Tablet',
      },
    });
    expect(resB.statusCode).toBe(201);

    // 3. Verify token is now assigned to User B and deactivated/removed from User A (Rule P-04)
    const activeAAfter = await pushDevicesRepo.findActiveByUserId(userA.user.id);
    const activeBAfter = await pushDevicesRepo.findActiveByUserId(userB.user.id);

    expect(activeAAfter).toHaveLength(0);
    expect(activeBAfter).toHaveLength(1);
    expect(activeBAfter[0]?.user_id).toBe(userB.user.id);
  });

  // ---------------------------------------------------------------------------
  // Evidence 7: Rule P-05 — Push payload invariant {type, teamId, entityId} only
  // ---------------------------------------------------------------------------
  it('Evidence 7 (Rule P-05): Push payload contains strictly {type, teamId, entityId} with zero notes or billing secrets', async () => {
    const owner = await signupUser(nextEmail('invariant-owner'), 'Owner Invariant');
    const team = await createTeam(owner.authHeaders, 'Invariant Team');
    const testPushToken = `ExponentPushToken[invariant-${Date.now()}]`;
    const outboxId = await createOutboxEvent(team.id);

    await pushDevicesRepo.upsert({
      userId: owner.user.id,
      provider: 'expo',
      token: testPushToken,
      platform: 'android',
    });

    const membershipId = await getOwnerMembershipId(team.id, owner.user.id);
    const shardDb = getShardDb(team.id);
    const shiftEntityId = randomUUID();
    const startsAt = new Date(Date.now() + 86400000);
    const endsAt = new Date(startsAt.getTime() + 8 * 3600000);

    await shardDb
      .insertInto('shifts')
      .values({
        id: shiftEntityId,
        team_id: team.id,
        title: 'Morning Shift',
        starts_at: startsAt,
        ends_at: endsAt,
        status: 'published',
        created_by_membership_id: membershipId,
      })
      .execute();

    const job = await notificationService.enqueueNotificationJob({
      teamId: team.id,
      outboxEventId: outboxId,
      userId: owner.user.id,
      category: 'shift',
      eventType: 'shift.published',
      payload: {
        type: 'shift',
        teamId: team.id,
        entityId: shiftEntityId,
      },
    });
    expect(job).toBeDefined();

    // Process job
    await notificationService.processJob(team.id, job!.id);

    // Inspect dispatched push payload from push adapter
    const adapter = getPushAdapter() as ExpoPushAdapter;
    const sent = adapter.getSentNotifications();
    expect(sent).toHaveLength(1);

    const payloadData = sent[0]!.data;
    // Rule P-05: Strictly {type, teamId, entityId}
    const keys = Object.keys(payloadData).sort();
    expect(keys).toEqual(['entityId', 'teamId', 'type']);
    expect(payloadData.type).toBe('shift');
    expect(payloadData.teamId).toBe(team.id);
    expect(payloadData.entityId).toBe(shiftEntityId);

    // Invariant: zero sensitive fields
    expect(payloadData).not.toHaveProperty('notes');
    expect(payloadData).not.toHaveProperty('shiftNotes');
    expect(payloadData).not.toHaveProperty('billingSecret');
    expect(payloadData).not.toHaveProperty('price');
  });

  // ---------------------------------------------------------------------------
  // Evidence 8: Live POST /v1/me/push-test endpoint dispatches via push adapter
  // ---------------------------------------------------------------------------
  it('Evidence 8: Live POST /v1/me/push-test endpoint dispatches through push adapter for all 4 tap-to-open types', async () => {
    const owner = await signupUser(nextEmail('live-owner'), 'Owner LivePush');
    const team = await createTeam(owner.authHeaders, 'Live Team');
    const testToken = `ExponentPushToken[live-${Date.now()}]`;

    // Register push device
    await app.inject({
      method: 'POST',
      url: '/v1/me/push-tokens',
      headers: owner.authHeaders,
      payload: {
        provider: 'expo',
        token: testToken,
        platform: 'android',
      },
    });

    const adapter = getPushAdapter() as ExpoPushAdapter;
    const types: ('shift' | 'swap' | 'billing' | 'activity')[] = ['shift', 'swap', 'billing', 'activity'];

    for (const type of types) {
      adapter.clearSent();
      const entityId = randomUUID();

      const res = await app.inject({
        method: 'POST',
        url: '/v1/me/push-test',
        headers: owner.authHeaders,
        payload: {
          type,
          teamId: team.id,
          entityId,
          title: `Test ${type}`,
          body: `Tap to open ${type}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.sentCount).toBe(1);

      // Verify dispatched payload
      const sent = adapter.getSentNotifications();
      expect(sent).toHaveLength(1);
      expect(sent[0]!.data).toEqual({
        type,
        teamId: team.id,
        entityId,
      });
    }
  });
});
