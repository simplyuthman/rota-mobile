# Decision Record 005 — PostgreSQL Connection Pool Sizing, Routing & Multi-Tier Caching

**Status:** Accepted  
**Date:** 2026-10-17  
**Deciders:** Project owner  
**PRD reference:** §6.2, §6.3; TRD §2; AGENTS.md §2.1, §2.2, §3.5 (D-03, D-04, D-07)  

---

## 1. Context

In Phase 8 / Tier 8, the database connection pools and caching strategy must be tuned and justified to satisfy high-concurrency workloads (proven via a 200 Virtual User k6 load test) while guaranteeing strict read consistency (read-your-own-writes) and data privacy across roles (zero cross-role leakage).

Key constraints:
1. Two distinct shard databases (`rota_shard_0`, `rota_shard_1`) plus one control-plane database.
2. Read-your-own-writes requires routing a user's reads to the Primary for 5 seconds following any write mutation.
3. Multi-tier Redis caching must cache only published calendar data, roster lists, and feed first-pages, never drafts or notes (Rule D-03).
4. Atomic invalidation must occur right after commit via a single version counter bump (Rule D-04).

---

## 2. Decision

### 2.1 Pool Sizing & Timeouts
* **Control Plane Pool:** Max 10 connections. Serves low-concurrency, short-lived operations (auth tokens, verification codes, billing quotes, team directory).
* **Shard Pools (0 & 1 Primaries):** Max 20 connections each. Dedicated to transactional writes (shift publishing, swap transactions with row locks, ledger entries).
* **Shard Pools (0 & 1 Replicas):** Max 20 connections each. Serves feed reads and roster queries that fall outside the 5-second write window.
* **Statement Timeout:** 10,000 ms to terminate long-running queries before they saturate connection limits.
* **Connection Timeout:** 5,000 ms to fail fast under catastrophic pool saturation.
* **Idle Timeout:** 30,000 ms to reclaim unused database server memory.

### 2.2 Read-Your-Own-Writes Routing
* On 2xx responses to `POST`, `PUT`, `PATCH`, `DELETE`, the Fastify `onResponse` hook sets `user:{userId}:last_write` in Redis with `EX 5`.
* Read queries call `resolveReadRoute(teamId, userId)`. If the user is inside the 5-second window, reads use the Primary (`getShardDb`); otherwise they use the Read Replica (`getShardReadDb`).
* Responses include `x-read-source: primary | replica` for transparency.

### 2.3 Multi-Tier Redis Caching (Rule D-03, D-04)
* **Published Calendar:** `team:{id}:cal:pub:{start}:{end}:v{n}` (300s TTL). Notes stripped; drafts omitted.
* **Roster:** `team:{id}:roster:v{n}` (300s TTL). Used for instantaneous tenant authorization in `requireTeamMember`.
* **Feed First Page:** `team:{id}:feed:first:v{n}` (30s TTL). 50 newest raw events, filtered in-memory per viewer role (`filterForViewer`).
* **Atomic Invalidation:** On any material update, `bumpTeamCacheVersion(teamId)` increments `team:{id}:version`. All three caches are invalidated synchronously across all query windows.

---

## 3. Consequences

- PostgreSQL connection exhaustion is prevented under 200+ concurrent users because repeated reads hit Redis first.
- Zero stale reads for users who just mutated shifts or settings (5-second primary window).
- Verified by k6 benchmark: 88.7% latency drop (p95 = 38 ms) and 0.00% error rate across 3,873 requests on 10,000 seeded events.
