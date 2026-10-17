/**
 * =============================================================================
 * Rota API — Subscriptions & Billing Service
 * =============================================================================
 * AGENTS.md §2.2, §3.1 (M-01 through M-15):
 * - Integer cents only. Never use floats or floating division.
 * - Calculate proration with floor(amount * remaining / period).
 * - Assert charge >= 0, throw PRORATION_NEGATIVE.
 * - Change classification: new_amount > current_amount -> immediate; else scheduled.
 * - Append-only ledger with signed amounts. Rebuild state from ledger.
 * - Quotes expire at min(30 min, period_end). Checkout charges exact quote amount.
 * =============================================================================
 */

import { subscriptionsRepo } from './subscriptions.repo.js';
import { calculateProration } from './proration.js';
import {
  PLAN_CONSTANTS,
  calculateRecurringAmountCents,
  type PlanName,
  type SubscriptionDto,
  type BillingQuoteDto,
  type BillingLedgerEntryDto,
} from '@rota/contracts';
import { defaultPaymentProvider } from '../../adapters/payments/flutterwave/index.js';
import { getShardDb } from '../../db/index.js';
import { config } from '../../config/env.js';

export interface CreateQuoteInput {
  teamId: string;
  plan: PlanName;
  purchasedSeats: number;
  effectiveAt?: Date;
}

export interface QuoteInputsData {
  plan: PlanName;
  purchasedSeats: number;
  isImmediate: boolean;
  currentRecurringCents: number;
  newRecurringCents: number;
  creditCents: number;
  costCents: number;
  periodStart: string;
  periodEnd: string;
  effectiveAt: string;
}

export class SubscriptionsService {
  constructor(private paymentProvider = defaultPaymentProvider) {}

  /**
   * Fetch current subscription for a team.
   */
  async getSubscription(teamId: string): Promise<SubscriptionDto> {
    const sub = await subscriptionsRepo.findSubscriptionByTeamId(teamId);
    if (!sub) {
      throw new Error(`Subscription not found for team ${teamId}`);
    }

    return {
      id: sub.id,
      teamId: sub.team_id,
      plan: sub.plan as PlanName,
      status: sub.status,
      currency: sub.currency,
      basePriceCents: sub.base_price_cents,
      includedSeats: sub.included_seats,
      extraSeatPriceCents: sub.extra_seat_price_cents,
      purchasedSeats: sub.purchased_seats,
      currentRecurringCents: sub.current_recurring_cents,
      scheduledPlan: (sub.scheduled_plan as PlanName) ?? null,
      scheduledPurchasedSeats: sub.scheduled_purchased_seats,
      scheduledEffectiveAt: sub.scheduled_effective_at ? sub.scheduled_effective_at.toISOString() : null,
      trialEndsAt: sub.trial_ends_at ? sub.trial_ends_at.toISOString() : null,
      periodStart: sub.period_start ? sub.period_start.toISOString() : null,
      periodEnd: sub.period_end ? sub.period_end.toISOString() : null,
      graceUntil: sub.grace_until ? sub.grace_until.toISOString() : null,
      createdAt: sub.created_at.toISOString(),
      updatedAt: sub.updated_at.toISOString(),
    };
  }

  /**
   * Get available plan constants.
   */
  getPlans() {
    return PLAN_CONSTANTS;
  }

