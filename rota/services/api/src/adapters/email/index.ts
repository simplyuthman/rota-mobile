/**
 * =============================================================================
 * Rota API — Email Adapter Stub (Resend)
 * =============================================================================
 * AGENTS.md §4 (L-06) & Decision 002:
 * Transactional email provider is Resend.
 * The rest of the backend talks to this provider-neutral interface.
 */

export interface EmailProvider {
  sendMagicLink(params: { to: string; magicLinkUrl: string }): Promise<void>;
  sendPasswordReset(params: { to: string; resetUrl: string }): Promise<void>;
  sendTeamInvitation(params: {
    to: string;
    teamName: string;
    inviterName: string;
    inviteUrl: string;
  }): Promise<void>;
}

export class ResendEmailAdapter implements EmailProvider {
  async sendMagicLink(_params: { to: string; magicLinkUrl: string }): Promise<void> {
    throw new Error('ResendEmailAdapter not yet implemented — Phase 2 scope');
  }

  async sendPasswordReset(_params: { to: string; resetUrl: string }): Promise<void> {
    throw new Error('ResendEmailAdapter not yet implemented — Phase 2 scope');
  }

  async sendTeamInvitation(_params: {
    to: string;
    teamName: string;
    inviterName: string;
    inviteUrl: string;
  }): Promise<void> {
    throw new Error('ResendEmailAdapter not yet implemented — Phase 2 scope');
  }
}
