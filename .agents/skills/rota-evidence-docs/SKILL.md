---
name: rota-evidence-docs
description: Write the Rota graduation evidence documents - README (including the app-store billing section), ARCHITECTURE.md, STATE.md, SECURITY.md (8 threats plus EXPO_PUBLIC audit), SHARDING.md, LEARNING-LOG.md. Use when producing or updating any of these docs or preparing delivery.
---

# Evidence documents

Write each as you build, not at the end. Be specific and honest; no unmeasured claims.

- **README.md** — top screen: one-line description, GIF, Android dev build link, demo video link. Then: run locally, env setup (names from `.env.example`), tests, deploy, **a section on how Apple/Google app-store billing rules would affect Rota in production** (digital subscriptions sold inside an app may need the store's in-app purchase system; this task uses Flutterwave in test mode and is not published to stores).
- **ARCHITECTURE.md** — component diagram, data flow, pool size and why, read/write routing with read-your-own-writes (5 s) and the second read connection string, cache-aside strategy, the two Redis instances, repeatable jobs, and the **payment-trail walkthrough** (how to answer "what happened to this user's payment at 3:14pm?" from logs and the ledger).
- **STATE.md** — every important piece of data: where it lives (TanStack Query / Zustand / AsyncStorage persister / SecureStore / server) and why; the settings conflict rule and its weakness; query cache times and rationale.
- **SECURITY.md** — at least **8 threats** and how each is handled: cross-team leakage; privilege escalation incl. staff reading drafts/billing events; stolen access/refresh token (15-min tokens, `sid` set, rotation, Redis-flush window); reset/magic/invite token replay; webhook spoofing and duplicates; secrets in bundle/logs; brute force and abuse; shared-phone cache and push tokens. Plus the **`EXPO_PUBLIC_` audit**: list every variable and why it is safe to expose (the Sentry DSN is public by design; a Sentry auth token never is). Link the permission, team-isolation, and proration test results.
- **SHARDING.md** — shard key `team_id` and why; stable hash; control plane contents; routing for login, invites, webhooks; which queries became harder (cross-shard reports); how to handle a very large team (dedicated shard, time partitioning); when the key fails (hot shard).
- **LEARNING-LOG.md** — after AI helps you build something, close the chat and write a short paragraph in your own words explaining it. Date each entry. Do not paste AI output.
- **docs/decisions/** — one record per major choice (see rota-decision-record).
- **load-tests/REPORT.md** — see rota-load-test.
- Deliverables list: public repo(s), deployed backend, Android dev build link, architecture diagram, test results (permissions, team isolation, proration), 3-minute demo, one LinkedIn post about a decision.
