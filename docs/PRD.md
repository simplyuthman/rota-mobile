# Rota — Product Requirements Document (PRD)

**Document status:** Draft v1.1 (revised after adversarial review; every ruling applied)

**Product:** Rota

**Platforms:** Android (development build, verified). iOS: same codebase, not verified in MVP.

**Primary audience:** Product, design, mobile, backend, QA, and AI coding agents

---

## 1. Product summary

Rota is a mobile-first workforce scheduling product for restaurants, clinics, shops, and other shift-based businesses. Owners create a workspace, invite staff, manage subscriptions and seat capacity, and delegate scheduling. Managers create and publish shifts and approve shift swaps. Staff view their upcoming shifts, request swaps, and receive relevant updates. Rota provides a reliable, role-aware schedule, an auditable activity feed, synchronized notification preferences, and offline access to upcoming shifts.

**Product promise:** Everyone knows when they are working, changes are traceable, and schedule changes follow the right approval path.

## 2. Problem statement

Shift-based teams often coordinate schedules across chat messages, spreadsheets, paper notices, and informal conversations. This can lead to missed changes, duplicate coverage, unclear ownership, slow swap approvals, and poor visibility for staff. Owners also need a clear way to manage team membership and subscription costs as staffing changes.

Rota consolidates schedules, swap workflows, notifications, team permissions, and seat-based billing in one mobile experience.

**Assumption (unvalidated):** the first target is restaurants and cafés with 5 to 40 staff, which matches the plan limits. The problem claim above is also an assumption until validated with real teams.

## 3. Goals and non-goals

### Goals

1. Let an owner create a team and invite members without needing a desktop.
2. Let authorized managers create, edit, publish, and cancel shifts.
3. Let staff see published shifts for their team and request eligible swaps.
4. Require colleague consent and manager approval for swap requests, and make the final outcome visible to everyone affected.
5. Deliver useful notifications without violating each user's server-enforced quiet hours.
6. Keep upcoming shifts available when a device is offline, showing when cached data was last refreshed.
7. Enforce roles, team isolation, subscription limits, and billing decisions on the server.
8. Provide an activity feed that stays correct as it grows: first page p95 at or under 500 ms at 200 virtual users (Section 9).

### Non-goals for the initial release

- Payroll, timesheets, time-clock/geofencing, tips, or wage calculations.
- Demand forecasting, AI-generated schedules, or labor-law compliance automation.
- Full desktop/web scheduling console. (A tiny static site for link verification and the invite fallback page is not a console; see Section 6.1.)
- Multi-location hierarchy beyond the initial team/workspace model.
- Employee performance management or HR records.
- Automatic approval of swaps.
- Open swap offers and two-way shift trades.
- Ownership transfer.
- Configurable overlap policy or manager overrides of overlaps.
- Shift breaks and multiple locations per team.
- Offline writes of any kind.
- Real-money production billing before test-mode billing and webhook handling are verified.

### Graduation deliverables (not product goals)

These come from the graduation brief. They are tracked here and in Section 11 so they are not mistaken for product behaviour:

- Demonstrate engineering quality through tests, load measurements, architecture notes, and a reproducible development build.
- Everything listed under "Graduation deliverables" in Section 11.

### Scope tiers

**Step zero:** confirm whether the deadline of Monday 19 October 2026 has moved. No edit to this document creates time. The Implementation Plan phases add up to 24 days at best and 40 at worst. The brief has no optional parts for Rota, so scope can only be cut in depth inside each requirement, never by dropping a requirement.

If the deadline has not moved, build in this order. Each tier ends with the evidence the brief asks for.

| Tier | Build | Evidence that ends the tier |
|---|---|---|
| 1 | Auth, roles, team isolation tests | Permission test (Staff calling delete shift is rejected); team-isolation test; token rotation/replay test |
| 2 | Shifts and direct swap | Overlap and swap concurrency tests; swap flow demo |
| 3 | Cursor feed with 10,000 rows | Seeded 10,000 events; `EXPLAIN ANALYZE` before and after the index for a staff view and an owner view |
| 4 | Settings and quiet hours in the worker | Quiet-hours test through the notification worker; cross-device settings sync demo |
| 5 | Proration unit tests, webhook pipeline, ledger | Eight or more proration tests including the pinned vectors; duplicate-webhook test; ledger rebuild test |
| 6 | Offline cache | Offline screenshot with "Last updated"; cache-wipe test |
| 7 | Push | Push received on a development build; tap opens the exact screen |
| 8 | Pool, caching, sharding, load test | Pool size justification; two-database routing; k6 report before and after caching |

