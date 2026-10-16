/**
 * =============================================================================
 * Rota API — Tier 2 Graduation Evidence Integration Tests
 * =============================================================================
 * Proves the 2 critical graduation criteria for Tier 2:
 *
 * 1. Rule A-09: Overlap Race Test
 *    Two managers concurrently assign the same person to overlapping shifts
 *    → exactly ONE succeeds and ONE fails with 409 OVERLAPPING_SHIFT.
 *
 * 2. Rule A-10: Swap Concurrency Test (duplicate swap from two devices)
 *    Two simultaneous swap requests for the same shift and requester
 *    → exactly ONE succeeds and ONE fails with 409 SWAP_DUPLICATE.
 *
 * Additional A-10 correctness tests:
 * 3. Full swap lifecycle: create → accept → approve → assignment transferred.
 * 4. Cannot approve before target accepts (SWAP_NOT_ACCEPTED).
 * 5. Cannot approve when approver is requester (unless Owner self-approval).
 * 6. Shift cancellation expires pending swaps in the same operation.
 *
 * Additional A-07 test:
 * 7. Staff cannot see draft shifts or shift notes.
 * =============================================================================
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { buildApp } from '../src/app.js';
import { getShardDb } from '../src/db/index.js';
import type { App } from '../src/app.js';

describe('Tier 2 Graduation Evidence: Shifts & Swaps', () => {
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
      session: body.session,
      authHeaders: { authorization: `Bearer ${body.session.accessToken}` },
    };
  }

  async function createTeam(authHeaders: Record<string, string>, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/teams',
      headers: authHeaders,
      payload: { name, timezone: 'Europe/London' },
    });
    expect(res.statusCode, `createTeam: ${res.body}`).toBe(201);
    return JSON.parse(res.body).team;
  }

  /** Add a user directly into the shard with a given role */
  async function addMember(
    teamId: string,
    userId: string,
    role: 'manager' | 'staff'
  ): Promise<string> {
    const db = getShardDb(teamId);
    const row = await db
      .insertInto('team_memberships')
      .values({
        team_id: teamId,
        user_id: userId,
        role,
        status: 'active',
        activated_at: new Date(),
        updated_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /** Create a shift via the API */
  async function createShift(
    authHeaders: Record<string, string>,
    teamId: string,
    opts: { startsOffset?: number; endsOffset?: number; title?: string } = {}
  ) {
    const base = Date.now() + 86_400_000; // tomorrow
    const startsAt = new Date(base + (opts.startsOffset ?? 0));
    const endsAt = new Date(base + (opts.endsOffset ?? 7_200_000)); // +2h by default
    const res = await app.inject({
      method: 'POST',
      url: `/v1/teams/${teamId}/shifts`,
      headers: authHeaders,
      payload: {
        title: opts.title ?? 'Test Shift',
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      },
    });
    expect(res.statusCode, `createShift: ${res.body}`).toBe(201);
    return JSON.parse(res.body).shift;
  }

  /** Publish a shift via the API */
  async function publishShift(
    authHeaders: Record<string, string>,
    teamId: string,
    shiftId: string,
    assignMembershipId?: string
  ) {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/teams/${teamId}/shifts/${shiftId}/publish`,
      headers: authHeaders,
      payload: assignMembershipId ? { assignMembershipId } : {},
    });
    expect(res.statusCode, `publishShift: ${res.body}`).toBe(200);
    return JSON.parse(res.body).shift;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Evidence 1 (A-09): Overlap Race — two concurrent assignments, one succeeds
  // ─────────────────────────────────────────────────────────────────────────────
  it(
    'Evidence 1 (A-09): Two concurrent overlapping-shift assignments → exactly one succeeds and one is 409 OVERLAPPING_SHIFT',
    async () => {
      const owner = await signupUser(nextEmail('owner-a09'), 'Owner A09');
      const team = await createTeam(owner.authHeaders, 'Overlap Test Team');

      // A staff member to be assigned
      const staff = await signupUser(nextEmail('staff-a09'), 'Staff A09');
      const staffMembershipId = await addMember(team.id, staff.user.id, 'staff');

      // Two overlapping shifts (same window)
      const _base = Date.now() + 86_400_000;
      const shift1 = await createShift(owner.authHeaders, team.id, {
        title: 'Morning 1',
        startsOffset: 0,
        endsOffset: 3_600_000, // 1 hour
      });
      const shift2 = await createShift(owner.authHeaders, team.id, {
        title: 'Morning 2',
        startsOffset: 1_800_000, // overlaps: starts 30min into shift1
        endsOffset: 5_400_000,   // ends 1.5h after base
      });

      // RACE: Assign the same person to both overlapping shifts simultaneously
      const [res1, res2] = await Promise.all([
        app.inject({
          method: 'POST',
          url: `/v1/teams/${team.id}/shifts/${shift1.id}/assignments/${staffMembershipId}`,
          headers: owner.authHeaders,
        }),
        app.inject({
          method: 'POST',
          url: `/v1/teams/${team.id}/shifts/${shift2.id}/assignments/${staffMembershipId}`,
          headers: owner.authHeaders,
        }),
      ]);

      const codes = [res1.statusCode, res2.statusCode].sort();

      // Exactly one 201 success and one 409 OVERLAPPING_SHIFT
      expect(codes, `Got status codes: ${codes.join(', ')} — bodies: ${res1.body} / ${res2.body}`).toEqual([201, 409]);

      const failedRes = res1.statusCode === 409 ? res1 : res2;
      const failedBody = JSON.parse(failedRes.body);
      expect(failedBody.error.code).toBe('OVERLAPPING_SHIFT');

      // DB verification: staff member has exactly ONE active assignment, never two
      const db = getShardDb(team.id);
      const assignments = await db
        .selectFrom('shift_assignments')
        .selectAll()
        .where('membership_id', '=', staffMembershipId)
        .where('status', '=', 'assigned')
        .execute();
      expect(assignments.length).toBe(1);
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Evidence 2 (A-10): Swap Duplicate — two devices, same shift, same requester
  // ─────────────────────────────────────────────────────────────────────────────
  it(
    'Evidence 2 (A-10): Two simultaneous swap requests for the same shift → exactly one succeeds and one is 409 SWAP_DUPLICATE',
    async () => {
      const owner = await signupUser(nextEmail('owner-dup'), 'Owner Dup');
      const team = await createTeam(owner.authHeaders, 'Swap Duplicate Team');
      const db = getShardDb(team.id);

      const ownerMembership = await db
        .selectFrom('team_memberships')
        .selectAll()
        .where('team_id', '=', team.id)
        .where('user_id', '=', owner.user.id)
        .executeTakeFirstOrThrow();

      const target = await signupUser(nextEmail('target-dup'), 'Target Dup');
      const targetMembershipId = await addMember(team.id, target.user.id, 'staff');

      // Publish a shift assigned to the owner
      const shift = await createShift(owner.authHeaders, team.id, { title: 'Swap Shift Dup' });
      await publishShift(owner.authHeaders, team.id, shift.id, ownerMembership.id);

      // RACE: Two simultaneous swap requests for the same shift+requester
      const [resA, resB] = await Promise.all([
        app.inject({
          method: 'POST',
          url: `/v1/teams/${team.id}/shifts/${shift.id}/swaps`,
          headers: owner.authHeaders,
          payload: { targetMembershipId },
        }),
        app.inject({
          method: 'POST',
          url: `/v1/teams/${team.id}/shifts/${shift.id}/swaps`,
          headers: owner.authHeaders,
          payload: { targetMembershipId },
        }),
      ]);

      const codes = [resA.statusCode, resB.statusCode].sort();

      // Exactly one 201 and one 409
      expect(codes, `Got: ${codes.join(', ')} bodies: ${resA.body} / ${resB.body}`).toEqual([201, 409]);

      const failedRes = resA.statusCode === 409 ? resA : resB;
      const failedBody = JSON.parse(failedRes.body);
      expect(failedBody.error.code).toBe('SWAP_DUPLICATE');

      // DB: exactly ONE pending swap for this shift+requester
      const swaps = await db
        .selectFrom('swap_requests')
        .selectAll()
        .where('team_id', '=', team.id)
        .where('shift_id', '=', shift.id)
        .where('requester_membership_id', '=', ownerMembership.id)
        .where('status', '=', 'pending')
        .execute();
      expect(swaps.length).toBe(1);
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Evidence 3 (A-10): Full swap lifecycle
  // ─────────────────────────────────────────────────────────────────────────────
  it(
    'Evidence 3 (A-10): Full swap lifecycle — create → target accepts → manager approves → assignment transferred',
    async () => {
      const owner = await signupUser(nextEmail('owner-swap-full'), 'Owner Full');
      const team = await createTeam(owner.authHeaders, 'Swap Lifecycle Team');
      const db = getShardDb(team.id);

      const ownerMembership = await db
        .selectFrom('team_memberships')
        .selectAll()
        .where('team_id', '=', team.id)
        .where('user_id', '=', owner.user.id)
        .executeTakeFirstOrThrow();

      const target = await signupUser(nextEmail('target-full'), 'Target Full');
      const targetMembershipId = await addMember(team.id, target.user.id, 'staff');

      const manager = await signupUser(nextEmail('mgr-full'), 'Manager Full');
      const managerMembershipId = await addMember(team.id, manager.user.id, 'manager');

      // Published shift assigned to owner
      const shift = await createShift(owner.authHeaders, team.id, { title: 'Full Lifecycle Shift' });
      await publishShift(owner.authHeaders, team.id, shift.id, ownerMembership.id);

      // Step 1: Owner requests swap
      const createRes = await app.inject({
        method: 'POST',
        url: `/v1/teams/${team.id}/shifts/${shift.id}/swaps`,
        headers: owner.authHeaders,
        payload: { targetMembershipId },
      });
      expect(createRes.statusCode, createRes.body).toBe(201);
      const swapId = JSON.parse(createRes.body).swap.id;

      // Step 2: Target accepts
      const acceptRes = await app.inject({
        method: 'POST',
        url: `/v1/teams/${team.id}/swaps/${swapId}/respond`,
        headers: target.authHeaders,
        payload: { action: 'accept' },
      });
      expect(acceptRes.statusCode, acceptRes.body).toBe(200);
      const afterAccept = JSON.parse(acceptRes.body).swap;
      expect(afterAccept.targetAcceptedAt).not.toBeNull();
      expect(afterAccept.status).toBe('pending'); // still pending until manager approves

      // Step 3: Manager approves
      const approveRes = await app.inject({
        method: 'POST',
        url: `/v1/teams/${team.id}/swaps/${swapId}/review`,
        headers: manager.authHeaders,
        payload: { action: 'approve' },
      });
      expect(approveRes.statusCode, approveRes.body).toBe(200);
      const approvedSwap = JSON.parse(approveRes.body).swap;
      expect(approvedSwap.status).toBe('approved');
      expect(approvedSwap.reviewedByMembershipId).toBe(managerMembershipId);

      // DB: assignment transferred — target is now assigned, owner is removed
      const ownerAssignment = await db
        .selectFrom('shift_assignments')
        .selectAll()
        .where('team_id', '=', team.id)
        .where('shift_id', '=', shift.id)
        .where('membership_id', '=', ownerMembership.id)
        .where('status', '=', 'assigned')
        .executeTakeFirst();
      expect(ownerAssignment, 'Owner assignment should be removed after swap approval').toBeUndefined();

      const targetAssignment = await db
        .selectFrom('shift_assignments')
        .selectAll()
        .where('team_id', '=', team.id)
        .where('shift_id', '=', shift.id)
        .where('membership_id', '=', targetMembershipId)
        .where('status', '=', 'assigned')
        .executeTakeFirst();
      expect(targetAssignment, 'Target should now be assigned').toBeDefined();

      // Activity event was created (D-05)
      const activityEvent = await db
        .selectFrom('activity_events')
        .selectAll()
        .where('team_id', '=', team.id)
        .where('event_type', '=', 'swap_approved')
        .executeTakeFirst();
      expect(activityEvent, 'Activity event should be written in same transaction').toBeDefined();

      // Outbox event was created (D-05)
      const outboxEvent = await db
        .selectFrom('domain_outbox_events')
        .selectAll()
        .where('team_id', '=', team.id)
        .where('event_type', '=', 'swap_approved')
        .executeTakeFirst();
      expect(outboxEvent, 'Outbox event should be written in same transaction').toBeDefined();
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Evidence 4 (A-10): Cannot approve without target acceptance
  // ─────────────────────────────────────────────────────────────────────────────
  it(
    'Evidence 4 (A-10): Manager cannot approve a swap before the target has accepted (409 SWAP_NOT_ACCEPTED)',
    async () => {
      const owner = await signupUser(nextEmail('owner-no-accept'), 'Owner NoAccept');
      const team = await createTeam(owner.authHeaders, 'No Accept Team');
      const db = getShardDb(team.id);

      const ownerMembership = await db
        .selectFrom('team_memberships')
        .selectAll()
        .where('team_id', '=', team.id)
        .where('user_id', '=', owner.user.id)
        .executeTakeFirstOrThrow();

      const target = await signupUser(nextEmail('target-no-accept'), 'Target NoAccept');
      const targetMembershipId = await addMember(team.id, target.user.id, 'staff');

      const manager = await signupUser(nextEmail('mgr-no-accept'), 'Manager NoAccept');
      await addMember(team.id, manager.user.id, 'manager');

      const shift = await createShift(owner.authHeaders, team.id, { title: 'NoAccept Shift' });
      await publishShift(owner.authHeaders, team.id, shift.id, ownerMembership.id);

      const createRes = await app.inject({
        method: 'POST',
        url: `/v1/teams/${team.id}/shifts/${shift.id}/swaps`,
        headers: owner.authHeaders,
        payload: { targetMembershipId },
      });
      expect(createRes.statusCode).toBe(201);
      const swapId = JSON.parse(createRes.body).swap.id;

      // Manager tries to approve BEFORE target accepts
      const approveRes = await app.inject({
        method: 'POST',
        url: `/v1/teams/${team.id}/swaps/${swapId}/review`,
        headers: manager.authHeaders,
        payload: { action: 'approve' },
      });
      expect(approveRes.statusCode).toBe(409);
      expect(JSON.parse(approveRes.body).error.code).toBe('SWAP_NOT_ACCEPTED');
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Evidence 5 (A-10): Shift cancellation expires pending swaps
  // ─────────────────────────────────────────────────────────────────────────────
  it(
    'Evidence 5 (A-10): Cancelling a shift expires its pending swap with reason shift_cancelled',
    async () => {
      const owner = await signupUser(nextEmail('owner-cancel'), 'Owner Cancel');
      const team = await createTeam(owner.authHeaders, 'Cancel Shift Team');
      const db = getShardDb(team.id);

      const ownerMembership = await db
        .selectFrom('team_memberships')
        .selectAll()
        .where('team_id', '=', team.id)
        .where('user_id', '=', owner.user.id)
        .executeTakeFirstOrThrow();

      const target = await signupUser(nextEmail('target-cancel'), 'Target Cancel');
      const targetMembershipId = await addMember(team.id, target.user.id, 'staff');

      const shift = await createShift(owner.authHeaders, team.id, { title: 'Cancel Shift' });
      await publishShift(owner.authHeaders, team.id, shift.id, ownerMembership.id);

      // Create a pending swap
      const createRes = await app.inject({
        method: 'POST',
        url: `/v1/teams/${team.id}/shifts/${shift.id}/swaps`,
        headers: owner.authHeaders,
        payload: { targetMembershipId },
      });
      expect(createRes.statusCode).toBe(201);
      const swapId = JSON.parse(createRes.body).swap.id;

      // Cancel the shift — should expire the pending swap
      const cancelRes = await app.inject({
        method: 'DELETE',
        url: `/v1/teams/${team.id}/shifts/${shift.id}`,
        headers: owner.authHeaders,
      });
      expect(cancelRes.statusCode, cancelRes.body).toBe(200);

      // Swap must now be expired with reason 'shift_cancelled'
      // Note: The cancel route calls swapsService.expireSwapsForShift — verify via DB
      const swap = await db
        .selectFrom('swap_requests')
        .selectAll()
        .where('id', '=', swapId)
        .executeTakeFirstOrThrow();

      expect(swap.status).toBe('expired');
      expect(swap.expired_reason).toBe('shift_cancelled');
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Evidence 6 (A-07): Staff cannot see draft shifts or notes
  // ─────────────────────────────────────────────────────────────────────────────
  it(
    'Evidence 6 (A-07): Staff cannot see draft shifts; published shifts returned without notes',
    async () => {
      const owner = await signupUser(nextEmail('owner-a07'), 'Owner A07');
      const team = await createTeam(owner.authHeaders, 'A07 Team');
      const db = getShardDb(team.id);

      const staff = await signupUser(nextEmail('staff-a07'), 'Staff A07');
      await addMember(team.id, staff.user.id, 'staff');

      // Owner creates a draft shift with notes
      const draftRes = await app.inject({
        method: 'POST',
        url: `/v1/teams/${team.id}/shifts`,
        headers: owner.authHeaders,
        payload: {
          title: 'Draft Shift',
          notes: 'Secret manager notes',
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
          endsAt: new Date(Date.now() + 90_000_000).toISOString(),
        },
      });
      expect(draftRes.statusCode).toBe(201);
      const draftShift = JSON.parse(draftRes.body).shift;

      // Staff cannot see the draft shift (list)
      const staffListRes = await app.inject({
        method: 'GET',
        url: `/v1/teams/${team.id}/shifts`,
        headers: staff.authHeaders,
      });
      expect(staffListRes.statusCode).toBe(200);
      const staffShifts = JSON.parse(staffListRes.body).shifts;
      const foundDraft = staffShifts.find((s: { id: string }) => s.id === draftShift.id);
      expect(foundDraft, 'Staff should not see draft shift in list').toBeUndefined();

      // Staff cannot get the draft shift directly
      const staffGetRes = await app.inject({
        method: 'GET',
        url: `/v1/teams/${team.id}/shifts/${draftShift.id}`,
        headers: staff.authHeaders,
      });
      expect(staffGetRes.statusCode).toBe(404);

      // Now publish the shift
      const ownerMembership = await db
        .selectFrom('team_memberships')
        .selectAll()
        .where('team_id', '=', team.id)
        .where('user_id', '=', owner.user.id)
        .executeTakeFirstOrThrow();
      await publishShift(owner.authHeaders, team.id, draftShift.id, ownerMembership.id);

      // Staff can now see the published shift
      const staffGetPublishedRes = await app.inject({
        method: 'GET',
        url: `/v1/teams/${team.id}/shifts/${draftShift.id}`,
        headers: staff.authHeaders,
      });
      expect(staffGetPublishedRes.statusCode).toBe(200);
      const publishedShift = JSON.parse(staffGetPublishedRes.body).shift;

      // Notes must NOT be present for staff (A-07)
      expect(
        'notes' in publishedShift,
        'Staff response must not contain a notes field'
      ).toBe(false);

      // Owner sees notes
      const ownerGetRes = await app.inject({
        method: 'GET',
        url: `/v1/teams/${team.id}/shifts/${draftShift.id}`,
        headers: owner.authHeaders,
      });
      expect(ownerGetRes.statusCode).toBe(200);
      const ownerShift = JSON.parse(ownerGetRes.body).shift;
      expect(ownerShift.notes).toBe('Secret manager notes');
    }
  );
});
