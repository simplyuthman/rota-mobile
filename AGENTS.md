# AGENTS.md — Rota

You are an AI coding agent building **Rota** inside Antigravity. This file tells you **how to behave** while building. The PRD tells you **what** to build. Read this file in full before every task and obey it over any habit, default, or "better idea" of your own.

**Precedence when documents disagree:** this file's Locked Choices and Never Rules → `docs/PRD.md` → `docs/TRD.md` → `docs/BACKEND-SCHEMA.md` → `docs/APP-FLOW.md` → `docs/DESIGN-SYSTEM.md` → `docs/IMPLEMENTATION-PLAN.md`. If two documents conflict and this list does not settle it, **stop and ask** (Section 7). Do not pick a winner silently.

---

## 1. What is this project?

- **Rota** is a mobile shift-scheduling app for small teams (target: restaurants and cafés, 5–40 staff). Owners create a team, invite staff, and pay a monthly **per-seat** subscription. Managers create and publish shifts and approve swaps. Staff view published shifts, request swaps, and get push notifications.
- **Users and roles:** Owner, Manager, Staff. Exactly one Owner per team.
- **Version being built:** MVP only, Draft v1.1 of the document pack. Verified platform: **Android development build**. iOS shares the code but is **not verified**; do not claim iOS support.
- **Source of truth for behavior:** `docs/PRD.md`. Cite PRD section numbers (for example "PRD §6.2") in commits and pull requests.
- **Work order:** follow the scope tiers in `docs/IMPLEMENTATION-PLAN.md` §1, in order. A tier is finished only when its listed evidence exists. Do not start a later tier early.
- **This is graduation work (Mobile Task A).** Every required item needs evidence you can show: a passing test, a query plan, a report. "It works" is not done. The correct record existing in the database, shown by a test, is done.

---

## 2. What is Locked?

Never change, swap, upgrade, "improve", or add alternatives to anything in this section. If you believe a locked choice is wrong, **stop and ask** (Section 7). Do not work around it.

### 2.1 Tools and services

| Area | Locked choice |
|---|---|
| Mobile | React Native + Expo + TypeScript (strict). Expo Router. Verified on Android development build via EAS Build |
| Server state (mobile) | TanStack Query for **all** server data |
| Client state (mobile) | Zustand, for transient UI state only |
| Offline store | TanStack Query persister over **AsyncStorage**, persisting **one query** (upcoming shifts) with minimal fields |
| Token storage | Expo SecureStore only. Never AsyncStorage |
| Feed list | FlashList (FlatList only with a written reason in `docs/decisions/`) |
| Push | Expo Notifications, with FCM v1 credentials in EAS |
| Backend | Node.js (current **Active LTS** release, pinned in `.nvmrc` and `engines`) + TypeScript (strict) + **Fastify** |
| Validation | **Zod** on every request body, query, path param, and webhook payload, on the server |
| Database | PostgreSQL |
| Data layer | **SQL-first**: Kysely **or** Drizzle (see 2.3), with plain SQL migrations. **Never Prisma** |
| Cache, rate limits, revoked sessions | Redis instance #1 (cache instance, every key has a TTL) |
| Job queue | BullMQ on Redis instance #2 (queue instance, `noeviction`) |
| **Payments** | **Flutterwave, test mode only**, behind an adapter. Not Paystack. Not Stripe |
| Passwords | Argon2id |
| Sign-in | Email + password, plus **email magic link**. **No Google sign-in** |
| Email | One transactional email provider, recorded in `docs/decisions/` (see 2.3) |
| Deep links | `https` Android App Links served by the static link site. Never rely on `rota://` |
| Error tracking | **Sentry** on both the server and the mobile app (brief requirement). Scrub tokens, secrets, and shift notes before sending |
| Load testing | k6 |
| Tests | Vitest or Jest, plus a PostgreSQL integration test environment |

### 2.2 Database design

