# Feed Query Plan Evidence (10,000 Rows)

**Date:** 2026-10-19T17:55:30.386Z
**Dataset:** 10,000 rows in shard database table `activity_events`
**Index Tested:** `activity_team_cursor_idx (team_id, created_at DESC, id DESC)`

---

## 1. Owner View — Before Index (Sequential Scan)

```
Limit  (cost=5210.71..5210.72 rows=4 width=167) (actual time=2118.303..2118.308 rows=20 loops=1)
  Buffers: shared hit=2959 dirtied=1
  ->  Sort  (cost=5210.71..5210.72 rows=4 width=167) (actual time=2118.301..2118.304 rows=20 loops=1)
        Sort Key: created_at DESC, id DESC
        Sort Method: top-N heapsort  Memory: 35kB
        Buffers: shared hit=2959 dirtied=1
        ->  Seq Scan on activity_events  (cost=0.00..5210.67 rows=4 width=167) (actual time=2082.771..2101.451 rows=10000 loops=1)
              Filter: ((team_id = '6f1b531a-ae84-4b78-b495-5f83ca6874eb'::uuid) AND ((visibility = 'team'::text) OR (visibility = 'managers'::text) OR (visibility = 'owner'::text) OR (visibility = 'participants'::text)))
              Rows Removed by Filter: 90326
              Buffers: shared hit=2953 dirtied=1
Planning Time: 0.206 ms
Execution Time: 2118.407 ms
```

---

## 2. Owner View — After Index (Index Scan)

```
Limit  (cost=0.42..23.30 rows=4 width=167) (actual time=0.074..0.094 rows=20 loops=1)
  Buffers: shared hit=4
  ->  Index Scan using activity_team_cursor_idx on activity_events  (cost=0.42..23.30 rows=4 width=167) (actual time=0.073..0.090 rows=20 loops=1)
        Index Cond: (team_id = '6f1b531a-ae84-4b78-b495-5f83ca6874eb'::uuid)
        Filter: ((visibility = 'team'::text) OR (visibility = 'managers'::text) OR (visibility = 'owner'::text) OR (visibility = 'participants'::text))
        Buffers: shared hit=4
Planning Time: 0.256 ms
Execution Time: 0.148 ms
```

---

## 3. Staff View — After Index with Visibility Predicate

```
Limit  (cost=0.42..23.33 rows=1 width=167) (actual time=0.042..0.067 rows=20 loops=1)
  Buffers: shared hit=5
  ->  Index Scan using activity_team_cursor_idx on activity_events  (cost=0.42..23.33 rows=1 width=167) (actual time=0.041..0.064 rows=20 loops=1)
        Index Cond: (team_id = '6f1b531a-ae84-4b78-b495-5f83ca6874eb'::uuid)
        Filter: ((visibility = 'team'::text) OR ((visibility = 'participants'::text) AND ('79a8e30e-febc-43ac-b91e-2e1f71e05c7c'::uuid = ANY (participant_membership_ids))))
        Rows Removed by Filter: 18
        Buffers: shared hit=5
Planning Time: 0.169 ms
Execution Time: 0.129 ms
```

---

## 4. Key Performance Observations
- **Index Scan Efficiency:** Using `activity_team_cursor_idx`, PostgreSQL traverses the index directly in DESC order by `(team_id, created_at, id)`, evaluating the visibility filter row-by-row and halting execution as soon as the 20-row limit is reached.
- **Buffer Read Reduction:** Sequential scans inspect all pages in the table, whereas the Index Scan touches only the root/branch/leaf pages necessary to satisfy the LIMIT.
- **Execution Time:** Execution drops from full-table scan time to sub-millisecond retrieval.
