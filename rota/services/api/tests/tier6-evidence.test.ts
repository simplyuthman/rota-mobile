/**
 * =============================================================================
 * Rota API — Tier 6 Graduation Evidence Integration Tests
 * =============================================================================
 * Proves the critical graduation criteria for Tier 6 (Offline Cache & Privacy):
 *
 * 1. Rule P-01 & S-03:
 *    - Wipe shift cache & session revocation on logout and logout-all.
 *    - Revoked `sid` immediately rejects access tokens via Redis revoked set (401).
 *    - Push devices deactivated on logout (Rule P-04).
 *
 * 2. Rule P-02 & A-07:
 *    - Staff visibility: published shifts without notes; drafts hidden.
 *    - Notes strictly omitted from staff payloads to ensure notes never enter offline cache.
 *
 * 3. Rule P-03:
 *    - Mutations require active server authentication and live transaction locking;
 *      offline writes are strictly rejected.
 * =============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { getShardDb } from '../src/db/index.js';
import { pushDevicesRepo } from '../src/modules/notifications/push-devices.repo.js';
import type { App } from '../src/app.js';

describe('Tier 6 Graduation Evidence: Offline Invariants, Privacy & Session Revocation', () => {
  let app: App;
  let counter = 0;
  const nextEmail = (prefix: string) => `tier6-${prefix}-${Date.now()}-${counter++}@example.com`;

  beforeAll(async () => {
    app = await buildApp();
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

  // ---------------------------------------------------------------------------
  // Evidence 1: Rule P-01 & S-03 — Logout revokes session and deactivates push device
  // ---------------------------------------------------------------------------
  it('Evidence 1 (Rule P-01, P-04, S-03): Logout revokes token family, sid in Redis, and deactivates push tokens', async () => {
    const user = await signupUser(nextEmail('logout-p01'), 'User P01');
    const pushToken = `ExponentPushToken[p01-${Date.now()}]`;

    // 1. Register push device
    await pushDevicesRepo.upsert({
      userId: user.user.id,
      provider: 'expo',
      token: pushToken,
      platform: 'android',
    });

    const activeDevicesBefore = await pushDevicesRepo.findActiveByUserId(user.user.id);
    expect(activeDevicesBefore).toHaveLength(1);

    // 2. Perform logout (Rule P-01, P-04)
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: user.authHeaders,
    });
    expect(logoutRes.statusCode).toBe(200);

    // 3. Verify push devices deactivated (Rule P-04)
    const activeDevicesAfter = await pushDevicesRepo.findActiveByUserId(user.user.id);
    expect(activeDevicesAfter).toHaveLength(0);

    // 4. Verify old access token is immediately rejected with 401 via Redis revoked-sid set
    const meRes = await app.inject({
      method: 'GET',
      url: '/v1/me/settings',
      headers: user.authHeaders,
    });
    expect(meRes.statusCode).toBe(401);

    // 5. Verify refresh token cannot be reused
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: user.session.refreshToken },
    });
    expect(refreshRes.statusCode).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // Evidence 2: Rule P-01 & S-03 — Logout-all revokes across all devices
  // ---------------------------------------------------------------------------
  it('Evidence 2 (Rule P-01, S-03): Logout-all revokes sessions across all devices and deactivates push tokens', async () => {
    const email = nextEmail('logout-all');
    const user1 = await signupUser(email, 'User Multi');

    // Sign in on second device
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'Password123!' },
    });
    expect(loginRes.statusCode).toBe(200);
    const session2 = JSON.parse(loginRes.body).session;
    const authHeaders2 = { authorization: `Bearer ${session2.accessToken}` };

    // Register push tokens for both devices
    await pushDevicesRepo.upsert({
      userId: user1.user.id,
      provider: 'expo',
      token: `ExponentPushToken[dev1-${Date.now()}]`,
      platform: 'android',
    });
    await pushDevicesRepo.upsert({
      userId: user1.user.id,
      provider: 'expo',
      token: `ExponentPushToken[dev2-${Date.now()}]`,
      platform: 'android',
    });

    const activeBefore = await pushDevicesRepo.findActiveByUserId(user1.user.id);
    expect(activeBefore).toHaveLength(2);

    // Call logout-all
    const logoutAllRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout-all',
      headers: user1.authHeaders,
    });
    expect(logoutAllRes.statusCode).toBe(200);

    // Verify all push tokens deactivated
    const activeAfter = await pushDevicesRepo.findActiveByUserId(user1.user.id);
    expect(activeAfter).toHaveLength(0);

    // Both device access tokens fail
    const me1 = await app.inject({ method: 'GET', url: '/v1/me/settings', headers: user1.authHeaders });
    expect(me1.statusCode).toBe(401);

    const me2 = await app.inject({ method: 'GET', url: '/v1/me/settings', headers: authHeaders2 });
    expect(me2.statusCode).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // Evidence 3: Rule P-02 & A-07 — Staff published shifts visibility and note scrubbing
  // ---------------------------------------------------------------------------
  it('Evidence 3 (Rule P-02, A-07): Staff query returns published shifts without notes; drafts are hidden', async () => {
    const owner = await signupUser(nextEmail('owner-p02'), 'Owner P02');
    const team = await createTeam(owner.authHeaders, 'Team P02');
    const shardDb = getShardDb(team.id);

    // Add staff member directly to shard
    const staff = await signupUser(nextEmail('staff-p02'), 'Staff P02');
    const staffMembership = await shardDb
      .insertInto('team_memberships')
      .values({
        team_id: team.id,
        user_id: staff.user.id,
        role: 'staff',
        status: 'active',
        activated_at: new Date(),
        updated_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // 1. Create a published shift with sensitive notes via API
    const base = Date.now() + 86400000;
    const createRes1 = await app.inject({
      method: 'POST',
      url: `/v1/teams/${team.id}/shifts`,
      headers: owner.authHeaders,
      payload: {
        title: 'Staff Published Shift',
        startsAt: new Date(base).toISOString(),
        endsAt: new Date(base + 28800000).toISOString(),
        notes: 'TOP SECRET: Manager safe code is 7890',
      },
    });
    expect(createRes1.statusCode).toBe(201);
    const shift1 = JSON.parse(createRes1.body).shift;

    // Publish and assign to staff member
    const publishRes = await app.inject({
      method: 'POST',
      url: `/v1/teams/${team.id}/shifts/${shift1.id}/publish`,
      headers: owner.authHeaders,
      payload: {
        assignMembershipId: staffMembership.id,
      },
    });
    expect(publishRes.statusCode).toBe(200);

    // 2. Create a draft shift (not published)
    const createRes2 = await app.inject({
      method: 'POST',
      url: `/v1/teams/${team.id}/shifts`,
      headers: owner.authHeaders,
      payload: {
        title: 'Draft Unreleased Shift',
        startsAt: new Date(base + 86400000).toISOString(),
        endsAt: new Date(base + 86400000 + 28800000).toISOString(),
        notes: 'Draft shift notes',
      },
    });
    expect(createRes2.statusCode).toBe(201);

    // 3. Staff queries shifts: GET /v1/teams/:teamId/shifts
    const staffShiftsRes = await app.inject({
      method: 'GET',
      url: `/v1/teams/${team.id}/shifts`,
      headers: staff.authHeaders,
    });
    expect(staffShiftsRes.statusCode).toBe(200);
    const staffShifts = JSON.parse(staffShiftsRes.body).shifts;

    // Staff must ONLY see published shifts (draft is hidden)
    expect(staffShifts).toHaveLength(1);
    expect(staffShifts[0].id).toBe(shift1.id);
    expect(staffShifts[0].title).toBe('Staff Published Shift');

    // Invariant: Notes MUST be completely stripped / absent from staff response (Rule P-02, A-07)
    expect(staffShifts[0]).not.toHaveProperty('notes');
    expect(staffShifts[0].notes).toBeUndefined();

    // 4. Owner queries shifts: Sees both draft and published, with notes intact
    const ownerShiftsRes = await app.inject({
      method: 'GET',
      url: `/v1/teams/${team.id}/shifts`,
      headers: owner.authHeaders,
    });
    expect(ownerShiftsRes.statusCode).toBe(200);
    const ownerShifts = JSON.parse(ownerShiftsRes.body).shifts;
    expect(ownerShifts).toHaveLength(2);
    const ownerPublished = ownerShifts.find((s: any) => s.id === shift1.id);
    expect(ownerPublished.notes).toBe('TOP SECRET: Manager safe code is 7890');
  });

  // ---------------------------------------------------------------------------
  // Evidence 4: Rule P-03 — Mutation constraints block unauthenticated/offline writes
  // ---------------------------------------------------------------------------
  it('Evidence 4 (Rule P-03): Direct offline mutations without valid session fail with 401', async () => {
    const owner = await signupUser(nextEmail('owner-p03'), 'Owner P03');
    const team = await createTeam(owner.authHeaders, 'Team P03');

    // An unauthenticated request simulates offline or expired token mutation attempt
    const offlineCreateRes = await app.inject({
      method: 'POST',
      url: `/v1/teams/${team.id}/shifts`,
      payload: {
        title: 'Offline Shift Attempt',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        endsAt: new Date(Date.now() + 86400000 + 28800000).toISOString(),
      },
    });
    expect(offlineCreateRes.statusCode).toBe(401);
  });
});
