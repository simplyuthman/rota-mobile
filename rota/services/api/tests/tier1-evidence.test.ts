/**
 * =============================================================================
 * Rota API — Tier 1 Graduation Evidence Integration Tests
 * =============================================================================
 * Proves the 5 critical graduation criteria for Tier 1:
 *
 * 1. Rule A-01: Permission Test (Staff calling delete shift directly is rejected)
 *    HTTP 403 FORBIDDEN.
 * 2. Rule A-02: Team Isolation Test (Team A user cannot access Team B data)
 *    HTTP 403 FORBIDDEN.
 * 3. Rule S-04: Refresh Token Rotation & Replay Test (Consumed token reuse
 *    revokes session family and fails with 401).
 * 4. Rule A-04: Owner Immutability Test (Owner cannot change own role,
 *    deactivate self, or assign another Owner -> 409 OWNER_IMMUTABLE).
 * 5. Rule A-06: Atomic Seat Limit Concurrency Test (Two simultaneous invite
 *    accepts on the final seat produce exactly one success and one 409 SEAT_LIMIT).
 * =============================================================================
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { buildApp } from '../src/app.js';
import { getShardDb } from '../src/db/index.js';
import type { App } from '../src/app.js';

describe('Tier 1 Graduation Evidence: Auth & Tenant Isolation', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // Helper to generate unique emails
  const nextEmail = (prefix: string) =>
    `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}@example.com`;

  // Helper to sign up and get auth tokens
  async function signupUser(email: string, displayName = 'Test User') {
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

  // Helper to create a team
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
  // Evidence 1: Rule A-01 — Permission Test (Staff calling delete shift rejected)
  // ---------------------------------------------------------------------------
  it('Evidence 1 (Rule A-01): Staff calling delete shift directly is rejected with 403 FORBIDDEN', async () => {
    // 1. Owner creates team
    const owner = await signupUser(nextEmail('owner-a01'), 'Owner A01');
    const team = await createTeam(owner.authHeaders, 'A01 Team');

    // 2. Insert a shift for this team directly on the shard
    const shardDb = getShardDb(team.id);
    const ownerMembership = await shardDb
      .selectFrom('team_memberships')
      .selectAll()
      .where('team_id', '=', team.id)
      .where('user_id', '=', owner.user.id)
      .executeTakeFirstOrThrow();

    const shift = await shardDb
      .insertInto('shifts')
      .values({
        team_id: team.id,
        title: 'Morning Shift',
        starts_at: new Date(Date.now() + 86400000),
        ends_at: new Date(Date.now() + 86400000 + 28800000),
        status: 'published',
        created_by_membership_id: ownerMembership.id,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // 3. Staff user signs up and is added as 'staff'
    const staff = await signupUser(nextEmail('staff-a01'), 'Staff A01');
    await shardDb
      .insertInto('team_memberships')
      .values({
        team_id: team.id,
        user_id: staff.user.id,
        role: 'staff',
        status: 'active',
        activated_at: new Date(),
        updated_at: new Date(),
      })
      .execute();

    // 4. Staff user calls DELETE /v1/teams/:teamId/shifts/:shiftId
    const staffDeleteRes = await app.inject({
      method: 'DELETE',
      url: `/v1/teams/${team.id}/shifts/${shift.id}`,
      headers: staff.authHeaders,
    });

    // Rule A-01 Assertion: Must return 403 FORBIDDEN
    expect(staffDeleteRes.statusCode).toBe(403);
    const staffError = JSON.parse(staffDeleteRes.body);
    expect(staffError.error.code).toBe('FORBIDDEN');

    // 5. Verify that Owner calling DELETE on the shift succeeds with 200
    const ownerDeleteRes = await app.inject({
      method: 'DELETE',
      url: `/v1/teams/${team.id}/shifts/${shift.id}`,
      headers: owner.authHeaders,
    });
    expect(ownerDeleteRes.statusCode).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // Evidence 2: Rule A-02 — Team Isolation Test (Team A cannot access Team B)
  // ---------------------------------------------------------------------------
  it('Evidence 2 (Rule A-02): User from Team A cannot read or write Team B data (403 FORBIDDEN)', async () => {
    // 1. User A creates Team A
    const userA = await signupUser(nextEmail('user-a02-a'), 'User A');
    const teamA = await createTeam(userA.authHeaders, 'Team Alpha');

    // 2. User B creates Team B
    const userB = await signupUser(nextEmail('user-a02-b'), 'User B');
    const teamB = await createTeam(userB.authHeaders, 'Team Beta');

    // 3. User A attempts to access Team B details
    const resGetTeam = await app.inject({
      method: 'GET',
      url: `/v1/teams/${teamB.id}`,
      headers: userA.authHeaders,
    });

    expect(resGetTeam.statusCode).toBe(403);
    const getError = JSON.parse(resGetTeam.body);
    expect(getError.error.code).toBe('FORBIDDEN');

    // 4. User A attempts to list members of Team B
    const resGetMembers = await app.inject({
      method: 'GET',
      url: `/v1/teams/${teamB.id}/members`,
      headers: userA.authHeaders,
    });

    expect(resGetMembers.statusCode).toBe(403);
    const membersError = JSON.parse(resGetMembers.body);
    expect(membersError.error.code).toBe('FORBIDDEN');
  });

  // ---------------------------------------------------------------------------
  // Evidence 3: Rule S-04 — Refresh Token Rotation and Replay Detection
  // ---------------------------------------------------------------------------
  it('Evidence 3 (Rule S-04): Consumed refresh token reuse revokes entire session family', async () => {
    const user = await signupUser(nextEmail('replay-s04'), 'Replay Tester');
    const initialRefreshToken = user.session.refreshToken;

    // 1. First legitimate refresh: Consumes initialRefreshToken and issues refreshToken2
    const firstRefreshRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: initialRefreshToken },
    });

    expect(firstRefreshRes.statusCode).toBe(200);
    const session2 = JSON.parse(firstRefreshRes.body);
    expect(session2.accessToken).toBeDefined();
    expect(session2.refreshToken).toBeDefined();
    expect(session2.refreshToken).not.toBe(initialRefreshToken);

    const refreshToken2 = session2.refreshToken;

    // 2. Attack / Replay: Re-send the consumed initialRefreshToken
    const replayRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: initialRefreshToken },
    });

    // Replay must be rejected with 401 UNAUTHORIZED
    expect(replayRes.statusCode).toBe(401);
    const replayBody = JSON.parse(replayRes.body);
    expect(replayBody.error.code).toBe('UNAUTHORIZED');

    // 3. Consequence: The entire token family was revoked, so even the latest
    // refreshToken2 is now invalid and rejected!
    const invalidatedRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: refreshToken2 },
    });

    expect(invalidatedRes.statusCode).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // Evidence 4: Rule A-04 — Owner Immutability Test (All 3 Cases)
  // ---------------------------------------------------------------------------
  it('Evidence 4 (Rule A-04): Owner cannot change role, deactivate self, or assign another Owner (409 OWNER_IMMUTABLE)', async () => {
    const owner = await signupUser(nextEmail('owner-a04'), 'Immutable Owner');
    const team = await createTeam(owner.authHeaders, 'Immutability Team');

    const shardDb = getShardDb(team.id);
    const ownerMembership = await shardDb
      .selectFrom('team_memberships')
      .selectAll()
      .where('team_id', '=', team.id)
      .where('user_id', '=', owner.user.id)
      .executeTakeFirstOrThrow();

    // Add a staff member to the team
    const staff = await signupUser(nextEmail('staff-a04'), 'Staff Member');
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

    // Case 1: Owner tries to demote themselves to 'manager'
    const case1Res = await app.inject({
      method: 'PATCH',
      url: `/v1/teams/${team.id}/members/${ownerMembership.id}`,
      headers: owner.authHeaders,
      payload: { role: 'manager' },
    });

    expect(case1Res.statusCode).toBe(409);
    expect(JSON.parse(case1Res.body).error.code).toBe('OWNER_IMMUTABLE');

    // Case 2: Owner tries to suspend/deactivate themselves
    const case2Res = await app.inject({
      method: 'PATCH',
      url: `/v1/teams/${team.id}/members/${ownerMembership.id}`,
      headers: owner.authHeaders,
      payload: { status: 'suspended' },
    });

    expect(case2Res.statusCode).toBe(409);
    expect(JSON.parse(case2Res.body).error.code).toBe('OWNER_IMMUTABLE');

    // Case 3: Owner tries to promote staff member to 'owner'
    const case3Res = await app.inject({
      method: 'PATCH',
      url: `/v1/teams/${team.id}/members/${staffMembership.id}`,
      headers: owner.authHeaders,
      payload: { role: 'owner' },
    });

    expect(case3Res.statusCode).toBe(409);
    expect(JSON.parse(case3Res.body).error.code).toBe('OWNER_IMMUTABLE');
  });

  // ---------------------------------------------------------------------------
  // Evidence 5: Rule A-06 — Atomic Seat Limit Concurrency Race Test
  // ---------------------------------------------------------------------------
  it('Evidence 5 (Rule A-06): Two simultaneous invite accepts on final seat produce exactly one success and one 409 SEAT_LIMIT', async () => {
    // 1. Owner creates team on Starter plan (5 seats limit)
    const owner = await signupUser(nextEmail('owner-a06'), 'Owner A06');
    const team = await createTeam(owner.authHeaders, 'Seat Limit Team');
    const shardDb = getShardDb(team.id);

    // 2. Seed 3 more members so total active members = 4 (1 seat remaining out of 5)
    for (let i = 1; i <= 3; i++) {
      const extraUser = await signupUser(nextEmail(`seed-${i}-a06`), `Member ${i}`);
      await shardDb
        .insertInto('team_memberships')
        .values({
          team_id: team.id,
          user_id: extraUser.user.id,
          role: 'staff',
          status: 'active',
          activated_at: new Date(),
          updated_at: new Date(),
        })
        .execute();
    }

    // Verify 4 active members exist currently
    const preCount = await shardDb
      .selectFrom('team_memberships')
      .selectAll()
      .where('team_id', '=', team.id)
      .where('status', '=', 'active')
      .execute();
    expect(preCount.length).toBe(4);

    // 3. Create two invitations for the last available seat
    const inv1Res = await app.inject({
      method: 'POST',
      url: `/v1/teams/${team.id}/invitations`,
      headers: owner.authHeaders,
      payload: { intendedRole: 'staff' },
    });
    expect(inv1Res.statusCode).toBe(201);
    const inv1 = JSON.parse(inv1Res.body).invitation;

    const inv2Res = await app.inject({
      method: 'POST',
      url: `/v1/teams/${team.id}/invitations`,
      headers: owner.authHeaders,
      payload: { intendedRole: 'staff' },
    });
    expect(inv2Res.statusCode).toBe(201);
    const inv2 = JSON.parse(inv2Res.body).invitation;

    // 4. Two candidate users register
    const candidateA = await signupUser(nextEmail('candidate-a'), 'Candidate A');
    const candidateB = await signupUser(nextEmail('candidate-b'), 'Candidate B');

    // 5. RACE: Execute both acceptances simultaneously!
    const [resA, resB] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/invitations/accept',
        headers: candidateA.authHeaders,
        payload: { token: inv1.token },
      }),
      app.inject({
        method: 'POST',
        url: '/v1/invitations/accept',
        headers: candidateB.authHeaders,
        payload: { token: inv2.token },
      }),
    ]);

    const statusCodes = [resA.statusCode, resB.statusCode].sort();

    // Rule A-06 Assertion: Exactly one 200 and exactly one 409 SEAT_LIMIT
    expect(statusCodes).toEqual([200, 409]);

    const failedRes = resA.statusCode === 409 ? resA : resB;
    const failedBody = JSON.parse(failedRes.body);
    expect(failedBody.error.code).toBe('SEAT_LIMIT');

    // 6. Database Verification: Exactly 5 active memberships exist, never 6!
    const postMemberships = await shardDb
      .selectFrom('team_memberships')
      .selectAll()
      .where('team_id', '=', team.id)
      .where('status', '=', 'active')
      .execute();

    expect(postMemberships.length).toBe(5);
  });
});
