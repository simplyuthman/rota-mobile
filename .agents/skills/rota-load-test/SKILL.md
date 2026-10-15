---
name: rota-load-test
description: Write and run the Rota k6 load test and report - 200 virtual users on the cached first-page activity feed, with baseline and after-caching runs against pass criteria written first. Use for any k6, performance, caching-evidence, or load-tests/ work.
---

# k6 load test

## Write the pass criteria first (commit before running)
At **200 virtual users, 30 s ramp, 3 min steady state**: **p95 ≤ 500 ms and error rate < 1%** on cached first-page feed reads. Record a **baseline run first**. If the free tier misses, report that honestly with environment details.

## Setup (scripts in `load-tests/`)
- 200 pre-created users across 4 teams; the main team has **10,000 events**.
- Create tokens **before** the run (login would hit the login limit).
- Set the feed rate limit (60/min per user) above test throughput for the run, and say so in the report.
- Same environment and data volume for both runs.

## Runs
1. **Baseline** (feed cache off). 2. **After caching** (feed first-page cache on: newest 50 raw events per team, 30 s TTL, version bumped on insert, filtered per viewer in code). The "after" run must exercise the cache; otherwise the report shows no change and is useless.

## Report (`load-tests/REPORT.md`)
Environment (host, DB, Redis, region, pool size); p50/p95/p99; throughput; error rate; cache hit rate; DB query counts; CPU/memory; baseline vs after; verdict against the pass criteria; anything unexpected. No unmeasured claims.

## Also verify
Cache leaks nothing across roles (staff never get owner/billing events from the cached page). Correctness regressions are investigated before performance tuning.
