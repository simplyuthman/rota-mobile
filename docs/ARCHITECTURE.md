# Rota System Architecture & Engineering Reference

This document describes the end-to-end system architecture, data routing, replication guarantees, connection pool sizing, caching invariants, and payment audit walkthrough for **Rota** (Mobile Task A graduation build).

---

## 1. System Overview & Component Diagram

Rota is a multi-tenant mobile shift-scheduling application for small teams (target: restaurants and cafés, 5–40 staff).

```
                      +-----------------------------+
                      | React Native (Expo) Mobile  |
                      |  (Android Dev Build / EAS)  |
                      +--------------+--------------+
                                     | HTTPS / JSON
                                     v
                      +-----------------------------+
                      |     Fastify API Service     |
                      | (Pino, Zod, Kysely, Argon2) |
                      +----+--------+----------+----+
                           |        |          |
            +--------------+        |          +--------------+
            |                       |                         |
            v                       v                         v
+-----------------------+ +--------------------+ +--------------------+
| Control Plane Postgres| | Redis #1 (Cache)   | | Redis #2 (Queue)   |
| (users, sessions,     | | TTL on all keys    | | BullMQ background  |
|  team_directory,      | | Revoked sessions   | | noeviction policy  |
|  quotes, webhooks)    | | Feed page 1 cache  | | Outbox relay       |
+-----------------------+ +--------------------+ +--------------------+
            |
            +--------------------------+
            v                          v
+-----------------------+  +-----------------------+
|  Shard 0 PostgreSQL   |  |  Shard 1 PostgreSQL   |
| (teams, shifts, swaps,|  | (teams, shifts, swaps,|
|  activity, ledger)    |  |  activity, ledger)    |
+-----------------------+  +-----------------------+
```

---

## 2. Component Design & Layering (Rules L-01 to L-11)

- **Routes (`modules/*.routes.ts`)**: HTTP boundary only. Validates request schemas with Zod, authenticates tokens, authorizes roles via centralized authorization service (`requireRole`), and delegates immediately to services. Routes never contain SQL or business calculations.
- **Services (`modules/*.service.ts`)**: Business logic, transactional boundaries, advisory locks (`pg_advisory_xact_lock`), proration math, and outbox event emission.
- **Repositories (`modules/*.repo.ts`)**: Pure SQL queries using Kysely query builder. All database reads and writes are encapsulated here.
- **Adapters (`adapters/*`)**: Isolated provider implementations:
  - `adapters/payments/flutterwave/`: The ONLY place that knows Flutterwave REST endpoints and HMAC signatures.
  - `adapters/email/`: Transactional email delivery (Resend).
  - `adapters/push/`: Expo Push / FCM v1 token dispatch.

---

## 3. Database Partitioning & Sharding (`SHARDING.md`)

- **Shard Key (`team_id`)**: The shard key is the UUID of the team.
- **Stable Documented Hash**: CRC-32 of `team_id` modulo 2 picks the shard (`rota_shard_0` or `rota_shard_1`). The assignment is permanently recorded in `team_directory(team_id, shard_id)`.
- **Zero Cross-Database Foreign Keys**: Control-plane tables and shard tables NEVER share database-level foreign keys. References across boundaries are plain UUID columns validated in application code.
- **Same-Team Integrity**: Enforced via `UNIQUE (team_id, id)` on parents and composite foreign keys `(team_id, x_id)` on children.

---

## 4. Connection Pool Sizing & Timeouts (`docs/decisions/005-pool-sizing-and-caching.md`)

PostgreSQL connection pools are configured explicitly using `pg.Pool`:

| Pool Name | Database | Max Connections | Connection Timeout | Statement Timeout | Idle Timeout | Rationale |
|---|---|---|---|---|---|---|
| `controlPlane` | `control_plane` | 10 | 5,000 ms | 10,000 ms | 30,000 ms | Control-plane handles lightweight lookups (auth, tokens, quotes, directory). |
| `controlPlaneRead` | `control_plane` (read) | 10 | 5,000 ms | 10,000 ms | 30,000 ms | Read replica for control plane. |
| `shard0` | `rota_shard_0` (primary) | 20 | 5,000 ms | 10,000 ms | 30,000 ms | Shard 0 write traffic, shifts, transactions, advisory locks. |
| `shard0Read` | `rota_shard_0` (replica) | 20 | 5,000 ms | 10,000 ms | 30,000 ms | Shard 0 read traffic (roster, calendar, feed). |
| `shard1` | `rota_shard_1` (primary) | 20 | 5,000 ms | 10,000 ms | 30,000 ms | Shard 1 write traffic. |
| `shard1Read` | `rota_shard_1` (replica) | 20 | 5,000 ms | 10,000 ms | 30,000 ms | Shard 1 read traffic. |

**Timeouts**:
- `statement_timeout = 10,000 ms`: Terminates runaway queries before pool exhaustion.
- `connectionTimeoutMillis = 5,000 ms`: Fails fast under connection starvation.
- `idleTimeoutMillis = 30,000 ms`: Reclaims idle connections to protect PostgreSQL memory.

---

