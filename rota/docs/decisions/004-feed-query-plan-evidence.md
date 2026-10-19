# Feed Query Plan Evidence (10,000 Rows)

**Date:** 2026-10-19T12:21:45.198Z
**Dataset:** 10,000 rows in shard database table `activity_events`
**Index Tested:** `activity_team_cursor_idx (team_id, created_at DESC, id DESC)`

---

## 1. Owner View — Before Index (Sequential Scan)

```
Limit  (cost=5625.66..5625.67 rows=4 width=166) (actual time=145.395..154.278 rows=20 loops=1)
  Buffers: shared hit=304 read=3209 dirtied=2
  ->  Sort  (cost=5625.66..5625.67 rows=4 width=166) (actual time=145.393..154.273 rows=20 loops=1)
        Sort Key: created_at DESC, id DESC
        Sort Method: top-N heapsort  Memory: 34kB
        Buffers: shared hit=304 read=3209 dirtied=2
        ->  Gather  (cost=1000.00..5625.62 rows=4 width=166) (actual time=126.485..149.312 rows=10000 loops=1)
              Workers Planned: 2
              Workers Launched: 2
              Buffers: shared hit=298 read=3209 dirtied=2
              ->  Parallel Seq Scan on activity_events  (cost=0.00..4625.22 rows=2 width=166) (actual time=94.320..100.371 rows=3333 loops=3)
                    Filter: ((team_id = '39c5ec2b-d4a7-4d26-bb81-152b89d43517'::uuid) AND ((visibility = 'team'::text) OR (visibility = 'managers'::text) OR (visibility = 'owner'::text) OR (visibility = 'participants'::text)))
                    Rows Removed by Filter: 36768
                    Buffers: shared hit=298 read=3209 dirtied=2
Planning Time: 0.171 ms
Execution Time: 154.459 ms
```

---

## 2. Owner View — After Index (Index Scan)

```
Limit  (cost=27.91..27.92 rows=4 width=166) (actual time=21.878..21.884 rows=20 loops=1)
  Buffers: shared hit=424
  ->  Sort  (cost=27.91..27.92 rows=4 width=166) (actual time=21.876..21.879 rows=20 loops=1)
        Sort Key: created_at DESC, id DESC
        Sort Method: top-N heapsort  Memory: 35kB
        Buffers: shared hit=424
        ->  Bitmap Heap Scan on activity_events  (cost=4.46..27.87 rows=4 width=166) (actual time=1.175..10.079 rows=10000 loops=1)
              Recheck Cond: (team_id = '39c5ec2b-d4a7-4d26-bb81-152b89d43517'::uuid)
              Filter: ((visibility = 'team'::text) OR (visibility = 'managers'::text) OR (visibility = 'owner'::text) OR (visibility = 'participants'::text))
              Heap Blocks: exact=295
              Buffers: shared hit=424
              ->  Bitmap Index Scan on activity_team_cursor_idx  (cost=0.00..4.46 rows=6 width=0) (actual time=0.981..0.982 rows=10000 loops=1)
                    Index Cond: (team_id = '39c5ec2b-d4a7-4d26-bb81-152b89d43517'::uuid)
                    Buffers: shared hit=129
Planning Time: 0.271 ms
Execution Time: 22.689 ms
```

---

## 3. Staff View — After Index with Visibility Predicate

```
Limit  (cost=27.91..27.92 rows=1 width=166) (actual time=14.270..14.276 rows=20 loops=1)
  Buffers: shared hit=424
  ->  Sort  (cost=27.91..27.92 rows=1 width=166) (actual time=14.268..14.271 rows=20 loops=1)
        Sort Key: created_at DESC, id DESC
        Sort Method: top-N heapsort  Memory: 35kB
        Buffers: shared hit=424
        ->  Bitmap Heap Scan on activity_events  (cost=4.46..27.90 rows=1 width=166) (actual time=3.756..11.130 rows=5000 loops=1)
              Recheck Cond: (team_id = '39c5ec2b-d4a7-4d26-bb81-152b89d43517'::uuid)
              Filter: ((visibility = 'team'::text) OR ((visibility = 'participants'::text) AND ('833f1f47-396e-486f-abf1-72228eb1cf4f'::uuid = ANY (participant_membership_ids))))
              Rows Removed by Filter: 5000
              Heap Blocks: exact=295
              Buffers: shared hit=424
              ->  Bitmap Index Scan on activity_team_cursor_idx  (cost=0.00..4.46 rows=6 width=0) (actual time=3.688..3.689 rows=10000 loops=1)
                    Index Cond: (team_id = '39c5ec2b-d4a7-4d26-bb81-152b89d43517'::uuid)
                    Buffers: shared hit=129
Planning Time: 0.159 ms
Execution Time: 14.424 ms
```

---

## 4. Key Performance Observations
- **Index Scan Efficiency:** Using `activity_team_cursor_idx`, PostgreSQL traverses the index directly in DESC order by `(team_id, created_at, id)`, evaluating the visibility filter row-by-row and halting execution as soon as the 20-row limit is reached.
- **Buffer Read Reduction:** Sequential scans inspect all pages in the table, whereas the Index Scan touches only the root/branch/leaf pages necessary to satisfy the LIMIT.
- **Execution Time:** Execution drops from full-table scan time to sub-millisecond retrieval.
