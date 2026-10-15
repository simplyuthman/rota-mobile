# Rule 00 — Project core (Rota)

> **Activation:** Always On. Full detail lives in `@../../AGENTS.md`. If this file and AGENTS.md ever differ, stop and ask (rule 60).

You are building **Rota**: a mobile shift-scheduling app (Owner, Manager, Staff) with per-seat monthly billing. Target: restaurants and cafés with 5–40 staff. Build the **MVP only**. Verified platform: **Android development build**. iOS is not verified; never claim iOS support.

## Source of truth
`docs/PRD.md` is the source of truth for behaviour. Cite PRD sections (e.g. "PRD §6.2") in commits and PRs.
Precedence on conflict: AGENTS.md and these rules → PRD → TRD → BACKEND-SCHEMA → APP-FLOW → DESIGN-SYSTEM → IMPLEMENTATION-PLAN. If that list does not settle a conflict, stop and ask.

## Locked (never change, swap, or "improve")
- Mobile: React Native + Expo + TypeScript strict, Expo Router, EAS Build (Android).
- Mobile state: TanStack Query for all server data; Zustand for transient UI state only; AsyncStorage persister for one query (upcoming shifts); Expo SecureStore for tokens.
- Lists: FlashList. Push: Expo Notifications + FCM v1.
- Backend: Node.js Active LTS (pinned in `.nvmrc`) + TypeScript strict + Fastify + Zod on every input.
- Database: PostgreSQL, SQL-first layer (Kysely or Drizzle), SQL migrations. **Never Prisma.**
- Databases: one control-plane DB + two shard DBs. No foreign key across them.
- Redis: two instances. Cache (TTL on every key) and queue (BullMQ, `noeviction`).
- **Payments: Flutterwave, test mode only, behind an adapter. Not Paystack. Not Stripe.**
- Sign-in: email/password + email magic link. No Google sign-in.
- Passwords: Argon2id. Deep links: `https` Android App Links. Load tests: k6.
- Error tracking: **Sentry** on both the server and the app (see rule 35).
- Locked policies: direct-handoff swaps with colleague consent; only the Owner invites; overlaps always blocked; trial 14 days on Starter limits, no card; grace 7 days; seats are purchased capacity.

## Pending decisions — do not guess
Check `docs/decisions/` first. If a record is missing, **stop and ask**:
1. Kysely vs Drizzle. 2. Transactional email provider. 3. Flutterwave provider check (Phase 7 gate): test mode supports USD, saved-card recurring charges, signed webhooks, and a Node SDK or documented REST API. Never invent a Flutterwave endpoint, field, header, or signature scheme from memory.

## Work order
Follow the scope tiers in `docs/IMPLEMENTATION-PLAN.md` §1 in order (1 auth/roles/isolation → 2 shifts+swap → 3 feed → 4 settings/quiet hours → 5 proration/webhooks/ledger → 6 offline → 7 push → 8 pool/cache/shard/load). A tier ends only when its evidence exists. Never start a later tier early.

## Non-goals (never build)
Payroll, time clock, AI scheduling, web console, multi-location, open swap offers, two-way trades, ownership transfer, Google sign-in, overlap overrides or settings, shift breaks, offline writes, second UI language, iOS verification, an `industry` field. Never add a dependency or service not listed above without a decision record and the user's approval.
