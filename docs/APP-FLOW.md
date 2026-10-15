# Rota — App Flow and Navigation Specification

**Document status:** Draft v1.1 (revised after adversarial review; every ruling applied)

**Platforms:** Android (development build, verified). iOS: same codebase, not verified in MVP.

**Purpose:** Define screen transitions, role-specific routes, and key business flows for design and implementation.

## 1. Navigation model

Use Expo Router with authenticated and unauthenticated route groups. Resolve the active team after authentication. If a user belongs to multiple teams, provide a team switcher and ensure every request is scoped to the active team.

**Five primary tabs: Schedule, Activity, Requests, Team, Settings.** Billing is an Owner-only screen inside the Team tab.

```
App launch
  ├─ Session valid? ── No ──> Welcome / Sign in / Sign up
  │                            ├─ Magic link (email)
  │                            ├─ Password reset
  │                            ├─ Verify email (one-time code)
  │                            ├─ Invitation link → Accept invite
  │                            └─ Enter invite code → Accept invite
  └─ Yes
       ├─ No active team → Create team (Owner) / Accept invitation / Enter invite code
       └─ Active team → Main tabs
            ├─ Schedule
            │   ├─ Week / Agenda
            │   ├─ Shift detail
            │   ├─ Create/Edit shift (Owner/Manager)
            │   └─ Publish/cancel confirmation
            ├─ Activity
            │   └─ Event detail / linked shift or swap
            ├─ Requests
            │   ├─ For you (colleague accept / decline)
            │   ├─ My requests (requester)
            │   ├─ Needs review (Owner/Manager)
            │   └─ Request detail → Accept / Decline / Approve / Reject / Withdraw
            ├─ Team (permission-aware)
            │   ├─ Roster
            │   ├─ Member detail / role edit (Owner)
            │   ├─ Invite member (Owner only)
            │   └─ Billing (Owner only)
            └─ Settings
                ├─ Profile (display name)
                ├─ Notifications / Quiet hours
                ├─ Time zone / Theme   (Language row only when a second language ships)
                ├─ Sessions / Log out all devices
                └─ Help / Sign out
```

## 2. Route map

Suggested Expo Router file layout:

```
app/
  _layout.tsx
  (public)/
    index.tsx
    sign-in.tsx
    sign-up.tsx
    verify-email.tsx
    magic-link.tsx              # request screen + callback handler
    forgot-password.tsx
    reset-password.tsx
    enter-invite-code.tsx       # fallback when the link does not open the app
    invite/[token].tsx
  (onboarding)/
    create-team.tsx             # name + time zone only (no industry)
    start-trial.tsx
    plan-selection.tsx          # reachable later from Team > Billing
  (app)/
    _layout.tsx
    (tabs)/
      _layout.tsx
      schedule/index.tsx
      activity/index.tsx
      requests/index.tsx
      team/index.tsx
      settings/index.tsx
    shifts/
      new.tsx
      [shiftId].tsx
      [shiftId]/edit.tsx
      [shiftId]/publish.tsx
    swaps/
      new.tsx
      [swapId].tsx
    team/
      invite.tsx
      members/[memberId].tsx
      billing/
        index.tsx
        plans.tsx
        seats.tsx
        quote.tsx
        checkout-return.tsx
    settings/
      notifications.tsx
      profile.tsx
      sessions.tsx
```

Invitation and magic-link URLs are `https` links served by the static link site and opened by Android App Links (custom schemes such as `rota://` are not relied on). Route guards improve user experience but do not replace server-side authorization.

## 3. App launch and session flow

1. Read session metadata from secure storage; never expose token values to logs.
2. If the access token (15-minute lifetime, `sid` claim) is valid, fetch the current user and memberships.
3. If the access token is expired, refresh using the stored refresh token **through one shared in-flight promise**. Parallel 401s wait on the same refresh, so honest users never trip the replay rule.
4. On successful refresh, persist rotated tokens securely and continue.
5. If refresh fails or replay is detected: clear local tokens, **wipe the persisted shift cache**, and route to sign-in.
6. If the server reports the session revoked (for example after logout-all on another device), do the same wipe and route to sign-in.
7. If the signed-in user differs from the user who owns the cache, wipe the cache before loading.
8. If no team membership exists, route to invitation acceptance (link or code) or owner onboarding.
9. If a membership exists, load team, settings, subscription entitlement as appropriate, and upcoming shifts.
10. On first launch, send the device time zone to the server (IANA name) to initialize settings.
11. On app foreground, refresh settings and critical schedule data according to query policies.

