# Decision Record 002 — Transactional Email Provider: Resend

**Status:** Accepted  
**Date:** 2026-10-15  
**Deciders:** Project owner  
**PRD reference:** §12 (decision register); AGENTS.md §2.3 #2  

---

## Context

Rota requires a transactional email provider to send:
- Email verification codes (signup flow)
- Magic link sign-in emails
- Password-reset links
- Invitation emails (with the deep-link and invite code)
- Billing notifications (failed renewal, trial expiry, grace period warnings)

AGENTS.md requires one provider to be recorded in `docs/decisions/` before any email code is written.

Three candidates were evaluated:

| Criterion | Resend | Postmark | SendGrid |
|---|---|---|---|
| Node SDK | ✅ First-class, modern | ✅ Mature | ✅ Mature |
| API simplicity | ✅ Minimal, typed, `async/await` | ✅ Straightforward | ⚠️ More complex |
| Free tier | ✅ 3,000 emails/month, 100/day | ⚠️ No free tier (paid only) | ✅ 100/day |
| React Email support | ✅ Native | ✅ Via wrapper | ✅ Via wrapper |
| Deliverability | ✅ Excellent | ✅ Industry benchmark | ✅ Solid |
| Onboarding speed | ✅ Instant API key, no domain required for dev | ✅ Requires domain setup | ✅ Requires domain setup |
| Webhook for bounces | ✅ Yes | ✅ Yes | ✅ Yes |

---

## Decision

**Resend** is the chosen transactional email provider.

Reasoning:
1. **Modern Node SDK.** The SDK is TypeScript-first with full type inference, no callback patterns, and a clean `async/await` interface — consistent with the project's codebase style.
2. **Generous free tier.** 3,000 emails/month is sufficient for development and MVP launch. Postmark has no free tier, which would require a paid account before any email can be tested.
3. **No domain setup required for development.** Resend can send from their shared domain during development; custom domain is added before production. This removes a Phase 1 blocker.
4. **Fast onboarding.** An API key is available immediately after account creation, letting Phase 1 work proceed without waiting for DNS propagation.
5. **React Email native support.** Resend is the team behind React Email, so email templates render correctly without a custom wrapper.

---

## Adapter contract

All Resend-specific code is isolated inside `services/api/src/adapters/email/`. The rest of the backend calls the provider-neutral interface:

```typescript
interface EmailAdapter {
  sendVerificationCode(to: string, code: string): Promise<void>;
  sendMagicLink(to: string, link: string): Promise<void>;
  sendPasswordReset(to: string, link: string): Promise<void>;
  sendInvitation(to: string, link: string, code: string, teamName: string): Promise<void>;
  sendBillingAlert(to: string, type: BillingAlertType, params: BillingAlertParams): Promise<void>;
}
```

The Resend adapter implements this interface. Swapping providers requires only replacing the adapter file.

---

## Consequences

- `RESEND_API_KEY` is a server-only secret — never in `EXPO_PUBLIC_` variables, never in the app bundle.
- Email templates are authored using React Email components inside `adapters/email/templates/`.
- Bounce and complaint webhooks from Resend are received at `POST /webhooks/email` and logged (no blocking action required for MVP).
- This record is referenced in the email adapter header and in `SECURITY.md`.
