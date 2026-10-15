# Rota Learning Log

### 2026-10-15 — Monorepo Architecture & Database Partitioning
Setting up the Rota architecture highlighted the critical difference between control-plane and tenant data. By strictly isolating team data across two shards (`rota_shard_0` and `rota_shard_1`) and directing global identities (`users`, `sessions`, `team_directory`) to a control plane, we eliminate cross-tenant data leaks at the infrastructure level. Enforcing pure SQL migrations and strict composite foreign keys `(team_id, id)` ensures data integrity without relying on ORM magic. Separating Redis into a dedicated cache instance with TTLs and an eviction-free BullMQ queue instance guarantees that heavy background workloads won't drop jobs or starve session invalidations.
