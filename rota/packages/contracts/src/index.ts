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

