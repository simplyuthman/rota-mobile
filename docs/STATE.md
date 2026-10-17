# Rota State Management Document

## 1. State Locations & Classification

| Data | Location | Storage Type | Rationale | Wipe Condition |
|---|---|---|---|---|
| Access Token | Mobile Client | Expo SecureStore | 15-min JWT containing user ID and `sid`. Hardware keystore. | Logout, session revoked |
| Refresh Token | Mobile Client | Expo SecureStore | Rotated on every use. Hardware keystore. | Logout, session revoked |
| Active User / UI State | Mobile Client | Zustand | Transient client-only state (e.g. modal open, draft filters). | App reload / Logout |
| Server Entities (Shifts, Swaps, Roster) | Mobile Client | TanStack Query | Server cache with automated refetching and invalidation. | Logout |
| Offline Upcoming Shifts | Mobile Client | TanStack Query Persister (AsyncStorage) | Published shifts for next 30 days only; no notes (P-02). | Logout, user switch, stale > 14 days |
| Revoked Sessions | Backend | Redis Cache (`sid` set) | 15-minute TTL matching access token lifespan. | Expired by TTL |
| Rate Limits | Backend | Redis Cache | Sliding window counter with TTL. | Expired by TTL |
| Persistent Data | Backend | PostgreSQL (Control + Shards) | Authoritative source of truth for all business entities. | Append-only or soft-delete |

## 2. Cross-Device Settings & Conflict Resolution
- Settings updates use `PATCH` of changed fields only (P-08).
- Each accepted field is stamped with `field_updated_at` on the server.
- Field-level last-write-wins is applied per field rather than whole-row replacement (e.g. tablet changing theme does not overwrite phone quiet hours).
- **Documented weakness**: A stale device that has been offline can still overwrite the same field after it reconnects if its mutation is submitted without checking the remote `version` or `field_updated_at`.

## 3. Query Cache & Invalidation
- Calendar views: `team:{id}:cal:pub:{start}:{end}:v{n}` (D-03).
- Team cache version is bumped in the request transaction immediately upon shift publish/update.
- First feed page (newest 50 events) is cached in Redis for 30 seconds.

## 4. Subscription, Billing, and Ledger State (Tier 5)
- **Append-only ledger**: `billing_ledger_entries` stores signed amounts (`charge` +, `credit/refund` -, and zero-amount `adjustment` rows for downgrades). Rows are never updated or deleted (Rule M-12).
- **State Rebuild**: Authoritative plan and purchased seats can be fully reconstructed by walking the ledger in chronological order (`rebuildStateFromLedger`).
- **No Caching (Rule M-13)**: Subscription state, payment status, credit balances, and webhook idempotency records are never cached in Redis or client-side stores.
- **Hourly Billing Scheduler (Rule M-14, M-15)**:
  - Applies scheduled downgrades at period end.
  - Initiates recurring renewals via tokenized charges.
  - Transitions failed renewals to `grace` (exactly 7 days).
  - Transitions expired grace and unpaid 14-day trials to `restricted` (read-only scheduling).
  - Restrictions are derived strictly from `subscriptions.status`, never touching `teams.status`.

## 5. Offline Cache & Privacy State (Tier 6)
- **Persisted Query (Rule P-02)**: Only ONE query is persisted over AsyncStorage via `@tanstack/react-query-persist-client`: upcoming published shifts assigned to the current user in the next 30 days (`['shifts', 'upcoming', teamId, membershipId]`).
- **Strict Privacy Sanitization (Rule P-02)**: Minimal fields only (`id`, `teamId`, `title`, `locationLabel`, `startsAt`, `endsAt`, `status`, `assignedMembershipId`). The `notes` field is strictly omitted. Draft shifts and colleague shifts are never stored offline.
- **Expiry & Hide Guarantee (Rule P-02)**: If the last successful sync is older than 14 days (`MAX_CACHE_AGE_MS = 14 * 24 * 60 * 60 * 1000`), the cache is hidden and "Reconnect to refresh" is displayed.
- **Wipe Invariants (Rule P-01)**: The cache is completely wiped from AsyncStorage on user sign-out, session revocation (401), refresh token failure, and when a different user ID is detected.
- **No Offline Writes (Rule P-03)**: Writing offline is strictly disabled. Settings edits, shift creation, shift publishing, shift cancellations, and swap interactions are guarded and rejected with user alerts when offline.

