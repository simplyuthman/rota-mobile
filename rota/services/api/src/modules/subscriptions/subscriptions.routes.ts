/**
 * =============================================================================
 * Rota API — Subscriptions & Billing Routes
 * =============================================================================
 * AGENTS.md §2.2, §3.1 (M-01 through M-15), §3.2 (A-01, A-02, A-03, A-08), §3.3 (S-08):
 * - Enforce Owner permission on billing mutations and ledger (A-01, A-03)
 * - Rate limit: Checkout 5/hour per team (S-08)
 * - No subscription caching (M-13)
 * =============================================================================
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  BillingQuoteRequestSchema,
  CheckoutRequestSchema,
} from '@rota/contracts';
import { subscriptionsService } from './subscriptions.service.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireTeamMember, requireRoles } from '../../middleware/tenant.js';
import { createRateLimiter } from '../../middleware/rateLimit.js';

// Rule S-08: Checkout 5/hour per team
const checkoutRateLimiter = createRateLimiter({
  scope: 'checkout',
  maxRequests: 5,
  windowSeconds: 3600,
  identifierExtractor: (req) =>
    (req.params as Record<string, string> | undefined)?.['teamId'] ||
    (req.headers['x-team-id'] as string | undefined),
});

export const subscriptionRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /teams/:teamId/billing
   * Returns current subscription and period status.
   * Owner and Manager can view.
   */
  fastify.get<{
    Params: { teamId: string };
  }>(
    '/teams/:teamId/billing',
    {
      preHandler: [requireAuth, requireTeamMember, requireRoles(['owner', 'manager'])],
    },
    async (request, reply) => {
      const { teamId } = request.params;
      const subscription = await subscriptionsService.getSubscription(teamId);
      return reply.status(200).send({ subscription });
    }
  );

  /**
   * GET /teams/:teamId/billing/plans
   * Returns plan constants (prices in cents, seats, ceilings).
   */
  fastify.get<{
    Params: { teamId: string };
  }>(
    '/teams/:teamId/billing/plans',
    {
      preHandler: [requireAuth, requireTeamMember],
    },
    async (_request, reply) => {
      const plans = subscriptionsService.getPlans();
      return reply.status(200).send({ plans });
    }
  );

  /**
   * POST /teams/:teamId/billing/quotes
   * Generates a billing quote with calculated proration.
   * Owner only (Rule A-01, A-08).
   */
  fastify.post<{
    Params: { teamId: string };
  }>(
    '/teams/:teamId/billing/quotes',
    {
      preHandler: [requireAuth, requireTeamMember, requireRoles(['owner'])],
    },
    async (request, reply) => {
      const { teamId } = request.params;
      const body = BillingQuoteRequestSchema.parse(request.body);

      const quote = await subscriptionsService.createQuote({
        teamId,
        plan: body.plan,
        purchasedSeats: body.purchasedSeats,
      });

      return reply.status(201).send({ quote });
    }
  );

  /**
   * POST /teams/:teamId/billing/checkout
   * Initiates payment checkout session charging the exact quote amount.
   * Rate limited: 5/hour per team. Owner only.
   */
  fastify.post<{
    Params: { teamId: string };
  }>(
    '/teams/:teamId/billing/checkout',
    {
      preHandler: [requireAuth, requireTeamMember, requireRoles(['owner']), checkoutRateLimiter],
    },
    async (request, reply) => {
      const { teamId } = request.params;
      const body = CheckoutRequestSchema.parse(request.body);
      const user = request.user!;

      const result = await subscriptionsService.createCheckout({
        teamId,
        quoteId: body.quoteId,
        idempotencyKey: body.idempotencyKey,
        userEmail: user.email,
        userName: user.email,
      });

      return reply.status(200).send(result);
    }
  );

  /**
   * GET /teams/:teamId/billing/ledger
   * Lists append-only ledger entries. Owner only.
   */
  fastify.get<{
    Params: { teamId: string };
  }>(
    '/teams/:teamId/billing/ledger',
    {
      preHandler: [requireAuth, requireTeamMember, requireRoles(['owner'])],
    },
    async (request, reply) => {
      const { teamId } = request.params;
      const ledger = await subscriptionsService.listLedger(teamId);
      return reply.status(200).send({ ledger });
    }
  );

  /**
   * GET /teams/:teamId/billing/rebuild-check
   * Verifies that subscription state can be reconstructed from ledger. Owner only.
   */
  fastify.get<{
    Params: { teamId: string };
  }>(
    '/teams/:teamId/billing/rebuild-check',
    {
      preHandler: [requireAuth, requireTeamMember, requireRoles(['owner'])],
    },
    async (request, reply) => {
      const { teamId } = request.params;
      const rebuilt = await subscriptionsService.verifyLedgerRebuild(teamId);
      return reply.status(200).send({ rebuilt });
    }
  );
};
