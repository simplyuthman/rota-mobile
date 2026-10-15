# Rule 50 — Coding style and git

> **Activation:** Always On.

- TypeScript `strict: true`. No `any`. No `@ts-ignore` without a one-line reason + decision record. Use `unknown` + Zod at every boundary.
- Node: current Active LTS, pinned in `.nvmrc` and `engines`. Use stable, supported releases only (Expo SDK in `package.json`, Fastify current). Pin exact versions with a lockfile. No deprecated or end-of-life packages.
- Modern syntax: ES modules, `async/await`, `const` by default, optional chaining.
- Naming: `camelCase` values, `PascalCase` types/components, `SCREAMING_SNAKE_CASE` constants and error codes, `snake_case` SQL.
- One responsibility per function and file. Max three nesting levels; extract instead.
- Error envelope: `{ "error": { "code", "message", "requestId" } }`. Codes: `OWNER_IMMUTABLE`, `SEAT_LIMIT`, `SHIFT_OVERLAP`, `SWAP_DUPLICATE`, `PRORATION_NEGATIVE` (assertion, never user-facing). Status: 401 unauthenticated, 403 unauthorized, 404 to avoid disclosure, 409 conflict, 422 validation, 429 rate limit.
- SQL: parameterized only. Never concatenate.
- Comments explain **why**. Tag Never-Rule code: `// A-09: advisory lock prevents overlapping assignments`.
- No dead code, no commented-out code, no stray `console.log`. Use the structured logger with a request ID. Never log secrets.
- Tests: every Never Rule has a test named with its rule ID. Concurrency rules get a real concurrency test, never a mock.
- ESLint + Prettier: zero warnings.
- Git: feature branches; Conventional Commits (`feat: add cursor pagination to activity feed`); one small PR per feature with description, screenshots, and the PRD section; no force-push on shared history.
- Update the relevant doc in the same PR that changes a contract. Add a record to `docs/decisions/` for every major choice.