## 4. Users and roles

### Owner

Creates and owns the workspace, invites and removes members, assigns roles, manages subscription and seats, and can perform manager scheduling actions.

**Owner rules:**

- The owner cannot change their own role, deactivate their own membership, or set another member's role to Owner.
- Ownership transfer is out of MVP.
- Any attempt returns `409 OWNER_IMMUTABLE`.
- A test covers all three cases. The partial unique index on active owners stays as a backstop, never as the user-facing check.

### Manager

Creates and edits shifts, publishes schedules, cancels shifts, views the team roster, and approves or rejects shift swaps. Managers cannot invite members, change the plan or billing owner, or change roles.

### Staff

Views published shifts for their team (without notes), checks schedule details, requests or withdraws eligible swap requests, accepts or declines swaps addressed to them, manages personal notification preferences, and sees relevant activity. Staff cannot create or delete shifts, change another user's role, manage billing, or approve swaps. Staff never see drafts.

**Permission principle:** UI hiding is convenience only. Every protected operation must be authorized by the backend using the authenticated user, active team membership, role, and resource scope.

## 5. Product principles

- **Clarity over density:** Make the next shift, time, location, and status easy to scan.
- **Trust through traceability:** Schedule changes and swap decisions appear in the activity feed.
- **Fast but honest:** Optimistic UI is allowed only with rollback and visible failure handling.
- **Offline-aware:** Cached schedules are useful but must be visibly marked as potentially stale.
- **Least privilege:** Users only see and change data required for their role and team.
- **Predictable billing:** Show plan, purchased seats, additional-seat cost, effective date, and proration before confirmation.
- **Accessible by default (gated, P0):** Support screen readers, dynamic text, contrast, touch targets, and reduced motion. Four checks are built into components from day one and gated in Section 11: accessibility labels, 44 by 44 point touch targets, 4.5 to 1 text contrast, and layouts that survive the largest system font size.

## 6. Scope and functional requirements

### 6.1 Authentication and onboarding

- Email/password sign-up and login.
- The second sign-in method is **email magic link**. Google sign-in is removed from MVP.
- Password reset uses a single-use, expiring token.
- **Access tokens last 15 minutes** and carry a `sid` claim (the session identifier). Logout and logout-all write the revoked `sid` values to a Redis revoked set for 15 minutes. If Redis is flushed, the worst case is that a stolen access token lives out its remaining 15 minutes. This is documented in `SECURITY.md`.
- Refresh tokens rotate on use; a previously used refresh token is rejected and revokes the token family.
- The client refreshes through **one shared in-flight promise**, so two parallel 401s never trigger two refreshes and honest users are not logged out by the replay rule.
- Store mobile auth tokens in Expo SecureStore, never AsyncStorage.
- Provide logout for the current device and logout of all devices. Both deactivate the device's push token.
- Invite by email and shareable link. **Only the owner invites.** Invitation links are `https` links (custom schemes such as `rota://` are often blocked by mail apps). They open the app through Android App Links and route the user to the correct team and acceptance screen.
- An **"Enter invite code"** screen is the fallback when the link does not open the app. A development build has no deferred deep links, so on a fresh install the user installs the app, then re-taps the link or enters the code.
- Invitation tokens are random, expiring, single-use, and **always stored hashed** server-side.
- Accepting an email-bound invite requires a **verified email**. Magic-link sign-in counts as verified. Password sign-ups verify with a one-time code.
- Handle expired, revoked, already-used, and wrong-account invitations with clear recovery paths.

**Setup decisions this section requires** (made in Phase 0, built in Phase 1):

