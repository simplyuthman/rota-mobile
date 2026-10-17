# Rota Sharding & Connection Pool Architecture

**Document Version:** 1.2 (Tier 8 Milestone)  
**Governing Rules:** AGENTS.md §2.1, §2.2, §3.5 (D-01 to D-07), TRD §2  

---

## 1. Sharding Key & Topology
- **Shard Key**: `team_id` (UUID v4).
- **Control Plane**: Global tables:
  - `users`
  - `auth_sessions`
  - `auth_tokens`
  - `user_settings`
  - `push_devices`
  - `team_directory(team_id, shard_id)`
  - `user_team_index`
  - `idempotency_keys`
  - `billing_quotes`
  - `payment_webhook_events`
- **Data Shards**: Two shard databases (`rota_shard_0` and `rota_shard_1`), identical in schema, containing all team-scoped data:
  - `teams`
  - `team_memberships`
  - `invitations`
  - `shifts`
  - `shift_assignments`
  - `swap_requests`
  - `activity_events`
  - `subscriptions`
  - `billing_ledger_entries`
  - `notification_jobs`
  - `domain_outbox_events`

---

## 2. Hash Algorithm & Routing
- The target shard is picked deterministically via standard CRC-32 (ISO 3309) polynomial of `team_id`:
  ```ts
  const shardIndex = (crc32(teamId) % 2) as 0 | 1;
  ```
- The assignment is permanently recorded in the control plane's `team_directory(team_id, shard_id)` at creation time.
- Routing lookups:
  - **Authenticated Requests**: Extracted from validated session claims (`team_id`).
  - **Invitations**: Token format `{teamId}.{random}` allows extracting `teamId` before looking up the shard.
  - **Webhooks**: Flutterwave checkout metadata includes `team_id`, routing payment ledger writes to the correct shard.
  - **Login**: `user_team_index` enumerates user teams, but membership role and active status are always re-validated against the shard database.

---

## 3. Cross-Shard Boundaries & Invariants
- **Zero Cross-DB Foreign Keys:** Foreign keys cannot cross between the control plane and shards, or between shards. Cross-database references are plain UUIDs validated in application services (`team_memberships.user_id`, `notification_jobs.user_id`).
- **Same-Team Composite Integrity:** All parent tables have `UNIQUE (team_id, id)`. Children use composite foreign keys `FOREIGN KEY (team_id, parent_id) REFERENCES parent(team_id, id)`.
- If a single team grows exceptionally large (> 10,000 members), that team can be isolated onto a dedicated single-tenant shard with zero code changes, updated in `team_directory`.

---

## 4. PostgreSQL Connection Pool Sizing Rationale (Phase 8, Rule D-07)

| Pool Target | Connection String | Max Pool Size | Idle Timeout | Connection Timeout | Statement Timeout |
|---|---|---|---|---|---|
| **Control Plane** | `DATABASE_CONTROL_URL` | **10** | 30,000 ms | 5,000 ms | 10,000 ms |
| **Control Plane Read** | `DATABASE_CONTROL_READ_URL` | **10** | 30,000 ms | 5,000 ms | 10,000 ms |
| **Shard 0 Primary** | `DATABASE_SHARD_0_URL` | **20** | 30,000 ms | 5,000 ms | 10,000 ms |
| **Shard 0 Read Replica** | `DATABASE_SHARD_0_READ_URL` | **20** | 30,000 ms | 5,000 ms | 10,000 ms |
| **Shard 1 Primary** | `DATABASE_SHARD_1_URL` | **20** | 30,000 ms | 5,000 ms | 10,000 ms |
| **Shard 1 Read Replica** | `DATABASE_SHARD_1_READ_URL` | **20** | 30,000 ms | 5,000 ms | 10,000 ms |

### Rationale:
1. **Control Plane Pool (10 connections):** Serves lightweight user auth lookups, token family verification, and billing quote lookups. Query duration is typically < 2 ms. A pool of 10 easily handles 1,000+ req/s.
2. **Shard Pools (20 connections each):** Serves shift creation, overlap checking locks, swap workflows, and ledger writes. 20 connections per shard allows concurrent transactions while staying within PostgreSQL's optimal concurrency curve ($\approx 2 \times \text{CPU cores}$).
3. **Statement Timeout (10,000 ms):** Hard limit to abort runaway queries or hung locks before they exhaust the connection pool.
4. **Connection Timeout (5,000 ms):** Fails fast under catastrophic connection starvation rather than hanging indefinitely.

---

## 5. Read-Your-Own-Writes Guarantee (TRD §2, AGENTS.md §2.2)

- **Mechanism:**
  - On every successful write mutation (`POST`, `PUT`, `PATCH`, `DELETE`), the Fastify `onResponse` hook calls `recordUserWrite(userId)`, storing `user:{userId}:last_write` in Redis with a 5-second TTL.
  - When that user subsequently executes a read query, `resolveReadRoute(teamId, userId)` checks `isUserInWriteWindow(userId)`.
  - If the user wrote within the last 5 seconds, reads route to the **Primary database** (`getShardDb(teamId)`).
  - Otherwise, reads route to the **Read Replica** (`getShardReadDb(teamId)`).
  - Responses include `x-read-source: primary | replica` for observability.

---

## 6. Multi-Tier Redis Caching Strategy (Rule D-03, D-04)

Three distinct caching tiers exist on Redis Instance #1 (`allkeys-lru`):
1. **Published Calendar Cache:**
   - Key: `team:{id}:cal:pub:{start}:{end}:v{n}` (TTL 300s)
   - Stores only published shifts with notes stripped. Drafts are never cached.
2. **Name-and-Role Roster Cache:**
   - Key: `team:{id}:roster:v{n}` (TTL 300s)
   - Caches active team members. Used by tenant middleware for instant membership authorization without querying PostgreSQL.
3. **Feed First-Page Cache:**
   - Key: `team:{id}:feed:first:v{n}` (TTL 30s)
   - Caches 50 newest raw events. Filtered in-memory per viewer role (`filterForViewer`).

### Invalidation via Version Counter (Rule D-04):
- Whenever a shift is published, cancelled, updated, or membership changes, the application calls `bumpTeamCacheVersion(teamId)`.
- This atomically increments `team:{id}:version`.
- All three cache tiers for that team are invalidated instantaneously without scanning keys or race conditions.