## 4. Authentication and invitation flow

### Sign up

Welcome → Sign up → Validate email/password → Create account → Enter one-time verification code → Create team or accept invitation → Main app.

### Sign in

Sign in → Email/password **or magic link** → Backend session → SecureStore → Fetch memberships → Active team selection → Schedule. Magic-link sign-in counts as a verified email. (Google sign-in is out of MVP.)

### Password reset

Forgot password → Enter email → Generic success response → Email reset link (`https`) → App opens (or fallback page) → Validate single-use expiring token → Set new password → Revoke existing sessions → Sign in.

### Invite acceptance

Owner creates invite → Email or share link delivered (the same message includes an invite code) → Recipient taps the `https` link → App opens via App Link, or the fallback page offers "install the app" → Backend validates the token (`{teamId}.{random}`, hashed server-side) → Sign in or sign up → Verified email required for an email-bound invite → Confirm intended email/role/team → Backend locks the subscription row and checks `purchased_seats` → Membership activated → Route to team Schedule.

**Fresh install:** a development build has no deferred deep links, so the invite is gone after installing. The user installs the app, then **re-taps the link or enters the code** on the "Enter invite code" screen.

Failure paths: expired token, revoked invite, already accepted, wrong email, unverified email, **team full (`SEAT_LIMIT`: "This team is full. Ask the owner to add a seat.")**, restricted team, no network. Each has a clear next step.

## 5. Owner onboarding

1. Create account and verify email.
2. Create team: name and time zone only (no industry field).
3. **Start trial:** the team starts `trialing` on Starter limits for 14 days, no card. Show the trial end date and seat capacity (5).
4. Invite first members (Owner only) and choose roles.
5. Show empty schedule with "Create first shift" and "Invite team" actions.
6. **Choose a plan later** from Team → Billing. Show purchased seats, included seats, and overage pricing before confirmation.
7. If payment confirmation is pending, show the real server-derived state rather than assuming checkout success.
8. A trial that ends unpaid becomes `restricted` (read-only); the banner explains how to recover.

## 6. Schedule and shift flows

### Staff viewing schedule

Schedule tab → current week → upcoming **published** shift card (no notes, never drafts) → shift detail. Times show in the team's time zone. Offline path uses the persisted upcoming shifts and shows "Offline · Last updated [time]". If the last successful sync is more than 14 days old, hide the cache and show "Reconnect to refresh".

### Manager creating a shift

Schedule → Create shift → Enter title/role, date, start/end (overnight allowed, at most 24 hours), assignee(s), location/notes → Validate times → Save draft or Publish → Backend authorization and validation → Transaction takes the per-member advisory lock, checks overlaps, persists shift/assignments/activity/outbox → **Cache version bumped in the request right after commit** → UI refreshes → Notification job handles delivery.

Failure states:

- Invalid start/end time or duration over 24 hours.
- **Assignment overlap (always blocked; no override).** Explain which shift conflicts.
- Subscription/team restricted.
- Network failure.
- Permission denied.
- Stale version/conflicting edit.

Do not discard form input after a recoverable failure.

### Editing/cancelling a published shift

Open shift → Edit or Cancel → Explain affected staff and whether a push will be sent → Confirm → Backend checks role and team → Persist mutation and activity event → Cancelling expires pending swaps for that shift (`shift_cancelled`) in the same transaction → Bump cache version → Queue notifications.

**Notification decision:** changes to time, assignee, or location of a published shift send a push; notes-only edits create an activity event with no push.

## 7. Shift swap flow

**MVP swap is a direct handoff.** The requester nominates one colleague. Open offers and two-way trades are out of MVP.

### Staff request

Schedule → Assigned shift detail (published, in the future, requester currently assigned) → Request swap → Choose one colleague → Optional note → Review → Submit → Optimistic Pending state and disabled button → Server validates assignment, eligibility, target conflicts, and the one-pending-swap-per-shift-and-requester index → Request appears in the requester's My requests and the colleague's For you.

### Colleague response

Requests → For you → Open request → **Accept** or **Decline** → Server records `target_accepted_at` or sets `declined` → Requester and managers are notified.

### Manager decision

Requests → Needs review → Open request (shown only after the colleague has accepted) → Inspect shift, requester, target, conflicts → Approve or Reject → Confirm → Backend locks the swap and relevant rows, re-checks eligibility and the target's overlaps under the advisory lock → Transaction updates the swap and assignments (or marks rejected) → Activity/outbox event committed → UI updates → Notification jobs queued.

