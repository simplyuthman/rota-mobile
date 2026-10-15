# Rota Architecture Document

## 1. System Overview
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

## 2. Component Design & Layering (AGENTS.md L-01 to L-11)
- **Routes (`modules/*.routes.ts`)**: HTTP only. Parse request parameters with Zod, authenticate, authorize via shared authorization service, and call service functions. Never contains SQL.
- **Services (`modules/*.service.ts`)**: Business logic, transactional boundaries, advisory locks, and event outbox publishing.
- **Repositories (`modules/*.repo.ts`)**: All SQL queries using Kysely.
- **Adapters (`adapters/*`)**: Isolated provider implementations (Flutterwave, Resend, Expo Push).

## 3. Database Routing & Read Replicas
- **Shard Routing**: Teams are assigned to `rota_shard_0` or `rota_shard_1` via CRC-32 hash of `team_id` recorded in `team_directory`.
- **Read/Write Splitting**: Queries use `DATABASE_*_READ_URL`.
- **Read-Your-Own-Writes**: For 5 seconds following a write by a user, that user's subsequent reads are routed to the primary connection to prevent replication lag anomalies.

## 4. Redis Separation (AGENTS.md §2.1 & L-04)
- **Redis Instance #1 (Cache)**: Transient data only. Every key has an explicit TTL. Holds revoked session IDs (`sid` set with 15-min TTL), rate-limiting counters, and the 30-second first-page team activity feed cache.
- **Redis Instance #2 (Queue)**: BullMQ background worker instance. Configured with `noeviction` to ensure jobs are never dropped due to memory pressure.

## 5. Payment Trail Walkthrough (AGENTS.md O-04)
To answer: *"What happened to this user's payment at 3:14pm?"*:
1. Find the incoming checkout or webhook log using `requestId` or timestamp.
2. Correlate with `idempotency_key` stored in `idempotency_keys` table.
3. Inspect `billing_quotes` table using `quote_id` to verify quoted amount and seat count.
4. Verify the provider event in `payment_webhook_events` by `provider_event_id`.
5. Check `subscription_ledger` in the team's shard for the append-only ledger row containing `plan_after`, `purchased_seats_after`, and amount in cents.
