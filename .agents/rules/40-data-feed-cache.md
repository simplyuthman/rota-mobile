# Rule 40 — Data correctness, feed, caching, performance

> **Activation:** Model Decision (apply when touching the activity feed, shifts/calendar reads, Redis caching, time handling, or load tests). Breaking any rule fails the task.

- **D-01** Feed cursor = base64url `{createdAt: created_at::text, id}`. Never pass `created_at` through a JS `Date`. No offset pagination. Promise "no duplicates", never "no gaps". Say: rows committed after the first page, or late with an older timestamp, appear after pull-to-refresh.
- **D-02** Store instants in UTC. Show shifts in the **team's** time zone; quiet hours use the **user's**. Overnight shifts allowed (end > start, ≤ 24 h, enforced by `CHECK`). Use a zone-aware date library for DST.
- **D-03** Cache only: the published note-free calendar (`team:{id}:cal:pub:{start}:{end}:v{n}`), the name-and-role roster (`team:{id}:roster:v{n}`), and the feed first page (`team:{id}:feed:first:v{n}`: newest 50 raw events, 30 s TTL). Never cache drafts or notes. Filter the cached feed per viewer in code; read the DB if filtering leaves fewer rows than the page size.
- **D-04** Bump the team cache version **in the request, right after commit**. The outbox event repeats it as a backup. Never rely on the outbox alone.
- **D-05** Write the activity event and outbox event in the **same transaction** as the change.
- **D-06** Capture `EXPLAIN ANALYZE` before and after the feed index for a **staff view and an owner view**. Seed ≥ 10,000 events with a repeatable script. Re-capture if a filter column is added.
- **D-07** Never claim a speedup without a k6 result. Pass criteria written before the run: 200 VUs, 30 s ramp, 3 min steady, p95 ≤ 500 ms, errors < 1%, cached first-page feed reads, baseline run first. If it misses, report honestly with environment details.

## Read/write routing
Pool size is justified against the DB connection limit. For 5 seconds after a user's write, that user's reads go to the primary (read-your-own-writes). Reads use `DATABASE_READ_URL` (it may point at the primary when no replica exists, but the code path must exist). Caching is **cache-aside** with a TTL on every key and explicit invalidation.

## Never cache
Subscription state, payment status, balances, webhook idempotency records, drafts, notes.
