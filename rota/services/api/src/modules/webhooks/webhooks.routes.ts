/**
 * =============================================================================
 * Rota API — Payment Webhook Routes
 * =============================================================================
 * AGENTS.md §2.1, §3.1 (M-08, M-09, M-10), §4 (L-01, L-06):
 * - Verify signature strictly BEFORE reading/processing payload (M-09)
 * - Record in control-plane payment_webhook_events with global dedupe (M-10)
 * - Duplicate events are marked ignored_duplicate and return 200
 * - Process payment asynchronously, updating subscription and appending ledger
 * =============================================================================
 */

import type { FastifyPluginAsync } from 'fastify';
import { createHash } from 'node:crypto';
import { defaultPaymentProvider } from '../../adapters/payments/flutterwave/index.js';
import { subscriptionsRepo } from '../subscriptions/subscriptions.repo.js';
import { subscriptionsService } from '../subscriptions/subscriptions.service.js';

export const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /v1/webhooks/payments/flutterwave
   * Flutterwave payment confirmation webhook endpoint.
   */
  fastify.post('/v1/webhooks/payments/flutterwave', async (request, reply) => {
    const signatureHeader = request.headers['verif-hash'] as string | undefined;

    // Rule M-09: Verify signature BEFORE reading or trusting payload
    const isValidSignature = defaultPaymentProvider.verifyWebhookSignature(signatureHeader);
    if (!isValidSignature) {
      return reply.status(401).send({
        error: {
          code: 'INVALID_SIGNATURE',
          message: 'Webhook signature verification failed',
          requestId: request.id,
        },
      });
    }

    // Parse verified payload
    const parsed = defaultPaymentProvider.parseWebhookPayload(request.body);
    if (!parsed || !parsed.providerEventId) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'Malformed webhook payload or missing event ID',
          requestId: request.id,
        },
      });
    }

    // Compute payload hash for audit trail
    const rawPayloadStr = JSON.stringify(request.body ?? {});
    const payloadHash = createHash('sha256').update(rawPayloadStr).digest('hex');

    // Rule M-10: Global dedupe in control-plane payment_webhook_events
    const { event, isDuplicate } = await subscriptionsRepo.recordWebhookEvent({
      provider: 'flutterwave',
      provider_event_id: parsed.providerEventId,
      team_id: parsed.teamId || null,
      event_type: parsed.eventType,
      payload_hash: payloadHash,
      status: 'received',
    });

    if (isDuplicate) {
      // Rule M-10: Repeated event is a no-op
      await subscriptionsRepo.updateWebhookEventStatus(event.id, 'ignored_duplicate');
      return reply.status(200).send({
        status: 'ignored_duplicate',
        message: 'Duplicate event already processed',
      });
    }

    // If payment was successful and quoteId & teamId are present, process it
    if (parsed.status === 'successful' && parsed.quoteId && parsed.teamId) {
      try {
        await subscriptionsService.applyConfirmedPayment({
          teamId: parsed.teamId,
          quoteId: parsed.quoteId,
          providerEventId: parsed.providerEventId,
          providerRef: parsed.flwRef || parsed.txRef,
          cardToken: parsed.cardToken,
          customerEmail: parsed.customerEmail,
        });

        await subscriptionsRepo.updateWebhookEventStatus(event.id, 'processed');
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await subscriptionsRepo.updateWebhookEventStatus(event.id, 'failed', errorMsg);
        // Do not crash the endpoint; return 500 so webhook retry works
        return reply.status(500).send({
          error: {
            code: 'WEBHOOK_PROCESSING_FAILED',
            message: 'Failed to apply confirmed payment',
            requestId: request.id,
          },
        });
      }
    } else {
      await subscriptionsRepo.updateWebhookEventStatus(event.id, 'processed');
    }

    return reply.status(200).send({
      status: 'success',
      providerEventId: parsed.providerEventId,
    });
  });
};
