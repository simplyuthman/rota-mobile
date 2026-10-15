# Rota — Implementation Plan

**Document status:** Draft v1.1 (revised after adversarial review; every ruling applied)

**Delivery approach:** Build a vertical slice first, then expand by dependency order.

**Primary objective:** Deliver a secure, testable, visually polished Android development build and deployed backend with the required technical evidence.

## 1. Delivery strategy

Do not build all screens before backend contracts and data invariants exist. Start with repository/tooling, schema, auth, team isolation, and a thin end-to-end path. Then add scheduling, swaps, activity, offline/state coordination, billing, notifications, and performance evidence.

Use short, reviewable pull requests on feature branches, each with a description and screenshots. Each phase ends with a working demo and automated acceptance tests. AI coding agents receive one bounded task at a time, with relevant documents, test commands, and explicit non-goals.

### Deadline check and scope tiers (read first)

**Step zero (Phase 0): confirm whether the deadline of Monday 19 October 2026 has moved.** The phase estimates below add up to **24 days at best and 40 at worst**. The deadline is five calendar days from the date of this review, and Rota is one of four graduation parts. No edit to this plan creates time. The brief has no optional parts for Rota, so you cannot cut a requirement, only depth inside each one.

**If the deadline has not moved, build in this order. Each tier ends with the evidence the brief asks for.** The tier order governs; the phases below describe the work inside each tier and are re-sequenced to match when the deadline stands.

| Tier | Build | Evidence that ends the tier | Phases it draws on |
|---|---|---|---|
| 1 | Auth, roles, team isolation tests | Staff-calls-delete-shift rejection test; team-isolation test; refresh replay test | 0, 1, 2 |
| 2 | Shifts and direct swap | Overlap-race and swap-concurrency tests | 3, 4 |
| 3 | Cursor feed with 10,000 rows | Seed script; `EXPLAIN ANALYZE` before and after (staff and owner views) | 5 |
| 4 | Settings and quiet hours in the worker | Quiet-hours worker test; two-device settings demo | 6 (settings, worker) |
| 5 | Proration unit tests, webhook pipeline, ledger | 8+ proration tests with pinned vectors; duplicate-webhook test; ledger rebuild | 7 |
| 6 | Offline cache | Offline screenshot with "Last updated"; wipe-on-logout test | 6 (offline) |
| 7 | Push | Push delivered to the development build; tap opens the exact screen | 6 (push) |
| 8 | Pool, caching, sharding, load test | Pool justification; two-database routing test; k6 report | 8 |

Inside each tier, thin the depth (fewer screens, fewer polish items), never the evidence.

## 2. Workstreams

- Product/design: confirm decisions (register in the PRD), wireframes, design tokens, role-based journeys.
- Mobile: Expo app shell, navigation, design system, API client, state and persistence.
- Backend: auth, tenant authorization, domain services, migrations, API contracts.
- Platform: PostgreSQL control plane and two shards, two Redis instances, background jobs, deployment, secrets, observability, email provider, static link site, FCM v1.
- Billing: plan model, quotes, proration, checkout adapter, webhook pipeline, ledger, scheduler.
- QA/performance: test matrix, seed data, concurrency, load tests, demo preparation.
- Documentation: README, ARCHITECTURE, STATE, SECURITY, SHARDING, LEARNING-LOG, `docs/decisions/`.

## 3. Phased timeline

Timeline is an estimate for a focused individual or small team, not a commitment. Adjust after repository setup and provider decisions, and re-sequence around the scope tiers if the deadline stands.

### Phase 0 — Decisions and design foundation (1–2 days)

**Tasks**

- **Confirm the deadline.**
- **Publish the decision register** (PRD Section 12): swap model, staff visibility, who invites, overnight/DST, second sign-in (magic link), Fastify + Zod, Kysely or Drizzle (pick one), AsyncStorage persister, payment provider.
- **Choose the transactional email provider.**
- **Run the payment provider check:** test mode supports USD, saved-card recurring charges, signed webhooks, and a Node SDK. If USD fails, plan the fallback (provider test currency; USD cents kept in the ledger).
- Convert the PRD into epics and acceptance criteria.
- Map primary journeys and key screen states.
- Create design tokens and the core component inventory.
- Write the initial architecture and threat model.

