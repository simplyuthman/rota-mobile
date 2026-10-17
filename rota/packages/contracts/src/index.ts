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
  'past_due',
  'grace',
  'restricted',
  'cancelled',
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

// -----------------------------------------------------------------------------
// Auth & Identity DTOs (PRD §6.1, AGENTS.md §3.3)
// -----------------------------------------------------------------------------
export const UserDtoSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  emailVerified: z.boolean(),
  status: z.enum(['active', 'suspended', 'pending_deletion']),
  createdAt: z.string(),
});
export type UserDto = z.infer<typeof UserDtoSchema>;

export const AuthSessionDtoSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string(),
});
export type AuthSessionDto = z.infer<typeof AuthSessionDtoSchema>;

export const AuthResponseSchema = z.object({
  user: UserDtoSchema,
  session: AuthSessionDtoSchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const SignUpRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().min(1, 'Display name is required').max(100),
});
export type SignUpRequest = z.infer<typeof SignUpRequestSchema>;

export const SignInPasswordRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});
export type SignInPasswordRequest = z.infer<typeof SignInPasswordRequestSchema>;

export const MagicLinkRequestSchema = z.object({
  email: z.string().email(),
});
export type MagicLinkRequest = z.infer<typeof MagicLinkRequestSchema>;

export const MagicLinkVerifyRequestSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});
export type MagicLinkVerifyRequest = z.infer<typeof MagicLinkVerifyRequestSchema>;

export const RefreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});
export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;

export const PasswordResetRequestSchema = z.object({
  email: z.string().email(),
});
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

export const PasswordResetConfirmRequestSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});
export type PasswordResetConfirmRequest = z.infer<typeof PasswordResetConfirmRequestSchema>;

export const VerifyEmailCodeRequestSchema = z.object({
  code: z.string().length(6, 'Verification code must be 6 digits'),
});
export type VerifyEmailCodeRequest = z.infer<typeof VerifyEmailCodeRequestSchema>;

export const GenericMessageResponseSchema = z.object({
  message: z.string(),
});
export type GenericMessageResponse = z.infer<typeof GenericMessageResponseSchema>;

// -----------------------------------------------------------------------------
// Team & Membership DTOs (PRD §6.2, AGENTS.md §3.2)
// -----------------------------------------------------------------------------
export const TeamDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  timezone: z.string(),
  role: RoleSchema,
  status: z.enum(['active', 'closed']),
  createdAt: z.string(),
});
export type TeamDto = z.infer<typeof TeamDtoSchema>;

export const TeamMembershipDtoSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  userId: z.string().uuid(),
  role: RoleSchema,
  status: z.enum(['invited', 'active', 'suspended', 'removed']),
  activatedAt: z.string().nullable(),
  createdAt: z.string(),
  displayName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
});
export type TeamMembershipDto = z.infer<typeof TeamMembershipDtoSchema>;

export const CreateTeamRequestSchema = z.object({
  name: z.string().min(1, 'Team name is required').max(100),
  timezone: z.string().min(1, 'Timezone is required'),
});
export type CreateTeamRequest = z.infer<typeof CreateTeamRequestSchema>;

export const CreateInvitationRequestSchema = z.object({
  email: z.string().email().optional(),
  intendedRole: z.enum(['manager', 'staff']),
});
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequestSchema>;

export const InvitationDtoSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  token: z.string(),
  inviteCode: z.string(),
  email: z.string().nullable(),
  intendedRole: z.enum(['manager', 'staff']),
  status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type InvitationDto = z.infer<typeof InvitationDtoSchema>;

export const AcceptInvitationRequestSchema = z.object({
  token: z.string().min(1, 'Invitation token or code is required'),
});
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequestSchema>;

export const MeResponseSchema = z.object({
  user: UserDtoSchema,
  teams: z.array(TeamDtoSchema),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

// -----------------------------------------------------------------------------
// Shift DTOs (PRD §6.3, AGENTS.md §3.2 A-07, §3.5 D-02)
// -----------------------------------------------------------------------------
export const ShiftStatusSchema = z.enum(['draft', 'published', 'cancelled']);
export type ShiftStatus = z.infer<typeof ShiftStatusSchema>;

export const ShiftDtoSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  title: z.string(),
  locationLabel: z.string().nullable(),
  /** notes: null for Staff viewers (A-07). Omitted entirely in cached calendar (D-03). */
  notes: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: ShiftStatusSchema,
  createdByMembershipId: z.string().uuid(),
  publishedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  assignedMembershipId: z.string().uuid().nullable().optional(),
});
export type ShiftDto = z.infer<typeof ShiftDtoSchema>;

/** Staff-facing DTO: notes field is stripped (A-07). */
export const ShiftPublicDtoSchema = ShiftDtoSchema.omit({ notes: true });
export type ShiftPublicDto = z.infer<typeof ShiftPublicDtoSchema>;

