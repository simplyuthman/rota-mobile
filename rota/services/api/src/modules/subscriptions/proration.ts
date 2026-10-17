/**
 * =============================================================================
 * Rota API — Subscription Proration Calculator
 * =============================================================================
 * AGENTS.md §3.1 (M-01, M-03, M-04, M-05, M-06):
 * - Store every amount in integer cents. Never use floating-point arithmetic.
 * - Calculate proration using seconds: floor(amount * remaining / period).
 * - Throw PRORATION_NEGATIVE if charge < 0. Never swallow a negative with max(0, ...).
 * - Pinned vectors:
 *   1. Starter -> Team at 20/30 days remaining = 1333 credit / 3333 cost / 2000 charge.
 *   2. Team 15 -> 18 seats at 12/30 days remaining = 2000 credit / 2360 cost / 360 charge.
 * =============================================================================
 */

export class ProrationNegativeError extends Error {
  constructor(message = 'PRORATION_NEGATIVE: Calculated immediate charge is below zero') {
    super(message);
    this.name = 'ProrationNegativeError';
  }
}

export interface ProrationCalculationInput {
  currentRecurringCents: number;
  newRecurringCents: number;
  periodStart: Date;
  periodEnd: Date;
  effectiveAt?: Date;
}

export interface ProrationCalculationResult {
  creditCents: number;
  costCents: number;
  chargeCents: number;
  remainingSeconds: number;
  periodSeconds: number;
}

export function calculateProration(
  input: ProrationCalculationInput
): ProrationCalculationResult {
  const effectiveAt = input.effectiveAt ?? new Date();

  // Validate period bounds
  const periodStartMs = input.periodStart.getTime();
  const periodEndMs = input.periodEnd.getTime();
  const effectiveAtMs = effectiveAt.getTime();

  if (periodEndMs <= periodStartMs) {
    throw new Error('Invalid billing period: periodEnd must be after periodStart');
  }

  const periodSeconds = Math.max(1, Math.floor((periodEndMs - periodStartMs) / 1000));
  const remainingSeconds = Math.max(
    0,
    Math.min(periodSeconds, Math.floor((periodEndMs - effectiveAtMs) / 1000))
  );

  // Rule M-03: floor on both credit and cost with integer arithmetic
  // credit = floor(current_recurring_cents * remaining / period)
  // cost   = floor(new_recurring_cents * remaining / period)
  const creditCents = Math.floor(
    (input.currentRecurringCents * remainingSeconds) / periodSeconds
  );
  const costCents = Math.floor(
    (input.newRecurringCents * remainingSeconds) / periodSeconds
  );
  const chargeCents = costCents - creditCents;

  // Rule M-04: Assert charge >= 0, else throw PRORATION_NEGATIVE. No max(0, ...).
  if (chargeCents < 0) {
    throw new ProrationNegativeError(
      `PRORATION_NEGATIVE: immediate charge is ${chargeCents} cents (cost: ${costCents}, credit: ${creditCents})`
    );
  }

  return {
    creditCents,
    costCents,
    chargeCents,
    remainingSeconds,
    periodSeconds,
  };
}
