---
name: rota-task-workflow
description: Use at the start and end of every Rota coding task. Plans one bounded task against the scope tier and PRD section, builds only that, and produces the completion report. Use when starting, scoping, or finishing any feature, fix, or migration in this repo.
---

# Rota task workflow

## Before coding
1. Read `AGENTS.md` and the rules in `.agents/rules/`.
2. State in a few lines: **scope tier** (IMPLEMENTATION-PLAN §1), **PRD sections**, **Never Rule IDs you will touch**, **files you will change**, and **explicit non-goals** for this task.
3. Check `docs/decisions/` for any pending decision the task depends on (data layer, email provider, Flutterwave check). If a record is missing, stop and ask.
4. If the task needs a later tier, say so and stop.

## While coding
- Build exactly the stated scope. No extras (U-01).
- Write the test for each Never Rule first or alongside; name tests with the rule ID (e.g. `A-06 seat limit under concurrency`).
- Keep routes thin; rules in services; SQL in repos; provider code in adapters.
- Open a small PR on a feature branch with a Conventional Commit title and the PRD section.

## Before reporting
Run in order: install, typecheck, lint, tests, migrations from empty (control plane + both shards), build. Record real results.

## Finish with the report
Use the **Completion report** template from `.agents/rules/60-done-and-when-unsure.md`. Never write PASS for a command you did not run.

## If blocked
Use the **Blocked** template from rule 60 and wait.
