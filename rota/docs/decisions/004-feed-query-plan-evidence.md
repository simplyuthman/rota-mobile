# Feed Query Plan Evidence (10,000 Rows)

**Date:** 2026-10-19T11:35:55.362Z
**Dataset:** 10,000 rows in shard database table `activity_events`
**Index Tested:** `activity_team_cursor_idx (team_id, created_at DESC, id DESC)`

---

## 1. Owner View — Before Index (Sequential Scan)

```
Limit  (cost=4690.27..4690.28 rows=4 width=166) (actual time=758.074..758.083 rows=20 loops=1)
  Buffers: shared hit=303 read=2360 dirtied=1
  ->  Sort  (cost=4690.27..4690.28 rows=4 width=166) (actual time=758.072..758.076 rows=20 loops=1)
        Sort Key: created_at DESC, id DESC
        Sort Method: top-N heapsort  Memory: 35kB
        Buffers: shared hit=303 read=2360 dirtied=1
        ->  Seq Scan on activity_events  (cost=0.00..4690.23 rows=4 width=166) (actual time=707.326..729.515 rows=10000 loops=1)
              Filter: ((team_id = '8df87b4d-e79f-4d57-84b1-aca6ae5e695d'::uuid) AND ((visibility = 'team'::text) OR (visibility = 'managers'::text) OR (visibility = 'owner'::text) OR (visibility = 'participants'::text)))
              Rows Removed by Filter: 80280
              Buffers: shared hit=297 read=2360 dirtied=1
Planning Time: 0.327 ms
Execution Time: 758.246 ms
```

---

## 2. Owner View — After Index (Index Scan)

```
Limit  (cost=0.42..22.79 rows=4 width=166) (actual time=0.057..0.090 rows=20 loops=1)
  Buffers: shared hit=5
  ->  Index Scan using activity_team_cursor_idx on activity_events  (cost=0.42..22.79 rows=4 width=166) (actual time=0.056..0.085 rows=20 loops=1)
        Index Cond: (team_id = '8df87b4d-e79f-4d57-84b1-aca6ae5e695d'::uuid)
        Filter: ((visibility = 'team'::text) OR (visibility = 'managers'::text) OR (visibility = 'owner'::text) OR (visibility = 'participants'::text))
        Buffers: shared hit=5
Planning Time: 0.224 ms
Execution Time: 0.170 ms
```

---

## 3. Staff View — After Index with Visibility Predicate

```
Limit  (cost=0.42..22.82 rows=1 width=166) (actual time=0.113..0.158 rows=20 loops=1)
  Buffers: shared hit=5
  ->  Index Scan using activity_team_cursor_idx on activity_events  (cost=0.42..22.82 rows=1 width=166) (actual time=0.111..0.152 rows=20 loops=1)
        Index Cond: (team_id = '8df87b4d-e79f-4d57-84b1-aca6ae5e695d'::uuid)
        Filter: ((visibility = 'team'::text) OR ((visibility = 'participants'::text) AND ('694cc72f-bbd1-49fe-a10f-72f2766fbaae'::uuid = ANY (participant_membership_ids))))
        Rows Removed by Filter: 18
        Buffers: shared hit=5
Planning Time: 7.030 ms
Execution Time: 11.958 ms
```

---

## 4. Key Performance Observations
- **Index Scan Efficiency:** Using `activity_team_cursor_idx`, PostgreSQL traverses the index directly in DESC order by `(team_id, created_at, id)`, evaluating the visibility filter row-by-row and halting execution as soon as the 20-row limit is reached.
- **Buffer Read Reduction:** Sequential scans inspect all pages in the table, whereas the Index Scan touches only the root/branch/leaf pages necessary to satisfy the LIMIT.
- **Execution Time:** Execution drops from full-table scan time to sub-millisecond retrieval.
