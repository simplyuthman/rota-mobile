# Rule 10 — Money and billing

> **Activation:** Model Decision (apply when touching billing, subscriptions, seats, checkout, webhooks, ledger, pricing, trials). Breaking any rule here fails the task even if the feature works. Every rule needs a test.

- **M-01** Store every amount in cents as a whole number. Never decimals, floats, or float division for money.
- **M-02** Use exact plan constants. Define prices **only** in one plan-constants module.
- **M-03** Calculate proration on the server yourself. Never delegate it to Flutterwave. `floor` on both credit and cost. Tests inject the clock.
- **M-04** No `max(0, …)` on a charge. Assert; throw `PRORATION_NEGATIVE` if an immediate charge is below zero.
- **M-05** Classify changes by cost, never plan name. `new_amount > current_amount` → immediate, applies only after confirmed payment. Otherwise schedule for period end.
- **M-06** For two or more changes in one period, credit the recurring amount currently in effect; update `current_recurring_cents` on every applied change.
- **M-07** Create a `billing_quotes` row before checkout. Charge exactly the quoted amount; never recompute. Quote expires at the earlier of 30 minutes or period end.
- **M-08** Never mark payment successful from the app, a return URL, or a redirect. Only a signature-verified webhook processed by the worker confirms payment.
- **M-09** Verify the Flutterwave webhook signature **before** parsing or processing. Reject on failure. No bypass flag, not even in tests (tests sign real fixtures).
- **M-10** Store each provider event ID in control-plane `payment_webhook_events` (unique per provider). Repeats are no-ops.
- **M-11** Idempotency key on every payment request; a repeated key returns the stored result.
- **M-12** Ledger is append-only. Never UPDATE/DELETE. Signed amounts (charges +, credits/refunds −). Every row has `plan_after` and `purchased_seats_after`. A downgrade writes a zero-amount adjustment row. Subscription state must be rebuildable from the ledger.
- **M-13** Never cache subscription state, payment status, balances, or webhook idempotency records.
- **M-14** Renewals, scheduled downgrades, trial end, past_due→grace→restricted all run from the **hourly billing scheduler**. Never depend on a webhook for those transitions.
- **M-15** Failed renewal: exactly 7 days grace, notify the Owner, then read-only. Restriction derives from `subscriptions.status`; never write billing values into `teams.status`.

## Constants (cents)
| Plan | Base | Included | Extra seat | Ceiling |
|---|---:|---:|---:|---:|
| Starter | 2000 | 5 | n/a | 5 |
| Team | 5000 | 15 | 300 | 38 |
| Business | 12000 | 40 | 200 | 100 (operational ceiling, not an entitlement) |

`recurring_amount(plan, seats) = base + max(0, seats − included) × extra`
`remaining_seconds = period_end − effective_at`; `period_seconds = period_end − period_start`
`credit = floor(current_recurring × remaining / period)`; `cost = floor(new_recurring × remaining / period)`; `charge = cost − credit` (assert ≥ 0).

## Pinned test vectors (must pass)
- Starter→Team at 20 of 30 days: credit 1333, cost 3333, charge 2000.
- Team 15→18 seats at 12 of 30 days: credit 2000, cost 2360, charge 360.
At least 8 proration tests: upgrade, downgrade, add seats, remove seats, first day, last day, two changes in one period, plus `PRORATION_NEGATIVE`.

## Trial and states
New team: `trialing`, Starter limits, 14 days, no card. First confirmed checkout → `active`. Unpaid trial → `restricted` (read-only). Statuses: trialing, active, past_due, grace, restricted, cancelled.
