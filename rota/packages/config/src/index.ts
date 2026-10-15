/**
 * =============================================================================
 * Rota Config — Shared Plan Constants & System Limits
 * =============================================================================
 * AGENTS.md §2.2 & M-02:
 * Exact plan prices in cents and seat ceilings.
 * Never hardcode a price anywhere except the single plan-constants module.
 */

export interface PlanConfig {
  readonly id: 'starter' | 'team' | 'business';
  readonly name: string;
  readonly basePriceCents: number;
  readonly includedSeats: number;
  readonly extraSeatPriceCents: number;
  readonly maxSeatsCeiling: number;
}

export const PLAN_CONFIGS: Record<'starter' | 'team' | 'business', PlanConfig> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    basePriceCents: 2000, // $20.00
    includedSeats: 5,
    extraSeatPriceCents: 0, // no extras allowed
    maxSeatsCeiling: 5,
  },
  team: {
    id: 'team',
    name: 'Team',
    basePriceCents: 5000, // $50.00
    includedSeats: 15,
    extraSeatPriceCents: 300, // $3.00 per extra seat
    maxSeatsCeiling: 38,
  },
  business: {
    id: 'business',
    name: 'Business',
    basePriceCents: 12000, // $120.00
    includedSeats: 40,
    extraSeatPriceCents: 200, // $2.00 per extra seat
    maxSeatsCeiling: 100,
  },
} as const;

export const TRIAL_DURATION_DAYS = 14;
export const GRACE_PERIOD_DAYS = 7;
export const MAX_SHIFT_DURATION_HOURS = 24;
export const ACCESS_TOKEN_TTL_SECONDS = 900; // 15 minutes
