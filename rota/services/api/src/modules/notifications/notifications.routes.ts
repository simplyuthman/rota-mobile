/**
 * =============================================================================
 * Rota API — Notification & Push Routes
 * =============================================================================
 * AGENTS.md §3.4 (P-04, P-05):
 * Endpoints for device push token registration and deactivation.
 * =============================================================================
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { RegisterPushTokenRequestSchema, TestPushRequestSchema } from '@rota/contracts';
import { requireAuth } from '../../middleware/auth.js';
import { notificationService } from './notification.service.js';
import { pushDevicesRepo } from './push-devices.repo.js';
import { getPushAdapter } from '../../adapters/push/index.js';

const TokenParamSchema = z.object({
  token: z.string().min(1),
});

export const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /me/push-tokens
   * Upserts push device by (provider, token_hash) and reassigns user_id (Rule P-04).
   */
  fastify.post(
    '/me/push-tokens',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const body = RegisterPushTokenRequestSchema.parse(request.body);
      const userId = request.userId!;

      const device = await notificationService.registerPushToken(userId, body);

      return reply.status(201).send({
        success: true,
        id: device.id,
        platform: device.platform,
        deviceLabel: device.device_label,
      });
    }
  );

  /**
   * DELETE /me/push-tokens/:token
   * Deactivates the device push token on logout (Rule P-04).
   */
  fastify.delete(
    '/me/push-tokens/:token',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const { token } = TokenParamSchema.parse(request.params);
      const userId = request.userId!;

      await notificationService.deactivatePushToken(userId, token);

      return reply.status(200).send({
        success: true,
        message: 'Push token deactivated',
      });
    }
  );

  /**
   * POST /me/push-test
   * Sends a live test push notification to user's registered devices (Tier 7 demo/verification).
   * Payloads contain only { type, teamId, entityId } (Rule P-05).
   */
  fastify.post(
    '/me/push-test',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const body = TestPushRequestSchema.parse(request.body);
      const userId = request.userId!;

      const devices = await pushDevicesRepo.findActiveByUserId(userId);
      if (devices.length === 0) {
        return reply.status(200).send({
          success: false,
          sentCount: 0,
          message: 'No active push devices registered for this user.',
        });
      }

      const adapter = getPushAdapter();
      let sentCount = 0;
      let lastMessageId: string | undefined;

      for (const dev of devices) {
        const res = await adapter.sendPush({
          to: dev.token_ciphertext ?? dev.token_hash,
          title: body.title || 'Rota Alert',
          body: body.body || `Test notification: ${body.type}`,
          data: {
            type: body.type,
            teamId: body.teamId || '00000000-0000-0000-0000-000000000000',
            entityId: body.entityId || 'test-entity',
          },
        });
        if (res.success) {
          sentCount++;
          lastMessageId = res.messageId;
        }
      }

      return reply.status(200).send({
        success: sentCount > 0,
        sentCount,
        messageId: lastMessageId,
      });
    }
  );
};
