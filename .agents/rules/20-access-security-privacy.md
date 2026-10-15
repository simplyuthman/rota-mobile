# Rule 20 — Access control, sessions, secrets, privacy

> **Activation:** Always On. Breaking any rule here fails the task even if the feature works. Each needs a test.

## Who may do what
- **A-01** Enforce every permission on the server. A Staff user calling delete/cancel shift directly must be rejected (test it).
- **A-02** Scope every team-owned query by `team_id` from the authenticated membership. Never trust a client `teamId`. Team A must never reach Team B data (test it).
- **A-03** Use the shared authorization service. No ad-hoc role checks in handlers.
- **A-04** Owner is protected: cannot change own role, deactivate self, or set another member to Owner → `409 OWNER_IMMUTABLE`. Test all three. The unique index is a backstop only.
- **A-05** Only the Owner invites.
- **A-06** Seats: one transaction, `SELECT … FOR UPDATE` on the subscription row, count active memberships (Owner and Managers count), `409 SEAT_LIMIT` at `purchased_seats`. No counter column. Pending invites never reserve seats. Two simultaneous accepts on the last seat → exactly one success.
- **A-07** Staff never see drafts or notes. Managers/Owner see everything.
- **A-08** Every activity event has `visibility` (`team|managers|owner|participants`); filter in the server cursor query. Billing events `owner`; swap events `participants` (listed people + owner + managers). Never filter on the client.
- **A-09** Overlaps always blocked, no override. `pg_advisory_xact_lock(hashtextextended(membership_id::text, 0))` before the check, inside the transaction.
- **A-10** Swaps: direct handoff to one colleague → colleague accepts/declines → manager approves only after acceptance. Approver is never requester or target (exception: Owner requester with no manager, tagged `self_approved`). One pending swap per shift+requester (partial unique index). Expires at shift start or 7 days; cancelling a shift expires its pending swaps in the same transaction. Approval = one transaction with row locks and re-check.
- **A-11** Trial rules per rule 10.

## Sessions, tokens, secrets
- **S-01** No secret in repo, app bundle, or `EXPO_PUBLIC_*`. Keep `.env.example` (names only). List every `EXPO_PUBLIC_` variable in `SECURITY.md` with why it is safe.
- **S-02** Tokens only in Expo SecureStore. Never AsyncStorage. Never log tokens, passwords, reset/magic links, payment secrets.
- **S-03** Access token 15 minutes with `sid` claim (= session `token_family_id`). Logout/logout-all write revoked `sid`s to the Redis revoked set (15-min TTL); every authenticated request checks it.
- **S-04** Rotate refresh token each use; reject a consumed token and revoke its family.
- **S-05** Mobile refreshes through one shared in-flight promise.
- **S-06** Invitation, reset, magic-link, verification tokens: always stored hashed. Invitation token = `{teamId}.{random}`.
- **S-07** Email-bound invite requires a verified email. Magic link counts as verified; password sign-up verifies with a one-time code.
- **S-08** Rate limit in Redis (sliding window, `429` + `Retry-After`), per account AND per IP: Login 5/min acct, 30/min IP; Password reset 3/hour email, 10/hour IP; Invites 20/hour team; Checkout 5/hour team; Feed 60/min user.
- **S-09** Password-reset and magic-link requests respond identically whether or not the email exists.

## Privacy on shared phones and in notifications
- **P-01** Wipe the persisted shift cache on logout, session revocation, refresh failure, and user change.
- **P-02** Persist only published shifts assigned to the user in the next 30 days: time, title, location, status. No notes. Hide a cache older than 14 days since last sync ("Reconnect to refresh").
- **P-03** No writes offline (settings, swaps, shifts). Never queue offline writes.
- **P-04** Deactivate the push token on logout/logout-all. `POST /me/push-tokens` upserts by token and reassigns `user_id`.
- **P-05** Push payload is only `{type, teamId, entityId}`. No notes, no billing detail. Tapping opens the exact screen (cold start, background, foreground).
- **P-06** Quiet hours enforced by the server worker in the user's time zone. Only security events (new sign-in, logout-all, password change) bypass them.
- **P-07** Time zone initialised from the device on first launch, validated as IANA. Never default to `UTC`.
- **P-08** Settings `PATCH` sends changed fields only; server stamps each in `field_updated_at`. Never accept a whole-object overwrite.