  /**
   * Rule M-02, M-03, M-04, M-05, M-06, M-07:
   * Generate a billing quote with proration calculation and expiry.
   */
  async createQuote(input: CreateQuoteInput): Promise<BillingQuoteDto> {
    const { teamId, plan, purchasedSeats } = input;
    const effectiveAt = input.effectiveAt ?? new Date();

    // 1. Validate seat bounds and ceiling (AGENTS.md §2.2, M-02)
    const planConfig = PLAN_CONSTANTS[plan];
    if (!planConfig) {
      throw new Error(`Unknown plan: ${plan}`);
    }

    if (plan === 'starter' && purchasedSeats !== 5) {
      throw new Error('Starter plan must have exactly 5 seats');
    }
    if (plan === 'team') {
      if (purchasedSeats < 15 || purchasedSeats > 38) {
        throw new Error('Team plan seats must be between 15 and 38 (ceiling 38)');
      }
    }
    if (plan === 'business') {
      if (purchasedSeats < 40 || purchasedSeats > 100) {
        throw new Error('Business plan seats must be between 40 and 100 (ceiling 100)');
      }
    }

    const sub = await subscriptionsRepo.findSubscriptionByTeamId(teamId);
    if (!sub) {
      throw new Error(`Subscription not found for team ${teamId}`);
    }

    // 2. Classify change by cost (Rule M-05): new_amount > current_amount -> immediate; else scheduled
    const newRecurringCents = calculateRecurringAmountCents(plan, purchasedSeats);
    const currentRecurringCents = sub.current_recurring_cents;

    let periodStart = sub.period_start ?? effectiveAt;
    let periodEnd = sub.period_end ?? new Date(effectiveAt.getTime() + 30 * 24 * 60 * 60 * 1000);

    // If periodEnd is already passed or invalid, reset to 30 days ahead
    if (periodEnd.getTime() <= periodStart.getTime() || periodEnd.getTime() <= effectiveAt.getTime()) {
      periodStart = effectiveAt;
      periodEnd = new Date(effectiveAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    }

    const isImmediate = sub.status === 'trialing' || newRecurringCents > currentRecurringCents;

    let amountCents = 0;
    let creditCents = 0;
    let costCents = 0;

    if (isImmediate) {
      if (sub.status === 'trialing') {
        // First checkout from trial charges full period amount
        amountCents = newRecurringCents;
        costCents = newRecurringCents;
        creditCents = 0;
      } else {
        // Proration calculation (Rule M-03, M-04)
        const proration = calculateProration({
          currentRecurringCents,
          newRecurringCents,
          periodStart,
          periodEnd,
          effectiveAt,
        });
        amountCents = proration.chargeCents;
        creditCents = proration.creditCents;
        costCents = proration.costCents;
      }
    } else {
      // Downgrade / seat reduction: scheduled for period end (Rule M-05)
      amountCents = 0;
      creditCents = 0;
      costCents = 0;
    }

    // Rule M-07: Expires at earlier of 30 minutes or period end
    const thirtyMinutesLater = new Date(effectiveAt.getTime() + config.quoteExpiryMs);
    const expiresAt = thirtyMinutesLater < periodEnd ? thirtyMinutesLater : periodEnd;

    const quoteInputs: QuoteInputsData = {
      plan,
      purchasedSeats,
      isImmediate,
      currentRecurringCents,
      newRecurringCents,
      creditCents,
      costCents,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      effectiveAt: effectiveAt.toISOString(),
    };

    const savedQuote = await subscriptionsRepo.createBillingQuote({
      team_id: teamId,
      inputs: quoteInputs,
      amount_cents: amountCents,
      expires_at: expiresAt,
    });

    return {
      id: savedQuote.id,
      teamId: savedQuote.team_id,
      plan,
      purchasedSeats,
      isImmediate,
      amountCents: savedQuote.amount_cents,
      currentRecurringCents,
      newRecurringCents,
      creditCents,
      costCents,
      effectiveAt: effectiveAt.toISOString(),
      expiresAt: savedQuote.expires_at.toISOString(),
    };
  }

  /**
   * Rule M-07, M-11:
   * Create hosted checkout session charging exactly the quoted amount.
   */
  async createCheckout(params: {
    teamId: string;
    quoteId: string;
    idempotencyKey: string;
    userEmail: string;
    userName: string;
    redirectUrl?: string;
  }): Promise<{
    checkoutUrl: string;
    quoteId: string;
    amountCents: number;
    currency: string;
  }> {
    const quote = await subscriptionsRepo.findBillingQuoteById(params.quoteId);
    if (!quote) {
      throw new Error(`Quote ${params.quoteId} not found`);
    }

    if (quote.team_id !== params.teamId) {
      throw new Error('Quote does not belong to this team');
    }

    if (new Date() > quote.expires_at) {
      throw new Error('Billing quote has expired. Please generate a new quote.');
    }

    const inputs = quote.inputs as QuoteInputsData;

    // If change is not immediate (scheduled downgrade), schedule it directly
    if (!inputs.isImmediate) {
      const shardDb = getShardDb(params.teamId);
      await shardDb.transaction().execute(async (trx) => {
        await subscriptionsRepo.lockSubscriptionForUpdate(trx, params.teamId);
        await subscriptionsRepo.updateSubscription(trx, params.teamId, {
          scheduled_plan: inputs.plan,
          scheduled_purchased_seats: inputs.purchasedSeats,
          scheduled_effective_at: new Date(inputs.periodEnd),
        });
      });

      return {
        checkoutUrl: params.redirectUrl || 'https://rota.app/billing/scheduled',
        quoteId: quote.id,
        amountCents: 0,
        currency: 'USD',
      };
    }

    // Call payment provider to generate checkout session
    const checkoutResult = await this.paymentProvider.createCheckoutLink({
      teamId: params.teamId,
      quoteId: quote.id,
      amountCents: quote.amount_cents,
      currency: 'USD',
      customerEmail: params.userEmail,
      customerName: params.userName,
      redirectUrl: params.redirectUrl,
      idempotencyKey: params.idempotencyKey,
    });

    return {
      checkoutUrl: checkoutResult.checkoutUrl,
      quoteId: quote.id,
      amountCents: quote.amount_cents,
      currency: 'USD',
    };
  }

  /**
   * Rule M-08, M-10, M-12:
   * Process a confirmed payment from a verified webhook.
   * Updates subscription and writes append-only ledger row in one transaction.
   */
  async applyConfirmedPayment(params: {
    teamId: string;
    quoteId: string;
    providerEventId: string;
    providerRef?: string | undefined;
    cardToken?: string | undefined;
    customerEmail?: string | undefined;
  }): Promise<void> {
    const quote = await subscriptionsRepo.findBillingQuoteById(params.quoteId);
    if (!quote) {
      throw new Error(`Quote ${params.quoteId} not found for confirmed payment`);
    }

    const inputs = quote.inputs as QuoteInputsData;
    const planConfig = PLAN_CONSTANTS[inputs.plan];
    const shardDb = getShardDb(params.teamId);

    await shardDb.transaction().execute(async (trx) => {
      // 1. Lock subscription
      const sub = await subscriptionsRepo.lockSubscriptionForUpdate(trx, params.teamId);
      if (!sub) {
        throw new Error(`Subscription not found for team ${params.teamId}`);
      }

      // 2. Append ledger entry (Rule M-12: signed integer, append-only)
      await subscriptionsRepo.appendLedgerEntry(trx, {
        team_id: params.teamId,
        subscription_id: sub.id,
        entry_type: 'charge',
        amount_cents: quote.amount_cents,
        currency: 'USD',
        reason: `Payment for ${inputs.plan} plan (${inputs.purchasedSeats} seats)`,
        plan_after: inputs.plan,
        purchased_seats_after: inputs.purchasedSeats,
        period_start: new Date(inputs.periodStart),
        period_end: new Date(inputs.periodEnd),
        idempotency_key: `wh_${params.providerEventId}`,
        provider_reference: params.providerRef ?? null,
        metadata: JSON.stringify({
          quoteId: quote.id,
          providerEventId: params.providerEventId,
          creditCents: inputs.creditCents,
          costCents: inputs.costCents,
        }),
      });

      // 3. Update subscription (Rule M-06: update current_recurring_cents on every applied change)
      await subscriptionsRepo.updateSubscription(trx, params.teamId, {
        plan: inputs.plan,
        status: 'active',
        base_price_cents: planConfig.basePriceCents,
        included_seats: planConfig.includedSeats,
        extra_seat_price_cents: planConfig.extraSeatPriceCents,
        purchased_seats: inputs.purchasedSeats,
        current_recurring_cents: inputs.newRecurringCents,
        scheduled_plan: null,
        scheduled_purchased_seats: null,
        scheduled_effective_at: null,
        period_start: new Date(inputs.periodStart),
        period_end: new Date(inputs.periodEnd),
        grace_until: null,
        provider_customer_id: params.customerEmail ?? sub.provider_customer_id,
        provider_subscription_id: params.cardToken ?? sub.provider_subscription_id,
      });

      // 4. Record Activity Event (visibility: 'owner' per Rule A-08, D-05)
      await trx
        .insertInto('activity_events')
        .values({
          team_id: params.teamId,
          actor_membership_id: null,
          event_type: 'plan_changed',
          subject_type: 'subscription',
          subject_id: sub.id,
          params: JSON.stringify({
            plan: inputs.plan,
            purchasedSeats: inputs.purchasedSeats,
            amountCents: quote.amount_cents,
          }),
          visibility: 'owner',
          participant_membership_ids: [],
        })
        .execute();

      // 5. Domain Outbox Event
      await trx
        .insertInto('domain_outbox_events')
        .values({
          team_id: params.teamId,
          event_type: 'plan_changed',
          aggregate_type: 'subscription',
          aggregate_id: sub.id,
          payload: JSON.stringify({
            teamId: params.teamId,
            plan: inputs.plan,
            purchasedSeats: inputs.purchasedSeats,
            amountCents: quote.amount_cents,
          }),
          attempts: 0,
        })
        .execute();
    });
  }

  /**
   * Rule M-12: Downgrade writes a zero-amount adjustment row and updates subscription.
   */
  async applyScheduledDowngrade(teamId: string): Promise<void> {
    const shardDb = getShardDb(teamId);
    await shardDb.transaction().execute(async (trx) => {
      const sub = await subscriptionsRepo.lockSubscriptionForUpdate(trx, teamId);
      if (!sub || !sub.scheduled_plan || !sub.scheduled_purchased_seats) {
        return;
      }

      const newPlan = sub.scheduled_plan as PlanName;
      const newSeats = sub.scheduled_purchased_seats;
      const planConfig = PLAN_CONSTANTS[newPlan];
      const newRecurringCents = calculateRecurringAmountCents(newPlan, newSeats);

      const periodStart = sub.period_end ?? new Date();
      const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000);

      // Append zero-amount adjustment row
      await subscriptionsRepo.appendLedgerEntry(trx, {
        team_id: teamId,
        subscription_id: sub.id,
        entry_type: 'adjustment',
        amount_cents: 0,
        currency: 'USD',
        reason: `Scheduled downgrade to ${newPlan} plan (${newSeats} seats)`,
        plan_after: newPlan,
        purchased_seats_after: newSeats,
        period_start: periodStart,
        period_end: periodEnd,
        idempotency_key: `sched_${teamId}_${sub.scheduled_effective_at?.toISOString() ?? Date.now()}`,
        provider_reference: null,
        metadata: JSON.stringify({
          previousPlan: sub.plan,
          previousSeats: sub.purchased_seats,
        }),
      });

      // Update subscription
      await subscriptionsRepo.updateSubscription(trx, teamId, {
        plan: newPlan,
        base_price_cents: planConfig.basePriceCents,
        included_seats: planConfig.includedSeats,
        extra_seat_price_cents: planConfig.extraSeatPriceCents,
        purchased_seats: newSeats,
        current_recurring_cents: newRecurringCents,
        scheduled_plan: null,
        scheduled_purchased_seats: null,
        scheduled_effective_at: null,
        period_start: periodStart,
        period_end: periodEnd,
      });
    });
  }

  /**
   * List append-only ledger entries for a team.
   */
  async listLedger(teamId: string): Promise<BillingLedgerEntryDto[]> {
    const rows = await subscriptionsRepo.listLedgerEntries(teamId);
    return rows.map((r) => ({
      id: r.id,
      teamId: r.team_id,
      entryType: r.entry_type,
      amountCents: r.amount_cents,
      currency: r.currency,
      reason: r.reason,
      planAfter: r.plan_after as PlanName,
      purchasedSeatsAfter: r.purchased_seats_after,
      createdAt: r.created_at.toISOString(),
    }));
  }

  /**
   * Rule M-12: Verify that subscription state can be completely rebuilt from the ledger.
   */
  async verifyLedgerRebuild(teamId: string) {
    return await subscriptionsRepo.rebuildStateFromLedger(teamId);
  }
}

export const subscriptionsService = new SubscriptionsService();
