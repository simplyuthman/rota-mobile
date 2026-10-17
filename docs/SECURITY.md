# Rota Security Analysis & Threat Model

This document establishes the authoritative threat model, mitigation strategies, and environment variable security audit for **Rota** (Mobile Task A graduation build). Every security control is mapped directly to PRD/AGENTS.md rules and proven by automated regression test suites.

---

## 1. Threat Analysis (8 Core Threats)

### Threat 1: Cross-Team Data Leakage & Shard Escapes (Rule A-02)
- **Attack Vector**: An authenticated user belonging to Team A crafts an API request specifying `teamId` of Team B, attempting to read shift rosters, swap histories, or membership records.
- **Mitigation**:
  1. Shard connections are segregated: teams are partitioned across two discrete PostgreSQL databases (`rota_shard_0` and `rota_shard_1`).
  2. The Fastify `requireTeamMember` middleware verifies that the authenticated user holds an active membership row in the target team before routing.
  3. All database queries on tenant tables strictly scope records by `WHERE team_id = :teamId` derived from the validated server session, never trusting client input.
  4. Same-team integrity is enforced in database schemas via `UNIQUE (team_id, id)` and composite foreign keys `(team_id, x_id)`.
- **Test Evidence**: `tests/tier2-evidence.test.ts` (cross-team isolation), `tests/tier8-evidence.test.ts` (T8-04 zero cross-DB foreign keys), and `tests/tier9-evidence.test.ts` (T9-02 cross-team rejection returns HTTP 403 `FORBIDDEN`).

### Threat 2: Privilege Escalation & Role Visibility Leaks (Rules A-01, A-04, A-07)
- **Attack Vector**: A Staff member invokes mutation routes (`POST /shifts`, `PATCH /shifts/:id`, `DELETE /shifts/:id`) or attempts to view private draft schedules, shift notes, or owner billing ledger rows. Alternatively, an owner attempts to demote themselves or transfer ownership.
- **Mitigation**:
  1. Server-side role authorization: All permissions are enforced in Fastify route preHandlers via the centralized authorization service (`requireRole(['owner', 'manager'])`).
  2. Staff visibility filtering (Rule A-07): Staff listing shifts only receive published shifts; drafts are filtered out in SQL, and the `notes` column is omitted from response DTOs (`toPublicShiftDto`).
  3. Owner immutability (Rule A-04): The Owner role cannot change their own role, deactivate their membership, or assign another Owner (returns HTTP 409 `OWNER_IMMUTABLE`).
- **Test Evidence**: `tests/tier2-evidence.test.ts` (owner immutability), `tests/tier3-evidence.test.ts` (staff mutation rejection), `tests/tier8-evidence.test.ts` (T8-06 feed role isolation), and `tests/tier9-evidence.test.ts` (T9-03 staff drafts and notes hidden).