1. A transactional email provider (invites, password reset, magic links, verification codes), chosen in Phase 0.
2. A static site on an `https` domain hosting `/.well-known/assetlinks.json` (with the development build's signing fingerprint) plus the invite fallback page ("install the app").
3. FCM v1 credentials configured in EAS before the first development build (Android push needs them).

### 6.2 Workspace and membership

- An owner creates a team with a name and time zone. (No industry field.)
- Owners invite users by email or link and assign Manager or Staff role.
- An owner can change a member's role (Manager or Staff only) or deactivate another member's membership. See the owner rules in Section 4.
- **Seats are purchased capacity.** `purchased_seats` is stored on the subscription. Active memberships, counting the owner and managers, never exceed it. Pending invites do not reserve seats.
- Activating a membership runs in one transaction that locks the subscription row with `SELECT ... FOR UPDATE`, counts active memberships, and returns `409 SEAT_LIMIT` if the count equals `purchased_seats`. The join fails with a clear message when the team is full.
- **Assumption:** the brief's "per staff member" is read as every active member, including owner and managers.
- Team data is isolated; a user cannot infer another team's data by changing IDs in requests.
- Required test: two invites accepted at the same moment on the last seat give exactly one success.

### 6.3 Shifts and calendar

- Managers and owners can create, edit, publish, and cancel shifts.
- A shift includes team, title/role, start and end time, optional location/notes, assigned member(s), status, creator, and audit timestamps.
- Store timestamps in UTC. **Shifts always display in the team's time zone.** Quiet hours use the user's time zone.
- Overnight shifts are allowed: end after start, at most 24 hours, enforced by a `CHECK`. Breaks and multi-location stay out of MVP. Daylight saving is handled by UTC storage plus a zone-aware date library.
- **Overlap: always block.** No override. No setting. The check covers Draft and Published assignments with status `assigned`. It takes `pg_advisory_xact_lock(hashtextextended(membership_id::text, 0))` inside the transaction before checking, so two managers cannot assign the same person to overlapping shifts at the same moment.
- **Visibility:** staff see published shifts for their team, without notes. Staff never see drafts. Managers and owners see everything.
- **Calendar cache:** Redis holds only the published, note-free calendar. Key: `team:{id}:cal:pub:{start}:{end}:v{n}`. Drafts and notes are never cached. Managers read drafts from the database.
- The team cache version is bumped **in the request right after commit**, so a manager who just published never refetches a stale copy. The outbox event repeats the bump as a safety net.
- Calendar supports week view as the primary view and a list agenda as an accessible alternative.
- Shift states: Draft, Published, Cancelled.
- **Notification decision:** changes to time, assignee, or location of a published shift send a push. Notes-only edits create an activity event with no push.

### 6.4 Shift swaps

- **MVP swap is a direct handoff.** The requester nominates one colleague. Open offers and two-way trades are out of MVP.
- **Flow:** the requester creates the request → the colleague accepts or declines → the manager approves only after acceptance.
- **Eligible shift:** published, in the future, and the requester is currently assigned.
- The system validates eligibility, team membership, conflicting shifts for the target (using the same per-member advisory lock as Section 6.3), shift status, and subscription/team state.
- **Swap states:** Pending, Approved, Rejected, Declined, Withdrawn, Expired. Pending with the colleague not yet accepted means "waiting for colleague". Pending with `target_accepted_at` set means "waiting for manager".
- Endpoints for the colleague: `POST /swaps/:id/accept` and `POST /swaps/:id/decline`, target only.
- **One pending swap per shift and requester**, enforced by a partial unique index, so two taps from two devices cannot both insert.
- **Expiry:** a pending swap expires when the shift starts or 7 days after creation, whichever is first. Cancelling a shift sets its pending swaps to Expired with reason `shift_cancelled`, in the same transaction.
- **Approver rule:** the approver cannot be the requester or the target. If the owner is the requester and no manager exists, the owner may approve, and the activity event is tagged `self_approved`.
- Approval and assignment changes occur atomically in one database transaction, with row locks, a re-check of eligibility and conflicts, and the activity event written in the same transaction.
- The requester, target, and managers receive in-app activity and push events, respecting quiet hours.
- Rejection, decline, and withdrawal preserve the audit trail.

### 6.5 Activity feed

- Feed entries cover schedule creation/changes/cancellations, swap requests and decisions, invitations, membership changes, and billing events.
- **Visibility is stored per event.** Each event has a `visibility` of `team`, `managers`, `owner`, or `participants`, plus `participant_membership_ids`. Billing events use `owner`. Swap events use `participants`, which means the listed people plus owner and managers. The cursor query filters by the viewer's role and membership.
- Server-side cursor pagination uses a stable pair: `(created_at, id)`.
- The cursor is base64url of `{createdAt: <created_at::text>, id}`. It never passes through a JavaScript `Date`, which would truncate microseconds to milliseconds.
- **Guarantee, stated honestly:** no duplicates, ever. Rows committed after the first page loaded appear on the next pull to refresh. A row committed late with an older timestamp appears only after a refresh.
- Add a database index matching the feed query; capture `EXPLAIN ANALYZE` before and after, for **a staff view and an owner view**.
- Seed at least 10,000 activity events.
- Mobile feed uses FlashList by default; use FlatList only with a documented reason.
- Support infinite scroll and pull-to-refresh; prevent duplicate in-flight page requests.
- Explicit states: initial loading, refreshing, empty, end reached, and retryable error.
- Activity text is rendered on the client from `event_type` plus structured `params`, in the viewer's language and the team's time zone.

### 6.6 Notifications and settings

- Push notifications cover published/changed/cancelled shifts, swap events, invitations, and billing events for owners.
- Notification delivery is performed by a background job, never inside the request that changes a shift.
- **Every push carries `{type, teamId, entityId}`.** The app maps it to a screen (shift, swap, billing, activity) and handles cold start and foreground. **Tapping a push opens the exact screen.**
- Push payloads never carry shift notes.
- Notification categories (shift changes, swaps, billing, activity) can each be turned on or off. Security notifications cannot be turned off.
- **Urgent means security events only:** new sign-in, logout-all, password change. Every other category obeys quiet hours.
- **Product call (change it if you disagree):** time-critical shift changes made during quiet hours show in the app at once and are pushed when quiet hours end. The user chose quiet hours, and the server obeys them.
- **Pipeline rules:**
  - `notification_jobs` is the source of truth. BullMQ only executes.
  - Unique key `(outbox_event_id, user_id, category)` prevents duplicate sends if the outbox relay publishes twice.
  - A repeatable job every minute re-enqueues due rows in `pending` or `failed`, so a Redis flush cannot delete a 6am send.
  - Before sending, the worker re-checks that the entity still matches the event (a delayed "shift published" is dropped if the shift was cancelled at 3am).
  - Delayed items for one user collapse into one digest push.
- **Settings:**
  - Stored server-side: quiet hours, time zone, notification categories, language, theme.
  - The `PATCH` sends only changed fields. The server stamps each accepted field in `field_updated_at`. The most recent accepted change per field wins.
  - Settings edits are **blocked offline**.
  - Documented weakness: a stale device can still overwrite the same field after it comes back online.
  - Time zone is set from the device zone on first launch; IANA names are validated. There is no `UTC` default.
  - Settings synchronize between devices: refetch when the app opens or returns to foreground.
  - Settings updates use optimistic UI and rollback on server error.
- **Push tokens:** one user can have several devices. `POST /me/push-tokens` upserts by token and reassigns `user_id`, so Bob logging in on Alice's old phone never leaves Alice's row active. Logout and logout-all send the device token to deactivate. Invalid tokens reported by the push service are deleted.

### 6.7 Offline schedule access

- The cache holds published shifts assigned to the user in the next 30 days. It stores time, title, location, and status, not notes.
- It is erased on logout, on session revocation, on refresh failure, and when the signed-in user changes.
- A cache older than 14 days since the last successful sync is hidden. The screen says "Reconnect to refresh".
- Writes are disabled offline.
- Show a visible "Last updated" timestamp and an offline indicator.
- When connectivity returns, refetch from the server.

### 6.8 Subscription and seats

Use the exact monthly prices below; store amounts in integer cents.

| Plan | Monthly base price | Included seats | Extra-seat price | Seat ceiling |
|---|---:|---:|---:|---:|
| Starter | $20 (2000 cents) | Up to 5 | Not available | 5 |
| Team | $50 (5000 cents) | Up to 15 | $3/month (300 cents) | 38 |
| Business | $120 (12000 cents) | Up to 40 | $2/month (200 cents) | 100 |

- **Seat ceilings:** Starter 5. Team 15 to 38. Business 40 to 100. The 100 is an operational ceiling, not a plan entitlement. Team is capped at 38 because at 39 seats Team costs 12,200 cents against Business at 12,000; above 38 the owner moves to Business.
- `recurring_amount(plan, seats) = base + max(0, seats - included) × extra`.
- Owner can view current plan, included seats, purchased seats, active members, renewal date, and billing state.
- Owner can upgrade/downgrade and add/remove seats mid-cycle.
- **Classify changes by cost, not plan name.** If `new_amount > current_amount`, the change is immediate and applies after payment is confirmed. Otherwise it is scheduled for period end.
- Backend calculates proration. Provider checkout is test-mode only.
- The mobile client never declares payment success; only verified backend webhook processing confirms payment state.
- Every charge, credit, or refund creates an immutable ledger row. Corrections create new rows.
- Verify webhook signatures, process webhooks in a background job, store provider event IDs, ignore duplicates, and use idempotency keys for payment requests.
- Display billing currency and tax treatment accurately; prices are the task's USD base amounts.

**Proration formula (the server owns it):**

```
remaining_seconds = period_end - effective_at
period_seconds    = period_end - period_start

unused_credit_cents = floor(current_recurring_cents × remaining_seconds / period_seconds)
new_period_cost_cents = floor(new_recurring_cents × remaining_seconds / period_seconds)
immediate_charge_cents = new_period_cost_cents - unused_credit_cents
```

- Credit and cost both use `floor`. Net rounding error is at most 1 cent. This is documented.
- `max(0, ...)` is replaced by an **assertion**: the server throws `PRORATION_NEGATIVE` if the charge is below zero. Because changes are classified by cost, a negative charge on an immediate change is a bug, not a case to hide.
- Tests inject the clock.
- Persist period boundaries and calculation inputs so charges can be audited.
- **Quotes:** `billing_quotes` stores the inputs and amount. The server computes the quote once; checkout charges the quoted amount. A quote is valid until the earlier of 30 minutes or period end. The owner is charged what they saw.
- **Multiple changes in one period:** the credit uses the recurring amount currently in effect, not the original plan. Each applied change updates `current_recurring_cents`, so change two credits what change one already charged.

**Pinned test vectors:**

| Case | Credit | Cost | Charge |
|---|---:|---:|---:|
| Starter to Team at 20 of 30 days | 1333 | 3333 | 2000 |
| Team 15 to 18 seats at 12 of 30 days | 2000 | 2360 | 360 |

**Billing scheduler:** one repeatable job, every hour. It:

- applies scheduled changes at period end and starts renewal charges;
- moves `past_due` to `grace`, and `grace` to `restricted` when `grace_until` passes;
- ends trials.

Subscriptions store `scheduled_plan`, `scheduled_purchased_seats`, and `scheduled_effective_at`.

**Ledger:** amounts are signed (charges positive; credits and refunds negative). Each row records `plan_after` and `purchased_seats_after`. A downgrade writes a zero-amount adjustment row, so subscription state can be rebuilt from the ledger.

**Failed renewal:** the grace period is **7 days** (decided). The owner is notified. After grace the team is `restricted`: new invitations and schedule mutations are blocked, with read-only access to existing schedules and billing recovery. Team restriction is derived from `subscriptions.status`; `teams.status` has no billing values.

**Provider check before Phase 7:** confirm the chosen provider's test mode supports USD, saved-card recurring charges, signed webhooks, and a Node SDK. If USD fails, charge in the provider's test currency, keep USD cents in the ledger, and add a display note.

### 6.9 User settings and profile

- Users can edit display name.
- Account deletion and export policies require product/legal review before production launch (deferred).
- Language is stored and synced. The language row appears in the UI only when a second language ships.

## 7. Information architecture

Five primary tabs:

1. **Schedule** — upcoming shifts, calendar/agenda, shift details.
2. **Activity** — paginated team-relevant events.
3. **Requests** — swap requests and approvals, role-specific.
4. **Team** — roster, invitations, roles; Owner-only **Billing** screen lives here.
5. **Settings** — profile, notifications, quiet hours, time zone, theme, help, sign out.

Billing is an Owner-only screen inside the Team tab. The backend remains the authority for permissions.

## 8. Core user journeys

### Owner creates a workspace

Sign up → verify email (Section 6.1) → create team and time zone → **start trial** → invite members → members accept the link (or enter the code) → owner sees roster and schedule empty state → **choose a plan later**.

**Trial:** a new team starts `trialing` on Starter limits for 14 days, no card. The first confirmed checkout sets `active`. A trial that ends unpaid becomes `restricted` (read-only). If time is short, the cheapest alternative is `trialing` with no end date in MVP.

### Manager publishes a schedule

Open Schedule → choose week → create shift → select staff and time → validate overlap (blocked, no override) → save draft or publish → server writes activity event → notification jobs enqueue → staff receive updates subject to preferences and quiet hours.

### Staff requests a swap

Open assigned shift → Request swap → choose one colleague → confirm → optimistic "Pending" → colleague accepts or declines → manager approves/rejects after acceptance → server updates assignments atomically → all affected users see final status and activity.

### Owner upgrades a plan

Billing → choose plan/seat count → server creates a quote showing effective date and proration breakdown → confirm → backend creates idempotent test-mode checkout for the quoted amount → provider webhook is verified and queued → billing worker updates subscription and ledger → UI refreshes from server.

### Staff checks schedule offline

Open Schedule while online → shifts cache → lose connection → open Schedule → show cached shifts and last-updated time (hidden after 14 days without sync) → reconnect → refresh and clear offline state.

## 9. Non-functional requirements

- **Security:** backend authorization on every protected route; team scoping; validated inputs; rate limits; secure token lifecycle; no secrets in mobile bundle.
- **Reliability:** idempotent payment/webhook processing; atomic swap approval; retryable notification jobs; visible stale/offline states.
- **Performance — pass criteria, written before the run:** at 200 virtual users, 30 s ramp, 3 min steady state: p95 at or under 500 ms and error rate under 1% on cached first-page feed reads. Record a baseline run first. If the free tier misses it, report that honestly with environment details.
- **Load test setup:** 200 pre-created users across 4 teams. The main team holds 10,000 events. Tokens are created before the run. The feed rate limit sits above test throughput. Scripts live in `load-tests/`.
- **Feed caching:** cache the newest 50 raw events per team for 30 seconds. Bump the version on each insert. Filter per viewer in code. If filtering leaves fewer rows than the page size, read the database.
- **Pagination:** no duplicates under concurrent inserts, using `(created_at, id)` cursor semantics (guarantee in Section 6.5).
- **Accessibility:** meaningful labels, scalable text, sufficient contrast, TalkBack support, large enough touch targets (gated in Section 11).
- **Observability:** structured logs with correlation IDs, error monitoring, queue/job metrics, and payment webhook auditability without logging secrets or tokens.
- **Maintainability:** typed API contracts, migrations, documented state ownership, automated tests, and clear module boundaries.

**Rate limits** (starting values, sliding window in Redis, `429` with `Retry-After`; keyed per account and per IP, with the IP limit higher so a restaurant's shared Wi-Fi does not lock out a shift):

| Endpoint | Limit |
|---|---|
| Login | 5/min per account, 30/min per IP |
| Password reset | 3/hour per email, 10/hour per IP |
| Invites | 20/hour per team |
| Checkout | 5/hour per team |
| Feed | 60/min per user |

## 10. Success metrics

### Build-proof metrics (pass or fail)

| Metric | Threshold |
|---|---|
| Duplicate swaps | 0 |
| Double assignments | 0 |
| Duplicate webhook effects | 0 |
| API 5xx rate | under 1% |
| Notification failure rate, excluding invalid tokens | under 2% |

### Product metrics (starting hypotheses, to replace after 4 weeks of data)

| Metric | Definition | Hypothesis |
|---|---|---|
| Activation | Owners with at least 1 accepted invite within 7 days of sign-up | 50% |
| Schedule adoption | Active teams with at least 1 published shift this week | 60% |
| Staff utility | Staff with at least 1 schedule view this week | 70% |
| Swap speed | Median hours from request to decision | under 12 |

These are hypotheses, not facts. With three test teams they prove nothing; they exist so the instrumentation is built.

**Instrumentation:** a small `product_events` table (no third-party tool) records: `team_created`, `invite_sent`, `invite_accepted`, `shift_published`, `swap_requested`, `swap_decided`, `plan_changed`.

## 11. MVP release criteria

### Product criteria ("the product works")

- All three roles work and are enforced on the backend.
- Authentication, invitation links (including the invite-code fallback), magic link, password reset, logout-all-devices, and refresh-token rotation pass tests.
- Owner-immutable rules return `409 OWNER_IMMUTABLE` and are tested.
- Seat limits hold under concurrency: two simultaneous accepts on the last seat give exactly one success.
- Shift creation/publication and swap approval pass happy-path and concurrency tests, including overlap blocking and one-pending-swap-per-shift.
- Team-isolation tests prove users cannot read or mutate another team's resources. Staff cannot see drafts, notes, or billing events.
- Activity feed supports 10,000 seeded records, cursor pagination, loading/error/empty/end states, and duplicate-request prevention.
- Offline upcoming shifts show last-updated time and are erased on logout.
- Settings synchronize and quiet hours are enforced by the notification worker.
- **Tapping a push opens the exact screen.**
- Subscription plans use exact cents-based prices, seat limits and ceilings, verified idempotent webhooks, immutable ledger, and at least eight proration tests including the pinned vectors.
- **A failed renewal moves the team to grace for 7 days with owner notification, then to restricted (read-only).**
- **Accessibility gate (P0):** every interactive element has an accessibility label and a touch target of at least 44 by 44 points. Text contrast is at least 4.5 to 1. Layouts survive the largest system font size.

### Graduation deliverables ("the evidence")

- Architecture, state, security, sharding, learning log, and setup documentation in the repository (`README.md`, `ARCHITECTURE.md`, `STATE.md`, `SECURITY.md`, `SHARDING.md`, `LEARNING-LOG.md`).
- README section explaining how app-store billing rules would affect Rota in production.
- `load-tests/` folder with k6 scripts and a written report.
- `docs/decisions/` with one decision record per major choice.
- Android development build link, deployed backend link, architecture diagram.
- Test results for permissions, team isolation, and proration.
- 3-minute demo video.
- A LinkedIn post about one technical decision.

## 12. Decide before build

Every item below blocks the build. None may slide into Phase 3. Phase 0 exits only when this register is published and no policy block remains.

### Decision register

| Decision | Ruling |
|---|---|
| Swap model | Direct handoff with colleague consent |
| Staff visibility | Published shifts, no notes, no drafts |
| Who invites | Owner only |
| Overnight and DST | Allowed, UTC storage, team zone display |
| Second sign-in | Magic link |
| Backend | Fastify + Zod |
| Data layer | Kysely or Drizzle, SQL migrations (pick one in Phase 0; record as a decision record) |
| Offline store | AsyncStorage persister, one query, minimal fields |
| Payment provider | Chosen with the 4-point check in Section 6.8 |
| Seat model | Purchased capacity; owner and managers count |
| Trial | 14 days, Starter limits, no card |
| Grace period | 7 days |
| Overlap policy | Always block, no override |
| Email provider | Chosen in Phase 0 |

### Other working decisions

- Product name: Rota.
- Mobile: React Native + Expo + TypeScript.
- Data: PostgreSQL; Redis for caching, rate limiting, and jobs (queue and cache on separate instances; see TRD).
- State: TanStack Query for server state; Zustand for lightweight client state.
- Feed: cursor pagination by `(created_at, id)` with a string cursor.

### Deferred (not blocking MVP)

- Legal retention, privacy, data export, account deletion, and healthcare/regulated-industry requirements.
- Ownership transfer, multi-location support, and web-based admin.
- Production currencies and tax.