- **Control plane database:** `users`, `auth_sessions`, `auth_tokens`, `user_settings`, `push_devices`, `team_directory(team_id, shard_id)`, `user_team_index`, `idempotency_keys`, `billing_quotes`, and the global `payment_webhook_events`.
- **Two shard databases** (`rota_shard_0`, `rota_shard_1`) hold every team-owned table. A stable, documented hash of `team_id` picks the shard, recorded in `team_directory`.
- **No foreign key may cross the control-plane/shard line.** Cross-database references are plain `uuid` columns validated in code.
- Same-team integrity uses `UNIQUE (team_id, id)` on parents and **composite foreign keys** `(team_id, x_id)`.
- Reads go through a read connection string (`DATABASE_READ_URL`). If there is no replica it may point at the primary, but the code path must exist, with read-your-own-writes (5 seconds after a user's write, that user's reads use the primary).
- The schema in `docs/BACKEND-SCHEMA.md` is the contract. Change it only through a new migration, and only to implement a PRD requirement.
- **Plan constants (cents):** Starter 2000, 5 seats, no extras, ceiling 5. Team 5000, 15 included, 300 per extra seat, ceiling 38. Business 12000, 40 included, 200 per extra seat, ceiling 100.
- **Locked policy decisions:** swaps are direct handoffs with colleague consent; only the Owner invites; overlapping shifts are always blocked with no override; overnight shifts are allowed (at most 24 hours); trial is 14 days on Starter limits with no card; grace period is 7 days; seats are purchased capacity.

### 2.3 Pending decisions (do not guess)

Before you touch the area, check `docs/decisions/` for a record of each item below. **If the record does not exist, stop and ask.** Do not pick one yourself.

1. Data layer: Kysely or Drizzle.
2. Transactional email provider.
3. The **Flutterwave provider check** (a Phase 7 gate): confirm that Flutterwave test mode supports **USD**, **saved-card (tokenized) recurring charges**, **signed webhooks**, and a **Node SDK or documented REST API**. Record the result. If any item fails, stop and ask. The agreed fallback is: charge in Flutterwave's test currency, keep USD cents in the ledger, add a display note.

Never invent a Flutterwave endpoint, field name, header, or webhook signature scheme from memory. Read Flutterwave's current documentation and record what you used in `docs/decisions/`.

---

## 3. What must never happen?

**Breaking any rule in this section means the task FAILED, even if the code compiles, the feature works, and the demo looks right.** A task that breaks one of these is reverted, not patched forward.

Every rule needs a test, a constraint, or a query plan that proves it. If you cannot show the proof, the rule is not met. Rule IDs are for your completion checklist (Section 6). PRD references are in brackets.

### 3.1 Protect the money (PRD §6.8, §6.2)

- **M-01** Store every amount in the smallest unit (cents) as a whole number. Never use decimals, floats, or `number` division for money. Anywhere, ever.
- **M-02** Use the exact plan prices and seat ceilings in 2.2. Never hardcode a price anywhere except the single plan-constants module.
- **M-03** Calculate proration on the server, yourself. Never delegate it to Flutterwave. Use `floor` on both the credit and the cost, with `remaining_seconds / period_seconds`. Tests inject the clock.
- **M-04** Replace `max(0, ...)` with an assertion. If an immediate charge is below zero, throw `PRORATION_NEGATIVE`. Never swallow a negative.
- **M-05** Classify every plan or seat change by cost, never by plan name. If `new_amount > current_amount`, the change is immediate and applies only after payment is confirmed. Otherwise schedule it for period end.
- **M-06** For two or more changes in one period, credit the recurring amount currently in effect, and update `current_recurring_cents` on every applied change.
- **M-07** Create a `billing_quotes` row before any checkout. Charge exactly the quoted amount. Never recompute at checkout. A quote expires at the earlier of 30 minutes or period end.
- **M-08** Never mark a payment successful from the mobile app, a checkout return URL, or a Flutterwave redirect. Only a **signature-verified webhook processed by the worker** confirms payment.
- **M-09** Verify every Flutterwave webhook signature **before** reading or processing the payload. Reject on failure. Never add a bypass flag, not even for tests (tests sign real fixtures).
- **M-10** Store each provider event ID in the control-plane `payment_webhook_events` (unique per provider). A repeated event is a no-op. Never process an event twice.
- **M-11** Send an idempotency key on every payment request. A repeated key returns the stored result and never charges twice.
- **M-12** Treat the ledger as append-only. Never `UPDATE` or `DELETE` a ledger row. Corrections are new rows. Amounts are signed (charges positive, credits and refunds negative). Every row records `plan_after` and `purchased_seats_after`. A downgrade writes a zero-amount adjustment row.
- **M-13** Never cache subscription state, payment status, credit balances, or webhook idempotency records.
- **M-14** Never let the billing scheduler be missing. Renewals, scheduled downgrades, trial end, and grace-to-restricted all run from the hourly billing scheduler. Never rely on a webhook to move a subscription to `grace` or `restricted`.
- **M-15** A failed renewal gives exactly 7 days of grace, notifies the Owner, then makes the team read-only. Restriction is derived from `subscriptions.status`. Never write billing values into `teams.status`.

