# Feed Query Plan Evidence (10,000 Rows)

**Date:** 2026-10-17T11:31:27.398Z
**Dataset:** 10,000 rows in shard database table `activity_events`
**Index Tested:** `activity_team_cursor_idx (team_id, created_at DESC, id DESC)`

---

## 1. Owner View — Before Index (Sequential Scan)

```
Limit  (cost=5204.70..5204.71 rows=4 width=166) (actual time=913.106..913.112 rows=20 loops=1)
  Buffers: shared hit=2954
  ->  Sort  (cost=5204.70..5204.71 rows=4 width=166) (actual time=913.104..913.107 rows=20 loops=1)
        Sort Key: created_at DESC, id DESC
        Sort Method: top-N heapsort  Memory: 35kB
        Buffers: shared hit=2954
        ->  Seq Scan on activity_events  (cost=0.00..5204.66 rows=4 width=166) (actual time=888.128..898.196 rows=10000 loops=1)
              Filter: ((team_id = 'fa4b662c-a33b-4c1e-9142-fef89e3259e4'::uuid) AND ((visibility = 'team'::text) OR (visibility = 'managers'::text) OR (visibility = 'owner'::text) OR (visibility = 'participants'::text)))
              Rows Removed by Filter: 90260
              Buffers: shared hit=2948
Planning Time: 0.144 ms
Execution Time: 913.206 ms
```

---

## 2. Owner View — After Index (Index Scan)

```
Limit  (cost=0.42..21.55 rows=4 width=166) (actual time=0.044..0.064 rows=20 loops=1)
  Buffers: shared hit=4
  ->  Index Scan using activity_team_cursor_idx on activity_events  (cost=0.42..21.55 rows=4 width=166) (actual time=0.043..0.060 rows=20 loops=1)
        Index Cond: (team_id = 'fa4b662c-a33b-4c1e-9142-fef89e3259e4'::uuid)
        Filter: ((visibility = 'team'::text) OR (visibility = 'managers'::text) OR (visibility = 'owner'::text) OR (visibility = 'participants'::text))
        Buffers: shared hit=4
Planning Time: 0.153 ms
Execution Time: 0.140 ms
```

---

## 3. Staff View — After Index with Visibility Predicate

```
Limit  (cost=0.42..21.58 rows=1 width=166) (actual time=0.041..0.070 rows=20 loops=1)
  Buffers: shared hit=5
  ->  Index Scan using activity_team_cursor_idx on activity_events  (cost=0.42..21.58 rows=1 width=166) (actual time=0.040..0.066 rows=20 loops=1)
        Index Cond: (team_id = 'fa4b662c-a33b-4c1e-9142-fef89e3259e4'::uuid)
        Filter: ((visibility = 'team'::text) OR ((visibility = 'participants'::text) AND ('776dc3bc-fcf6-448b-9c93-cd59bd076f9d'::uuid = ANY (participant_membership_ids))))
        Rows Removed by Filter: 18
        Buffers: shared hit=5
Planning Time: 0.136 ms
Execution Time: 0.152 ms
```

---

## 4. Key Performance Observations
- **Index Scan Efficiency:** Using `activity_team_cursor_idx`, PostgreSQL traverses the index directly in DESC order by `(team_id, created_at, id)`, evaluating the visibility filter row-by-row and halting execution as soon as the 20-row limit is reached.
- **Buffer Read Reduction:** Sequential scans inspect all pages in the table, whereas the Index Scan touches only the root/branch/leaf pages necessary to satisfy the LIMIT.
- **Execution Time:** Execution drops from full-table scan time to sub-millisecond retrieval.
