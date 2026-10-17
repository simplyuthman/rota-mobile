# ADR 003: Flutterwave Provider Check and Integration Strategy

## Status
Accepted

## Context
Per AGENTS.md §2.1, §2.3, §3.1 (Rules M-01 to M-15), and `rota-flutterwave-webhooks` skill, Rota uses Flutterwave in test mode behind an isolated adapter (`services/api/src/adapters/payments/flutterwave/`).

The Phase 7 gate requires confirming four capabilities in Flutterwave test mode:
1. **USD currency support**: Flutterwave test accounts support USD transactions and card payments using test card numbers.
2. **Saved-card (tokenized) recurring charges**: Flutterwave issues reusable card tokens upon successful initial checkout (returned in `data.card.token`), which can subsequently be charged via the tokenized charge endpoint (`POST /v3/tokenized-charges`).
3. **Signed webhooks**: Flutterwave signs webhook deliveries using a secret hash sent in the `verif-hash` HTTP request header. Verification is performed using constant-time equality check (`crypto.timingSafeEqual`) against the server's configured `FLUTTERWAVE_SECRET_HASH` prior to reading or parsing the payload.
4. **Documented REST API**: Standard REST v3 API endpoints:
   - Hosted Payment Checkout Link: `POST https://api.flutterwave.com/v3/payments`
   - Tokenized Charge: `POST https://api.flutterwave.com/v3/tokenized-charges`
   - Transaction Verification: `GET https://api.flutterwave.com/v3/transactions/:id/verify`

## Decision
1. Implement `FlutterwaveAdapter` implementing `PaymentProvider` interface in `services/api/src/adapters/payments/flutterwave/`.
2. Signature verification strictly uses `verif-hash` header compared via `crypto.timingSafeEqual`.
3. Amounts in the Rota system are strictly integer cents (e.g. 2000 cents for $20.00). When calling Flutterwave's API, the amount is converted to standard units (`(amountCents / 100).toFixed(2)`), and Flutterwave returns the decimal amount which is converted back to whole cents via `Math.round(data.amount * 100)`.
4. Control plane stores quotes in `billing_quotes` with 30-minute expiry (M-07). Checkout charges exactly the quote amount.
5. Global deduplication is enforced by `payment_webhook_events(provider, provider_event_id)` (M-10). Duplicate events are acknowledged with HTTP 200 and marked `ignored_duplicate`.
6. Subscription updates and append-only ledger entries (`billing_ledger_entries`) are committed in a single database transaction on the shard.
7. Mobile app never marks payment success directly; all updates originate from signature-verified webhooks processed by the backend worker.

## Consequences
- Clean separation of provider details from the rest of the application.
- Fully idempotent payment and webhook lifecycle.
- Strict enforcement of PRD §6.8 and AGENTS.md §3.1.