### Threat 3: Stolen Access & Refresh Tokens (Rules S-02, S-03, S-04, S-05)
- **Attack Vector**: An attacker extracts an access or refresh token from a compromised device and attempts unauthorized API access after the user has logged out.
- **Mitigation**:
  1. Short-lived access tokens: JWTs expire in strictly 15 minutes and include a `sid` claim (representing the session's `token_family_id`).
  2. Instant Redis revocation: On logout or logout-all, revoked `sid` values are written to Redis (`auth:revoked:${sid}`) with a 15-minute TTL. Every authenticated request checks this key before processing.
  3. Single in-flight refresh promise (Rule S-05): Concurrent 401s on mobile share a single refresh mutex, preventing race conditions or accidental double-revocation.
  4. Refresh token rotation (Rule S-04): Refresh tokens are single-use; replay of an already-consumed refresh token immediately revokes the entire token family.
  5. Hardware token storage (Rule S-02): Mobile client stores tokens exclusively in hardware-backed `Expo SecureStore` (Android Keystore / iOS Keychain), never `AsyncStorage`.
- **Test Evidence**: `tests/tier2-evidence.test.ts` (refresh rotation and family revocation) and `tests/tier9-evidence.test.ts` (T9-04 revoked `sid` check returns HTTP 401 `UNAUTHORIZED`).

### Threat 4: Reset & Magic Link Token Replay / Enumeration (Rules S-06, S-07, S-09)
- **Attack Vector**: An attacker attempts brute-force token enumeration, replays an expired password-reset link, or inspects API responses to discover registered email addresses.
- **Mitigation**:
  1. Cryptographic token hashing (Rule S-06): Invitation tokens, magic links, and password-reset tokens are stored as 64-character SHA-256 hashes (`token_hash`) in PostgreSQL. Raw tokens are transmitted once to the user's verified email and never stored in plaintext.
  2. Single-use and short TTL: Tokens are atomically consumed and marked used upon verification, with strict expiry (15m for reset, 24h for invites).
  3. Uniform timing-safe responses (Rule S-09): `POST /v1/auth/password-reset` and `POST /v1/auth/magic-link` return identical success responses regardless of whether the requested email address exists in the database, defeating user enumeration attacks.
- **Test Evidence**: `tests/tier2-evidence.test.ts` (single-use token invalidation) and `tests/tier9-evidence.test.ts` (T9-05 tokens stored SHA-256 hashed).

### Threat 5: Webhook Spoofing & Duplicate Processing (Rules M-08, M-09, M-10)
- **Attack Vector**: An attacker spoofs incoming HTTP POST requests to `/v1/webhooks/payments/flutterwave`, attempting to activate subscriptions without payment, or Flutterwave delivers the same webhook multiple times causing duplicate seat credits.
- **Mitigation**:
  1. Pre-deserialization signature verification (Rule M-09): Flutterwave webhook signature header (`verif-hash`) is validated against secret HMAC keys *before* reading or deserializing the request body. Unsigned or invalid requests are rejected with HTTP 401 `INVALID_SIGNATURE`.
  2. Global event deduplication (Rule M-10): Provider event IDs are recorded in the control plane's unique `payment_webhook_events(provider, provider_event_id)` table. Repeated deliveries are recognized as duplicate no-ops and safely ignored without double-crediting.
  3. Server-side payment confirmation only (Rule M-08): The mobile app cannot mark payments successful; only signature-verified webhook events processed by the worker confirm payments.
- **Test Evidence**: `tests/tier7-evidence.test.ts` (webhook signature verification and idempotency) and `tests/tier9-evidence.test.ts` (T9-06 signature rejection and unique deduplication constraint).

### Threat 6: Leaked Secrets in Client Bundles or Application Logs (Rules S-01, O-01, O-03)
- **Attack Vector**: Sensitive credentials (database URLs, Flutterwave secret keys, JWT signing secrets, employee shift notes) leak into client JavaScript bundles, crash reports, or production server logs.
- **Mitigation**:
  1. Zero server secrets in client bundle (Rule S-01): The mobile build `.env.example` contains only public endpoints. No API keys, database credentials, or secret keys are accessible to the app.
  2. Pino log redaction (Rule O-01): Server logs automatically redact `req.headers.authorization`, `req.headers.cookie`, `password`, `token`, `refreshToken`, `notes`, `cardNumber`, and `secret`.
  3. Sentry beforeSend scrubber (Rule O-03): Server and mobile Sentry clients pass all events through `sentryBeforeSendHook` (`src/utils/sentryScrubber.ts`), stripping bearer tokens, passwords, push tokens, and private shift notes.
- **Test Evidence**: `tests/tier9-evidence.test.ts` (T9-01 Sentry scrubber redacts headers, tokens, push tokens, notes; T9-07 `EXPO_PUBLIC_` audit).

### Threat 7: Brute Force & Rate Limit Abuse (Rule S-08)
- **Attack Vector**: Automated bots attempt credential stuffing, password spray attacks, checkout quote flooding, or activity feed scrape abuse.
- **Mitigation**:
  1. Distributed Redis sliding-window rate limiting: Keys are maintained in Redis instance #1 and tracked concurrently per account AND per IP address.
  2. Exact numeric quotas:
     - Login: 5 / min per account, 30 / min per IP
     - Password reset: 3 / hour per email, 10 / hour per IP
     - Team invitations: 20 / hour per team
     - Checkout creations: 5 / hour per team
     - Activity feed reads: 60 / min per user
  3. Standardized HTTP 429 response with `Retry-After` header indicating remaining cooldown in seconds.
- **Test Evidence**: `tests/tier8-evidence.test.ts` (T8-07 sliding-window 429 and `Retry-After` verification).

### Threat 8: Shared-Phone Cache & Notification Leakage (Rules P-01, P-02, P-04, P-05)
- **Attack Vector**: Restaurant staff share a communal device. Staff Member A signs out, and Staff Member B logs in, or a colleague views notification previews on the lock screen containing sensitive shift notes or colleague wages.
- **Mitigation**:
  1. Persisted cache wipe (Rule P-01): On logout, session revocation (401), refresh token failure, or user change, the TanStack Query AsyncStorage shift cache is purged.
  2. Minimal cache fields (Rule P-02): Only published shifts assigned to the active user for the next 30 days are cached; shift notes and colleague shifts are never stored offline.
  3. Push payload privacy (Rule P-05): Notification payloads contain strictly `{ type, teamId, entityId }`. Notes, employee names, and billing details are never sent in push payloads.
  4. Device push token lifecycle (Rule P-04): On logout and logout-all, device push tokens are deactivated on the server. `POST /me/push-tokens` upserts by token and reassigns `user_id` when different users sign into the same device.
- **Test Evidence**: `tests/tier6-evidence.test.ts` (offline cache wipe and sanitization) and `tests/tier7-evidence.test.ts` (push token lifecycle and payload privacy).

---

## 2. EXPO_PUBLIC_ Environment Variable Audit

Every variable exposed with the `EXPO_PUBLIC_` prefix is bundled directly into client JavaScript. Below is the full security audit:

| Variable Name | Environment | Purpose | Security Justification |
|---|---|---|---|
| `EXPO_PUBLIC_API_URL` | Client | Base URL for the Rota backend API (e.g. `http://10.0.2.2:3000/v1` in dev, `https://api.rota.app/v1` in prod). | Public URL required for client-to-server HTTP communication. Does not contain credentials or secret tokens. |
| `EXPO_PUBLIC_SENTRY_DSN` | Client | Sentry Data Source Name for mobile crash reporting and performance monitoring. | Public by design in Sentry's client architecture. Sentry uses the DSN solely to route incoming error envelopes; it cannot be used to read or modify project data. Never includes a Sentry auth token (Rule O-03). |

### Verification Guarantee
- No database URLs (`DATABASE_CONTROL_URL`, `DATABASE_SHARD0_URL`, `DATABASE_SHARD1_URL`) exist in `apps/mobile/`.
- No payment secrets (`FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_WEBHOOK_SECRET`) exist in `apps/mobile/`.
- No JWT signing secrets (`JWT_SECRET`) exist in `apps/mobile/`.
- Proven by automated test `T9-07` in `tests/tier9-evidence.test.ts`.
