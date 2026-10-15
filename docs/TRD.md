# Rota — Technical Requirements Document (TRD)

**Document status:** Draft v1.1 (revised after adversarial review; every ruling applied)

**Audience:** Mobile/backend engineers, QA, DevOps, security reviewers, AI coding agents

## 1. Technical objectives

Build a maintainable mobile-first scheduling application with secure multi-tenant authorization, reliable shift/swap transactions, a scalable activity feed, server-enforced preferences, offline upcoming shifts, and auditable subscription billing. The implementation must demonstrate the requirements of the supplied Mobile Task A brief, not merely approximate the user-facing UI.

This document is written for AI coding agents. **Open choices make agents pick differently in different tasks, so every stack choice below is decided.**

## 2. Stack (decided)

### Mobile

- React Native + Expo + TypeScript. Verified platform: Android development build. iOS: same codebase, not verified in MVP.
- Expo Router for navigation and deep links (Android App Links over `https`).
- TanStack Query for all remote/server state.
- **Offline store: TanStack Query persister over AsyncStorage**, persisting one query (the user's upcoming shifts) with minimal fields. Shift times are not credentials. Tokens stay in SecureStore.
- Zustand for app-only UI state (selected tab, transient filters, draft UI state).
- Expo SecureStore for auth tokens. Never AsyncStorage.
- Expo Notifications for push registration and receipt handling.
- FlashList for the activity feed; FlatList only with a written rationale.
- Zod shared schemas where practical; validate again on the server regardless.

### Backend

- Node.js + TypeScript with **Fastify** and **Zod** request validation.
- PostgreSQL as system of record, accessed through a **SQL-first layer: Kysely or Drizzle**, with SQL migrations. Pick one in Phase 0 and record it in `docs/decisions/`. Prisma is excluded: this design needs raw SQL for row-value cursors, `FOR UPDATE`, partial indexes, advisory locks, and exclusion-style constraints.
- Redis for rate limiting, caching, the revoked-session set, and the job queue. **Queue and cache run on separate Redis instances.** If only one free instance exists: set `maxmemory-policy noeviction`, put a TTL on every cache key, and keep the cache small. BullMQ requires Redis never to evict keys; a cache wants eviction. BullMQ also polls constantly, so check the host's command quota before choosing a free tier.
- BullMQ for notifications, webhook processing, and retryable side effects. It only executes; the database is the source of truth for notification jobs.
- **Transactional email provider** (invites, password reset, magic links, verification codes), chosen in Phase 0.
- **Static site** on an `https` domain on a free host. It serves `/.well-known/assetlinks.json` (with the development build's signing fingerprint) and the invite fallback page ("install the app"). It is not a web console.
- **FCM v1 credentials** configured in EAS before the first development build.
- Structured logging and request correlation IDs.
- Payment provider in test mode, behind an adapter. Selected in Phase 0 using the provider check in Section 11.

### Engineering tools

- pnpm or npm workspaces; lock dependencies.
- ESLint + Prettier + TypeScript strict mode.
- Unit/integration tests (Vitest/Jest plus API test tooling); PostgreSQL integration test environment.
- k6 for load testing.
- CI for lint, typecheck, tests, migration validation, and build.
- EAS Build for the development build. **The first EAS development build, the deployed API, and the static link site happen in Phase 1**, because deep links (Phase 2) and push (Phase 6) cannot be tested without them, and native changes force rebuilds.

## 3. High-level architecture

```
Expo Mobile App
  ├─ Expo Router / UI / Design System
  ├─ TanStack Query ────────────────┐
  ├─ Zustand (client-only state)    │ HTTPS + access token (15 min, sid claim)
  ├─ SecureStore (tokens)           ▼
  └─ Persisted upcoming-shift    API / Backend-for-Frontend (Fastify)
     query (AsyncStorage)          ├─ Auth + session service
                                   ├─ Team / membership service
Static https site                  ├─ Shift / swap service
  (assetlinks.json, invite page)   ├─ Activity service
                                   ├─ Settings / notification service
                                   ├─ Subscription / billing service
                                   ├─ Control-plane DB (users, sessions, routing)
                                   ├─ Shard 0 + Shard 1 (team-owned data)
                                   ├─ Redis (cache, rate limits, revoked sids)
                                   └─ Redis (queue, no-eviction)
                                      ├─ Push notification worker
                                      ├─ Payment webhook worker
                                      ├─ Outbox relay
                                      ├─ Repeatable: notification re-enqueue (1 min)
                                      ├─ Repeatable: billing scheduler (1 hour)
                                      ├─ Repeatable: swap expiry
                                      └─ Retry / dead-letter handling
```

The mobile client must never connect directly to PostgreSQL, Redis, or the payment provider's secret-key API.

## 4. Repository and module layout

```
rota/
  apps/
    mobile/
      app/
      src/
        components/  features/  navigation/  api/
        hooks/  state/  storage/  theme/  utils/
  services/
    api/
      src/
        modules/
          auth/  teams/  memberships/  invitations/  shifts/  swaps/
          activity/  settings/  notifications/  subscriptions/  webhooks/
        jobs/  db/  middleware/  config/
      migrations/
      tests/
  sites/
    links/                 # static https site: assetlinks.json + invite fallback page
  packages/
    contracts/  config/
  load-tests/              # k6 scripts + written report
  docs/
    PRD.md  TRD.md  BACKEND-SCHEMA.md  DESIGN-SYSTEM.md  APP-FLOW.md
    IMPLEMENTATION-PLAN.md  ARCHITECTURE.md  STATE.md  SECURITY.md
    SHARDING.md  LEARNING-LOG.md
    decisions/             # one decision record per major choice
```

A split repository is acceptable if mobile and backend repositories link to each other and share versioned API contracts.

## 5. API design

- Base path: `/v1`. JSON bodies; ISO 8601 timestamps. UUID identifiers.
- Do not trust client-supplied `teamId` without checking membership.
- Standard error envelope: `{ "error": { "code": "FORBIDDEN", "message": "...", "requestId": "..." } }`.
- Validate all request bodies, query parameters, path parameters, and webhook payloads with server-side schemas.
- Use explicit DTOs; do not serialize database entities wholesale.
- Mutating requests that may be retried support idempotency keys (`Idempotency-Key` header), stored in `idempotency_keys`.
- `409 Conflict` for stale writes, duplicate operations, and concurrency conflicts. Specific codes: `OWNER_IMMUTABLE`, `SEAT_LIMIT`, `SHIFT_OVERLAP`, `SWAP_DUPLICATE`, `PRORATION_NEGATIVE` (this last one is a server error that must never reach a user; it is an assertion).
- `401` unauthenticated/invalid session, `403` unauthorized, `404` to avoid resource disclosure, `422` validation, `429` rate limit with `Retry-After`.
- Pagination shape: `{ items, nextCursor, hasMore }`.

### Endpoint inventory

| Method + path | Purpose | Roles |
|---|---|---|
| `POST /v1/auth/signup` | Create account; sends verification code | Public |
| `POST /v1/auth/verify-email` | Confirm one-time code | Public, rate-limited |
| `POST /v1/auth/login` | Authenticate | Public |
| `POST /v1/auth/magic-link/request` | Send magic link | Public, rate-limited |
| `POST /v1/auth/magic-link/confirm` | Consume single-use link token | Public, rate-limited |
| `POST /v1/auth/refresh` | Rotate refresh token | Refresh token |
| `POST /v1/auth/logout` | Revoke current session; deactivate device token | Authenticated |
| `POST /v1/auth/logout-all` | Revoke all sessions; deactivate device tokens | Authenticated |
| `POST /v1/auth/password-reset/request` | Start reset flow | Public, rate-limited |
| `POST /v1/auth/password-reset/confirm` | Use single-use reset token | Public, rate-limited |
| `POST /v1/teams` | Create team (starts trial) | Authenticated |
| `GET /v1/teams/:teamId` | Team details | Active member |
| `GET /v1/teams/:teamId/members` | Roster (staff: name and role only) | Active member; detail fields Owner/Manager |
| `POST /v1/teams/:teamId/invitations` | Invite member | Owner only |
| `POST /v1/invitations/accept` | Accept invitation by link token or entered code | Authenticated, verified email |
| `PATCH /v1/teams/:teamId/members/:memberId` | Change role (Manager/Staff) or deactivate | Owner; `409 OWNER_IMMUTABLE` on self or Owner target |
| `GET /v1/teams/:teamId/shifts` | Calendar (staff: published, no notes) | Active member |
| `POST /v1/teams/:teamId/shifts` | Create shift | Owner/Manager |
| `PATCH /v1/teams/:teamId/shifts/:shiftId` | Edit shift | Owner/Manager |
| `POST /v1/teams/:teamId/shifts/:shiftId/publish` | Publish shift | Owner/Manager |
| `POST /v1/teams/:teamId/shifts/:shiftId/cancel` | Cancel shift; expires pending swaps | Owner/Manager |
| `POST /v1/teams/:teamId/swaps` | Request swap (nominate one colleague) | Eligible assigned member |
| `GET /v1/teams/:teamId/swaps` | List requests | Active member, filtered by role |
| `POST /v1/teams/:teamId/swaps/:swapId/accept` | Colleague accepts | Target only |
| `POST /v1/teams/:teamId/swaps/:swapId/decline` | Colleague declines | Target only |
| `POST /v1/teams/:teamId/swaps/:swapId/approve` | Approve (only after acceptance) | Owner/Manager; not requester or target (owner exception) |
| `POST /v1/teams/:teamId/swaps/:swapId/reject` | Reject swap | Owner/Manager |
| `POST /v1/teams/:teamId/swaps/:swapId/withdraw` | Withdraw own request | Requester |
| `GET /v1/teams/:teamId/activity` | Cursor-paginated, visibility-filtered feed | Active member |
| `GET /v1/me/settings` | Read settings | Self |
| `PATCH /v1/me/settings` | Update changed fields only | Self |
| `POST /v1/me/push-tokens` | Upsert by token, reassign `user_id` | Self |
| `DELETE /v1/me/push-tokens` | Deactivate device token | Self |
| `GET /v1/teams/:teamId/subscription` | View plan, purchased seats, state | Owner |
| `POST /v1/teams/:teamId/billing/quote` | Create a billing quote | Owner |
| `POST /v1/teams/:teamId/billing/checkout` | Start test-mode checkout for a quote | Owner |
| `POST /v1/webhooks/payments/:provider` | Receive provider webhook | Provider signature |
| `GET /v1/teams/:teamId/billing/ledger` | Read ledger | Owner |

The endpoint list is a starting contract; settle response shapes in an OpenAPI specification before parallel implementation.

## 6. Authentication and session handling

- Passwords hashed with Argon2id (otherwise well-configured bcrypt).
- **Access tokens last 15 minutes** and carry a `sid` claim. `sid` equals the session's `token_family_id`, which stays stable across refresh rotations.
- Logout and logout-all write the revoked `sid` values to a Redis revoked set (`auth:revoked:{sid}`) with a 15-minute TTL. Every authenticated request checks the set. If Redis is flushed, the worst case is that a stolen access token lives out its 15 minutes. Document this in `SECURITY.md`.
- Refresh tokens are opaque, random, server-tracked, and rotated on each use. A hash of each is stored. A previously consumed token is rejected and the family is revoked as a theft signal.
- **The client refreshes through one shared in-flight promise.** Parallel 401s wait on the same refresh, so honest users do not trip the replay rule.
- Tokens live in Expo SecureStore. Never log tokens.
- Password-reset tokens, magic-link tokens, and email verification codes live in `auth_tokens`: single-use, expiring, random, always stored hashed. Responses never reveal whether an email exists.
- **Invitation tokens are built as `{teamId}.{random}` and always stored hashed.** The embedded `teamId` lets the server find the shard before lookup.
- Accepting an email-bound invite requires a verified email. Magic-link sign-in counts as verified; password sign-ups verify with a one-time code.
- Deep links are `https` App Links verified through `assetlinks.json`. The server validates the invitation token and intended team; never grant access merely because a team ID appears in a URL.
- A fresh install loses the link, so the app has an "Enter invite code" screen.

## 7. Authorization and tenant isolation

Every protected request must:

1. Authenticate the caller (token valid, `sid` not revoked).
2. Load active membership for the requested team from the team's shard.
3. Verify the role can perform the action.
4. Scope resource reads and writes to that team.
5. Check resource-level eligibility (e.g. only the target may accept a swap).
6. Record an activity/audit event for material changes.

Use a shared authorization service plus explicit checks in domain operations. Database constraints reinforce invariants, including composite same-team foreign keys. Optional PostgreSQL row-level security must not replace application tests.

**Owner immutability:** the owner cannot change their own role, deactivate themselves, or set another member to Owner; the API returns `409 OWNER_IMMUTABLE`.

**Required tests:**

- Staff calls delete/cancel shift endpoint directly and is rejected.
- Member from Team A requests a Team B resource and receives a safe denial.
- Owner cannot exceed purchased seats; two simultaneous accepts on the last seat give exactly one success.
- Concurrent swap approvals cannot double-assign a shift.
- Concurrent assignment of one member to overlapping shifts: exactly one succeeds.
- Owner-immutable cases (self-demote, self-deactivate, promote another to Owner) each return `OWNER_IMMUTABLE`.
- Staff cannot read drafts, notes, owner-visibility events, or participant-visibility events they are not part of.
- A user cannot change another user's settings or push token.

## 8. Database and query requirements

- PostgreSQL is the source of truth. Migrations are committed.
- **Control plane and shards:** a small control-plane database holds `users`, `auth_sessions`, `auth_tokens`, `user_settings`, `push_devices`, `team_directory(team_id, shard_id)`, `user_team_index(user_id, team_id, role, status)`, `idempotency_keys`, `billing_quotes`, and a global `payment_webhook_events`. Team-owned tables live on shards. **No foreign keys cross the control-plane/shard line**; those columns are plain `uuid` validated in code. See `BACKEND-SCHEMA.md` and `SHARDING.md`.
- **Routing:** login reads `user_team_index` for memberships; invitation tokens embed `teamId`; checkout sends `team_id` in provider metadata so webhooks route to a shard. `UNIQUE (provider, provider_event_id)` lives in the control plane so duplicates are deduped globally.
- Add indexes based on real query patterns; capture `EXPLAIN ANALYZE` before and after the feed index, **for a staff view and an owner view**.
- **Cursor query** (descending): `WHERE (created_at, id) < (:cursor_created_at, :cursor_id) ... ORDER BY created_at DESC, id DESC LIMIT :limit`, plus the visibility predicate (see `BACKEND-SCHEMA.md`).
- **Cursor serialization:** select `created_at::text` and send that string back inside the cursor (base64url of `{createdAt, id}`). The Node `pg` driver turns `timestamptz` into a JS `Date`, which keeps only milliseconds, so rows sharing a millisecond would be skipped or repeated. The cursor never passes through a `Date`.
- **Honest guarantee:** `created_at DEFAULT now()` is the transaction start time, so a slow transaction can commit a row dated before rows already served. No duplicates, ever; late rows appear after pull to refresh.
- Connection pooling: document pool size assumptions and justify them against the database connection limit. Never let mobile clients connect to the database.
- Read/write routing preserves read-your-own-writes: for 5 seconds after a user's write, that user's reads go to the primary.
- **Sharding simulation:** two separate PostgreSQL databases. Route team data by a stable hash of `team_id`. Write `SHARDING.md`.
- **Redis caches (all with TTLs, none inside the queue instance):**
  - Roster (name and role only, no email), `team:{id}:roster:v{n}`.
  - **Published, note-free calendar only**, `team:{id}:cal:pub:{start}:{end}:v{n}`. Drafts and notes are never cached; managers read drafts from the database.
  - **Feed first page:** newest 50 raw events per team for 30 seconds, `team:{id}:feed:first:v{n}`. Bump the version on each insert. Filter per viewer in code. If filtering leaves fewer rows than the page size, read the database.
- **Cache invalidation:** bump the team cache version **in the request, right after commit**. The outbox event repeats the bump as a safety net. Never rely on the outbox alone: it runs seconds later and would break read-your-own-writes.
- **Never cache:** active subscriptions, payment status, credit balances, webhook idempotency records, drafts, notes.
- **Overlap check:** inside the assignment transaction, first take `pg_advisory_xact_lock(hashtextextended(membership_id::text, 0))`, then check Draft and Published assignments with status `assigned` for overlapping time ranges.
- **Seat check:** activation locks the subscription row with `SELECT ... FOR UPDATE`, counts active memberships, and returns `409 SEAT_LIMIT` at `purchased_seats`.

## 9. State management and offline behavior

- TanStack Query owns remote state: shifts, members, activity pages, swaps, settings, billing state.
- Zustand owns transient client state only.
- The persisted store is **one query**: published shifts assigned to the user in the next 30 days, minimal fields (time, title, location, status; no notes), plus last-refresh metadata.
- **Wipe the persisted cache** on logout, on session revocation, on refresh failure, and when the signed-in user changes. A cache older than 14 days since the last successful sync is hidden ("Reconnect to refresh"). Writes are disabled offline.
- Auth tokens live only in SecureStore.
- Optimistic updates required for swap requests and settings changes: snapshot, apply, rollback on error, then invalidate/refetch. **Settings edits are blocked offline.**
- Settings `PATCH` sends only changed fields.
- Document all important state in `STATE.md`.

Suggested query cache policies (tune by measurement):

| Data | Policy |
|---|---|
| Upcoming shifts | Stale 1–3 min; persist next 30 days (14-day max age since sync) |
| Team roster | Stale 2–5 min; invalidate on membership change |
| Activity feed | Stale 30–60 s; cursor pages kept while mounted |
| Settings | Refetch on foreground and after local update; per-field `field_updated_at` governs conflicts |
| Subscription/billing | Refetch after checkout return and webhook-driven refresh |

Do not present stale billing state as confirmed payment success.

## 10. Activity feed implementation

- Seed at least 10,000 events (repeatable script).
- Sort descending by `(created_at, id)`. Cursor is base64url of `{createdAt: created_at::text, id}`, validated and encoded by the server.
- The query includes the visibility filter:
  - `team` visible to all; `managers` to owner and manager; `owner` to owner; `participants` to owner, manager, and listed members.
- Billing events use `owner`. Swap events use `participants`.
- Index the query and capture `EXPLAIN ANALYZE` before and after, for a staff view and an owner view. If a filter column is added later, re-capture the plan.
- Infinite scroll uses FlashList with an `isFetchingNextPage` guard and server cursor checks.
- Pull-to-refresh resets pages and loads the newest page; this also recovers late-committed rows.
- Handle loading, empty, end-of-list, and retryable errors.
- Tests: insert new events between page requests; rows sharing a millisecond but differing in microseconds; staff versus owner visibility.
- Activity text is rendered on the client from `event_type` plus `params`.

## 11. Subscription, proration, and payments

### Plan constants (integer cents)

| Plan | Base | Included | Extra seat | Seat ceiling |
|---|---:|---:|---:|---:|
| Starter | 2000 | 5 | unavailable | 5 |
| Team | 5000 | 15 | 300 | 38 |
| Business | 12000 | 40 | 200 | 100 |

The Business ceiling of 100 is an operational ceiling, not a plan entitlement. Team is capped at 38 because Team at 39 seats costs 12,200 cents against Business at 12,000.

`recurring_amount(plan, seats) = base + max(0, seats - included) × extra`

### Change classification

Classify by cost, not plan name. If `new_amount > current_amount`, the change is immediate and applies after payment is confirmed. Otherwise it is scheduled for period end (`scheduled_plan`, `scheduled_purchased_seats`, `scheduled_effective_at`).

### Proration

```
remaining_seconds = period_end - effective_at
period_seconds    = period_end - period_start
credit_cents      = floor(current_recurring_cents × remaining_seconds / period_seconds)
cost_cents        = floor(new_recurring_cents    × remaining_seconds / period_seconds)
charge_cents      = cost_cents - credit_cents      # assert >= 0, else throw PRORATION_NEGATIVE
```

- Integer-cent arithmetic only. Credit and cost both use `floor`; net rounding error is at most 1 cent (documented).
- Tests inject the clock.
- **Quotes:** the server computes once, stores the inputs in `billing_quotes`, and checkout charges the quoted amount. A quote is valid until the earlier of 30 minutes or period end.
- **Multiple changes:** the credit uses the recurring amount currently in effect. Each applied change updates `current_recurring_cents`.

**Required unit tests (at least eight):**

1. Starter → Team upgrade mid-cycle (20 of 30 days: credit 1333, cost 3333, charge 2000).
2. Team → Business upgrade mid-cycle.
3. Downgrade scheduled for period end.
4. Add seats mid-cycle (Team 15 → 18 at 12 of 30 days: credit 2000, cost 2360, charge 360).
5. Remove seats scheduled for period end.
6. Change on first day of period.
7. Change on last day of period.
8. Two changes in one period without double-crediting.
9. Zero remaining time boundary.
10. Rounding to integer cents.
11. Cost-based classification: a cost-lowering change is scheduled for period end regardless of plan name, and Team above 38 seats is rejected.
12. `PRORATION_NEGATIVE` assertion fires.

### Webhook, ledger, and trial

- Create checkout/payment requests server-side with idempotency keys.
- Verify every webhook signature before processing.
- Persist provider event ID and payload hash in the control-plane `payment_webhook_events`, then enqueue processing. Duplicate event IDs are no-ops. The shard is found from the `team_id` in checkout metadata.
- Process asynchronously with retries and dead-letter handling.
- **Ledger:** append-only, signed amounts (charges positive; credits and refunds negative). Each row stores `plan_after` and `purchased_seats_after`. A downgrade writes a zero-amount adjustment row, so state can be rebuilt from the ledger.
- **Trial:** new teams start `trialing` on Starter limits for 14 days, no card. First confirmed checkout sets `active`. A trial that ends unpaid becomes `restricted` (read-only).
- **Grace:** failed renewal → `past_due` → `grace` for **7 days** → `restricted`. Restriction is derived from `subscriptions.status`; `teams.status` carries no billing values.
- **Provider check before Phase 7:** confirm test mode supports USD, saved-card recurring charges, signed webhooks, and a Node SDK. If USD fails, charge in the provider's test currency, keep USD cents in the ledger, and add a display note.
- Seat limits are enforced in the same transaction as membership activation (row lock, see Section 8).

## 12. Notifications and background jobs

- A committed domain mutation writes an outbox event in the same transaction.
- The outbox relay publishes events and creates `notification_jobs`. `notification_jobs` is the source of truth; BullMQ only executes.
- **Uniqueness:** `UNIQUE (outbox_event_id, user_id, category)`, so a relay crash-and-republish cannot create duplicates.
- **Quiet hours:** the worker checks the recipient's time zone and quiet hours. Urgent means security events only (new sign-in, logout-all, password change). Everything else is delayed until quiet hours end. Time-critical shift changes made during quiet hours show in the app at once and are pushed when quiet hours end.
- **Re-check before send:** the worker confirms the entity still matches the event (a delayed "shift published" is dropped if the shift was cancelled).
- **Digest:** delayed items for one user collapse into one digest push (shared `collapse_key`).
- **Payload:** `{type, teamId, entityId}` only. No shift notes.
- Retry transient provider errors with bounded exponential backoff; delete invalid tokens; dead-letter repeated failures.
- Never block shift creation or swap approval on push provider availability.

**Repeatable jobs:**

| Job | Cadence | Purpose |
|---|---|---|
| Notification re-enqueue | Every minute | Re-enqueues due `notification_jobs` in `pending` or `failed`, so a Redis flush cannot delete delayed sends |
| Billing scheduler | Every hour | Applies scheduled plan/seat changes at period end; starts renewal charges; moves `past_due` → `grace` → `restricted` when `grace_until` passes; ends trials |
| Swap expiry | Every 5 minutes | Expires pending swaps at shift start or 7 days after creation |
| Outbox relay | Continuous | Publishes unpublished outbox events |

## 13. Caching, pooling, and load test

- Configure the PostgreSQL pool; justify the size against the database connection limit. Record the configuration in `ARCHITECTURE.md`.
- Implement read/write routing with read-your-own-writes.
- Cache rosters, the published note-free calendar, and the feed first page (Section 8).
- **Pass criteria, written before the run:** at 200 virtual users, 30 s ramp, 3 min steady state: p95 at or under 500 ms and error rate under 1% on cached first-page feed reads. Record a baseline run first. If the free tier misses it, report that honestly with environment details.
- **Setup:** 200 pre-created users across 4 teams; the main team holds 10,000 events; tokens are created before the run; the feed rate limit sits above test throughput. Scripts live in `load-tests/`.
- Report p50/p95/p99 latency, throughput, error rate, CPU/memory, DB query counts, and cache hit rate, before and after caching, under the same environment and data volume. The "after" run must exercise the cache; otherwise the report shows no change.
- Investigate any correctness regression before performance tuning.

**Rate limits** (Redis sliding window, `429` with `Retry-After`; per account and per IP, IP higher):

| Endpoint | Limit |
|---|---|
| Login | 5/min per account, 30/min per IP |
| Password reset | 3/hour per email, 10/hour per IP |
| Invites | 20/hour per team |
| Checkout | 5/hour per team |
| Feed | 60/min per user |

## 14. Security baseline

Document at least eight threats in `SECURITY.md`. Minimum coverage:

1. Cross-team data leakage / insecure direct object reference.
2. Privilege escalation or missing role checks (including staff reading drafts or billing events).
3. Stolen access/refresh token and refresh-token replay (15-minute access tokens, `sid` revoked set, rotation).
4. Password reset, magic-link, or invitation token theft/replay.
5. Payment webhook spoofing and duplicate delivery.
6. Secrets exposed in mobile bundle or logs.
7. Brute-force login, invite abuse, password-reset abuse, payment abuse.
8. Push token abuse (shared phones), sensitive notification content, quiet-hour bypass.
9. Additional: SQL injection, dependency compromise, cache poisoning (viewer-specific data in cache), denial of service, accidental PII logging, offline cache left on a shared phone.

Controls: server-side role/team checks; request validation; parameterized queries; Redis rate limits per account and IP; SecureStore; token rotation and revocation; webhook signature verification and idempotency; least-privilege secrets; TLS; audit logs; dependency scanning; safe push payloads; cache wipe on logout.

- List every `EXPO_PUBLIC_` variable and explain why it is safe to expose. No secret keys, database URLs, signing secrets, or payment credentials in public-prefixed variables.
- Keep secrets in deployment secret management.
- Never log passwords, tokens, reset links, payment secrets, or shift notes.

## 15. Observability and operations

- Structured logs: request ID, team ID where safe, actor ID where safe, action, result, latency. Never log credentials.
- Metrics: API latency/error rate, DB pool utilization, cache hit rate, queue depth/age, push outcomes, webhook verification failures, billing reconciliation status.
- Alerts: sustained queue backlog, webhook failures, pool saturation, reconciliation drift.
- Health endpoints: liveness and readiness.
- `product_events` table records `team_created`, `invite_sent`, `invite_accepted`, `shift_published`, `swap_requested`, `swap_decided`, `plan_changed`.
- Backups and restore testing before production use.
- Document deployment, migrations, rollback, and environment setup in README.

## 16. Acceptance test matrix

| Area | Minimum evidence |
|---|---|
| Authentication | Signup/login, magic link, refresh rotation, replay rejection, single-flight refresh, logout-all revokes `sid`, password reset expiry, hashed invite tokens |
| Authorization | Staff shift mutation rejected; role checks; team isolation; `OWNER_IMMUTABLE` cases |
| Seats | Two simultaneous accepts on last seat → one success; Starter cannot invite a sixth |
| Scheduling | Validations; overlap race (advisory lock); overnight and DST; publish/cancel audit events; staff cannot see drafts or notes |
| Swaps | State transitions; colleague accept/decline; duplicate-tap guard; expiry; self-approval tagging; atomic approval; concurrency |
| Feed | 10,000 records; cursor ties at microsecond precision; visibility per role; pull-to-refresh; no duplicate pages; EXPLAIN for staff and owner |
| State/offline | Query cache; optimistic rollback; offline shifts with last-updated; wipe on logout; 14-day hide |
| Settings | Cross-device refetch; per-field conflict test; quiet hours enforced by worker; offline edits blocked |
| Notifications | Unique key prevents duplicates; re-enqueue after Redis flush; stale send dropped; digest collapse; token reassignment; tap opens screen |
| Billing | Exact cents; seat ceilings; eight-plus proration tests incl. pinned vectors; quote equals charge; scheduler jobs; trial; grace; idempotent webhooks; ledger rebuild |
| Caching/performance | Cache invalidation after commit; feed cache; 200-VU report before/after against written pass criteria |
| Build/delivery | Public repo; deployed backend; Android development build; demo video |

## 17. Required engineering documents

- `README.md`: setup, environment, scripts, test, build, deployment, and a section on how app-store billing rules would affect Rota in production.
- `ARCHITECTURE.md`: component diagram, data flow, pooling, read/write routing, cache strategy.
- `STATE.md`: source of truth and persistence per data type.
- `SECURITY.md`: eight or more threats; public environment-variable audit.
- `SHARDING.md`: shard key, two-database simulation, control plane, routing, large-team limits, cross-shard queries.
- `LEARNING-LOG.md`: decisions, experiments, failures, measurements.
- `docs/decisions/`: one decision record per major choice.
- `load-tests/`: k6 scripts and written report.
- OpenAPI contract, migrations, permission/team-isolation/proration tests, 3-minute demo, one LinkedIn post about a technical decision.
