---
name: rota-flutterwave-webhooks
description: Implement the Rota Flutterwave payment adapter, test-mode checkout, signature-verified webhook endpoint, global event dedupe, background processing, and ledger posting. Use for any Flutterwave, checkout, or payment webhook work.
---

# Flutterwave checkout and webhooks

**Provider is Flutterwave, test mode only. Never Paystack or Stripe.**

## Before writing code
- Confirm `docs/decisions/` has the **Flutterwave provider check** (USD, saved-card recurring charges, signed webhooks, Node SDK or documented REST API). If not, stop and ask.
- **Read Flutterwave's current documentation.** Never invent an endpoint, request field, webhook header, or signature scheme from memory. Record the pages and the verification method in a decision record.

## Boundaries
- All Flutterwave knowledge lives in `services/api/src/adapters/payments/flutterwave/`. The rest of the code uses a provider-neutral interface (create checkout, verify webhook, parse event).
- The Flutterwave **secret key and webhook secret are server env vars**, never `EXPO_PUBLIC_*`, never in the app, never logged. Update `.env.example` with names only.

## Checkout
1. Owner requests a quote (`billing_quotes`). 2. `POST …/billing/checkout` takes the quote id. 3. Rate limit 5/hour per team. 4. Send an **idempotency key**; a repeated key returns the stored result (`idempotency_keys`). 5. Charge **exactly the quoted amount**. 6. Put `team_id` (and quote id) in the provider's checkout metadata so the webhook can route to a shard.

## Webhook endpoint (`POST /v1/webhooks/payments/flutterwave`)
1. **Verify the signature first**, on the raw body, before parsing or trusting anything. Fail → reject, log without payload secrets.
2. Insert into control-plane `payment_webhook_events` with `UNIQUE (provider, provider_event_id)`. A duplicate → mark `ignored_duplicate`, return success, do nothing else.
3. Enqueue a processing job and **return quickly** (L-01).
4. The worker finds the shard from `team_id`, then in one transaction appends the signed ledger row (`plan_after`, `purchased_seats_after`), updates the subscription, writes the activity event (visibility `owner`) and outbox event, and marks the event `processed`. Failures retry with exponential backoff, then dead-letter.
5. The app and a return URL never confirm payment (M-08). The UI shows server state only.

## Tests required
Bad signature rejected; same event three times → one ledger effect; worker retry is idempotent; checkout charges the quote amount; app cannot set payment success; ledger rebuilds subscription state; no secret in the bundle.
