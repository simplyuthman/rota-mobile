/**
 * =============================================================================
 * Rota Contracts — Shared API Types & Zod Schemas
 * =============================================================================
 * Single source of truth for request/response contracts shared between
 * the Fastify backend and the React Native mobile client.
 */

import { z } from 'zod';

// -----------------------------------------------------------------------------
// Standard Error Envelope (AGENTS.md §5, Rule 60)
// -----------------------------------------------------------------------------
export const ErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'OWNER_IMMUTABLE',
  'SEAT_LIMIT',
  'PRORATION_NEGATIVE',
  'OVERLAPPING_SHIFT',
  'INVALID_SWAP',
  'SUBSCRIPTION_RESTRICTED',
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// -----------------------------------------------------------------------------
// Roles and Subscriptions
// -----------------------------------------------------------------------------
export const RoleSchema = z.enum(['owner', 'manager', 'staff']);
export type Role = z.infer<typeof RoleSchema>;

export const SubscriptionPlanSchema = z.enum(['starter', 'team', 'business']);
export type SubscriptionPlan = z.infer<typeof SubscriptionPlanSchema>;

export const SubscriptionStatusSchema = z.enum([
  'trialing',
  'active',
  'grace',
  'restricted',
  'canceled',
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

// -----------------------------------------------------------------------------
// Health Check Schemas
// -----------------------------------------------------------------------------
export const HealthLiveResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string(),
});
export type HealthLiveResponse = z.infer<typeof HealthLiveResponseSchema>;

export const HealthReadyResponseSchema = z.object({
  status: z.union([z.literal('ready'), z.literal('degraded'), z.literal('down')]),
  timestamp: z.string(),
  checks: z.object({
    database: z.object({
      controlPlane: z.boolean(),
      shard0: z.boolean(),
      shard1: z.boolean(),
    }),
    redis: z.object({
      cache: z.boolean(),
      queue: z.boolean(),
    }),
  }),
});
export type HealthReadyResponse = z.infer<typeof HealthReadyResponseSchema>;