**Exit criteria**

- No unresolved policy blocks for MVP implementation (everything in "Decide before build" is decided).
- PRD, TRD, schema, design system, and app flow committed.
- API/domain boundaries and role matrix agreed.
- Email provider and payment provider chosen; deadline confirmed.

### Phase 1 — Repository, CI, environments, schema, first build (2–3 days)

**Tasks**

- Create the monorepo (or linked repos), including `load-tests/` and `docs/decisions/`.
- TypeScript strict mode, formatter, linter, test runner, environment validation.
- Local PostgreSQL (control plane plus two shard databases) and **two Redis instances** (queue with no eviction, cache with TTLs) via Docker Compose. If only one free Redis exists: `noeviction`, a TTL on every cache key, small cache. Check the host's command quota against BullMQ polling.
- Migration system and initial schema (including control-plane tables and composite foreign keys).
- CI for lint, typecheck, unit tests, migration checks.
- `/health/live` and `/health/ready`.
- Safe secret management and `.env.example`.
- **Deploy the API skeleton** to the hosting provider.
- **Static https site** on a free host serving `/.well-known/assetlinks.json` (with the development build's signing fingerprint) and the invite fallback page.
- **FCM v1 credentials in EAS, then the first EAS development build.** Native changes force rebuilds, so do this before features.

**Exit criteria**

- A new developer can run app/API/tests from the README.
- Migrations apply from an empty database on the control plane and both shards.
- CI is green.
- No secret is committed or exposed through `EXPO_PUBLIC_`.
- The development build installs on an Android device and reaches the deployed API.
- `assetlinks.json` is served over https.

### Phase 2 — Authentication, onboarding, and tenant isolation (3–5 days)

**Tasks**

- Signup/login, **magic link** (no Google), email verification code, password reset via the email provider.
- **15-minute access tokens with a `sid` claim; Redis revoked-`sid` set (15-minute TTL) written on logout and logout-all.**
- Rotating refresh sessions with replay rejection; **client refreshes through one shared in-flight promise.**
- SecureStore token handling; logout and logout-all deactivate the device push token and wipe the local cache.
- Team creation (name and time zone, no industry), memberships, **owner-only invitations stored always-hashed with `{teamId}.{random}` tokens**, https App Links, **"Enter invite code" screen**, **verified-email rule for email-bound invites**.
- Owner immutability (`OWNER_IMMUTABLE`) with tests.
- **Seat-limit transaction** (`FOR UPDATE` on the subscription row; `409 SEAT_LIMIT`) and the two-accepts-on-last-seat test.
- Control plane: `user_team_index`, `team_directory`, shard routing.
- Central authorization middleware/service.
- Rate limits (per account and per IP) for login, password reset, invitations.
- Permission and team-isolation tests.

**Exit criteria**

- Invitation works through an App Link and, on a fresh install, through re-tap or the invite code.
- Refresh-token replay is rejected; parallel 401s do not log the user out.
- Logout-all revokes the stolen-token `sid` within the revoked-set window.
- Staff cannot mutate shifts through direct API calls.
- Cross-team resource access is denied.
- Password reset and magic-link tokens expire and cannot be reused.
- Owner-immutable and seat-race tests pass.

### Phase 3 — Schedule and shift lifecycle (3–5 days)

**Tasks**

- Schedule week and agenda screens.
- Shift creation/edit form and shift detail (overnight allowed, at most 24 hours; shifts display in the team's time zone).
- Backend validation for time range, assignment, team scope.
- **Overlap check: always block, no override, with `pg_advisory_xact_lock(hashtextextended(membership_id::text, 0))` taken before the check** (Draft and Published assignments with status `assigned`). Concurrency test.
- Draft/publish/cancel lifecycle.
- **Staff visibility:** published shifts without notes; drafts hidden from staff.
- Activity/outbox event on material changes; the notification decision (time/assignee/location changes push; notes-only edits do not).
- **Redis caches only the published, note-free calendar (`team:{id}:cal:pub:{start}:{end}:v{n}`); the cache version is bumped in the request right after commit, with the outbox event as backup.**
- Role-aware design system components.

**Exit criteria**

- Owner/Manager can create and publish shifts; overlaps are blocked even under concurrent requests.
- Staff can view published, note-free shifts and never see drafts.
- Every mutation is audited and invalidates the correct queries; a manager who just published never reads a stale calendar.
- Error, loading, empty, and offline states are implemented.

### Phase 4 — Swap workflow and concurrency (2–4 days)

**Tasks**

- **Direct handoff** swap: requester nominates one colleague; colleague accept/decline endpoints; `target_accepted_at`; status `declined`.
- Manager approval only after acceptance; approver cannot be requester or target (owner exception tagged `self_approved`).
- Partial unique index `swaps_one_pending`; client optimistic update with rollback.
- Atomic assignment mutation with row locking and the target's advisory lock.
- **Expiry job:** shift start or 7 days after creation; shift cancellation expires pending swaps with reason `shift_cancelled` in the same transaction.
- Tests for simultaneous approvals, duplicate taps from two devices, invalid eligibility, stale state, and self-approval.

**Exit criteria**

- Pending → Approved/Rejected/Declined/Withdrawn/Expired transitions work.
- No duplicate assignment occurs under concurrent approvals; no duplicate pending swap occurs from two devices.
- Client rollback is tested on API failure.
- Activity events are created for all swap transitions, with participant-level visibility.

### Phase 5 — Activity feed and data volume (2–3 days)

**Tasks**

- Activity schema (**`visibility`, `participant_membership_ids`, `params`**) and cursor endpoint.
- **Cursor is base64url of `{createdAt: created_at::text, id}`; it never passes through a JS `Date`.**
- Seed at least 10,000 events (repeatable script).
- Capture `EXPLAIN ANALYZE` before and after the index, **for a staff view and an owner view**.
- FlashList implementation with pull-to-refresh and infinite scroll.
- Guard duplicate in-flight page requests.
- Tests for identical timestamps, rows differing only in microseconds, events inserted between pages, and role-based visibility (billing events owner-only; swap events participants plus managers and owner).

**Exit criteria**

- Cursor pagination has no duplicates in test scenarios; the guarantee is documented honestly (rows committed after the first page, or late with older timestamps, appear after a refresh).
- All feed states are implemented.
- Seed script is repeatable.
- Query plan evidence for both roles is committed to the engineering report.

### Phase 6 — Settings, notifications, offline cache (3–4 days)

**Tasks**

- Settings endpoint; **`PATCH` of changed fields only with per-field `field_updated_at`**; time zone initialized from the device (no UTC default); settings edits blocked offline; cross-device refetch; optimistic update with rollback.
- Push token registration: **upsert by token and reassign `user_id`; deactivate on logout and logout-all.**
- Outbox relay and notification worker. **`notification_jobs` is the source of truth with `UNIQUE (outbox_event_id, user_id, category)`; a repeatable job every minute re-enqueues due `pending`/`failed` rows; BullMQ only executes.**
- **Urgent means security only (new sign-in, logout-all, password change); everything else obeys quiet hours** in the user's time zone, including overnight ranges and DST.
- **Pre-send re-check of the entity; digest collapse of delayed items into one push.**
- Push payloads `{type, teamId, entityId}`; **tap-to-open for cold start, background, and foreground.**
- **Offline cache: one persisted query, 30 days of published shifts, minimal fields (no notes); erased on logout, session revocation, refresh failure, and user change; hidden after 14 days since last sync ("Reconnect to refresh").**
- Retries with bounded exponential backoff, invalid-token deletion, dead-letter strategy.

**Exit criteria**

- Server respects quiet hours even if client settings are stale.
- A stale tablet changing the theme does not overwrite quiet hours set on the phone.
- Settings changes on one device appear on another after refetch.
- Duplicate outbox publish creates one push; a Redis flush does not lose a delayed 6am send.
- A shift cancelled during quiet hours is not announced as published at 6am.
- Tapping a push opens the exact screen.
- Offline shifts render with a timestamp and are wiped on logout and user change.
- Push provider outage does not fail schedule mutations.

### Phase 7 — Subscriptions and billing (4–6 days)

**Before starting:** confirm the payment provider check from Phase 0 (USD, saved-card recurring charges, signed webhooks, Node SDK).

**Tasks**

- Plan constants in integer cents; **seat ceilings (Starter 5; Team 15 to 38; Business 40 to 100)**; `recurring_amount(plan, seats)`.
- **Trial state:** new teams `trialing` on Starter limits for 14 days, no card; first confirmed checkout sets `active`; unpaid trial becomes `restricted`.
- **Change classification by cost; `PRORATION_NEGATIVE` assertion instead of `max(0, ...)`.**
- Proration with seconds (`floor` on credit and cost; at most 1 cent net error), injected clock, **pinned vectors: Starter→Team at 20 of 30 days = 1333 / 3333 / 2000; Team 15→18 seats at 12 of 30 days = 2000 / 2360 / 360.**
- **`billing_quotes`:** server computes once; checkout charges the quoted amount; valid for the earlier of 30 minutes or period end.
- **Two-or-more-changes rule:** credit uses `current_recurring_cents`; each applied change updates it.
- Test-mode checkout behind the provider adapter; signature-verified webhook endpoint; global event dedupe; background processor.
- Idempotency keys; **signed immutable ledger with `plan_after`, `purchased_seats_after`, and zero-amount adjustment rows for downgrades**; ledger rebuild test.
- **Hourly billing scheduler:** applies scheduled changes at period end, starts renewal charges, moves `past_due` → `grace` → `restricted`, ends trials. Subscriptions store `scheduled_plan`, `scheduled_purchased_seats`, `scheduled_effective_at`.
- **Failed renewal: 7-day grace with owner notification, then restricted (read-only).**
- At least eight proration unit tests plus webhook and scheduler tests.

**Exit criteria**

- Exact plan prices are reflected in API and UI; Team cannot exceed 38 seats, Business 100.
- Starter cannot activate a sixth seat.
- The charged amount equals the quote the owner saw.
- Client cannot mark payment successful; duplicate webhook is harmless.
- Ledger is append-only and rebuilds subscription state.
- A failed renewal moves through grace to restricted; a trial ending unpaid restricts the team.
- Proration results are deterministic and audited.

### Phase 8 — Pooling, caching, sharding, load test (2–4 days)

**Tasks**

- Configure the PostgreSQL pool and document the pool size rationale.
- Read/write routing with read-your-own-writes (5 seconds after a write, that user's reads go to the primary).
- Redis cache for roster, published calendar, and **the feed's first page (newest 50 raw events per team, 30 s, version bumped on each insert, filtered per viewer in code, database fallback if filtering leaves fewer rows than the page size).**
- Two separate shard databases and stable `team_id` hash routing; control-plane routing for logins, invites, and webhooks; no cross-database foreign keys. Document in `SHARDING.md`.
- **Rate limits with numbers**, per account and per IP (Login 5/min per account, 30/min per IP; Password reset 3/hour per email, 10/hour per IP; Invites 20/hour per team; Checkout 5/hour per team; Feed 60/min per user).
- **k6 load test with pass criteria written before the run:** 200 virtual users, 30 s ramp, 3 min steady state; p95 at or under 500 ms and error rate under 1% on cached first-page feed reads. Record a baseline run first. Setup: 200 pre-created users across 4 teams; the main team holds 10,000 events; tokens created before the run; the feed rate limit sits above test throughput; scripts in `load-tests/`.

**Exit criteria**

- Read-after-write tests pass.
- Cache invalidation tests pass; cached feed leaks nothing across roles.
- Team routes deterministically to one shard.
- Load report includes baseline, p50/p95/p99, throughput, error rate, and cache hit rate, and the "after" run exercises the feed cache. If the free tier misses the criteria, the report says so with environment details.
- No unmeasured performance claim is made.

### Phase 9 — Hardening, polish, final build, delivery (3–5 days)

**Tasks**

- **Accessibility pass (gate, P0): accessibility labels, 44×44 pt touch targets, 4.5:1 contrast, largest-font-size layouts; TalkBack (VoiceOver if an iOS device is available).**
- Visual QA on small and large Android devices.
- Security review and `SECURITY.md` with at least eight threats (including shared-phone cache and push token, `sid` revoked-set Redis-flush window, staff visibility leaks).
- End-to-end smoke tests and regression suite.
- Configure production secrets; deploy the final backend.
- **Final Android build only** (the first development build already exists from Phase 1).
- **README section on how app-store billing rules would affect Rota in production.**
- **Decision records in `docs/decisions/`, one per major choice.**
- Complete docs and architecture diagram.
- Record a 3-minute demo and draft a LinkedIn post about one technical decision.

**Exit criteria**

- All MVP product criteria pass (PRD Section 11).
- All graduation deliverables present with working links.
- Public GitHub repository is complete.
- Android build link works; deployed backend is healthy.
- Demo and load-test evidence are available.
- Known limitations are documented honestly.

## 4. Priority matrix

### P0 — Must ship

- Authentication (password plus magic link) and secure sessions (15-minute tokens, `sid` revocation).
- Owner/Manager/Staff role enforcement, owner immutability, and team isolation.
- Team onboarding with trial; owner-only invitations and https invite links with the code fallback.
- Shift creation/publishing/viewing with overlap blocking and staff visibility rules.
- Direct-handoff swap with colleague consent and manager approval.
- Activity cursor pagination with visibility, 10,000 seed records.
- Server-synchronized settings and quiet-hour enforcement.
- Offline upcoming shifts with wipe rules.
- Push with tap-to-open.
- Subscription plans, purchased-seat enforcement, quotes, proration, test checkout, webhook verification, immutable ledger, billing scheduler, grace and restricted states.
- **Accessibility gate: accessibility labels, 44×44 pt touch targets, 4.5:1 contrast, largest-font-size layouts (moved up from P1).**
- Security tests, load test, required documentation, Android build, deployed API.

### P1 — Important polish

- Better calendar filters.
- Rich activity event detail.
- Notification delivery status.
- Improved billing history and recovery UX.
- Dark-mode validation beyond the basics and fuller screen-reader polish.

### P2 — Post-MVP

- Multi-location workspaces.
- Payroll/time-clock.
- Automated scheduling suggestions.
- Shift templates and recurring shifts.
- Web admin console.
- Open swap offers and two-way trades.
- Ownership transfer; Google sign-in; second UI language; iOS verification.
- Advanced analytics and exports.

## 5. Dependency graph

```
Deadline check + decision register + API contracts
          ↓
Repo/CI + databases + two Redis + first EAS dev build + deployed API + static link site
          ↓
Auth + membership + tenant authorization + seat transaction
          ↓
Shift lifecycle + overlap lock + audit/outbox
          ├───────────────┐
          ↓               ↓
    Swap (consent)   Activity feed (visibility)
          └───────┬───────┘
                  ↓
   Settings + notifications + offline + push
                  ↓
   Billing + quotes + webhooks + scheduler
                  ↓
   Pool/routing/caching/shard simulation/load test
                  ↓
   Security/accessibility/polish/final build/delivery
```

Some design-system work and test scaffolding can proceed in parallel. Do not parallelize dependent API consumers before response contracts stabilize.

## 6. Definition of done

A task is done only when:

- Acceptance criteria are met.
- Typecheck/lint/tests pass.
- Backend authorization and validation exist where relevant.
- Loading, empty, error, disabled, and success states are addressed.
- The four accessibility checks pass for new UI (label, 44×44 pt target, 4.5:1 contrast, largest font size).
- **`product_events` rows are emitted for the listed events** (`team_created`, `invite_sent`, `invite_accepted`, `shift_published`, `swap_requested`, `swap_decided`, `plan_changed`), and audit/activity events are written where relevant.
- Cache/query invalidation is correct (version bumped in the request after commit).
- Documentation is updated, and a decision record is added for any major choice.
- No secrets or sensitive user data are logged.
- A reviewer can reproduce the behavior locally.

## 7. Agentic-development workflow

For each task, give the coding agent:

- One document of source requirements (PRD/TRD/schema/flow).
- The exact file/module boundary.
- Expected behavior and explicit non-goals.
- Acceptance tests to add or update.
- Commands to run.
- Constraints: no secrets, no client-side authorization as the sole guard, no fabricated success state, no open stack choices (use the decision register).
- A required completion summary listing changed files, tests run, results, and remaining risks.

Recommended task template:

```
Task:
Implement [one bounded capability].

Source of truth:
docs/PRD.md section [...]
docs/TRD.md section [...]
docs/BACKEND-SCHEMA.md section [...]

Scope:
In scope: [...]
Out of scope: [...]

Acceptance criteria:
[ ] [...]
[ ] [...]

Engineering constraints:
- Validate all input on the server (Zod).
- Enforce team and role permissions server-side.
- Add/update automated tests.
- Update docs if the contract changes.
- Do not add secrets to the mobile bundle or logs.

Validation:
Run: [commands]
Report test results and known limitations.
```

## 8. Required test plan

### Unit tests

- Permission policy for every role/action.
- Proration calculation and rounding, with an injected clock; pinned vectors; `PRORATION_NEGATIVE` assertion; cost-based classification; two-change rule.
- Quote validity (earlier of 30 minutes or period end) and quoted amount equals charge.
- Quiet-hour calculation, including overnight ranges, the user's time zone, and DST.
- Cursor encoding/decoding with `created_at::text` and stable ordering.
- Seat-count and plan amount calculation; seat ceilings.
- Refresh-token rotation/replay handling; `sid` revoked-set check.
- Shard routing determinism.

### Integration tests

- Cross-team data isolation; staff cannot read drafts, notes, or owner/participant-only events.
- Owner immutability: self-demote, self-deactivate, promote another to Owner (each `OWNER_IMMUTABLE`).
- Invitation expiry/replay, always-hashed tokens, verified-email rule, and **two simultaneous accepts on the last seat give exactly one success**.
- Shift create/edit/publish/cancel audit behavior; overlap race under the advisory lock.
- Swap approval transaction and concurrency; colleague consent required; duplicate swap from two devices; expiry; self-approval tagging.
- Activity cursor pagination with tied timestamps, microsecond-differing rows, and inserted records.
- Settings: per-field patch, stale-device overwrite behavior, offline blocking, no UTC default.
- Notification pipeline: unique key blocks duplicate send; re-enqueue after Redis flush; stale send dropped; digest collapse; security events bypass quiet hours.
- Push token reassignment on shared phone; deactivation on logout and logout-all.
- Webhook signature verification, global duplicate delivery, retry, and immutable ledger; ledger rebuild.
- Billing scheduler: scheduled change applied, renewal started, `past_due` → `grace` → `restricted`, trial end.
- Cache invalidation after shift and membership changes; feed cache filtered per viewer; read-your-own-writes.

### End-to-end tests

- Owner creates team, starts trial, and invites Staff (link and code paths).
- Manager publishes a shift; Staff sees it without notes.
- Staff requests a swap; colleague accepts; Manager approves; assignment and notifications update.
- Staff views schedule offline; logs out; cache is gone.
- Owner upgrades a plan through test checkout and sees webhook-confirmed state.
- Tapping a push opens the exact screen from a cold start.
- Unauthorized user attempts a forbidden mutation and is rejected.

## 9. Required delivery checklist

### Product

- [ ] All product criteria in PRD Section 11 pass.

### Graduation deliverables

- [ ] Public GitHub repository (or linked mobile/backend repositories) with feature-branch pull requests.
- [ ] Deployed backend URL and environment setup.
- [ ] Android development build download link.
- [ ] README (with the **app-store billing rules section**) and architecture diagram.
- [ ] `ARCHITECTURE.md`, `STATE.md`, `SECURITY.md`, `SHARDING.md`, `LEARNING-LOG.md`.
- [ ] **`docs/decisions/` with one record per major choice.**
- [ ] Permission and team-isolation test results.
- [ ] Proration test results (at least eight cases).
- [ ] Activity feed query plan before/after index (staff and owner views).
- [ ] **`load-tests/` folder with k6 scripts and a written report:** 200-VU run, baseline plus before/after caching, against the pass criteria written first.
- [ ] 3-minute demo video.
- [ ] LinkedIn post describing one engineering decision.
- [ ] Known limitations and next steps documented.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Scope too large: 24–40 days against a 5-day deadline | Confirm the deadline; build by scope tiers; thin depth, never evidence |
| Inconsistent role rules between screens/API | One permission matrix and backend policy tests |
| Double assignment during swap approval | Row locking, advisory lock, state transition guard, concurrency tests |
| Overlapping shifts from two managers | Per-member advisory lock before the check |
| Duplicate swap from two devices | Partial unique index `swaps_one_pending` |
| Duplicate or missed feed items | `(created_at, id)` cursor carrying `created_at::text`; matching index; honest guarantee |
| Staff reading billing/swap events | Per-event `visibility` filter, tested per role |
| Quiet hours only applied on device | Server-side settings and notification worker |
| Delayed sends lost when Redis flushes | `notification_jobs` as source of truth plus one-minute re-enqueue |
| Duplicate pushes from outbox republish | `UNIQUE (outbox_event_id, user_id, category)` |
| Payment return URL mistaken for success | Verified webhook is the only source of payment confirmation |
| Seat race condition | `SELECT ... FOR UPDATE` on the subscription row; two-accepts test |
| **Price inversion: Team costs more than Business above 38 seats** | Seat ceilings (Team 38, Business 100); cost-based classification; `PRORATION_NEGATIVE` assertion |
| **Cross-database foreign keys in the sharding simulation** | Control plane split; plain uuid columns validated in code; routing via `team_directory`, `{teamId}.{random}` tokens, and `team_id` in checkout metadata |
| **Renewal engine missing (nothing charges next month)** | Hourly billing scheduler; scheduled_* columns; trial and grace states |
| **Redis eviction deleting queue keys** | Separate queue and cache instances, or `noeviction` with TTLs and a small cache; check command quota |
| Cache stale after mutation | Version bump in the request after commit; outbox as backup |
| Stale offline data on shared phones | Wipe on logout/revocation/user change; 14-day hide |
| Shared-phone push tokens | Upsert by token, reassign `user_id`, deactivate on logout |
| Email, https links, or FCM missing late | Phase 0 provider choice; Phase 1 static site, FCM v1, first dev build |
| Sharding complexity distracts from product | Implement the two-database simulation after the core product works (Tier 8) |
| Sensitive data leaks in logs/build | Secret audit, redacted logging, review all public environment variables |

## 11. Demo narrative (3 minutes)

- **0:00–0:20** — Introduce Rota and the Owner/Manager/Staff model.
- **0:20–0:50** — Owner creates a team (trial starts), shows seat capacity, and invites a member by link; show the code fallback.
- **0:50–1:20** — Manager creates and publishes a shift (an overlap is blocked); Staff sees it without notes.
- **1:20–1:45** — Staff nominates a colleague; colleague accepts; Manager approves; show activity history and the push tap opening the swap.
- **1:45–2:05** — Show offline upcoming shifts with the last-updated timestamp; show quiet-hour settings and that offline edits are blocked.
- **2:05–2:35** — Show the billing quote, proration, test checkout, and webhook-confirmed state, or a deterministic test-mode walkthrough if provider setup is unavailable.
- **2:35–3:00** — Show evidence: role and team-isolation tests, cursor pagination over 10,000 records with plans for staff and owner, and the 200-VU before/after report against the written pass criteria.