## 6. Push Notifications & Tap-To-Open Router State (Tier 7)
- **Database As Source of Truth (Rule L-02)**: `notification_jobs` on the shard database is the authoritative source of truth. Background workers/BullMQ only execute.
- **Idempotency & Deduplication (Rule L-02)**: Unique composite constraint `UNIQUE (outbox_event_id, user_id, category)` prevents duplicate job enqueueing on repeated outbox relay events.
- **Payload Privacy Invariant (Rule P-05)**: Push payload data contains strictly `{type, teamId, entityId}` only. Shift notes, manager notes, customer card tokens, and billing quote secrets are never permitted in push payloads.
- **Device Token Lifecycle (Rule P-04)**:
  - `POST /me/push-tokens` upserts by `(provider, token_hash)` and reassigns `user_id` when different users sign into the same shared phone.
  - `DELETE /me/push-tokens/:token` deactivates the device push token on user logout.
  - `authService.logoutAll()` deactivates all push tokens registered to the user across all devices.
- **Server Quiet Hours Enforcement (Rule P-06)**: Quiet hours are evaluated on the server in the recipient's validated IANA time zone inside the notification worker. Standard notifications outside waking hours are delayed until quiet hours end. Urgent security events (sign-in, logout-all, password change) immediately bypass quiet hours.
- **Digest Collapse (Rule L-02)**: Delayed items sharing a `collapse_key` (`digest:${userId}:${category}`) collapse into a single push notification upon release, marking older superseded pending jobs `cancelled` with `last_error_code='collapsed'`.
- **Pre-Send Re-Check (Rule L-02)**: Before dispatching push notifications, the worker re-reads the underlying database entity. If a shift was cancelled or a swap expired while delayed, the job is marked `cancelled` with `stale_entity_cancelled` and no push is transmitted.
- **Tap-To-Open Routing (Rule P-05)**: Handled across cold start, background, and foreground states. Automatically switches the client's active team context if `payload.teamId !== selectedTeamId` before deep linking to the target shift, swap, activity feed, or billing modal.
## 7. Pooling, Caching, Sharding, and Replication Routing (Tier 8)
- **PostgreSQL Pool Sizing & Timeouts**:
  - Control plane: `max: 10`
  - Shards 0 & 1 primary: `max: 20`
  - Shards 0 & 1 read replica: `max: 20`
  - Connection timeout: 5,000 ms; statement timeout: 10,000 ms; idle timeout: 30,000 ms.
- **Read-Your-Own-Writes Guarantee (TRD §2, AGENTS.md §2.2)**:
  - 5 seconds after a user write (`POST`, `PUT`, `PATCH`, `DELETE` returning 2xx), that user's read requests bypass read replicas and route directly to the primary database (`getShardDb`).
  - After the 5-second window elapses, read requests automatically return to the read replica (`getShardReadDb`).
  - Response header `x-read-source: primary | replica` is returned on all reads to expose data origin.
- **Multi-Tier Redis Caching Strategy (Rules D-03, D-04)**:
  - Published calendar cache: `team:{id}:cal:pub:{start}:{end}:v{n}` with 300s TTL (published shifts only, notes stripped, drafts never cached).
  - Tenant roster cache: `team:{id}:roster:v{n}` with 300s TTL (accelerates tenant membership lookup without touching PostgreSQL on cache hits).
  - Feed first-page cache: `team:{id}:feed:first:v{n}` with 30s TTL (newest 50 raw events per team, in-memory viewer filtered per role, fallback to DB if filtered rows < limit).
  - Cache versioning: atomic version bump via `bumpTeamCacheVersion(teamId)` increments `team:{id}:version`, simultaneously invalidating calendar, roster, and feed first-page caches.
