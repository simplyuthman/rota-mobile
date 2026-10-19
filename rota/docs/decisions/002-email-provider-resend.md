# ADR 002: Transactional Email Provider — Resend

## Status
Accepted

## Date
2026-10-16

## Context
AGENTS.md §2.1 locks the email layer to "one transactional email provider, recorded in `docs/decisions/`". AGENTS.md §2.3 requires this record to exist before touching email code.

## Options Considered
- **A) Resend** — modern transactional email API by the ex-Plaid team. Clean TypeScript SDK, simple API, generous free tier, React Email support.
- **B) SendGrid** — established provider, more complex setup and pricing.
- **C) Postmark** — strong deliverability, excellent for transactional email.

## Decision
**Resend** was chosen for the following reasons:
1. **Native TypeScript SDK**: `resend` npm package provides a fully typed client with zero ceremony.
2. **Simplicity**: Single `resend.emails.send()` call with a clean payload object.
3. **Free tier**: Generous for development/testing (100 emails/day free).
4. **Adapter isolation**: All Resend knowledge is strictly contained in `services/api/src/adapters/email/`. The rest of the application calls a provider-neutral `EmailProvider` interface.
5. **Fast onboarding**: No MX record management or complex setup required for test-mode use.

## Record of Use
- `resend` v6+ is installed in `services/api/package.json`.
- The email adapter lives in `services/api/src/adapters/email/`.
- Sends: invitation emails, password-reset links, magic-link sign-in, email verification codes.
- All send calls are enqueued as background jobs (Rule L-01) — never sent inside a request handler.
- Environment variable: `RESEND_API_KEY` (server-side only, never exposed in mobile bundle — Rule S-01).

## Consequences
- Switching providers requires only replacing the adapter (`adapters/email/`) and the env var.
- No other module knows about Resend.