export const CreateShiftRequestSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  locationLabel: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  startsAt: z.string().datetime({ message: 'startsAt must be an ISO-8601 datetime' }),
  endsAt: z.string().datetime({ message: 'endsAt must be an ISO-8601 datetime' }),
  /** membershipId to assign upon creation. */
  assignMembershipId: z.string().uuid().optional(),
});
export type CreateShiftRequest = z.infer<typeof CreateShiftRequestSchema>;

export const UpdateShiftRequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  locationLabel: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
});
export type UpdateShiftRequest = z.infer<typeof UpdateShiftRequestSchema>;

export const PublishShiftRequestSchema = z.object({
  assignMembershipId: z.string().uuid().optional(),
});
export type PublishShiftRequest = z.infer<typeof PublishShiftRequestSchema>;

// -----------------------------------------------------------------------------
// Swap Request DTOs (PRD §6.5, AGENTS.md §3.2 A-10)
// -----------------------------------------------------------------------------
export const SwapStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'declined',
  'withdrawn',
  'expired',
]);
export type SwapStatus = z.infer<typeof SwapStatusSchema>;

export const SwapRequestDtoSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  shiftId: z.string().uuid(),
  requesterMembershipId: z.string().uuid(),
  targetMembershipId: z.string().uuid(),
  status: SwapStatusSchema,
  targetAcceptedAt: z.string().nullable(),
  expiredReason: z.string().nullable(),
  message: z.string().nullable(),
  reviewedByMembershipId: z.string().uuid().nullable(),
  reviewedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SwapRequestDto = z.infer<typeof SwapRequestDtoSchema>;

export const CreateSwapRequestSchema = z.object({
  targetMembershipId: z.string().uuid(),
  message: z.string().max(500).optional(),
  idempotencyKey: z.string().min(1).max(100).optional(),
});
export type CreateSwapRequest = z.infer<typeof CreateSwapRequestSchema>;

export const RespondSwapRequestSchema = z.object({
  /** 'accept' or 'decline' — by target only. */
  action: z.enum(['accept', 'decline']),
});
export type RespondSwapRequest = z.infer<typeof RespondSwapRequestSchema>;

export const ReviewSwapRequestSchema = z.object({
  /** 'approve' or 'reject' — by Owner/Manager after target accepted. */
  action: z.enum(['approve', 'reject']),
  decisionNote: z.string().max(500).optional(),
});
export type ReviewSwapRequest = z.infer<typeof ReviewSwapRequestSchema>;

// =============================================================================
// Activity Feed Schemas (PRD §6.3, Rules D-01, A-08)
// =============================================================================

export const ActivityEventDtoSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  actorMembershipId: z.string().uuid().nullable(),
  eventType: z.string(),
  subjectType: z.string().nullable(),
  subjectId: z.string().uuid().nullable(),
  params: z.record(z.unknown()),
  visibility: z.enum(['team', 'managers', 'owner', 'participants']),
  participantMembershipIds: z.array(z.string().uuid()),
  createdAt: z.string(),
});
export type ActivityEventDto = z.infer<typeof ActivityEventDtoSchema>;

export const ActivityFeedQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ActivityFeedQuery = z.infer<typeof ActivityFeedQuerySchema>;

export const ActivityFeedResponseSchema = z.object({
  items: z.array(ActivityEventDtoSchema),
  nextCursor: z.string().nullable(),
});
export type ActivityFeedResponse = z.infer<typeof ActivityFeedResponseSchema>;

// =============================================================================
// User Settings & Push Device DTOs (PRD §6.6, §6.7, Rules P-04, P-06, P-07, P-08)
// =============================================================================

export const NotificationPreferencesSchema = z.object({
  shiftChanges: z.boolean().default(true),
  swaps: z.boolean().default(true),
  billing: z.boolean().default(true),
  activity: z.boolean().default(true),
  security: z.boolean().default(true), // non-disableable
});
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;

export const UserSettingsDtoSchema = z.object({
  userId: z.string().uuid(),
  timezone: z.string(),
  quietHoursEnabled: z.boolean(),
  quietHoursStart: z.string().nullable(),
  quietHoursEnd: z.string().nullable(),
  notificationPreferences: NotificationPreferencesSchema,
  language: z.string(),
  theme: z.enum(['light', 'dark', 'system']),
  fieldUpdatedAt: z.record(z.string()),
  version: z.number().int(),
  updatedAt: z.string(),
});
export type UserSettingsDto = z.infer<typeof UserSettingsDtoSchema>;

export const UpdateUserSettingsRequestSchema = z.object({
  timezone: z.string().min(1).optional(),
  quietHoursEnabled: z.boolean().optional(),
  quietHoursStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/, 'Invalid time format (HH:MM)')
    .nullable()
    .optional(),
  quietHoursEnd: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/, 'Invalid time format (HH:MM)')
    .nullable()
    .optional(),
  notificationPreferences: NotificationPreferencesSchema.partial().optional(),
  language: z.string().min(2).max(10).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
});
export type UpdateUserSettingsRequest = z.infer<typeof UpdateUserSettingsRequestSchema>;

export const RegisterPushTokenRequestSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  provider: z.enum(['expo', 'fcm']).default('expo'),
  platform: z.enum(['ios', 'android']),
  deviceLabel: z.string().max(100).optional(),
});
export type RegisterPushTokenRequest = z.infer<typeof RegisterPushTokenRequestSchema>;

export const TestPushRequestSchema = z.object({
  type: z.enum(['shift', 'swap', 'billing', 'activity', 'security']).default('activity'),
  teamId: z.string().uuid().optional(),
  entityId: z.string().optional(),
  title: z.string().max(100).optional(),
  body: z.string().max(250).optional(),
});
export type TestPushRequest = z.infer<typeof TestPushRequestSchema>;

// =============================================================================
// Billing & Subscriptions (PRD §6.8, AGENTS.md §2.2, §3.1 M-01 through M-15)
// =============================================================================

export const PLAN_CONSTANTS = {
  starter: {
    plan: 'starter' as const,
    name: 'Starter',
    basePriceCents: 2000,
    includedSeats: 5,
    extraSeatPriceCents: null,
    seatCeiling: 5,
  },
  team: {
    plan: 'team' as const,
    name: 'Team',
    basePriceCents: 5000,
    includedSeats: 15,
    extraSeatPriceCents: 300,
    seatCeiling: 38,
  },
  business: {
    plan: 'business' as const,
    name: 'Business',
    basePriceCents: 12000,
    includedSeats: 40,
    extraSeatPriceCents: 200,
    seatCeiling: 100,
  },
} as const;

export type PlanName = keyof typeof PLAN_CONSTANTS;

export function calculateRecurringAmountCents(plan: PlanName, seats: number): number {
  const config = PLAN_CONSTANTS[plan];
  if (!config) throw new Error(`Unknown plan: ${plan}`);
  if (plan === 'starter' && seats !== 5) {
    throw new Error('Starter plan must have exactly 5 seats');
  }
  if (plan === 'team' && (seats < 15 || seats > 38)) {
    throw new Error('Team plan seats must be between 15 and 38');
  }
  if (plan === 'business' && (seats < 40 || seats > 100)) {
    throw new Error('Business plan seats must be between 40 and 100');
  }
  const extraSeats = Math.max(0, seats - config.includedSeats);
  const extraCost = config.extraSeatPriceCents ? extraSeats * config.extraSeatPriceCents : 0;
  return config.basePriceCents + extraCost;
}

export const PlanNameSchema = z.enum(['starter', 'team', 'business']);

export const SubscriptionDtoSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  plan: PlanNameSchema,
  status: SubscriptionStatusSchema,
  currency: z.string(),
  basePriceCents: z.number().int(),
  includedSeats: z.number().int(),
  extraSeatPriceCents: z.number().int().nullable(),
  purchasedSeats: z.number().int(),
  currentRecurringCents: z.number().int(),
  scheduledPlan: PlanNameSchema.nullable(),
  scheduledPurchasedSeats: z.number().int().nullable(),
  scheduledEffectiveAt: z.string().nullable(),
  trialEndsAt: z.string().nullable(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  graceUntil: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SubscriptionDto = z.infer<typeof SubscriptionDtoSchema>;

export const BillingQuoteRequestSchema = z.object({
  plan: PlanNameSchema,
  purchasedSeats: z.number().int().min(1).max(100),
});
export type BillingQuoteRequest = z.infer<typeof BillingQuoteRequestSchema>;

export const BillingQuoteDtoSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  plan: PlanNameSchema,
  purchasedSeats: z.number().int(),
  isImmediate: z.boolean(),
  amountCents: z.number().int(),
  currentRecurringCents: z.number().int(),
  newRecurringCents: z.number().int(),
  creditCents: z.number().int(),
  costCents: z.number().int(),
  effectiveAt: z.string(),
  expiresAt: z.string(),
});
export type BillingQuoteDto = z.infer<typeof BillingQuoteDtoSchema>;

export const CheckoutRequestSchema = z.object({
  quoteId: z.string().uuid(),
  idempotencyKey: z.string().min(1).max(100),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;

export const CheckoutResponseSchema = z.object({
  checkoutUrl: z.string(),
  quoteId: z.string().uuid(),
  amountCents: z.number().int(),
  currency: z.string(),
});
export type CheckoutResponse = z.infer<typeof CheckoutResponseSchema>;

export const BillingLedgerEntryDtoSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  entryType: z.enum(['charge', 'credit', 'refund', 'adjustment']),
  amountCents: z.number().int(),
  currency: z.string(),
  reason: z.string(),
  planAfter: PlanNameSchema,
  purchasedSeatsAfter: z.number().int(),
  createdAt: z.string(),
});
export type BillingLedgerEntryDto = z.infer<typeof BillingLedgerEntryDtoSchema>;

