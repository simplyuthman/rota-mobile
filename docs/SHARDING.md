# Rota Sharding Architecture

## 1. Sharding Key & Topology
- **Shard Key**: `team_id` (UUID v4).
- **Control Plane**: Global tables (`users`, `auth_sessions`, `auth_tokens`, `user_settings`, `push_devices`, `team_directory`, `user_team_index`, `idempotency_keys`, `billing_quotes`, `payment_webhook_events`).
- **Data Shards**: Two shard databases (`rota_shard_0` and `rota_shard_1`), identical in schema, containing all team-scoped data (`teams`, `memberships`, `shifts`, `swaps`, `activity_events`, `subscriptions`, etc.).

## 2. Hash Algorithm & Routing
- The target shard is picked deterministically via CRC-32 hash of `team_id`:
  ```ts
  const shardIndex = crc32(teamId) % 2; // yields 0 or 1
  ```
- The assignment is permanently recorded in the control plane's `team_directory(team_id, shard_id)` at creation time.
- Routing lookups:
  - **Authenticated Requests**: Extracted from validated session claims (`team_id`).
  - **Invitations**: Token format `{teamId}.{random}` allows extracting `teamId` before looking up the shard.
  - **Webhooks**: Flutterwave checkout metadata includes `team_id`, routing payment ledger writes to the correct shard.

## 3. Cross-Shard Boundaries & Limitations
- Foreign keys cannot cross between the control plane and shards, or between shards. Cross-database references are plain UUIDs checked in application services.
- Multi-team reporting or admin rollups query shards individually and aggregate in application memory.
- If a single team grows exceptionally large (> 10,000 members), that team can be isolated onto a dedicated single-tenant shard with zero code changes, updated in `team_directory`.
