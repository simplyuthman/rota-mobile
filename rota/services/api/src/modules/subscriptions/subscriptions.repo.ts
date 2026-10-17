/**
 * =============================================================================
 * Rota API — Subscriptions & Billing Repository
 * =============================================================================
 * AGENTS.md §2.2, §3.1 (M-01 through M-15), §4 (L-05):
 * - Control plane: billing_quotes, payment_webhook_events
 * - Shards: subscriptions, billing_ledger_entries (append-only)
 * - State rebuild from ledger (M-12)
 * =============================================================================
 */

import { controlPlane, getShardDb } from '../../db/index.js';
import type {
  Subscription,
  NewBillingQuote,
  BillingQuote,
  NewPaymentWebhookEvent,
  PaymentWebhookEvent,
  BillingLedgerEntry,
  NewBillingLedgerEntry,
  ShardDB,
  SubscriptionsTable,
} from '../../db/schema.js';
import type { Kysely, Transaction, Updateable } from 'kysely';

export const subscriptionsRepo = {
  // ─── Subscriptions (Shard) ──────────────────────────────────────────────────

  async findSubscriptionByTeamId(teamId: string): Promise<Subscription | undefined> {
    const shardDb = getShardDb(teamId);
    return await shardDb
      .selectFrom('subscriptions')
      .selectAll()
      .where('team_id', '=', teamId)
      .executeTakeFirst();
  },

  async lockSubscriptionForUpdate(
    trx: Transaction<ShardDB>,
    teamId: string
  ): Promise<Subscription | undefined> {
    return await trx
      .selectFrom('subscriptions')
      .selectAll()
      .where('team_id', '=', teamId)
      .forUpdate()
      .executeTakeFirst();
  },

  async updateSubscription(
    dbOrTrx: Kysely<ShardDB> | Transaction<ShardDB>,
    teamId: string,
    updates: Updateable<SubscriptionsTable>
  ): Promise<Subscription> {
    return await dbOrTrx
      .updateTable('subscriptions')
      .set({
        ...updates,
        updated_at: new Date(),
      })
      .where('team_id', '=', teamId)
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  // ─── Billing Quotes (Control Plane) ─────────────────────────────────────────

  async createBillingQuote(quote: NewBillingQuote): Promise<BillingQuote> {
    return await controlPlane
      .insertInto('billing_quotes')
      .values(quote)
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  async findBillingQuoteById(quoteId: string): Promise<BillingQuote | undefined> {
    return await controlPlane
      .selectFrom('billing_quotes')
      .selectAll()
      .where('id', '=', quoteId)
      .executeTakeFirst();
  },

  // ─── Billing Ledger Entries (Shard — Append-Only, Rule M-12) ───────────────

  async appendLedgerEntry(
    trx: Transaction<ShardDB>,
    entry: NewBillingLedgerEntry
  ): Promise<BillingLedgerEntry> {
    return await trx
      .insertInto('billing_ledger_entries')
      .values(entry)
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  async listLedgerEntries(teamId: string, limit = 50): Promise<BillingLedgerEntry[]> {
    const shardDb = getShardDb(teamId);
    return await shardDb
      .selectFrom('billing_ledger_entries')
      .selectAll()
      .where('team_id', '=', teamId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
  },

  /**
   * Rule M-12: State must rebuild from the ledger.
   * Walks all append-only rows in chronological order to compute current plan,
   * purchased seats, and total net billed cents.
   */
  async rebuildStateFromLedger(
    teamId: string
  ): Promise<{
    plan: string;
    purchasedSeats: number;
    totalAmountCents: number;
    rowCount: number;
  }> {
    const shardDb = getShardDb(teamId);
    const entries = await shardDb
      .selectFrom('billing_ledger_entries')
      .selectAll()
      .where('team_id', '=', teamId)
      .orderBy('created_at', 'asc')
      .execute();

    if (entries.length === 0) {
      // If no ledger rows exist, return Starter baseline
      return {
        plan: 'starter',
        purchasedSeats: 5,
        totalAmountCents: 0,
        rowCount: 0,
      };
    }

    let totalAmountCents = 0;
    let latestPlan = 'starter';
    let latestPurchasedSeats = 5;

    for (const entry of entries) {
      totalAmountCents += entry.amount_cents;
      latestPlan = entry.plan_after;
      latestPurchasedSeats = entry.purchased_seats_after;
    }

    return {
      plan: latestPlan,
      purchasedSeats: latestPurchasedSeats,
      totalAmountCents,
      rowCount: entries.length,
    };
  },

  // ─── Payment Webhook Events (Control Plane Global Dedupe — Rule M-10) ───────

  async recordWebhookEvent(
    event: NewPaymentWebhookEvent
  ): Promise<{ event: PaymentWebhookEvent; isDuplicate: boolean }> {
    try {
      const inserted = await controlPlane
        .insertInto('payment_webhook_events')
        .values(event)
        .returningAll()
        .executeTakeFirstOrThrow();
      return { event: inserted, isDuplicate: false };
    } catch (err: unknown) {
      // Unique constraint violation on (provider, provider_event_id)
      const isUniqueViolation =
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === '23505';

      if (isUniqueViolation) {
        const existing = await controlPlane
          .selectFrom('payment_webhook_events')
          .selectAll()
          .where('provider', '=', event.provider)
          .where('provider_event_id', '=', event.provider_event_id)
          .executeTakeFirstOrThrow();
        return { event: existing, isDuplicate: true };
      }
      throw err;
    }
  },

  async updateWebhookEventStatus(
    id: string,
    status: PaymentWebhookEvent['status'],
    failureReason?: string
  ): Promise<void> {
    await controlPlane
      .updateTable('payment_webhook_events')
      .set({
        status,
        processed_at: new Date(),
        failure_reason: failureReason ?? null,
      })
      .where('id', '=', id)
      .execute();
  },

  // ─── Scheduler Queries (Rule M-14) ──────────────────────────────────────────

  async findDueScheduledChanges(
    shardDb: Kysely<ShardDB>,
    now: Date
  ): Promise<Subscription[]> {
    return await shardDb
      .selectFrom('subscriptions')
      .selectAll()
      .where('scheduled_effective_at', 'is not', null)
      .where('scheduled_effective_at', '<=', now)
      .execute();
  },

  async findDueRenewals(
    shardDb: Kysely<ShardDB>,
    now: Date
  ): Promise<Subscription[]> {
    return await shardDb
      .selectFrom('subscriptions')
      .selectAll()
      .where('status', '=', 'active')
      .where('period_end', 'is not', null)
      .where('period_end', '<=', now)
      .execute();
  },

  async findExpiredGraceSubscriptions(
    shardDb: Kysely<ShardDB>,
    now: Date
  ): Promise<Subscription[]> {
    return await shardDb
      .selectFrom('subscriptions')
      .selectAll()
      .where('status', '=', 'grace')
      .where('grace_until', 'is not', null)
      .where('grace_until', '<=', now)
      .execute();
  },

  async findExpiredTrials(
    shardDb: Kysely<ShardDB>,
    now: Date
  ): Promise<Subscription[]> {
    return await shardDb
      .selectFrom('subscriptions')
      .selectAll()
      .where('status', '=', 'trialing')
      .where('trial_ends_at', 'is not', null)
      .where('trial_ends_at', '<=', now)
      .execute();
  },
};
