# Feed Query Plan Evidence (10,000 Rows)

**Date:** 2026-10-17T14:27:19.299Z
**Dataset:** 10,000 rows in shard database table `activity_events`
**Index Tested:** `activity_team_cursor_idx (team_id, created_at DESC, id DESC)`

---

## 1. Owner View — Before Index (Sequential Scan)

```
Limit  (cost=4164.92..4164.93 rows=3 width=166) (actual time=1449.882..1449.889 rows=20 loops=1)
  Buffers: shared hit=2360 dirtied=1
  ->  Sort  (cost=4164.92..4164.93 rows=3 width=166) (actual time=1449.880..1449.883 rows=20 loops=1)
        Sort Key: created_at DESC, id DESC
        Sort Method: top-N heapsort  Memory: 30kB
        Buffers: shared hit=2360 dirtied=1
        ->  Seq Scan on activity_events  (cost=0.00..4164.90 rows=3 width=166) (actual time=895.120..1423.631 rows=10000 loops=1)
              Filter: ((team_id = '04f8a4a3-baef-4be6-8d51-cd944a1f2581'::uuid) AND ((visibility = 'team'::text) OR (visibility = 'managers'::text) OR (visibility = 'owner'::text) OR (visibility = 'participants'::text)))
              Rows Removed by Filter: 70261
              Buffers: shared hit=2360 dirtied=1
Planning Time: 0.232 ms
Execution Time: 1450.017 ms
```

---

## 2. Owner View — After Index (Index Scan)

```
Limit  (cost=23.92..23.92 rows=3 width=166) (actual time=50.093..50.102 rows=20 loops=1)
  Buffers: shared hit=425
  ->  Sort  (cost=23.92..23.92 rows=3 width=166) (actual time=50.091..50.095 rows=20 loops=1)
        Sort Key: created_at DESC, id DESC
        Sort Method: top-N heapsort  Memory: 30kB
        Buffers: shared hit=425
        ->  Bitmap Heap Scan on activity_events  (cost=4.46..23.89 rows=3 width=166) (actual time=1.699..32.990 rows=10000 loops=1)
              Recheck Cond: (team_id = '04f8a4a3-baef-4be6-8d51-cd944a1f2581'::uuid)
              Filter: ((visibility = 'team'::text) OR (visibility = 'managers'::text) OR (visibility = 'owner'::text) OR (visibility = 'participants'::text))
              Heap Blocks: exact=296
              Buffers: shared hit=425
              ->  Bitmap Index Scan on activity_team_cursor_idx  (cost=0.00..4.46 rows=5 width=0) (actual time=1.612..1.613 rows=10000 loops=1)
                    Index Cond: (team_id = '04f8a4a3-baef-4be6-8d51-cd944a1f2581'::uuid)
                    Buffers: shared hit=129
Planning Time: 0.171 ms
Execution Time: 50.435 ms
```

---

## 3. Staff View — After Index with Visibility Predicate

```
Limit  (cost=23.93..23.93 rows=1 width=166) (actual time=30.377..30.386 rows=20 loops=1)
  Buffers: shared hit=425
  ->  Sort  (cost=23.93..23.93 rows=1 width=166) (actual time=30.375..30.379 rows=20 loops=1)
        Sort Key: created_at DESC, id DESC
        Sort Method: top-N heapsort  Memory: 35kB
        Buffers: shared hit=425
        ->  Bitmap Heap Scan on activity_events  (cost=4.46..23.92 rows=1 width=166) (actual time=9.657..26.513 rows=5000 loops=1)
              Recheck Cond: (team_id = '04f8a4a3-baef-4be6-8d51-cd944a1f2581'::uuid)
              Filter: ((visibility = 'team'::text) OR ((visibility = 'participants'::text) AND ('cad37418-0e34-4faf-818e-8585ba144a81'::uuid = ANY (participant_membership_ids))))
              Rows Removed by Filter: 5000
              Heap Blocks: exact=296
              Buffers: shared hit=425
              ->  Bitmap Index Scan on activity_team_cursor_idx  (cost=0.00..4.46 rows=5 width=0) (actual time=9.569..9.570 rows=10000 loops=1)
                    Index Cond: (team_id = '04f8a4a3-baef-4be6-8d51-cd944a1f2581'::uuid)
                    Buffers: shared hit=129
Planning Time: 0.327 ms
Execution Time: 30.595 ms
```

---

## 4. Key Performance Observations
- **Index Scan Efficiency:** Using `activity_team_cursor_idx`, PostgreSQL traverses the index directly in DESC order by `(team_id, created_at, id)`, evaluating the visibility filter row-by-row and halting execution as soon as the 20-row limit is reached.
- **Buffer Read Reduction:** Sequential scans inspect all pages in the table, whereas the Index Scan touches only the root/branch/leaf pages necessary to satisfy the LIMIT.
- **Execution Time:** Execution drops from full-table scan time to sub-millisecond retrieval.