**Approver rule:** the approver cannot be the requester or the target. If the owner is the requester and no manager exists, the owner may approve and the activity event is tagged `self_approved`.

### Withdrawal and expiration

Requester opens a pending request → Withdraw → Confirm → Backend verifies requester and pending state → status becomes Withdrawn.

A pending swap expires when the shift starts or 7 days after creation, whichever is first. Cancelling a shift expires its pending swaps with reason `shift_cancelled`. The expiry job runs every 5 minutes.

Concurrency rules:

- A request can only be decided once.
- Approval requires prior acceptance and re-checks current shift and eligibility.
- A duplicate request, from one device or two, hits the partial unique index and returns `409`, not a second row. A duplicate approval is a no-op or conflict, not a second assignment mutation.
- Client optimistic state rolls back on failure and displays a useful message.

## 8. Activity feed flow

Activity tab → Fetch the first cursor page (the server filters events by the viewer's role and membership) → Show skeleton or events → Scroll threshold → If not already fetching and `nextCursor` exists, fetch the next page → Append unique events → End marker when exhausted.

Pull-to-refresh → Reset cursor stack → Fetch newest page → Replace/merge carefully to avoid duplicate IDs. Pull to refresh also recovers rows that committed after the first page loaded, including a row committed late with an older timestamp.

On error → Keep previously loaded items and show a retry affordance.

The cursor is an opaque string carrying `created_at` as text (microsecond precision) plus the row id; the client never parses it. Guarantee: no duplicates, ever.

## 9. Notifications and settings flow

### Settings

Settings → Notification preferences → Toggle category, quiet hours, or time zone → Apply optimistic update → `PATCH` only the changed fields → Success: the server stamps each accepted field in `field_updated_at`; failure restores the previous state and shows an error.

- Settings edits are **blocked offline**: controls are disabled with "Connect to change settings."
- On another device or on app foreground → Fetch settings → Apply server state.
- Known weakness: a stale device can overwrite the same field after it reconnects.
- Time zone is initialized from the device on first launch; there is no UTC default.

### Notification delivery

Worker receives an outbox event → Creates a `notification_jobs` row (unique per event, user, and category) → Resolves recipient preferences and time zone → **Security events (new sign-in, logout-all, password change) send immediately; everything else obeys quiet hours** → Delayed items wait for the end of quiet hours, are re-checked against the current entity state, and collapse into one digest push → Sends → Records the result.

The app shows a time-critical shift change made during quiet hours immediately; the push arrives when quiet hours end. Do not assume the device enforces quiet hours.

### Notification tap

Every push carries `{type, teamId, entityId}`. The app maps it to a route:

| `type` | Route |
|---|---|
| `shift` | `shifts/[entityId]` |
| `swap` | `swaps/[entityId]` |
| `billing` | `team/billing` (Owner) |
| `activity` | Activity tab |

Handle **cold start** (app launched by the tap), **background** (app resumed), and **foreground** (show an in-app banner; tapping routes the same way). If the tap names a team other than the active one, switch team first. Payloads never carry shift notes.

### Push token lifecycle

Register after login: `POST /me/push-tokens` upserts by token and reassigns `user_id`. Logout and logout-all send the device token to deactivate. Shared phones therefore never keep Alice's token active for Bob.

## 10. Billing flow

Team → Billing (Owner only) → Current plan, status, and seats → Choose plan or seat count → **Server creates a quote** (exact price, included seats, overage, proration, effective date, renewal effect; valid for the earlier of 30 minutes or period end) → Confirm → Backend creates an idempotent checkout for the quoted amount → Payment provider test checkout → Provider webhook → Signature verification → Persist unique event (global dedupe) → Background worker processes the event → Append ledger entry and update subscription state → Client refreshes server state.

Important states: Trialing, Checkout started, Awaiting provider confirmation, Active, Past due, Grace period (7 days), Restricted, Cancelled, Payment failed.

- Never treat a checkout return URL as proof of payment.
- Cost-raising changes (`new_amount > current_amount`) apply after payment is confirmed. Cost-lowering changes are scheduled for period end and shown as "Takes effect at the end of this period".
- The charge equals the quote the owner saw.
- The hourly billing scheduler applies scheduled changes, starts renewal charges, moves `past_due` → `grace` → `restricted`, and ends trials.
- A failed renewal notifies the Owner, gives 7 days of grace, then the team becomes read-only with billing recovery still available.

Plan rules:

| Plan | Price | Seats | Extra seat | Ceiling |
|---|---:|---|---|---:|
| Starter | $20/month | up to 5 | none | 5 |
| Team | $50/month | up to 15 | $3/month | 38 |
| Business | $120/month | up to 40 | $2/month | 100 (operational ceiling) |

Proration is server-calculated in integer cents. Seat limits are enforced when a membership is activated (row lock, `purchased_seats`), not only when the UI renders.

## 11. Role and permission matrix

| Capability | Owner | Manager | Staff |
|---|---:|---:|---:|
| View own assigned shifts | Yes | Yes | Yes |
| View team calendar | Yes (all, incl. drafts and notes) | Yes (all, incl. drafts and notes) | Published shifts only, no notes, never drafts |
| Create/edit/publish/cancel shifts | Yes | Yes | No |
| Request swap for own shift | If assigned and eligible | If assigned and eligible | If assigned and eligible |
| Accept/decline a swap addressed to them | Yes, if target | Yes, if target | Yes, if target |
| Approve/reject swap | Yes (not as requester or target, except the self-approval case) | Yes (not as requester or target) | No |
| Withdraw own pending request | Yes, if requester | Yes, if requester | Yes, if requester |
| Invite members | Yes | No | No |
| Change roles/deactivate members | Yes (Manager/Staff only; never self, never to Owner: `OWNER_IMMUTABLE`) | No | No |
| View billing/manage plan/seats | Yes | No | No |
| Change own settings | Yes | Yes | Yes |
| Change another user's settings | No | No | No |
| View activity feed | Yes (all events, including billing) | Team, managers, and participant events | Team events and participant events they are in |

The backend must enforce this matrix and any final policy refinements.

## 12. Error and edge-state flows

- **Offline:** read cached upcoming shifts (hidden after 14 days without sync); disable all writes, including settings edits; display connection and last-updated state.
- **Expired session:** refresh once (shared promise); if it fails, wipe the cache, route to sign-in, and preserve non-sensitive draft form data where safe.
- **Session revoked elsewhere:** wipe the cache and route to sign-in. A phone that is offline cannot be reached by logout-all; its cache is hidden after 14 days without sync and erased on next contact.
- **Permission denied:** show an explanation and return to a permitted screen.
- **Seat limit reached:** explain that the team is full, show the Owner-only billing path to the Owner, and do not activate the member.
- **Owner immutability:** attempts to change the owner's role or status return `OWNER_IMMUTABLE` with a plain explanation.
- **Shift overlap:** show which shift conflicts; there is no override.
- **Quiet hours:** do not show a false "push sent" confirmation; activity remains available in-app at once.
- **Webhook delay:** show "Payment confirmation pending" until the backend confirms.
- **Quote expired:** ask the owner to review a fresh quote.
- **Concurrent swap decision or duplicate swap:** refresh the current request and explain that it has already been handled.
- **Feed failure:** preserve loaded items and offer retry.
- **Stale settings:** per-field `field_updated_at` governs; communicate a conflict if a field was changed elsewhere.
- **Trial ended / grace / restricted:** persistent banner with recovery path; read-only access remains.

## 13. Navigation QA checklist

- [ ] **Fresh install: install, then re-tap the link or enter the code.** The invite works on an existing session and an expired session.
- [ ] Magic link signs in and counts as verified; password sign-up verifies with a one-time code.
- [ ] Auth refresh uses one shared in-flight promise; parallel 401s do not log the user out.
- [ ] Logout and logout-all lead to the correct navigation, wipe the local cache, and deactivate the push token.
- [ ] Changing the signed-in user on a shared phone wipes the previous user's cache.
- [ ] Role-restricted routes are hidden where appropriate and server-protected regardless.
- [ ] Five tabs only; Billing is reachable only for the Owner, inside Team.
- [ ] Staff never see drafts, shift notes, or billing events.
- [ ] Every mutation has loading, success, and recoverable error states.
- [ ] Back navigation does not lose unsaved form input unexpectedly.
- [ ] Offline schedule opens without network and displays last-updated time; hidden after 14 days without sync.
- [ ] Settings edits are blocked offline.
- [ ] Tapping a push opens the exact screen from a cold start, background, and foreground.
- [ ] Activity pagination handles fast scroll and pull-to-refresh without duplicate requests or duplicate rows.
- [ ] Swap flow: colleague accepts before the manager can approve; duplicate taps create one request.
- [ ] Billing status comes from backend/webhook state, not the return URL; the charge equals the quote.
- [ ] Every interactive element has an accessibility label, a 44×44 pt target, and sufficient contrast; layouts survive the largest font size.
