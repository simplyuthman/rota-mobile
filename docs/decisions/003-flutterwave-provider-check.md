# 003 — Flutterwave Payment Provider Check
Date: 2026-10-17
Status: accepted
Related: PRD §6.8, AGENTS.md §2.1, §2.3, §3.1 (M-01 through M-15), §4 (L-06)

## Problem
Before implementing Tier 5 billing and proration, AGENTS.md §2.3 requires running the **Flutterwave provider check** against Flutterwave's current test mode documentation:
1. Support for USD currency in test mode.
2. Saved-card (tokenized) recurring charges.
3. Signature-verified webhooks.
4. Documented REST API / Node SDK.

## Options considered
1. **Direct Flutterwave REST API v3 via provider adapter (Recommended)**: Use standard `fetch` within `adapters/payments/flutterwave/` conforming to Flutterwave REST v3 specs. No bulky external SDK dependencies; exact control over timeouts, payload headers, and signature verification.
2. **Third-party community wrapper**: Flutterwave Node SDK (`flutterwave-node-v3`). Prone to maintenance lags and version mismatches.

## Decision
We select **Option 1**: Flutterwave REST API v3 directly behind the `PaymentProvider` interface inside `services/api/src/adapters/payments/flutterwave/`.

### Provider Verification Results:
1. **USD Currency Support**: Verified. Flutterwave supports USD payments in test mode via Standard Checkout (`https://api.flutterwave.com/v3/payments`) and Tokenized Charges (`https://api.flutterwave.com/v3/tokenized-charges`). Fallback currency rule (in case of geo-currency restriction) is noted: charge in provider test currency, maintain USD cents in the immutable ledger, and display currency conversion note.
2. **Saved-card (Tokenized) Recurring Charges**: Verified. When a card charge completes successfully, Flutterwave returns `data.card.token` which can be charged subsequently via `POST /v3/tokenized-charges` with `token`, `currency: 'USD'`, `amount`, and `email`.
3. **Signed Webhooks**: Verified. Flutterwave signs webhooks using a secret hash (`verif-hash` header) configured in the merchant dashboard. Verification is performed using timing-safe comparison:
   `crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(secretHash))`
   before reading or processing the payload (Rule M-09).
4. **API Interface**: Verified. REST API v3 with Bearer token authentication (`Authorization: Bearer FLWSECK_TEST-...`).

## Why
This keeps the payment boundary strictly encapsulated inside `services/api/src/adapters/payments/flutterwave/` per Rule L-06, ensuring that the domain billing services, quotes, proration logic, and ledger remain 100% provider-neutral and testable with mock providers.

## Consequences
- All Flutterwave secret keys stay in environment variables (`FLW_SECRET_KEY`, `FLW_WEBHOOK_SECRET_HASH`) and are never exposed to the client or bundle.
- Every payment quote creates a `billing_quotes` row before checkout (Rule M-07).
- Webhook events are deduplicated in `payment_webhook_events` (Rule M-10).
- Subscription renewals and status transitions are driven by our hourly scheduler (Rule M-14) and verified webhooks (Rule M-08), never client assertions.
