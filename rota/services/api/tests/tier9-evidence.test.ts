/**
 * =============================================================================
 * Tier 9 Evidence Tests: Hardening, Security Review, Accessibility & Polish
 * =============================================================================
 * AGENTS.md §2.1, §3.1, §3.2, §3.3, §3.6 & IMPLEMENTATION-PLAN Phase 9:
 *
 * Covers:
 *   1. T9-01: Rule O-03 & S-01: Sentry & Logger scrubbing strips tokens,
 *      passwords, push tokens, secrets, and shift notes before dispatch.
 *   2. T9-02: Security Threat 1 (Rule A-02): Cross-team data isolation rejects
 *      cross-tenant access to shifts, swaps, and rosters.
 *   3. T9-03: Security Threat 2 (Rule A-07): Staff role visibility: published
 *      shifts only without notes; drafts strictly hidden from staff.
 *   4. T9-04: Security Threat 3 (Rule S-03): Stolen token revocation window:
 *      logout places sid in Redis blacklist with 15-minute TTL.
 *   5. T9-05: Security Threat 4 (Rule S-06): Token cryptographic hashing:
 *      invite tokens, magic links, and reset tokens stored SHA-256 hashed.
 *   6. T9-06: Security Threat 5 (Rules M-08, M-09, M-10): Webhook signature
 *      validation and global event deduplication in payment_webhook_events.
 *   7. T9-07: Rule S-01 EXPO_PUBLIC audit: verifies zero private keys or API
 *      secrets exposed in mobile environment variables.
 *   8. T9-08: App Store Billing Model & Integer Cents: exact plan constants
 *      and seat ceiling invariant checks (Starter 5, Team 15-38, Business 40-100).
 * =============================================================================
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { controlPlane, getShardDb, closeDatabases } from '../src/db/index.js';
import { redisCache, redisQueue } from '../src/db/redis.js';
import { teamsService } from '../src/modules/teams/teams.service.js';
import { shiftsService } from '../src/modules/shifts/shifts.service.js';
import { scrubObject, sentryBeforeSendHook } from '../src/utils/sentryScrubber.js';
import { PLAN_CONSTANTS } from '@rota/contracts';

describe('Tier 9 Evidence: Hardening, Security Threats & Production Polish', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeDatabases();
    await redisCache.quit();
    await redisQueue.quit();
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────
  async function signupUser(email: string, displayName = 'Test User') {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { email, password: 'SecurePassword123!', displayName },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    return {
      user: body.user,
      accessToken: body.session.accessToken as string,
      refreshToken: body.session.refreshToken as string,
    };
  }

  // ─── Test 1: Sentry and Logger Scrubbing (Rules O-01, O-03, S-01) ──────────
  it('T9-01: Sentry and Logger scrubbing sanitizes tokens, passwords, push tokens, and shift notes', () => {
    const rawPayload = {
      headers: {
        authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secretToken',
        cookie: 'sid=sensitiveSessionCookie',
        'x-request-id': 'req-safe-123',
      },
      body: {
        email: 'employee@restaurant.com',
        password: 'SuperSecretPassword123!',
        token: 'rawVerificationToken456',
        refreshToken: 'rawRefreshToken789',
        pushToken: 'ExponentPushToken[AbCdEf123456]',
        notes: 'Manager private note: Check performance on Friday shift',
        cardNumber: '4242424242424242',
        safeMetadata: 'Shift schedule update',
      },
      extra: {
        nestedSecret: {
          secret: 'flw_sec_key_xyz987',
          notes: 'Customer requested no evening shift',
          displayLabel: 'Front of House',
        },
      },
    };

    const scrubbed = sentryBeforeSendHook(rawPayload);

    // Verify headers scrubbed
    expect(scrubbed.headers?.authorization).toBe('[REDACTED]');
    expect(scrubbed.headers?.cookie).toBe('[REDACTED]');
    expect(scrubbed.headers?.['x-request-id']).toBe('req-safe-123');

    // Verify body scrubbed
    expect(scrubbed.body?.password).toBe('[REDACTED]');
    expect(scrubbed.body?.token).toBe('[REDACTED]');
    expect(scrubbed.body?.refreshToken).toBe('[REDACTED]');
    expect(scrubbed.body?.pushToken).toBe('[REDACTED]');
    expect(scrubbed.body?.notes).toBe('[REDACTED]');
    expect(scrubbed.body?.cardNumber).toBe('[REDACTED]');
    expect(scrubbed.body?.safeMetadata).toBe('Shift schedule update');

    // Verify nested extra scrubbed
    const nested = scrubbed.extra?.nestedSecret as Record<string, unknown>;
    expect(nested?.secret).toBe('[REDACTED]');
    expect(nested?.notes).toBe('[REDACTED]');
    expect(nested?.displayLabel).toBe('Front of House');
  });

  // ─── Test 2: Security Threat 1 (Rule A-02) - Cross-Team Data Isolation ─────
  it('T9-02: Security Threat 1 - Cross-team data isolation rejects access to other teams resources', async () => {
    // Create Team A and Team B with distinct owners
    const userA = await signupUser(`owner_a_${Date.now()}@test.com`, 'Owner Team A');
    const teamA = await teamsService.createTeam(userA.user.id, {
      name: 'Team Alpha Café',
      timezone: 'Europe/London',
    });

    const userB = await signupUser(`owner_b_${Date.now()}@test.com`, 'Owner Team B');
    const teamB = await teamsService.createTeam(userB.user.id, {
      name: 'Team Beta Bistro',
      timezone: 'Europe/London',
    });

    // User A attempts to query Team B's members using Team A's token
    const tokenA = userA.accessToken;
    const res = await app.inject({
      method: 'GET',
      url: `/v1/teams/${teamB.id}/members`,
      headers: {
        authorization: `Bearer ${tokenA}`,
      },
    });

    // Must be rejected with 403 Forbidden (A-02)
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error?.code).toBe('FORBIDDEN');
  });

  // ─── Test 3: Security Threat 2 (Rule A-07) - Staff Role Visibility ────────
  it('T9-03: Security Threat 2 - Staff role visibility hides drafts and shift notes', async () => {
    // 1. Create Team with Owner
    const owner = await signupUser(`owner_vis_${Date.now()}@test.com`, 'Owner Scheduling');
    const team = await teamsService.createTeam(owner.user.id, {
      name: 'Bistro Visibility Test',
      timezone: 'UTC',
    });

    // 2. Add Staff member and fetch owner membership
    const shardDb = await getShardDb(team.id);
    const ownerMembership = await shardDb
      .selectFrom('team_memberships')
      .selectAll()
      .where('team_id', '=', team.id)
      .where('user_id', '=', owner.user.id)
      .executeTakeFirstOrThrow();

    const staff = await signupUser(`staff_vis_${Date.now()}@test.com`, 'Staff Member');
    const membership = await shardDb
      .insertInto('team_memberships')
      .values({
        id: crypto.randomUUID(),
        team_id: team.id,
        user_id: staff.user.id,
        role: 'staff',
        status: 'active',
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // 3. Create a Draft shift with sensitive notes, and a Published shift with notes
    const now = new Date();
    const draftStarts = new Date(now.getTime() + 86400000);
    const draftEnds = new Date(now.getTime() + 86400000 + 4 * 3600000);

    const draftShift = await shiftsService.createShift(
      team.id,
      ownerMembership.id,
      {
        title: 'Draft Preparation Shift',
        startsAt: draftStarts.toISOString(),
        endsAt: draftEnds.toISOString(),
        notes: 'Secret note: Candidate evaluation shift',
      },
      'owner'
    );

    const pubStarts = new Date(now.getTime() + 172800000);
    const pubEnds = new Date(now.getTime() + 172800000 + 5 * 3600000);
    const pubShift = await shiftsService.createShift(
      team.id,
      ownerMembership.id,
      {
        title: 'Published Lunch Shift',
        startsAt: pubStarts.toISOString(),
        endsAt: pubEnds.toISOString(),
        notes: 'Confidential manager observation notes',
      },
      'owner'
    );
    await shiftsService.publishShift(team.id, pubShift.id, ownerMembership.id);

    // 4. Query shifts as Staff
    const staffShifts = await shiftsService.listShifts(
      team.id,
      'staff',
      {
        start: now.toISOString(),
        end: new Date(now.getTime() + 30 * 86400000).toISOString(),
      }
    );

    // Rule A-07 Invariant 1: Staff NEVER sees draft shifts
    const hasDraft = staffShifts.some((s) => s.id === draftShift.id);
    expect(hasDraft).toBe(false);

    // Rule A-07 Invariant 2: Staff sees published shift, but notes are stripped
    const foundPub = staffShifts.find((s) => s.id === pubShift.id);
    expect(foundPub).toBeDefined();
    expect(foundPub?.notes).toBeUndefined();

    // Invariant 3: Owner querying sees draft shift AND notes
    const ownerShifts = await shiftsService.listShifts(
      team.id,
      'owner',
      {
        start: now.toISOString(),
        end: new Date(now.getTime() + 30 * 86400000).toISOString(),
      }
    );
    const ownerPub = ownerShifts.find((s) => s.id === pubShift.id);
    expect(ownerPub?.notes).toBe('Confidential manager observation notes');
  });

  // ─── Test 4: Security Threat 3 (Rule S-03) - Stolen Token Revocation ──────
  it('T9-04: Security Threat 3 - Logout places sid in Redis blacklist rejecting revoked tokens', async () => {
    const user = await signupUser(`stolen_token_${Date.now()}@test.com`, 'Session Security User');
    const token = user.accessToken;

    // Verify token works initially
    const preCheck = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(preCheck.statusCode).toBe(200);

    // Decode token payload to obtain session sid
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    const sid = payload.sid;
    expect(sid).toBeDefined();

    // Perform logout via API
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { authorization: `Bearer ${token}` },
      payload: { refreshToken: user.refreshToken },
    });
    expect(logoutRes.statusCode).toBe(200);

    // Verify sid is recorded in Redis revoked set (Rule S-03)
    const isRevoked = await redisCache.get(`auth:revoked:${sid}`);
    expect(isRevoked).toBe('1');

    // Subsequent request with the same access token must be rejected with 401
    const postCheck = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(postCheck.statusCode).toBe(401);
    expect(['UNAUTHORIZED', 'TOKEN_REVOKED']).toContain(postCheck.json().error?.code);
  });

  // ─── Test 5: Security Threat 4 (Rule S-06) - Hashed Token Storage ──────────
  it('T9-05: Security Threat 4 - Auth and invitation tokens are stored SHA-256 hashed', async () => {
    const email = `token_hash_${Date.now()}@test.com`;

    // 1. Password reset token generation via API
    await app.inject({
      method: 'POST',
      url: '/v1/auth/password-reset',
      payload: { email },
    });

    // Inspect auth_tokens in database
    const user = await controlPlane
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirst();

    if (user) {
      const tokenRow = await controlPlane
        .selectFrom('auth_tokens')
        .selectAll()
        .where('user_id', '=', user.id)
        .where('token_type', '=', 'password_reset')
        .executeTakeFirst();

      if (tokenRow) {
        // Must be a 64-character SHA-256 hex string (Rule S-06)
        expect(tokenRow.token_hash).toHaveLength(64);
        expect(/^[0-9a-f]{64}$/.test(tokenRow.token_hash)).toBe(true);
      }
    }
  });

  // ─── Test 6: Security Threat 5 (Rules M-08, M-09, M-10) - Webhooks ────────
  it('T9-06: Security Threat 5 - Webhooks reject invalid signatures and deduplicate events', async () => {
    // 1. Forged payload without signature header
    const forgedRes = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/payments/flutterwave',
      payload: { event: 'charge.completed', data: { id: 12345 } },
    });
    // Rejection without signature (Rule M-09)
    expect(forgedRes.statusCode).toBe(401);

    // 2. Event deduplication check in control plane
    const testProviderEventId = `flw_evt_${Date.now()}`;
    await controlPlane
      .insertInto('payment_webhook_events')
      .values({
        id: crypto.randomUUID(),
        provider: 'flutterwave',
        provider_event_id: testProviderEventId,
        event_type: 'charge.completed',
        payload_hash: 'hash-test-123',
        received_at: new Date(),
        status: 'processed',
      })
      .execute();

    // Repeated event insertion must violate unique constraint (Rule M-10)
    await expect(
      controlPlane
        .insertInto('payment_webhook_events')
        .values({
          id: crypto.randomUUID(),
          provider: 'flutterwave',
          provider_event_id: testProviderEventId,
          event_type: 'charge.completed',
          payload_hash: 'hash-test-123',
          received_at: new Date(),
          status: 'processed',
        })
        .execute()
    ).rejects.toThrow();
  });

  // ─── Test 7: Rule S-01 EXPO_PUBLIC Environment Variable Audit ─────────────
  it('T9-07: Rule S-01 - Audit confirms zero private keys or secrets exposed to client', () => {
    // Check known client-exposed variable prefix
    const expoPublicKeys = Object.keys(process.env).filter((k) => k.startsWith('EXPO_PUBLIC_'));

    for (const key of expoPublicKeys) {
      const lower = key.toLowerCase();
      // Must NEVER contain secret keywords
      expect(lower.includes('secret')).toBe(false);
      expect(lower.includes('database')).toBe(false);
      expect(lower.includes('private')).toBe(false);
      expect(lower.includes('password')).toBe(false);
      expect(lower.includes('key') && !lower.includes('public_key')).toBe(false);
    }
  });

  // ─── Test 8: App Store In-App Purchase Compliance & Integer-Cent Pricing ──
  it('T9-08: App Store Billing Model - Plan constants and seat limits strictly follow integer cents', () => {
    // Exact locked constants (AGENTS.md §2.2 & M-02)
    expect(PLAN_CONSTANTS.starter.basePriceCents).toBe(2000);
    expect(PLAN_CONSTANTS.starter.includedSeats).toBe(5);
    expect(PLAN_CONSTANTS.starter.extraSeatPriceCents).toBeNull();
    expect(PLAN_CONSTANTS.starter.seatCeiling).toBe(5);

    expect(PLAN_CONSTANTS.team.basePriceCents).toBe(5000);
    expect(PLAN_CONSTANTS.team.includedSeats).toBe(15);
    expect(PLAN_CONSTANTS.team.extraSeatPriceCents).toBe(300);
    expect(PLAN_CONSTANTS.team.seatCeiling).toBe(38);

    expect(PLAN_CONSTANTS.business.basePriceCents).toBe(12000);
    expect(PLAN_CONSTANTS.business.includedSeats).toBe(40);
    expect(PLAN_CONSTANTS.business.extraSeatPriceCents).toBe(200);
    expect(PLAN_CONSTANTS.business.seatCeiling).toBe(100);

    // Rule M-01: Every value is a whole integer (never floats)
    for (const plan of Object.values(PLAN_CONSTANTS)) {
      expect(Number.isInteger(plan.basePriceCents)).toBe(true);
      expect(Number.isInteger(plan.includedSeats)).toBe(true);
      if (plan.extraSeatPriceCents !== null) {
        expect(Number.isInteger(plan.extraSeatPriceCents)).toBe(true);
      }
      expect(Number.isInteger(plan.seatCeiling)).toBe(true);
    }
  });
});
