# Decision Record 001 — Data Layer: Kysely

**Status:** Accepted  
**Date:** 2026-10-15  
**Deciders:** Project owner  
**PRD reference:** §12 (decision register); TRD §3.2  

---

## Context

The AGENTS.md locked choice for the data layer is "SQL-first: Kysely **or** Drizzle", with a decision record required before any SQL code is written. The project uses PostgreSQL with a control-plane database and two shard databases. Shard routing requires passing a different database connection per request (determined by `team_directory`), without any cross-database foreign keys.

Two candidates were evaluated:

| Criterion | Kysely | Drizzle |
|---|---|---|
| SQL-first philosophy | Query builder — every query reads like SQL | ORM-style by default; raw SQL mode is secondary |
| TypeScript inference | Best-in-class; column types flow from schema definition | Good, but schema definition is more verbose |
| Shard-connection switching | `db` is a plain parameter — trivially pass a different `Kysely<Schema>` instance per request | Requires more ceremony to swap connection at runtime |
| Plain SQL migrations | Works alongside raw `.sql` files natively | Also supports raw SQL migrations |
| Stability | Stable API, widely deployed at scale | Younger project; API surface still shifting |
| Bundle size | Lightweight | Comparable |

---

## Decision

**Kysely** is the chosen data layer.

Reasoning:
1. **Shard routing is trivial.** The `db` object is just a typed value. The shard router creates one `Kysely<ControlPlaneSchema>` and two `Kysely<ShardSchema>` instances at startup and passes the correct one into each repo function. No framework ceremony is involved.
2. **SQL-first is genuine.** Kysely query builder output maps 1:1 to SQL; nothing is hidden. Debugging slow queries does not require decoding generated SQL.
3. **Type inference is the strongest of the two options.** The schema type definition is the single source of truth; column narrowing happens automatically without extra decorators.
4. **API stability.** Kysely has a stable, documented API. Drizzle is improving rapidly but still has breaking changes between minor versions.

---

## Consequences

- Every SQL query in the project is written using Kysely's query builder API inside `*.repo.ts` files.
- Migrations remain as plain `.sql` files under `migrations/control-plane/` and `migrations/shard/`.
- The shard router (`services/api/src/db/`) creates and exports three typed Kysely instances at startup: `controlPlane`, `shard0`, `shard1`. Route handlers never import a database client directly — they call repo functions that accept the correct instance.
- Drizzle is not installed, not used, and not evaluated again unless a new decision record overrides this one.
- **This record is referenced in every repo file header.**
