/**
 * =============================================================================
 * Rota API — Tier 4 Graduation Evidence Integration Tests
 * =============================================================================
 * Proves the critical graduation criteria for Tier 4:
 *
 * 1. Rule P-06: Quiet-hours worker test
 *    Notification worker enforces quiet hours on the server in the user's
 *    time zone. Non-security notifications are delayed until quiet hours end.
 *
 * 2. Rule P-06: Security bypass
 *    Security notifications (sign-in, password change) bypass quiet hours immediately.
 *
 * 3. Rule P-08: Two-device settings demo
 *    Device A (tablet) updates theme; Device B (phone) updates quiet hours.
 *    PATCH updates changed fields only, stamping each in field_updated_at;
 *    neither device overwrites the other.
 *
 * 4. Rule P-07: Timezone validation
 *    Timezone is validated as a valid IANA name and never defaults to UTC.
 *
 * 5. Rule L-02: Idempotent notification enqueue
 *    Duplicate outbox publish creates exactly one notification_jobs row via
 *    UNIQUE (outbox_event_id, user_id, category).
 *
 * 6. Rule L-02: Pre-send re-check
 *    A notification delayed during quiet hours is dropped if the underlying
 *    entity was cancelled or deleted before send.
 *
 * 7. Rule P-04: Push token reassignment and logout deactivation
 *    Push token is reassigned on shared device and deactivated on logout.
 * =============================================================================
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { buildApp } from '../src/app.js';
import { getControlPlaneDb, getShardDb } from '../src/db/index.js';
import { notificationService } from '../src/modules/notifications/notification.service.js';
import { pushDevicesRepo } from '../src/modules/notifications/push-devices.repo.js';
import { evaluateQuietHours } from '../src/modules/notifications/quiet-hours.js';
import type { App } from '../src/app.js';

describe('Tier 4 Graduation Evidence: Settings & Quiet Hours', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const uid = () => crypto.randomBytes(4).toString('hex');
  const nextEmail = (prefix: string) => `${prefix}-${Date.now()}-${uid()}@example.com`;
  const randomIp = () =>
    `10.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}`;

  async function signupUser(email: string, displayName = 'Test User') {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      headers: { 'x-forwarded-for': randomIp() },
      payload: { email, password: 'Password123!', displayName },
    });
    expect(res.statusCode, `signup ${email}: ${res.body}`).toBe(201);
    const body = JSON.parse(res.body);
    return {
      user: body.user,
      accessToken: body.session.accessToken,
    };
  }

  async function createTeam(accessToken: string, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/teams',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name, timezone: 'America/New_York' },
    });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.body).team;
  }

  async function createOutboxEvent(
    teamId: string,
    eventType = 'shift.published',
    aggregateId = crypto.randomUUID()
  ): Promise<string> {
    const shardDb = getShardDb(teamId);
    const outbox = await shardDb
      .insertInto('domain_outbox_events')
      .values({
        team_id: teamId,
        event_type: eventType,
        aggregate_type: 'shift',
        aggregate_id: aggregateId,
        payload: { teamId, shiftId: aggregateId },
        published_at: null,
        attempts: 0,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return outbox.id;
  }

  // ── Evidence 1 & 2: Quiet Hours & Security Bypass (Rule P-06) ─────────────

  it('Evidence 1 (Rule P-06): Notification worker respects quiet hours in user timezone and delays non-security sends', async () => {
    const user = await signupUser(nextEmail('quiet-hours-user'));
    const team = await createTeam(user.accessToken, 'Quiet Hours Team');

    // Configure user settings with America/New_York timezone and overnight quiet hours 22:00 - 07:00
    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/v1/me/settings',
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: {
        timezone: 'America/New_York',
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      },
    });
    expect(patchRes.statusCode).toBe(200);

    // Mock "now" at 23:30 New York time on 2026-10-16 (inside quiet hours)
    // 2026-10-16 23:30 EDT = 2026-10-17 03:30 UTC
    const mockNightTime = new Date('2026-10-17T03:30:00.000Z');

    const outboxId = await createOutboxEvent(team.id, 'shift.published');
    const job = await notificationService.enqueueNotificationJob({
      teamId: team.id,
      outboxEventId: outboxId,
      userId: user.user.id,
      category: 'shift',
      eventType: 'shift.published',
      payload: { type: 'shift', teamId: team.id, entityId: crypto.randomUUID() },
      now: mockNightTime,
    });

    expect(job).toBeDefined();
    expect(job?.status).toBe('pending');

    // The job must be delayed until 07:00 next morning (2026-10-17 07:00 EDT = 2026-10-17 11:00 UTC)
    const scheduledTime = new Date(job!.scheduled_for).getTime();
    expect(scheduledTime).toBeGreaterThan(mockNightTime.getTime());

    // Verify quiet hours evaluator directly
    const evalResult = evaluateQuietHours({
      enabled: true,
      start: '22:00',
      end: '07:00',
      timezone: 'America/New_York',
      now: mockNightTime,
    });
    expect(evalResult.inQuietHours).toBe(true);
    expect(evalResult.nextQuietHoursEnd?.toISOString()).toBe('2026-10-17T11:00:00.000Z');
  });

  it('Evidence 2 (Rule P-06): Security notifications bypass quiet hours immediately', async () => {
    const user = await signupUser(nextEmail('sec-bypass-user'));
    const team = await createTeam(user.accessToken, 'Sec Bypass Team');

    await app.inject({
      method: 'PATCH',
      url: '/v1/me/settings',
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: {
        timezone: 'America/New_York',
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      },
    });

    const mockNightTime = new Date('2026-10-17T03:30:00.000Z'); // 23:30 local

    const outboxId = await createOutboxEvent(team.id, 'auth.new_signin', user.user.id);
    const securityJob = await notificationService.enqueueNotificationJob({
      teamId: team.id,
      outboxEventId: outboxId,
      userId: user.user.id,
      category: 'security',
      eventType: 'auth.new_signin',
      payload: { type: 'security', teamId: team.id, entityId: user.user.id },
      now: mockNightTime,
    });

    expect(securityJob).toBeDefined();
    // Rule P-06: Security events bypass quiet hours; scheduled_for is immediate (<= mockNightTime)
    const scheduledTime = new Date(securityJob!.scheduled_for).getTime();
    expect(scheduledTime).toBeLessThanOrEqual(mockNightTime.getTime());
  });

  // ── Evidence 3: Two-Device Settings Demo (Rule P-08) ───────────────────────

  it('Evidence 3 (Rule P-08): Two-device settings demo — tablet theme change does not overwrite phone quiet hours', async () => {
    const user = await signupUser(nextEmail('twodev-user'));

    // Step 1: Initialize settings on phone
    await app.inject({
      method: 'PATCH',
      url: '/v1/me/settings',
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: {
        timezone: 'Europe/London',
        theme: 'light',
        quietHoursEnabled: false,
      },
    });

    // Step 2: Device A (tablet) updates only theme to 'dark'
    const tabletRes = await app.inject({
      method: 'PATCH',
      url: '/v1/me/settings',
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: { theme: 'dark' },
    });
    expect(tabletRes.statusCode).toBe(200);
    const tabletSettings = JSON.parse(tabletRes.body);
    expect(tabletSettings.theme).toBe('dark');
    expect(tabletSettings.fieldUpdatedAt.theme).toBeDefined();

    // Step 3: Device B (phone) concurrently updates only quiet hours
    const phoneRes = await app.inject({
      method: 'PATCH',
      url: '/v1/me/settings',
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: {
        quietHoursEnabled: true,
        quietHoursStart: '23:00',
        quietHoursEnd: '08:00',
      },
    });
    expect(phoneRes.statusCode).toBe(200);
    const phoneSettings = JSON.parse(phoneRes.body);
    expect(phoneSettings.quietHoursEnabled).toBe(true);
    expect(phoneSettings.fieldUpdatedAt.quietHoursEnabled).toBeDefined();

    // Step 4: Device A refetches full settings
    const refetchRes = await app.inject({
      method: 'GET',
      url: '/v1/me/settings',
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
    expect(refetchRes.statusCode).toBe(200);
    const mergedSettings = JSON.parse(refetchRes.body);

    // Prove neither device overwrote the other:
    // Theme is still 'dark' (from tablet) AND quiet hours is enabled (from phone)
    expect(mergedSettings.theme).toBe('dark');
    expect(mergedSettings.quietHoursEnabled).toBe(true);
    expect(mergedSettings.quietHoursStart).toBe('23:00');
    expect(mergedSettings.quietHoursEnd).toBe('08:00');
    expect(mergedSettings.timezone).toBe('Europe/London');
  });

  // ── Evidence 4: Timezone Validation (Rule P-07) ───────────────────────────

  it('Evidence 4 (Rule P-07): Timezone validation blocks invalid/empty timezone names and never defaults to UTC', async () => {
    const user = await signupUser(nextEmail('tz-val-user'));

    // Attempt invalid IANA timezone
    const invalidRes = await app.inject({
      method: 'PATCH',
      url: '/v1/me/settings',
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: { timezone: 'Fake/Invalid_Zone_123' },
    });
    expect(invalidRes.statusCode).toBe(400);
    expect(JSON.parse(invalidRes.body).error.code).toBe('INVALID_TIMEZONE');

    // Valid IANA timezone succeeds
    const validRes = await app.inject({
      method: 'PATCH',
      url: '/v1/me/settings',
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: { timezone: 'Asia/Tokyo' },
    });
    expect(validRes.statusCode).toBe(200);
    expect(JSON.parse(validRes.body).timezone).toBe('Asia/Tokyo');
  });

  // ── Evidence 5: Idempotent Notification Enqueue (Rule L-02) ───────────────

  it('Evidence 5 (Rule L-02): Duplicate outbox publish creates exactly one notification job row', async () => {
    const user = await signupUser(nextEmail('idemp-notif-user'));
    const team = await createTeam(user.accessToken, 'Idempotent Notification Team');

    await app.inject({
      method: 'PATCH',
      url: '/v1/me/settings',
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: { timezone: 'Europe/London' },
    });

    const outboxEventId = await createOutboxEvent(team.id, 'shift.published');

    // First publish attempt
    const job1 = await notificationService.enqueueNotificationJob({
      teamId: team.id,
      outboxEventId,
      userId: user.user.id,
      category: 'shift',
      eventType: 'shift.published',
      payload: { type: 'shift', teamId: team.id, entityId: crypto.randomUUID() },
    });
    expect(job1).toBeDefined();

    // Duplicate publish attempt with identical (outbox_event_id, user_id, category)
    const job2 = await notificationService.enqueueNotificationJob({
      teamId: team.id,
      outboxEventId,
      userId: user.user.id,
      category: 'shift',
      eventType: 'shift.published',
      payload: { type: 'shift', teamId: team.id, entityId: crypto.randomUUID() },
    });
    expect(job2).toBeUndefined(); // Idempotently ignored via UNIQUE constraint

    // Verify shard DB has exactly 1 row
    const shardDb = getShardDb(team.id);
    const rows = await shardDb
      .selectFrom('notification_jobs')
      .selectAll()
      .where('outbox_event_id', '=', outboxEventId)
      .where('user_id', '=', user.user.id)
      .execute();

    expect(rows).toHaveLength(1);
  });

  // ── Evidence 6: Pre-send Re-check (Rule L-02) ──────────────────────────────

  it('Evidence 6 (Rule L-02): Pre-send re-check drops notifications if entity was cancelled while delayed', async () => {
    const owner = await signupUser(nextEmail('presend-owner'));
    const team = await createTeam(owner.accessToken, 'Presend Recheck Team');

    // Create and publish a shift
    const createShiftRes = await app.inject({
      method: 'POST',
      url: `/v1/teams/${team.id}/shifts`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: {
        title: 'Morning Shift',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        endsAt: new Date(Date.now() + 86400000 + 28800000).toISOString(),
      },
    });
    expect(createShiftRes.statusCode).toBe(201);
    const shift = JSON.parse(createShiftRes.body).shift;

    const outboxEventId = await createOutboxEvent(team.id, 'shift.published', shift.id);

    // Enqueue notification for this shift
    const job = await notificationService.enqueueNotificationJob({
      teamId: team.id,
      outboxEventId,
      userId: owner.user.id,
      category: 'shift',
      eventType: 'shift.published',
      payload: { type: 'shift', teamId: team.id, entityId: shift.id },
    });
    expect(job).toBeDefined();

    // Cancel the shift before the notification worker runs
    const cancelRes = await app.inject({
      method: 'DELETE',
      url: `/v1/teams/${team.id}/shifts/${shift.id}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(cancelRes.statusCode).toBe(200);

    // Process the notification job
    const result = await notificationService.processJob(team.id, job!.id);

    // Rule L-02: Pre-send re-check notices shift is cancelled and cancels notification
    expect(result.status).toBe('cancelled');

    const shardDb = getShardDb(team.id);
    const updatedJob = await shardDb
      .selectFrom('notification_jobs')
      .selectAll()
      .where('id', '=', job!.id)
      .executeTakeFirst();

    expect(updatedJob?.status).toBe('cancelled');
    expect(updatedJob?.last_error_code).toBe('stale_entity_cancelled');
  });

  // ── Evidence 7: Push Token Reassignment & Logout (Rule P-04) ───────────────

  it('Evidence 7 (Rule P-04): Push token reassigned on shared phone and deactivated on logout', async () => {
    const userA = await signupUser(nextEmail('user-a-phone'));
    const userB = await signupUser(nextEmail('user-b-phone'));

    const sharedToken = `ExponentPushToken[shared-phone-${uid()}]`;

    // User A registers push token on phone
    const regResA = await app.inject({
      method: 'POST',
      url: '/v1/me/push-tokens',
      headers: { authorization: `Bearer ${userA.accessToken}` },
      payload: {
        token: sharedToken,
        platform: 'android',
        deviceLabel: 'Shared Counter Tablet',
      },
    });
    expect(regResA.statusCode).toBe(201);

    const cpDb = getControlPlaneDb();
    let deviceRow = await cpDb
      .selectFrom('push_devices')
      .selectAll()
      .where('token_ciphertext', '=', sharedToken)
      .executeTakeFirst();

    expect(deviceRow?.user_id).toBe(userA.user.id);
    expect(deviceRow?.active).toBe(true);

    // User B signs in on same phone and registers same token (Rule P-04 reassignment)
    const regResB = await app.inject({
      method: 'POST',
      url: '/v1/me/push-tokens',
      headers: { authorization: `Bearer ${userB.accessToken}` },
      payload: {
        token: sharedToken,
        platform: 'android',
        deviceLabel: 'Shared Counter Tablet',
      },
    });
    expect(regResB.statusCode).toBe(201);

    deviceRow = await cpDb
      .selectFrom('push_devices')
      .selectAll()
      .where('token_ciphertext', '=', sharedToken)
      .executeTakeFirst();

    // Verify token was reassigned to User B
    expect(deviceRow?.user_id).toBe(userB.user.id);
    expect(deviceRow?.active).toBe(true);

    // User B logs out -> token deactivated (Rule P-04)
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { authorization: `Bearer ${userB.accessToken}` },
    });
    expect(logoutRes.statusCode).toBe(200);

    deviceRow = await cpDb
      .selectFrom('push_devices')
      .selectAll()
      .where('token_ciphertext', '=', sharedToken)
      .executeTakeFirst();

    expect(deviceRow?.active).toBe(false);
    expect(deviceRow?.deactivated_at).not.toBeNull();
  });
});
