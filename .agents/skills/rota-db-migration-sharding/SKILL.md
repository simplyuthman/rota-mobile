---
name: rota-db-migration-sharding
description: Add or change Rota database tables, migrations, indexes, or shard routing. Use for any SQL migration, schema change, foreign key, composite key, team_directory routing, or control-plane versus shard placement question.
---

# Migrations and sharding

## Decide where the table lives
- **Control plane:** users, auth_sessions, auth_tokens, user_settings, push_devices, team_directory, user_team_index, idempotency_keys, billing_quotes, payment_webhook_events.
- **Shard:** everything team-owned (teams, team_memberships, invitations, shifts, shift_assignments, swap_requests, activity_events, subscriptions, billing_ledger_entries, domain_outbox_events, notification_jobs, product_events).
If unsure, stop and ask.

## Rules
1. SQL migrations only, in `services/api/migrations/control-plane/` or `.../shard/`. Never edit an applied migration; add a new one.
2. **No foreign key across control plane and shard.** Use plain `uuid` columns validated in code (e.g. `team_memberships.user_id`, `notification_jobs.user_id`).
3. Same-team integrity: parent gets `UNIQUE (team_id, id)`; children use composite FKs, e.g. `FOREIGN KEY (team_id, shift_id) REFERENCES shifts(team_id, id)`.
4. Money columns are `integer` cents. Instants are `timestamptz` (UTC). Never store local times.
5. Required constraints (must exist): `one_active_owner` partial unique index; `swaps_one_pending` partial unique index on `(shift_id, requester_membership_id) WHERE status='pending'`; shift `CHECK (ends_at > starts_at)` and `CHECK (ends_at - starts_at <= interval '24 hours')`; `UNIQUE (outbox_event_id, user_id, category)` on `notification_jobs`; ledger sign `CHECK`.
6. `user_settings.timezone` has **no default**. `subscriptions` has no `active_seat_count`.
7. Ledger: deny UPDATE/DELETE to the application role.
8. Add an index only for a real query pattern; capture `EXPLAIN ANALYZE`.

## Routing
- Shard = stable documented hash of `team_id` mod 2, recorded in `team_directory`. Never use a runtime-randomised hash. Test determinism.
- Invites: token `{teamId}.{random}` → find shard before lookup.
- Webhooks: `team_id` in Flutterwave checkout metadata → find shard. Dedupe in control-plane `payment_webhook_events`.
- Login: `user_team_index` lists teams; **always re-check membership on the shard** for authorization.

## Verify
Apply every migration from an empty database on the control plane and both shards. Add or update the schema validation checklist in `docs/BACKEND-SCHEMA.md` §9. Document trade-offs in `docs/SHARDING.md`.