- **Deterministic Two-Shard Routing**:
  - Teams are deterministically partitioned across `rota_shard_0` and `rota_shard_1` using CRC-32 mod 2, recorded in the control plane `team_directory(team_id, shard_id)`.
  - Zero cross-database foreign keys (enforced in database schema and test T8-04).
- **Rule S-08 Rate Limits**:
  - Sliding-window Redis counters per account and IP returning HTTP 429 and `Retry-After`:
    - Login: 5/min per account, 30/min per IP
    - Password reset: 3/hour per email, 10/hour per IP
    - Invites: 20/hour per team
    - Checkout: 5/hour per team
    - Feed: 60/min per user

## 8. Hardening, Security, Accessibility & Production Readiness State (Phase 9)
- **Design Tokens & Accessibility Gate (P0 Gate)**:
  - Zero raw colors (`#hex`, `rgba`, `hsla`), zero named colors (`white`, `black`, `transparent`), zero primitives outside `src/theme/`, zero raw typography (`fontSize`, `lineHeight`), zero raw spacing numbers, and zero disabled font scaling (`allowFontScaling={false}`).
  - WCAG AAA/AA relative luminance contrast: all text foreground/background pairs exceed $\ge 4.5:1$ across both Light and Dark themes (e.g. `onSurface/surface` 16.99:1 in light, 13.96:1 in dark).
  - Minimum touch targets: interactive elements guarantee at least $44 \times 44$ pt (`theme.touchTarget = 48 pt`).
  - Screen reader & TalkBack support: accessibility roles and labels across all buttons, inputs, switches, and modal dialogs.
- **Sentry & Logger Scrubbing (Rules O-01, O-03)**:
  - Sentry `beforeSend` hook and Pino logger redaction sanitize sensitive data before logging or transmission:
    - Authorization headers, bearer tokens, passwords, push tokens.
    - Credit card numbers, CVVs, provider payment secrets.
    - Shift notes and manager comments (Rules O-01, O-03).
  - Sentry DSN is safely exposed in client (`EXPO_PUBLIC_SENTRY_DSN`), while Sentry Auth Token remains strictly on the server or CI/CD secrets.
- **Security Threat Model Invariants (8 Core Threats)**:
  - 1. **Cross-Team Data Leakage**: Strictly scoped by `team_id` in SQL and directory routing; composite foreign keys `(team_id, id)`.
  - 2. **Privilege Escalation**: Centralized server-side authorization; staff hidden from draft shifts, shift notes, and billing records; Owner role is immutable (`409 OWNER_IMMUTABLE`).
  - 3. **Stolen Tokens**: 15-minute access tokens with `sid` claim; Redis revocation blacklist (`auth:revoked:${sid}`) checked on every authenticated request; refresh token rotation.
  - 4. **Reset & Magic Link Replay**: Tokens stored SHA-256 hashed; single-use consumption; timing-safe comparison; uniform responses to prevent account enumeration.
  - 5. **Webhook Spoofing & Duplicates**: HMAC signature verification before parsing payload; deduplication via control plane `payment_webhook_events`.
  - 6. **Secrets in Bundles & Logs**: Zero secrets in client bundle or Git repository; `EXPO_PUBLIC_` audit; Pino and Sentry redaction.
  - 7. **Brute Force & Abuse**: Multi-tier sliding-window Redis rate limits per account and per IP.
  - 8. **Shared-Phone Cache & Push Leaks**: Single-query 30-day offline cache with notes stripped; cache wiped on logout/user change; push payloads restricted to `{type, teamId, entityId}`; quiet hours enforced on server.
- **App Store In-App Purchase Architecture & B2B SaaS Modeling**:
  - Digital subscriptions sold directly inside mobile apps are subject to Apple In-App Purchase (StoreKit 2) and Google Play Billing (15–30% platform commission).
  - Multi-platform B2B / SaaS tools operating on team-seat pricing commonly utilize web-based administrative management or native store billing adapters.
  - Test mode Flutterwave payment adapter models the complete asynchronous subscription lifecycle (tokenized card charges, webhooks, proration, append-only ledger) without violating store distribution terms for unreviewed binaries.

