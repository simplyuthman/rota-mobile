---
name: rota-activity-feed
description: Build or change the Rota activity feed - cursor pagination, visibility filtering, feed index, EXPLAIN ANALYZE evidence, 10,000-row seed, feed first-page cache, and the mobile FlashList screen. Use for anything touching activity_events or the Activity tab.
---

# Activity feed

## Schema essentials
`activity_events(id, team_id, actor_membership_id, event_type, subject_type, subject_id, params jsonb, visibility, participant_membership_ids uuid[], created_at)`; index `(team_id, created_at DESC, id DESC)`. Store `event_type` + `params`, **not rendered text**; the client renders in the viewer's language and the team's zone. Never put shift notes in `params`.

## Cursor query
```sql
SELECT id, event_type, subject_type, subject_id, params, created_at::text AS created_at_text
FROM activity_events
WHERE team_id = $1
  AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
  AND (visibility = 'team'
    OR (visibility = 'managers' AND $role IN ('owner','manager'))
    OR (visibility = 'owner' AND $role = 'owner')
    OR (visibility = 'participants'
        AND ($role IN ('owner','manager') OR $membership_id = ANY(participant_membership_ids))))
ORDER BY created_at DESC, id DESC
LIMIT $4;
```
- Cursor = base64url `{createdAt: <created_at::text>, id}`. **Never through a JS `Date`** (it truncates microseconds).
- Cap page size 20–50. Return `nextCursor` only if more may exist.
- Billing events `owner`; swap events `participants`.
- Honest guarantee: **no duplicates, ever.** Rows committed after the first page, or late with an older timestamp (`now()` is transaction start), appear after pull-to-refresh. Never write "no gaps".

## Evidence required
- Seed ≥ 10,000 events with a repeatable script.
- `EXPLAIN ANALYZE` **before and after** the index, for a **staff view and an owner view**. Save in the engineering report. Re-capture if a filter column is added.
- Tests: rows with identical timestamps; rows differing only in microseconds; inserts between pages; billing events hidden from staff; swap events visible only to participants + managers + owner.

## Cache (D-03/D-04)
Cache the newest 50 raw events per team for 30 s at `team:{id}:feed:first:v{n}`. Bump version in the request right after each insert. Filter per viewer in code; if fewer rows than page size remain, read the database.

## Mobile
FlashList, infinite scroll with an `isFetchingNextPage` guard, pull-to-refresh (resets pages), and distinct loading / empty / end-of-list / retryable-error states. Never append duplicate IDs.
