---
name: rota-auth-session
description: Implement or change Rota authentication, sessions, tokens, magic links, password reset, email verification, invitations, logout-all, or the mobile token refresh logic. Use for any auth, session, SecureStore, or invite-link work.
---

# Auth and sessions

## Server
- Passwords: Argon2id. Sign-in: password or **email magic link**. No Google.
- **Access token: 15 minutes, claim `sid` = session `token_family_id`.**
- **Refresh token:** opaque, random, hash stored, rotated on every use. A consumed token is rejected and its whole family revoked.
- **Logout / logout-all:** revoke sessions in the database, write the revoked `sid`s to the Redis revoked set (`auth:revoked:{sid}`, 15-min TTL), deactivate the device push token. Every authenticated request checks the set. Document that a Redis flush leaves a stolen access token alive for at most 15 minutes (put it in `SECURITY.md`).
- **`auth_tokens`** (kinds `password_reset`, `magic_link`, `email_verify_code`): random, single-use, expiring, **always hashed**; count attempts for one-time codes.
- **Invitations:** Owner only; token `{teamId}.{random}`, hashed; expiring; single-use. Accepting an email-bound invite needs a **verified email**. Accept inside the seat-limit transaction (see rota-concurrency-transactions).
- Reset and magic-link requests return the same response whether or not the email exists.
- Rate limits (Redis, per account AND per IP): login 5/min acct + 30/min IP; reset 3/hour email + 10/hour IP; invites 20/hour team.
- Never log tokens, links, or passwords.

## Mobile
- Tokens only in **Expo SecureStore**.
- **One shared in-flight refresh promise**: parallel 401s await the same refresh. Never start two.
- If refresh fails, or the server reports the session revoked: clear tokens, **wipe the persisted shift cache**, route to sign-in.
- If the signed-in user changes, wipe the cache before loading.
- Links are `https` App Links. A dev build has no deferred deep links, so provide the **"Enter invite code" screen** (the code is the same token). Fresh install: install, then re-tap the link or enter the code.
- On first launch send the device IANA time zone to initialise settings.

## Tests required
Refresh replay rejected; parallel 401s trigger one refresh; logout-all revokes `sid`; reset/magic tokens expire and are single-use; raw tokens never in the database; unverified email cannot accept an email-bound invite.
