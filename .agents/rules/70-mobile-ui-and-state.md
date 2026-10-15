# Rule 70 — Mobile UI, state, accessibility

> **Activation:** Glob — `apps/mobile/**`. Breaking any rule fails the task.

- **L-08** Server data lives in TanStack Query. Never copy it into Zustand. Zustand = transient UI state only.
- **L-11** UI is built from design-system components that use design tokens only. No raw color, font size, spacing, radius, or shadow values in screens. Tokens live in `src/theme/` (see `docs/DESIGN-SYSTEM.md`).
- Optimistic updates (swap requests, settings) must snapshot → apply → rollback on error → refetch. Disable the button while pending.
- Offline: show cached upcoming shifts with a visible "Last updated" time and offline indicator; disable all writes (P-03); wipe per P-01; hide per P-02.
- Navigation: **five tabs only** — Schedule, Activity, Requests, Team, Settings. Billing is an Owner-only screen inside Team. Never add a sixth tab.
- Feed: FlashList, infinite scroll, pull-to-refresh, guard against duplicate in-flight page requests, and explicit loading / empty / end / error states.
- Payment screens never claim success until the server reports webhook-confirmed state. Show the quote; the charge equals the quote.
- Staff UI never renders drafts, notes, or billing events (the server also enforces this).
- Language row appears only when a second language ships. Settings controls are disabled offline ("Connect to change settings").
- Push tap routing: `shift → shifts/[entityId]`, `swap → swaps/[entityId]`, `billing → team/billing` (Owner), `activity → Activity tab`. Handle cold start, background, foreground; switch team first if needed.
- Auth client: one shared in-flight refresh promise (S-05). Tokens only in SecureStore (S-02).

## Accessibility gate (P0 — every interactive element)
1. Accessibility label. 2. Touch target ≥ 44×44 pt. 3. Text contrast ≥ 4.5:1. 4. Layout survives the largest system font size. Verify with TalkBack (VoiceOver only if an iOS device is available). Never use color alone for status. Respect reduced motion.
