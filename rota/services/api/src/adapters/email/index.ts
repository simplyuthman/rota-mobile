/**
 * =============================================================================
 * Rota API — Email Adapter (Resend)
 * =============================================================================
 * AGENTS.md §4 (L-06) & Decision 002 (docs/decisions/002-email-provider.md):
 * Transactional email provider is Resend.
 * The rest of the backend talks exclusively to this provider-neutral interface.
 */

import { Resend } from 'resend';
import { env } from '../../config/env.js';

export interface EmailProvider {
  sendVerificationCode(params: { to: string; code: string }): Promise<void>;
  sendMagicLink(params: { to: string; magicLinkUrl: string }): Promise<void>;
  sendPasswordReset(params: { to: string; resetUrl: string }): Promise<void>;
  sendTeamInvitation(params: {
    to: string;
    teamName: string;
    inviterName: string;
    inviteUrl: string;
    inviteCode: string;
  }): Promise<void>;
}

export interface SentEmailRecord {
  to: string;
  type: 'verification' | 'magic_link' | 'password_reset' | 'invitation';
  payload: Record<string, unknown>;
  sentAt: Date;
}

export class MockEmailAdapter implements EmailProvider {
  public sentEmails: SentEmailRecord[] = [];

  async sendVerificationCode(params: { to: string; code: string }): Promise<void> {
    this.sentEmails.push({
      to: params.to,
      type: 'verification',
      payload: { code: params.code },
      sentAt: new Date(),
    });
    if (env.NODE_ENV !== 'test') {
      // eslint-disable-next-line no-console
      console.log(`\n📨 [DEV EMAIL] Verification Code for ${params.to}: ${params.code}\n`);
    }
  }

  async sendMagicLink(params: { to: string; magicLinkUrl: string }): Promise<void> {
    this.sentEmails.push({
      to: params.to,
      type: 'magic_link',
      payload: { magicLinkUrl: params.magicLinkUrl },
      sentAt: new Date(),
    });
    if (env.NODE_ENV !== 'test') {
      // eslint-disable-next-line no-console
      console.log(`\n📨 [DEV EMAIL] Magic Link for ${params.to}: ${params.magicLinkUrl}\n`);
    }
  }

  async sendPasswordReset(params: { to: string; resetUrl: string }): Promise<void> {
    this.sentEmails.push({
      to: params.to,
      type: 'password_reset',
      payload: { resetUrl: params.resetUrl },
      sentAt: new Date(),
    });
    if (env.NODE_ENV !== 'test') {
      // eslint-disable-next-line no-console
      console.log(`\n📨 [DEV EMAIL] Password Reset Link for ${params.to}: ${params.resetUrl}\n`);
    }
  }

  async sendTeamInvitation(params: {
    to: string;
    teamName: string;
    inviterName: string;
    inviteUrl: string;
    inviteCode: string;
  }): Promise<void> {
    this.sentEmails.push({
      to: params.to,
      type: 'invitation',
      payload: params,
      sentAt: new Date(),
    });
    if (env.NODE_ENV !== 'test') {
      // eslint-disable-next-line no-console
      console.log(`\n📨 [DEV EMAIL] Team Invitation for ${params.to} | Team: ${params.teamName} | Code: ${params.inviteCode} | URL: ${params.inviteUrl}\n`);
    }
  }

  clear(): void {
    this.sentEmails = [];
  }
}

export class ResendEmailAdapter implements EmailProvider {
  private resend: Resend;

  constructor(apiKey: string = env.RESEND_API_KEY) {
    this.resend = new Resend(apiKey);
  }

  async sendVerificationCode(params: { to: string; code: string }): Promise<void> {
    await this.resend.emails.send({
      from: env.EMAIL_FROM,
      to: params.to,
      subject: `Your Rota verification code: ${params.code}`,
      text: `Welcome to Rota!\n\nYour 6-digit verification code is: ${params.code}\n\nThis code expires in 15 minutes.`,
    });
  }

  async sendMagicLink(params: { to: string; magicLinkUrl: string }): Promise<void> {
    await this.resend.emails.send({
      from: env.EMAIL_FROM,
      to: params.to,
      subject: 'Sign in to Rota',
      text: `Click the link below to sign in to your Rota account:\n\n${params.magicLinkUrl}\n\nThis link is single-use and expires in 15 minutes.`,
    });
  }

  async sendPasswordReset(params: { to: string; resetUrl: string }): Promise<void> {
    await this.resend.emails.send({
      from: env.EMAIL_FROM,
      to: params.to,
      subject: 'Reset your Rota password',
      text: `You requested a password reset for Rota.\n\nClick the link below to reset your password:\n\n${params.resetUrl}\n\nThis link is single-use and expires in 15 minutes.`,
    });
  }

  async sendTeamInvitation(params: {
    to: string;
    teamName: string;
    inviterName: string;
    inviteUrl: string;
    inviteCode: string;
  }): Promise<void> {
    await this.resend.emails.send({
      from: env.EMAIL_FROM,
      to: params.to,
      subject: `You've been invited to join ${params.teamName} on Rota`,
      text: `${params.inviterName} has invited you to join ${params.teamName} on Rota.\n\nOpen this link to accept the invitation:\n${params.inviteUrl}\n\nOr enter this invite code in the app:\n${params.inviteCode}\n\nThis invitation is single-use and expires in 7 days.`,
    });
  }
}

let activeEmailAdapter: EmailProvider =
  env.NODE_ENV === 'test' || env.RESEND_API_KEY.includes('mock')
    ? new MockEmailAdapter()
    : new ResendEmailAdapter();

export function getEmailAdapter(): EmailProvider {
  return activeEmailAdapter;
}

export function setEmailAdapterForTesting(adapter: EmailProvider): void {
  activeEmailAdapter = adapter;
}