### 3.2 Protect who may do what (PRD §4, §6.1–§6.5)

- **A-01** Enforce every permission **on the server**. Never rely on hidden buttons, route guards, or client checks. A Staff user calling `delete`/`cancel` shift directly must be rejected, and a test must prove it.
- **A-02** Scope every team-owned query by `team_id` from the authenticated membership. Never trust a client-supplied `teamId`. A user from Team A must never read or write Team B data, and a test must prove it.
- **A-03** Send every request through the shared authorization service. Never write a one-off role check inside a route handler.
- **A-04** Protect the Owner. The Owner cannot change their own role, deactivate their own membership, or set another member to Owner. Return `409 OWNER_IMMUTABLE`. Never rely on the unique index to catch this. Test all three cases.
- **A-05** Let only the Owner invite. Managers and Staff never create invitations.
- **A-06** Enforce seat limits inside one transaction: lock the subscription row with `SELECT ... FOR UPDATE`, count active memberships, and return `409 SEAT_LIMIT` when the count equals `purchased_seats`. Never use a counter column. Never check seats in the app only. Two simultaneous accepts on the last seat must give exactly one success (test it). Count the Owner and Managers as seats. Pending invites never reserve seats.
- **A-07** Never show Staff a draft shift or a shift note. Staff see published shifts only, without notes. Managers and Owner see everything.
- **A-08** Store a `visibility` on every activity event and filter the feed by it, on the server, in the cursor query. Billing events are `owner`. Swap events are `participants`. Never send an unfiltered feed and filter on the client.
- **A-09** Block overlapping assignments for the same member, always. No override. No setting. Take `pg_advisory_xact_lock(hashtextextended(membership_id::text, 0))` before the overlap check, inside the transaction.
- **A-10** Enforce the swap rules: direct handoff to one colleague; the colleague accepts or declines; a manager approves only after acceptance; the approver is never the requester or the target (the only exception is the Owner requesting with no manager present, tagged `self_approved`); one pending swap per shift and requester (partial unique index); expiry at shift start or 7 days; cancelling a shift expires its pending swaps in the same transaction. Approval and assignment changes happen in one transaction with row locks and a re-check.
- **A-11** Enforce the trial: a new team starts `trialing` on Starter limits for 14 days with no card. An unpaid trial becomes `restricted` (read-only).

### 3.3 Protect sessions and secrets (PRD §6.1, §9)

