# Rule 30 — Architecture and layering

> **Activation:** Always On. Breaking any rule here fails the task.

- **L-01** Heavy or unreliable work runs in a background job, never inside the request: push, webhook processing, email, slow third-party calls. Requests enqueue and return.
- **L-02** `notification_jobs` (database) is the source of truth; BullMQ only executes. `UNIQUE (outbox_event_id, user_id, category)`; a one-minute repeatable job re-enqueues due `pending`/`failed` rows; re-check the entity before sending; collapse delayed items into one digest push.
- **L-03** Jobs retry with exponential backoff, then move to a failed list after a set number of attempts.
- **L-04** Queue and cache are separate Redis instances. If only one exists: `noeviction`, TTL on every cache key, small cache.
- **L-05** Routes parse + authorize. Services hold business rules and transactions. Repos hold all SQL. No SQL in routes, components, or job bodies.
- **L-06** Flutterwave knowledge lives only in `adapters/payments/flutterwave/`. Email and push likewise (`adapters/email/`, `adapters/push/`). The rest talks to provider-neutral interfaces.
- **L-07** The mobile app never talks to PostgreSQL, Redis, or Flutterwave's secret-key API. Only the Rota API.
- **L-09** No foreign key or join across control plane and shards. Route via `team_directory`. Invites find the shard from the embedded `teamId`; webhooks from `team_id` in checkout metadata. `UNIQUE (provider, provider_event_id)` lives in the control plane.
- **L-10** First EAS development build, deployed API, and static link site exist **before** deep-link and push work.

## Where data lives
- **Control plane:** users, auth_sessions, auth_tokens, user_settings, push_devices, team_directory, user_team_index, idempotency_keys, billing_quotes, payment_webhook_events.
- **Shards (hash of `team_id`, recorded in `team_directory`):** teams, team_memberships, invitations, shifts, shift_assignments, swap_requests, activity_events, subscriptions, billing_ledger_entries, domain_outbox_events, notification_jobs, product_events.
- Same-team integrity: `UNIQUE (team_id, id)` on parents + composite FKs `(team_id, x_id)`.
- Cross-database references are plain `uuid` columns validated in code. `user_team_index` is updated after shard commit by the outbox relay; always re-check membership on the shard.

## Repeatable jobs
Notification re-enqueue (1 min); billing scheduler (hourly); swap expiry (5 min); outbox relay (continuous).

## Folder layout
Use the layout in `AGENTS.md` §4 exactly. Do not invent top-level folders. Module files: `<module>.routes.ts`, `.service.ts`, `.repo.ts`, `.schemas.ts`, `.test.ts`.
