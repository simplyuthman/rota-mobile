/**
 * =============================================================================
 * Rota API — Billing Scheduler
 * =============================================================================
 * AGENTS.md §2.2, §3.1 (M-14, M-15), §3.2 (A-11):
 * - Hourly repeatable scheduler (M-14).
 * - Applies scheduled plan changes / downgrades at period end.
 * - Attempts recurring card token renewals.
 * - Failed renewal gives exactly 7 days of grace, then sets status = 'restricted'.
 * - Expired unpaid trial (14 days) sets status = 'restricted'.
 * - Restriction derived from subscriptions.status; never touches teams.status (M-15).
 * =============================================================================
 */

import { shard0, shard1, getShardDb } from '../../db/index.js';
import { subscriptionsRepo } from './subscriptions.repo.js';
import { subscriptionsService } from './subscriptions.service.js';
import { defaultPaymentProvider } from '../../adapters/payments/flutterwave/index.js';
import { config } from '../../config/env.js';

export interface SchedulerExecutionResult {
  downgradesApplied: number;
  renewalsAttempted: number;
  renewalsSucceeded: number;
  renewalsFailedToGrace: number;
  graceRestricted: number;
  trialsRestricted: number;
}

export class BillingScheduler {
  constructor(private paymentProvider = defaultPaymentProvider) {}

  /**
   * Run one iteration of the hourly billing scheduler across both shards.
   */
  async runTick(now: Date = new Date()): Promise<SchedulerExecutionResult> {
    const shards = [shard0, shard1];
    const result: SchedulerExecutionResult = {
      downgradesApplied: 0,
      renewalsAttempted: 0,
      renewalsSucceeded: 0,
      renewalsFailedToGrace: 0,
      graceRestricted: 0,
      trialsRestricted: 0,
    };

    for (const shardDb of shards) {
      // 1. Apply scheduled changes / downgrades
      const dueChanges = await subscriptionsRepo.findDueScheduledChanges(shardDb, now);
      for (const sub of dueChanges) {
        try {
          await subscriptionsService.applyScheduledDowngrade(sub.team_id);
          result.downgradesApplied++;
        } catch {
          // Log and continue
        }
      }

      // 2. Process renewals for active subscriptions whose period has ended
      const dueRenewals = await subscriptionsRepo.findDueRenewals(shardDb, now);
      for (const sub of dueRenewals) {
        result.renewalsAttempted++;
        const token = sub.provider_subscription_id;

        if (token) {
          try {
            const chargeResult = await this.paymentProvider.chargeToken({
              token,
              amountCents: sub.current_recurring_cents,
              currency: sub.currency,
              idempotencyKey: `renew_${sub.team_id}_${sub.period_end?.toISOString() ?? now.toISOString()}`,
              txRef: `renew_${sub.team_id.slice(0, 8)}_${now.getTime()}`,
              email: sub.provider_customer_id ?? 'billing@rota.app',
            });

            if (chargeResult.status === 'success') {
              const periodStart = sub.period_end ?? now;
              const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000);

              const teamShardDb = getShardDb(sub.team_id);
              await teamShardDb.transaction().execute(async (trx) => {
                await subscriptionsRepo.appendLedgerEntry(trx, {
                  team_id: sub.team_id,
                  subscription_id: sub.id,
                  entry_type: 'charge',
                  amount_cents: sub.current_recurring_cents,
                  currency: sub.currency,
                  reason: `Subscription renewal (${sub.plan} plan, ${sub.purchased_seats} seats)`,
                  plan_after: sub.plan,
                  purchased_seats_after: sub.purchased_seats,
                  period_start: periodStart,
                  period_end: periodEnd,
                  idempotency_key: `renew_ledger_${sub.team_id}_${periodStart.toISOString()}`,
                  provider_reference: chargeResult.transactionId,
                  metadata: JSON.stringify({ renewal: true }),
                });

                await subscriptionsRepo.updateSubscription(trx, sub.team_id, {
                  period_start: periodStart,
                  period_end: periodEnd,
                  grace_until: null,
                });
              });

              result.renewalsSucceeded++;
              continue;
            }
          } catch {
            // charge failed
          }
        }

        // Renewal failed or no card token -> enter 7-day grace period (Rule M-15)
        const graceUntil = new Date(now.getTime() + config.gracePeriodMs);
        const teamShardDb = getShardDb(sub.team_id);
        await subscriptionsRepo.updateSubscription(teamShardDb, sub.team_id, {
          status: 'grace',
          grace_until: graceUntil,
        });
        result.renewalsFailedToGrace++;
      }

      // 3. Move expired grace subscriptions to restricted (Rule M-14, M-15)
      const expiredGrace = await subscriptionsRepo.findExpiredGraceSubscriptions(shardDb, now);
      for (const sub of expiredGrace) {
        const teamShardDb = getShardDb(sub.team_id);
        await subscriptionsRepo.updateSubscription(teamShardDb, sub.team_id, {
          status: 'restricted',
        });
        result.graceRestricted++;
      }

      // 4. Move expired trials to restricted (Rule A-11)
      const expiredTrials = await subscriptionsRepo.findExpiredTrials(shardDb, now);
      for (const sub of expiredTrials) {
        const teamShardDb = getShardDb(sub.team_id);
        await subscriptionsRepo.updateSubscription(teamShardDb, sub.team_id, {
          status: 'restricted',
        });
        result.trialsRestricted++;
      }
    }

    return result;
  }
}

export const billingScheduler = new BillingScheduler();
