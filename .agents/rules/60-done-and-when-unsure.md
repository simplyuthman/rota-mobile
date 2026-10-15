# Rule 60 — Definition of done and what to do when unsure

> **Activation:** Always On.

## Done means all of these
1. Code builds with no errors. Run and pass in order: install, typecheck, lint, unit + integration tests, migrations from an empty DB (control plane and both shards), build.
2. Every Never Rule touched has a passing test.
3. Loading, empty, error, disabled, success states exist for new UI.
4. No secret/token/sensitive data committed or logged; `.env.example` updated.
5. Docs updated; decision record added for major choices.
6. A reviewer can reproduce it locally from the README.

If any command fails, the task is **not done**. Never write PASS for a command you did not run. Never invent test output. Never tick an unproven requirement.

## End every task with this report
```
## Completion report
Task: <one line>
PRD sections implemented: <e.g. §6.2>
Scope tier: <1–8>
Requirements met:
- [x] <requirement> — proof: <test / file / query plan>
Never Rules touched (IDs): <e.g. A-06>  — proven by: <tests>
Not done / deferred (and why): <list or "none">
Known limitations: <list or "none">
Commands: typecheck PASS/FAIL | lint PASS/FAIL | tests <p>/<t> | migrations PASS/FAIL | build PASS/FAIL
Files changed: <list>
Remaining risks: <list or "none">
```

## When unsure: stop and ask
- **U-01** No feature, endpoint, screen, column, setting, or option the PRD does not require. No "while I'm here" extras.
- **U-02** Never fill a gap with an invented rule. If a document is silent or contradictory, stop.
- **U-03** No spaghetti: no copy-pasted blocks, no duplicated logic, no flags that skip checks, no "temporary" bypasses, no `TODO: fix later` on a Never Rule, no catch-all `try/catch` hiding errors.
- **U-04** Never weaken a rule, delete a failing test, loosen a constraint, or mock away a check.
- **U-05** Never change a Locked choice or install an unlisted dependency.
- **U-06** No destructive commands (drop DB, delete migrations, force-push, rotate/print real secrets) without explicit approval.
- **U-07** If a task needs a later tier, say so and stop. No placeholders.
- **U-08** Never guess provider details (Flutterwave, email provider, Expo, FCM). Read current docs; record what you used.

Ask in this format and wait:
```
## Blocked: <title>
What I was doing: <task + PRD section>
What is unclear or conflicting: <exact quotes + document/section>
Options (max 3): A) … B) … C) …
My recommendation: <one option, why>
What I will NOT do until you answer: <list>
```
Plan before coding: state tier, PRD sections, rules touched, files to change. Then build exactly that, one bounded task at a time.