## 5. Read-Your-Own-Writes Guarantee (TRD §2, Rule A-02)

To prevent replication lag anomalies (e.g. a manager publishes a shift and then immediately sees a stale calendar on refresh):
1. **Mutation Tracking**: Any mutating HTTP request (`POST`, `PUT`, `PATCH`, `DELETE`) that completes with a 2xx status code records the acting user's ID in Redis (`user:write:{userId}`) with a 5-second TTL (`recordUserWrite(userId)`).
2. **Dynamic Route Selection**: When that user issues a `GET` request within 5 seconds, `resolveReadRoute(userId)` detects the active write window and routes the request directly to the primary shard connection (`getShardDb`).
3. **Automatic Fallback to Replica**: Once the 5-second window expires, subsequent read requests route to the read replica (`getShardReadDb`).
4. **Header Visibility**: All responses include `x-read-source: primary | replica` exposing the underlying connection used.

---

## 6. Multi-Tier Redis Caching Strategy (Rules D-03, D-04)

Redis instance #1 serves as the performance cache. Every key has an explicit TTL:

1. **Published Calendar Cache**:
   - Key: `team:{id}:cal:pub:{start}:{end}:v{n}`
   - TTL: 300 seconds.
   - Invariant: Stores published shifts only. Shift notes are stripped. Draft shifts are NEVER cached.
2. **Tenant Roster Cache**:
   - Key: `team:{id}:roster:v{n}`
   - TTL: 300 seconds.
   - Invariant: Stores active memberships (name, role, status) to accelerate tenant authorization (`requireTeamMember`) to 0.2 ms without hitting PostgreSQL.
3. **Feed First-Page Cache**:
   - Key: `team:{id}:feed:first:v{n}`
   - TTL: 30 seconds.
   - Invariant: Stores the newest 50 raw events per team. Evaluated in-memory per viewer role (`filterForViewer`), protecting staff from seeing billing events or private swaps. Falls back to database query if filtering leaves fewer rows than the requested limit.
4. **Atomic Invalidation**:
   - Any shift mutation, invitation accept, or membership status change calls `bumpTeamCacheVersion(teamId)`, atomically incrementing `team:{id}:version`.
   - Bumping the version instantaneously invalidates the calendar, roster, and feed caches for that team in a single atomic Redis operation.

---

## 7. Repeatable Background Jobs (BullMQ on Redis Instance #2)

1. **Push Notification Relay & Worker (Rules L-01, L-02)**:
   - Source of truth: `notification_jobs` on the shard database.
   - BullMQ executes tasks from the queue instance (`noeviction`).
   - A 1-minute repeatable job inspects due `pending` and `failed` jobs and re-enqueues them with exponential backoff.
   - Pre-send check: Re-reads the target shift or swap before dispatch; if cancelled or expired while waiting, cancels the push.
   - Server quiet hours: Evaluated in the user's validated IANA time zone; non-security pushes are delayed until quiet hours end.
2. **Hourly Billing Scheduler (Rules M-14, M-15)**:
   - Runs every hour on the hour.
   - Applies scheduled plan downgrades at period end.
   - Initiates recurring renewals via saved tokenized cards.
   - Moves failed renewals to `grace` (exactly 7 days), notifying the owner.
   - Transitions expired grace and unpaid 14-day trials to `restricted` (read-only scheduling mode).

---

## 8. Payment Trail Walkthrough (Rule O-04)

To answer the forensic audit question: **"What happened to this user's payment at 3:14pm?"**:

```
Step 1: Inbound Request Log (Pino)
   ↳ Match requestId (e.g. req-abc-123) or timestamp 15:14:00Z.
   ↳ Extract user_id and idempotency_key.

Step 2: Idempotency Key Lookup
   ↳ SELECT * FROM idempotency_keys WHERE key = :idempotencyKey;
   ↳ Confirms the initial client intent and prevents duplicate charges.

Step 3: Billing Quote Verification
   ↳ SELECT * FROM billing_quotes WHERE id = :quoteId;
   ↳ Inspect quoted_amount_cents, purchased_seats, plan, and expires_at.
   ↳ Confirms the user saw a quote before checkout (Rule M-07).

Step 4: Webhook Event Audit (Control Plane)
   ↳ SELECT * FROM payment_webhook_events WHERE provider_event_id = :flwId;
   ↳ Confirms Flutterwave webhook delivery, HMAC verification timestamp, and payload_hash.

Step 5: Shard Routing & Subscription Ledger Verification
   ↳ Consult team_directory(team_id) to locate shard (rota_shard_0 or rota_shard_1).
   ↳ SELECT * FROM billing_ledger_entries WHERE quote_id = :quoteId ORDER BY created_at ASC;
   ↳ Inspect immutable ledger row:
        - type: 'charge'
        - amount_cents: quoted_amount_cents (integer cents, Rule M-01)
        - plan_after, purchased_seats_after
        - provider_transaction_id
   ↳ SELECT status, period_end FROM subscriptions WHERE team_id = :teamId;
   ↳ Confirms subscription transitioned to 'active' with updated recurring amount.
```
