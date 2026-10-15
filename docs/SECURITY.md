# Rota Security Analysis & Threat Model

## 1. Threat Analysis (8 Core Threats)

### Threat 1: Cross-Team Data Leakage (A-02)
- **Mitigation**: Every database query on shard tables strictly enforces `WHERE team_id = :team_id` derived from the validated server-side session membership, never from client input. Cross-shard queries are structurally prevented by per-shard database connections.

### Threat 2: Privilege Escalation & Unauthorized Access (A-01, A-04, A-07)
- **Mitigation**: All authorization logic runs on the Fastify backend via a centralized authorization service. Staff users are forbidden from viewing shift notes, draft shifts, or billing records. The Owner role is immutable (cannot deactivate self, change role, or assign another Owner).

### Threat 3: Stolen Access / Refresh Tokens (S-02, S-03, S-04, S-05)
- **Mitigation**: Access tokens expire in 15 minutes and include a `sid` claim. Revocation (on logout or compromise) writes `sid` to a Redis blacklist with a 15-minute TTL. Refresh tokens are rotated on every use; reuse of an old token revokes the entire token family. Mobile tokens are stored in hardware-backed `Expo SecureStore`, never `AsyncStorage`.

### Threat 4: Reset / Magic Link Token Replay (S-06, S-07, S-09)
- **Mitigation**: All authentication and invitation tokens are stored cryptographically hashed (SHA-256). Tokens are single-use with short expiration. Magic link responses return identical messages whether an account exists or not to prevent user enumeration.

### Threat 5: Webhook Spoofing & Duplicate Processing (M-08, M-09, M-10)
- **Mitigation**: Flutterwave webhook signatures are validated against secret HMAC keys before payload deserialization. Every provider event ID is recorded in the control plane's unique `payment_webhook_events` table; duplicate events are discarded immediately as no-ops.

### Threat 6: Leaked Secrets in Client Bundles or Logs (S-01, O-01, O-03)
- **Mitigation**: Backend logs use Pino with automatic redaction of `authorization`, `password`, `token`, and sensitive fields. Sentry client and server integrations strip tokens and shift notes before dispatch. No backend secrets are embedded in the client build.

### Threat 7: Brute Force & Rate Limit Abuse (S-08)
- **Mitigation**: Sliding-window Redis-based rate limiting enforced per IP and per account:
  - Login: 5/min per account, 30/min per IP
  - Password reset: 3/hour per email, 10/hour per IP
  - Team invites: 20/hour per team
  - Checkout: 5/hour per team
  - Feed: 60/min per user

### Threat 8: Shared-Phone Cache & Notification Leakage (P-01, P-02, P-05)
- **Mitigation**: Push notification payloads contain only `{ type, teamId, entityId }` — never employee names, shift notes, or amounts. On user logout, the local AsyncStorage shift cache is purged and the push device token is deactivated on the server.

---

## 2. EXPO_PUBLIC_ Audit

| Variable Name | Purpose | Security Justification |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | Base HTTPS URL for the Rota backend API. | Public URL required for client-to-server HTTP communication. Does not contain any secrets. |
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry Data Source Name for mobile crash reporting. | Public by design in Sentry architecture. Sentry uses the DSN only to route incoming error events; it does not grant administrative or read access to project data. Never includes a Sentry auth token. |
