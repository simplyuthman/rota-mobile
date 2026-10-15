/**
 * =============================================================================
 * Rota API — Invitations Service
 * =============================================================================
 * AGENTS.md §3.2 (A-05, A-06) & §3.3 (S-06, S-07):
 * Business logic for invitation creation, inspection, and atomic acceptance.
 */

import crypto from 'node:crypto';
import { invitationsRepo, SeatLimitError } from './invitations.repo.js';
import { teamsRepo } from '../teams/teams.repo.js';
import { authRepo } from '../auth/auth.repo.js';
import { getEmailAdapter } from '../../adapters/email/index.js';
import { env } from '../../config/env.js';
import type { InvitationDto, TeamMembershipDto } from '@rota/contracts';

export class InvitationError extends Error {
  constructor(
    public code:
      | 'FORBIDDEN'
      | 'SEAT_LIMIT'
      | 'NOT_FOUND'
      | 'INVITATION_EXPIRED'
      | 'INVITATION_ALREADY_USED'
      | 'EMAIL_NOT_VERIFIED'
      | 'EMAIL_MISMATCH'
      | 'VALIDATION_ERROR',
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'InvitationError';
  }
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export const invitationsService = {
  /**
   * Generates a raw token formatted as `{teamId}.{randomHex}` (Rule S-06).
   */
  generateToken(teamId: string): string {
    const randomHex = crypto.randomBytes(32).toString('hex');
    return `${teamId}.${randomHex}`;
  },

  /**
   * Only the Owner invites (Rule A-05).
   * Generates hashed token and persists to shard (Rule S-06).
   */
  async createInvitation(
    teamId: string,
    actingMembershipId: string,
    actingUserId: string,
    actingUserRole: string,
    input: {
      email?: string | null;
      role: 'manager' | 'staff';
    }
  ): Promise<InvitationDto> {
    // Rule A-05: Only the Owner invites.
    if (actingUserRole !== 'owner') {
      throw new InvitationError(
        'FORBIDDEN',
        'Only the team Owner can invite new members.',
        403
      );
    }

    const team = await teamsRepo.findTeamById(teamId);
    if (!team) {
      throw new InvitationError('NOT_FOUND', 'Team not found', 404);
    }

    const inviter = await authRepo.findUserById(actingUserId);
    const emailNormalized = input.email ? input.email.trim().toLowerCase() : null;

    // Generate token: {teamId}.{random}
    const rawToken = this.generateToken(teamId);
    const tokenHash = hashToken(rawToken);

    // Default expiration: 7 days
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const row = await invitationsRepo.createInvitation({
      teamId,
      emailNormalized,
      intendedRole: input.role,
      tokenHash,
      invitedByMembershipId: actingMembershipId,
      expiresAt,
    });

    const inviteUrl = `${process.env['APP_LINK_BASE_URL'] ?? 'https://rota-app.com'}/invite/${rawToken}`;

    // Send email if email was provided
    if (emailNormalized) {
      try {
        const emailAdapter = getEmailAdapter();
        await emailAdapter.sendTeamInvitation({
          to: emailNormalized,
          teamName: team.name,
          inviterName: inviter?.display_name || 'Team Owner',
          inviteUrl,
          inviteCode: rawToken,
        });
      } catch (err) {
        // Log and proceed; the token can still be copied/shared
        console.error('Failed to send invitation email:', err);
      }
    }

    return {
      id: row.id,
      teamId: row.team_id,
      email: row.email_normalized,
      intendedRole: row.intended_role,
      token: rawToken, // Returned once upon creation
      inviteCode: rawToken,
      status: row.status,
      expiresAt: row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString(),
    };
  },

  /**
   * Inspects invitation details before accepting.
   */
  async getInvitationByToken(rawToken: string): Promise<{
    teamId: string;
    teamName: string;
    role: 'manager' | 'staff';
    email: string | null;
    expiresAt: string;
  }> {
    const parts = rawToken.split('.');
    if (parts.length < 2) {
      throw new InvitationError('VALIDATION_ERROR', 'Invalid invite code format', 400);
    }
    const teamId = parts[0]!;
    const tokenHash = hashToken(rawToken);

    const inv = await invitationsRepo.findInvitationByTokenHash(teamId, tokenHash);
    if (!inv) {
      throw new InvitationError('NOT_FOUND', 'Invitation not found', 404);
    }

    if (inv.status !== 'pending') {
      throw new InvitationError('INVITATION_ALREADY_USED', 'This invitation is no longer active', 409);
    }

    if (new Date() > inv.expires_at) {
      throw new InvitationError('INVITATION_EXPIRED', 'This invitation has expired', 410);
    }

    const team = await teamsRepo.findTeamById(teamId);
    if (!team) {
      throw new InvitationError('NOT_FOUND', 'Team not found', 404);
    }

    return {
      teamId: inv.team_id,
      teamName: team.name,
      role: inv.intended_role,
      email: inv.email_normalized,
      expiresAt: inv.expires_at.toISOString(),
    };
  },

  /**
   * Accepts an invitation atomically enforcing seat limits (Rule A-06).
   */
  async acceptInvitation(
    userId: string,
    rawToken: string
  ): Promise<{ membership: TeamMembershipDto; teamId: string }> {
    const parts = rawToken.split('.');
    if (parts.length < 2) {
      throw new InvitationError('VALIDATION_ERROR', 'Invalid invite code format', 400);
    }
    const teamId = parts[0]!;
    const tokenHash = hashToken(rawToken);

    const inv = await invitationsRepo.findInvitationByTokenHash(teamId, tokenHash);
    if (!inv) {
      throw new InvitationError('NOT_FOUND', 'Invitation not found', 404);
    }

    if (inv.status !== 'pending') {
      throw new InvitationError('INVITATION_ALREADY_USED', 'This invitation has already been used', 409);
    }

    if (new Date() > inv.expires_at) {
      throw new InvitationError('INVITATION_EXPIRED', 'This invitation has expired', 410);
    }

    // Rule S-07: Require a verified email to accept an email-bound invite
    if (inv.email_normalized) {
      const user = await authRepo.findUserById(userId);
      if (!user) {
        throw new InvitationError('NOT_FOUND', 'User not found', 404);
      }

      if (!user.email_verified_at) {
        throw new InvitationError(
          'EMAIL_NOT_VERIFIED',
          'You must verify your email before accepting this invitation.',
          403
        );
      }

      if (user.email_normalized !== inv.email_normalized) {
        throw new InvitationError(
          'EMAIL_MISMATCH',
          `This invitation was sent to ${inv.email_normalized}. You are signed in as ${user.email}.`,
          403
        );
      }
    }

    try {
      const membership = await invitationsRepo.acceptInvitationAtomic({
        teamId,
        invitationId: inv.id,
        userId,
        role: inv.intended_role,
      });

      return {
        membership: {
          id: membership.id,
          teamId: membership.team_id,
          userId: membership.user_id,
          role: membership.role,
          status: membership.status as 'active',
          activatedAt: membership.activated_at ? membership.activated_at.toISOString() : null,
          createdAt: membership.created_at.toISOString(),
        },
        teamId,
      };
    } catch (err) {
      if (err instanceof SeatLimitError) {
        throw new InvitationError('SEAT_LIMIT', 'Team seat limit reached', 409);
      }
      throw err;
    }
  },
};
