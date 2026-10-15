---
name: rota-notification-pipeline
description: Implement Rota push notifications - outbox relay, notification_jobs, BullMQ worker, quiet hours in the user's time zone, digest collapse, re-enqueue job, push token lifecycle, and tap-to-open routing. Use for any notification, push, outbox, or quiet-hours work.
---

# Notification pipeline

## Flow
1. A domain mutation writes an **outbox event in the same transaction**.
2. The relay publishes and creates `notification_jobs` rows. Unique `(outbox_event_id, user_id, category)`: a republish creates no duplicate.
3. **`notification_jobs` is the source of truth. BullMQ only executes.**
4. Worker, per job: load the recipient's settings; check category toggle; **check quiet hours in the user's time zone** (handle overnight ranges and DST); re-check the entity still matches the event (a delayed "shift published" is dropped if the shift was cancelled); send via the push adapter; record the result.
5. A repeatable job **every minute** re-enqueues due `pending`/`failed` rows, so a Redis flush cannot delete a 6am send.
6. Delayed items for one user collapse into **one digest push** (`collapse_key`); superseded rows become `cancelled` with `last_error_code='collapsed'`.
7. Retry with exponential backoff; dead-letter after the set attempts; delete tokens the push service reports invalid.

## Rules
- Send only from a job, never inside the request (L-01).
- Urgent = **security only** (new sign-in, logout-all, password change). Everything else obeys quiet hours (P-06). Security cannot be turned off.
- Notification decision: time, assignee, or location change of a published shift → push; notes-only edit → activity event, no push.
- Time-critical shift changes during quiet hours show in the app at once and push when quiet hours end.
- Payload only `{type, teamId, entityId}`; never notes or billing detail (P-05).
- Push tokens: `POST /me/push-tokens` upserts by token and **reassigns `user_id`**; logout/logout-all deactivate the device token (`active=false`, `deactivated_at`).
- Categories users can toggle: shift changes, swaps, billing, activity.

## Tap routing (mobile)
`shift → shifts/[entityId]`, `swap → swaps/[entityId]`, `billing → team/billing` (Owner), `activity → Activity tab`. Handle cold start, background, foreground; switch team first if needed.

## Tests required
Duplicate outbox publish → one push; Redis flushed → delayed send still happens; cancelled shift → stale send dropped; digest collapse; security event bypasses quiet hours; token reassigned on shared phone; invalid token deleted; tap opens exact screen on a dev build.