- **S-01** Keep every secret on the server. Never put an API key, database URL, Flutterwave secret key, or signing secret in the repo, the app bundle, or any `EXPO_PUBLIC_` variable. Commit a `.env.example` with names only. List every `EXPO_PUBLIC_` variable in `SECURITY.md` with the reason it is safe to expose.
- **S-02** Store tokens in Expo SecureStore only. Never AsyncStorage. Never log a token, password, reset link, magic link, or payment secret.
- **S-03** Issue access tokens that last 15 minutes and carry a `sid` claim (the session's `token_family_id`). Logout and logout-all write the revoked `sid` values to the Redis revoked set with a 15-minute TTL, and every authenticated request checks that set.
- **S-04** Rotate the refresh token on every use. Reject a consumed token and revoke its family.
- **S-05** Make the mobile client refresh through **one shared in-flight promise**. Parallel 401s must never start two refreshes.
- **S-06** Store invitation, password-reset, magic-link, and verification-code tokens **hashed, always**. Never store a raw token. Build invitation tokens as `{teamId}.{random}`.
- **S-07** Require a **verified email** to accept an email-bound invite. Magic-link sign-in counts as verified; password sign-ups verify with a one-time code.
- **S-08** Rate limit with Redis, never with in-memory state. Use these starting values (sliding window, `429` with `Retry-After`), keyed per account **and** per IP: Login 5/min per account and 30/min per IP; Password reset 3/hour per email and 10/hour per IP; Invites 20/hour per team; Checkout 5/hour per team; Feed 60/min per user.
- **S-09** Return the same response whether or not an email exists in password-reset and magic-link requests.

### 3.4 Protect privacy on shared phones and in notifications (PRD §6.6, §6.7)

- **P-01** Wipe the persisted shift cache on logout, on session revocation, on refresh failure, and when the signed-in user changes.
- **P-02** Persist only published shifts assigned to the user in the next 30 days, with time, title, location, and status. Never persist notes. Hide a cache older than 14 days since the last sync ("Reconnect to refresh").
- **P-03** Never write while offline. Settings edits, swaps, and shift changes are disabled offline. Never queue offline writes.
- **P-04** Deactivate the device push token on logout and logout-all. `POST /me/push-tokens` upserts by token and reassigns `user_id`.
- **P-05** Put only `{type, teamId, entityId}` in a push payload. Never put shift notes or billing details in one. Tapping a push must open the exact screen (cold start, background, foreground).
- **P-06** Enforce quiet hours **on the server**, in the **user's** time zone, inside the notification worker. Never rely on the device. Only security events (new sign-in, logout-all, password change) bypass quiet hours. Everything else waits.
- **P-07** Initialize the user's time zone from the device on first launch and validate it as an IANA name. Never default it to `UTC`.
- **P-08** Update settings with `PATCH` of **changed fields only**, stamping each accepted field in `field_updated_at`. Never accept a whole-object overwrite.

### 3.5 Protect data correctness (PRD §6.3, §6.5)

- **D-01** Paginate the activity feed with a cursor of base64url `{createdAt: created_at::text, id}`. Never convert `created_at` through a JavaScript `Date`. Never use offset pagination. Promise "no duplicates", never "no gaps".
- **D-02** Show shifts in the **team's** time zone. Store all instants in UTC. Never store local times.
- **D-03** Cache only the published, note-free calendar (`team:{id}:cal:pub:{start}:{end}:v{n}`), the name-and-role roster, and the first feed page (newest 50 raw events per team, 30 seconds). Never cache drafts or notes. Filter the cached feed per viewer in code; read the database if filtering leaves fewer rows than the page size.
- **D-04** Bump the team cache version **in the request, right after commit**. The outbox event repeats it as a backup. Never rely on the outbox alone.
- **D-05** Write the activity event and the outbox event **in the same transaction** as the change they describe.
- **D-06** Capture `EXPLAIN ANALYZE` before and after the feed index, for a **staff view and an owner view**. Seed at least 10,000 events with a repeatable script.
- **D-07** Never claim a performance improvement without a measured k6 result. The load test must meet the pass criteria written before the run (200 virtual users, 30 s ramp, 3 min steady state, p95 at or under 500 ms, errors under 1%, cached first-page feed reads), against a baseline run first. If it misses, report that honestly.

### 3.6 Protect observability (brief requirement, PRD §9)

- **O-01** Log every request with request ID, user ID (when authenticated), route, response time, and result. Never log tokens, passwords, reset or magic links, payment secrets, or shift notes.
- **O-02** Log every job attempt with job name, attempt number, outcome, error code, duration, and the related event ID. A job that fails after its last attempt must be visible in the failed list and in Sentry.
- **O-03** Run Sentry on **both** the server and the mobile app. Scrub `Authorization` headers, tokens, push tokens, secrets, and notes before sending. Never put a Sentry auth token in the app bundle or any `EXPO_PUBLIC_` variable. The mobile DSN is public by design and may be `EXPO_PUBLIC_`; list it in `SECURITY.md`.
- **O-04** Log the payment trail (request ID, idempotency key, quote ID, provider event ID, ledger entry ID) so "what happened to this user's payment at 3:14pm?" is answerable. Write that walkthrough in `ARCHITECTURE.md`.

### 3.7 Protect scope

- **X-01** Build only what the current tier asks for. Never build ahead of the scope tier order.
- **X-02** Never build a non-goal: payroll, time clock, AI scheduling, a web console, multi-location, open swap offers, two-way trades, ownership transfer, Google sign-in, overlap overrides, configurable overlap policy, shift breaks, offline writes, a second UI language, iOS verification, an `industry` field.
- **X-03** Never add a dependency, service, framework, or tool that is not in Section 2. Adding one needs a decision record and the user's approval first.

---

## 4. How is the work arranged?

Follow the layout from `docs/TRD.md` §4. Do not invent new top-level folders.

```
rota/
  AGENTS.md
  .env.example                      # names only, never values
  .nvmrc                            # pinned Node LTS major
  apps/
    mobile/
      app/                          # Expo Router routes only (thin)
      src/
        components/                 # design-system components (tokens only)
        features/<feature>/         # screens, hooks, feature logic
        api/                        # API client, one shared refresh promise
        state/                      # Zustand stores (UI state only)
        storage/                    # SecureStore + AsyncStorage persister
        theme/                      # design tokens
        utils/
  services/
    api/
      src/
        modules/<module>/           # auth, teams, memberships, invitations,
                                    # shifts, swaps, activity, settings,
                                    # notifications, subscriptions, webhooks
          <module>.routes.ts        # HTTP only: parse, authorize, call service
          <module>.service.ts       # business rules and transactions
          <module>.repo.ts          # all SQL for this module
          <module>.schemas.ts       # Zod schemas
          <module>.test.ts
        jobs/                       # workers and repeatable jobs only
        db/                         # control-plane + shard connections, routing
        middleware/                 # auth, authorization, rate limit, request id
        config/                     # validated env, plan constants
        adapters/
          payments/flutterwave/     # the ONLY place that knows Flutterwave
          email/                    # the ONLY place that knows the email provider
          push/                     # the ONLY place that knows the push service
      migrations/                   # control-plane/ and shard/ SQL migrations
      tests/                        # integration and concurrency tests
  sites/
    links/                          # static https site: assetlinks.json + invite page
  packages/
    contracts/                      # shared Zod schemas and API types
    config/
  load-tests/                       # k6 scripts + written report
  docs/
    PRD.md  TRD.md  BACKEND-SCHEMA.md  DESIGN-SYSTEM.md  APP-FLOW.md
    IMPLEMENTATION-PLAN.md  ARCHITECTURE.md  STATE.md  SECURITY.md
    SHARDING.md  LEARNING-LOG.md
    decisions/                      # one short record per major choice
```

### Layering rules (break one and the task fails)

- **L-01** Run heavy or unreliable work in a **background job**, never inside the request: push notifications, webhook processing, emails, calls to slow third parties. Requests enqueue and return.
- **L-02** Make `notification_jobs` in the database the source of truth. BullMQ only executes. Use `UNIQUE (outbox_event_id, user_id, category)`, a one-minute repeatable job that re-enqueues due `pending`/`failed` rows, a pre-send re-check that the entity still matches, and digest collapse of delayed items.
- **L-03** Retry jobs with exponential backoff, then move them to a failed list after a set number of attempts.
- **L-04** Keep the queue and the cache on **separate Redis instances**. If only one exists, set `noeviction`, give every cache key a TTL, and keep the cache small.
- **L-05** Let routes parse and authorize only. Put business rules in services. Put SQL only in repos. Never put SQL in a route, a component, or a job body.
- **L-06** Keep Flutterwave knowledge inside `adapters/payments/flutterwave/`. The rest of the backend talks to a provider-neutral interface. Likewise for email and push.
- **L-07** Never let the mobile app talk to PostgreSQL, Redis, or Flutterwave's secret-key API. The app talks to the Rota API only.
- **L-08** Keep server data in TanStack Query. Never copy it into Zustand. Zustand holds only transient UI state.
- **L-09** Never cross the control-plane/shard line with a foreign key or a join. Route by `team_directory`. Find the shard for an invite from the embedded `teamId`, and for a webhook from the `team_id` in Flutterwave checkout metadata.
- **L-10** Make the first EAS development build, the deployed API, and the static link site exist **before** building deep-link and push features.
- **L-11** Put UI in design-system components that use design tokens only. Never use a raw color, font size, or spacing value in a screen.

---

## 5. How should the code look?

Clean, readable, modern, and on supported versions.

- **Language and runtime:** TypeScript with `strict: true`. Use the current Active LTS Node.js release, pinned in `.nvmrc` and `engines`. Use current stable releases of Expo, React Native, and Fastify as supported by the Expo SDK in `package.json`. Pin dependency versions exactly with a lockfile. Do not use a deprecated or end-of-life package.
- **No `any`.** No `@ts-ignore` without a one-line reason and a linked decision record. Prefer `unknown` plus Zod parsing at every boundary.
- **Modern syntax:** ES modules, `async/await`, `const` by default, optional chaining. No callbacks where a promise works.
- **Naming:** `camelCase` for values, `PascalCase` for types and components, `SCREAMING_SNAKE_CASE` for constants and error codes, `snake_case` for SQL.
- **Small units:** one responsibility per function and file. Keep functions short enough to read without scrolling. Extract instead of nesting more than three levels.
- **Errors:** use the standard envelope `{ "error": { "code", "message", "requestId" } }`. Use these codes consistently: `OWNER_IMMUTABLE`, `SEAT_LIMIT`, `SHIFT_OVERLAP`, `SWAP_DUPLICATE`, and `PRORATION_NEGATIVE` (an assertion that must never reach a user).
- **SQL:** parameterized queries only. Never build SQL by string concatenation.
- **Comments:** explain **why**, never what. Put a one-line reference to the rule (for example `// A-09: advisory lock prevents overlapping assignments`) next to code that implements a Never Rule.
- **No dead code, no commented-out code, no stray `console.log`.** Use the structured logger with a request ID. Never log secrets.
- **Tests:** every Never Rule has a test named after its rule ID. Concurrency rules get a real concurrency test, not a mock.
- **Formatting:** ESLint and Prettier must pass with zero warnings.
- **Git:** work on feature branches. Use Conventional Commits (`feat: add cursor pagination to activity feed`). Open one small pull request per feature with a description and the PRD section it implements. Do not force-push or rewrite shared history.
- **Accessibility (gate for all UI):** every interactive element has an accessibility label and a touch target of at least 44×44 points; text contrast is at least 4.5:1; layouts survive the largest system font size.
- **Documentation:** update the relevant doc in the same pull request that changes a contract. Add a short record to `docs/decisions/` for every major choice.

---

## 6. What counts as done?

A task is done only when **all** of these are true:

1. **The code builds with no errors.** Run and pass, in this order: install, typecheck, lint, unit and integration tests, migrations applied from an empty database (control plane and both shards), and the build (API build; mobile typecheck and Expo build checks).
2. Every Never Rule your change touches has a passing test that proves it.
3. Loading, empty, error, disabled, and success states exist for any new UI.
4. No secret, token, or sensitive data is committed or logged. `.env.example` is updated if you added a variable.
5. Docs are updated, and a decision record exists for any major choice.
6. A reviewer can reproduce your result locally from the README.

**End every task with this checklist, filled in honestly:**

```
## Completion report
Task: <one line>
PRD sections implemented: <e.g. §6.2, §6.8>
Scope tier: <1–8>

Requirements met:
- [x] <requirement>  — proof: <test name / file / query plan>
- [x] ...

Never Rules touched (IDs): <e.g. A-06, M-07>  — each proven by: <test names>

Not done / deferred (and why): <list, or "none">
Known limitations: <list, or "none">

Commands run and results:
- typecheck: PASS/FAIL
- lint: PASS/FAIL
- tests: <passed>/<total>
- migrations from empty DB: PASS/FAIL
- build: PASS/FAIL

Files changed: <list>
Remaining risks: <list, or "none">
```

- If any command failed, the task is **not done**. Say so. Fix it or report it. Never write "PASS" for a command you did not run, and never invent test output.
- Never tick a requirement you did not prove.

---

## 7. What does the agent do when unsure?

**Stop and ask. Do not guess, and do not improvise.**

- **U-01** Never add a feature, endpoint, screen, column, setting, or option that the PRD does not require. No "while I'm here" extras. No scope of your own.
- **U-02** Never fill a gap with an invented rule. If the PRD, TRD, schema, or flow is silent or contradictory, stop.
- **U-03** Never write spaghetti to get past uncertainty: no copy-pasted blocks, no duplicate logic in several places, no flags that skip checks, no "temporary" bypasses, no `TODO: fix later` on a Never Rule, no catch-all `try/catch` that hides an error.
- **U-04** Never weaken a Never Rule, delete a failing test, loosen a constraint, or mock away a check to make something pass.
- **U-05** Never change a Locked Choice, install an unlisted dependency, or swap a tool because it seems easier.
- **U-06** Never run destructive commands (dropping databases, deleting migrations, force-pushing, rotating or printing real secrets) without explicit approval.
- **U-07** If a task needs something from a later tier, say so and stop. Do not build a placeholder for it.
- **U-08** Do not guess provider details (Flutterwave, the email provider, Expo, FCM). Read the current documentation, then record what you used.

**How to ask.** Write this and wait:

```
## Blocked: <short title>
What I was doing: <task and PRD section>
What is unclear or conflicting: <exact quotes, with document and section>
Options (max 3): A) ... B) ... C) ...
My recommendation: <one option and why>
What I will NOT do until you answer: <list>
```

Plan before coding. At the start of each task, state in a few lines the tier, the PRD sections, the rules you will touch, and the files you will change. Then build exactly that, one bounded task at a time.
