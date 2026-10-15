---
name: rota-concurrency-transactions
description: Implement Rota operations that must be race-safe - seat limits and membership activation, shift assignment overlap checks, swap request/accept/approve/expire, owner-immutability. Use for any transaction, lock, advisory lock, FOR UPDATE, or concurrency test in the scheduling or membership code.
---

# Race-safe transactions

All of these run inside one database transaction on the team's shard.

## Seat limit (A-06)
```sql
BEGIN;
SELECT purchased_seats FROM subscriptions WHERE team_id = $1 FOR UPDATE;
SELECT count(*) FROM team_memberships WHERE team_id = $1 AND status = 'active';
-- count = purchased_seats  → ROLLBACK, 409 SEAT_LIMIT
UPDATE team_memberships SET status='active', activated_at=now() WHERE id = $2;
COMMIT;
```
Owner and Managers count. Pending invites never reserve seats. No counter column. Test: two simultaneous accepts on the last seat → exactly one success.

## Overlap (A-09)
Inside the transaction, **first** `SELECT pg_advisory_xact_lock(hashtextextended($membership_id::text, 0));` then check Draft and Published assignments with status `assigned` whose shift range overlaps. Match → `409 SHIFT_OVERLAP`. No override, no setting. Test: two managers assign the same person to overlapping shifts at once → exactly one succeeds.

## Swaps (A-10)
- Create: shift is published, in the future, requester currently assigned; target is one other active member. Partial unique index `swaps_one_pending` makes a second tap (any device) fail with `409 SWAP_DUPLICATE`. Client uses optimistic update + rollback.
- Accept/decline: target only. Accept sets `target_accepted_at`; decline sets `declined`.
- Approve (Owner/Manager): only if `target_accepted_at` is set; approver ≠ requester and ≠ target (exception: Owner requester with no manager → tag `self_approved`). Lock the swap and shift rows `FOR UPDATE`, take the advisory lock for the target, re-check eligibility and overlap, update assignments, set status, insert activity + outbox events, commit. Bump the cache version in the request after commit.
- Expire: at shift start or 7 days after creation (job every 5 min). Cancelling a shift expires its pending swaps (`expired_reason = 'shift_cancelled'`) in the same transaction.

## Owner immutability (A-04)
Owner cannot change own role, deactivate self, or set another member to Owner → `409 OWNER_IMMUTABLE` before the unique index is reached. Test all three.

## Always
Activity event and outbox event are written in the same transaction. Real concurrency tests (parallel connections), never mocks.
