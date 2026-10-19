# ADR 001: Data Layer — Kysely

## Status
Accepted

## Date
2026-10-16

## Context
AGENTS.md §2.1 locks the data layer to "Kysely **or** Drizzle, with plain SQL migrations" and **never Prisma**. A decision record must exist before touching the data layer.

## Options Considered
- **A) Kysely** — lightweight SQL query builder for TypeScript, fully type-safe, no ORM magic, works cleanly with plain SQL migrations, excellent Postgres support.
- **B) Drizzle** — ORM with schema declaration in TypeScript and its own migration system.

## Decision
**Kysely** was chosen for the following reasons:
1. **SQL-first**: Kysely wraps raw SQL closely, making the intended query obvious without a heavy abstraction layer. This is consistent with "SQL-first" in AGENTS.md §2.1.
2. **Plain SQL migrations**: Works alongside hand-written SQL files in `migrations/control-plane/` and `migrations/shard/` without coupling schema management to TypeScript.
3. **TypeScript safety**: The `Database` type (defined in `src/db/schema.ts`) provides full compile-time column safety without code generation.
4. **No magic**: No relations, no lazy loading, no hidden N+1. Every query is explicit.
5. **Small surface area**: No additional runtime code paths that could hide performance issues.

## Record of Use
- Kysely v0.27+ is installed in `services/api/package.json`.
- All SQL queries live in `*.repo.ts` files under `src/modules/<module>/`.
- Shard routing is done via `getShardDb(teamId)` in `src/db/index.ts`.
- Control-plane queries use the `controlPlane` connection also in `src/db/index.ts`.

## Consequences
- All joins, aggregations, and subqueries are written explicitly in repo files.
- No automatic migration generation — all migrations are plain SQL in `migrations/`.
- Drizzle is **not** used anywhere in this codebase.
