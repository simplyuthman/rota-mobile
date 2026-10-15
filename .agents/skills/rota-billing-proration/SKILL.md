---
name: rota-billing-proration
description: Implement Rota subscription plans, seat ceilings, proration, billing quotes, change classification, the billing scheduler, trial, grace, and the immutable ledger. Use for any pricing, plan change, seat purchase, renewal, or ledger code.
---

# Billing and proration

## Constants (cents, single module)
Starter 2000 / 5 incl / no extras / ceiling 5. Team 5000 / 15 incl / 300 extra / ceiling 38. Business 12000 / 40 incl / 200 extra / ceiling 100 (operational ceiling).
`recurring_amount(plan, seats) = base + max(0, seats − included) × extra`.
Team above 38 seats is rejected: at 39 it would cost 12,200 vs Business 12,000.

## Change flow
1. Compute `new_amount`. **If `new_amount > current_amount` → immediate** (applies only after confirmed payment). **Else → scheduled** (`scheduled_plan`, `scheduled_purchased_seats`, `scheduled_effective_at`) for period end. Never classify by plan name.
2. Proration for immediate changes (injected clock):
   - `remaining_seconds = period_end − effective_at`; `period_seconds = period_end − period_start`
   - `credit = floor(current_recurring_cents × remaining / period)`; `cost = floor(new_recurring_cents × remaining / period)`; `charge = cost − credit`
   - **Assert `charge ≥ 0`, else throw `PRORATION_NEGATIVE`.** No `max(0, …)`. Net rounding error ≤ 1 cent; document it.
3. Create a **`billing_quotes`** row (inputs, `amount_cents`, `expires_at` = earlier of 30 min or period end). Checkout charges **exactly** the quoted amount.
4. Two or more changes in a period: credit uses `current_recurring_cents`; each applied change updates it.

## Ledger
Append-only, signed (charge +, credit/refund −), each row has `plan_after` and `purchased_seats_after`. A downgrade writes a zero-amount `adjustment` row. State must rebuild from the ledger (write the rebuild test). Never UPDATE/DELETE.

## Billing scheduler (one repeatable job, hourly)
Applies scheduled changes at period end; starts renewal charges; moves `past_due → grace → restricted` when `grace_until` passes; ends trials. Grace = **7 days**, notify the Owner. Restriction derives from `subscriptions.status`; never write billing values into `teams.status`.

## Trial
New team `trialing` on Starter limits for 14 days, no card. First confirmed checkout → `active`. Unpaid trial → `restricted` (read-only). Cheapest fallback if time is short: `trialing` with no end date in MVP (say so in the PRD).

## Tests (≥ 8)
Pinned: Starter→Team at 20/30 days = 1333 / 3333 / 2000. Team 15→18 seats at 12/30 days = 2000 / 2360 / 360. Plus downgrade scheduled, remove seats scheduled, first day, last day, two changes in one period, `PRORATION_NEGATIVE` fires, Team cap 38 enforced, quote equals charge, scheduler transitions, ledger rebuild.
