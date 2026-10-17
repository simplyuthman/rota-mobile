/**
 * =============================================================================
 * Rota API — Auth Service
 * =============================================================================
 * AGENTS.md §3.3 (S-01 through S-09) & §5:
 * Business rules, token lifecycles, hashing, and session management.
 * - Passwords hashed with Argon2id.
 * - Access tokens: 15-minute JWT with `sid = token_family_id`.
 * - Refresh tokens: Single-use rotating; replay revokes family.
 * - Logout / Logout-all writes revoked `sid`s to Redis with 15-min TTL.
 * - All tokens (magic link, reset, verification) stored hashed always.
 */

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { hash, verify } from '@node-rs/argon2';
import { env, config } from '../../config/env.js';
import { redisCache } from '../../db/redis.js';
import { authRepo, type UserRow } from './auth.repo.js';
import { teamsRepo } from '../teams/teams.repo.js';
import { getEmailAdapter } from '../../adapters/email/index.js';
import { pushDevicesRepo } from '../notifications/push-devices.repo.js';
import type {
  SignUpRequest,
  SignInPasswordRequest,
  AuthResponse,
  AuthSessionDto,
  UserDto,
  MeResponse,
  TeamDto,
} from '@rota/contracts';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  sid: string; // token_family_id
  iat?: number;
  exp?: number;
}

export class AuthError extends Error {
  constructor(
    public code:
      | 'UNAUTHORIZED'
      | 'CONFLICT'
      | 'NOT_FOUND'
      | 'RATE_LIMITED'
      | 'VALIDATION_ERROR',
    message: string,
    public statusCode: number = 401
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export const authService = {
  // ─── Helpers ───────────────────────────────────────────────────────────────

  hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  },

  async hashPassword(password: string): Promise<string> {
    return await hash(password, {
      memoryCost: 19456, // 19 MiB per OWASP recommendation
      timeCost: 2,
      outputLen: 32,
      parallelism: 1,
    });
  },

  async verifyPassword(storedHash: string, plainText: string): Promise<boolean> {
    try {
      return await verify(storedHash, plainText);
    } catch {
      return false;
    }
  },

  createAccessToken(user: { id: string; email: string }, tokenFamilyId: string): string {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      sid: tokenFamilyId,
    };

    return jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: '15m',
    });
  },

  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
      return decoded;
    } catch {
      throw new AuthError('UNAUTHORIZED', 'Invalid or expired access token', 401);
    }
  },

  async isSidRevoked(sid: string): Promise<boolean> {
    try {
      const result = await redisCache.get(`auth:revoked:${sid}`);
      return result !== null;
    } catch {
      // In worst-case Redis outage, do not reject valid JWTs without proof of revocation
      return false;
    }
  },

  async markSidRevoked(sid: string): Promise<void> {
    try {
      // 15 minutes TTL matches access token max remaining lifetime (AGENTS.md S-03)
      await redisCache.set(`auth:revoked:${sid}`, '1', 'EX', 900);
    } catch {
      // Logged by redis client
    }
  },

  toUserDto(user: UserRow): UserDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      emailVerified: user.email_verified_at !== null,
      status: user.status,
      createdAt: user.created_at.toISOString(),
    };
  },

  async issueTokens(
    user: UserRow,
    existingFamilyId?: string,
    meta?: { deviceLabel?: string; ipHash?: string; userAgentSummary?: string }
  ): Promise<AuthSessionDto> {
    const tokenFamilyId = existingFamilyId ?? crypto.randomUUID();
    const rawRefreshToken = crypto.randomBytes(32).toString('hex');
    const refreshTokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + config.refreshTokenTtlMs);

    await authRepo.createSession({
      user_id: user.id,
      refresh_token_hash: refreshTokenHash,
      token_family_id: tokenFamilyId,
      expires_at: expiresAt,
      device_label: meta?.deviceLabel ?? null,
      ip_hash: meta?.ipHash ?? null,
      user_agent_summary: meta?.userAgentSummary ?? null,
    });

    const accessToken = this.createAccessToken(user, tokenFamilyId);

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresAt: expiresAt.toISOString(),
    };
  },

  // ─── Sign up & Sign in ─────────────────────────────────────────────────────

  async signUp(input: SignUpRequest): Promise<AuthResponse> {
    const emailNormalized = input.email.trim().toLowerCase();

    const existing = await authRepo.findUserByNormalizedEmail(emailNormalized);
    if (existing) {
      throw new AuthError('CONFLICT', 'An account with this email already exists', 409);
    }

    const passwordHash = await this.hashPassword(input.password);

    const user = await authRepo.createUser({
      email: input.email.trim(),
      email_normalized: emailNormalized,
      password_hash: passwordHash,
      display_name: input.displayName.trim(),
      status: 'active',
    });

    // Send email verification code
    const rawCode = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = this.hashToken(`${user.id}:${rawCode}`);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await authRepo.createAuthToken({
      kind: 'email_verify_code',
      token_hash: codeHash,
      user_id: user.id,
      email: user.email_normalized,
      expires_at: expiresAt,
    });

    await getEmailAdapter().sendVerificationCode({
      to: user.email,
      code: rawCode,
    });

    const session = await this.issueTokens(user);

    return {
      user: this.toUserDto(user),
      session,
    };
  },

  async signInWithPassword(input: SignInPasswordRequest): Promise<AuthResponse> {
    const emailNormalized = input.email.trim().toLowerCase();

    const user = await authRepo.findUserByNormalizedEmail(emailNormalized);
    if (!user || !user.password_hash) {
      throw new AuthError('UNAUTHORIZED', 'Invalid email or password', 401);
    }

    const isValid = await this.verifyPassword(user.password_hash, input.password);
    if (!isValid) {
      throw new AuthError('UNAUTHORIZED', 'Invalid email or password', 401);
    }

    if (user.status !== 'active') {
      throw new AuthError('UNAUTHORIZED', 'Account is suspended or deactivated', 403);
    }

    const session = await this.issueTokens(user);

    return {
      user: this.toUserDto(user),
      session,
    };
  },

  // ─── Rotating Refresh Token ────────────────────────────────────────────────

  async refreshTokens(rawRefreshToken: string): Promise<AuthSessionDto> {
    const tokenHash = this.hashToken(rawRefreshToken);
    const session = await authRepo.findSessionByRefreshTokenHash(tokenHash);

    if (!session) {
      throw new AuthError('UNAUTHORIZED', 'Invalid refresh token', 401);
    }

    // AGENTS.md S-04: Replay detection
    if (session.consumed_at !== null) {
      // Replay detected! Revoke the whole family immediately.
      await authRepo.revokeSessionFamily(session.token_family_id);
      await this.markSidRevoked(session.token_family_id);
      throw new AuthError(
        'UNAUTHORIZED',
        'Refresh token replay detected. All sessions in this family revoked.',
        401
      );
    }

    if (session.revoked_at !== null) {
      throw new AuthError('UNAUTHORIZED', 'Session has been revoked', 401);
    }

    if (session.expires_at < new Date()) {
      throw new AuthError('UNAUTHORIZED', 'Refresh token has expired', 401);
    }

    const user = await authRepo.findUserById(session.user_id);
    if (!user || user.status !== 'active') {
      throw new AuthError('UNAUTHORIZED', 'User not found or inactive', 401);
    }

    // Rotate: Issue new refresh token in the same family and consume the old one
    const newRawRefreshToken = crypto.randomBytes(32).toString('hex');
    const newRefreshTokenHash = this.hashToken(newRawRefreshToken);
    const newExpiresAt = new Date(Date.now() + config.refreshTokenTtlMs);

    await authRepo.rotateSession(session.id, {
      user_id: user.id,
      refresh_token_hash: newRefreshTokenHash,
      token_family_id: session.token_family_id,
      expires_at: newExpiresAt,
      device_label: session.device_label,
      ip_hash: session.ip_hash,
      user_agent_summary: session.user_agent_summary,
    });

    const accessToken = this.createAccessToken(user, session.token_family_id);

    return {
      accessToken,
      refreshToken: newRawRefreshToken,
      expiresAt: newExpiresAt.toISOString(),
    };
  },

  // ─── Logout & Revocation ───────────────────────────────────────────────────

  async logout(tokenFamilyId: string, userId?: string): Promise<void> {
    await authRepo.revokeSessionFamily(tokenFamilyId);
    await this.markSidRevoked(tokenFamilyId);
    if (userId) {
      await pushDevicesRepo.deactivateAllForUser(userId);
    }
  },

  async logoutAll(userId: string): Promise<void> {
    const revokedFamilyIds = await authRepo.revokeAllUserSessions(userId);
    await Promise.all(revokedFamilyIds.map((sid) => this.markSidRevoked(sid)));
    // Rule P-04: Deactivate the device push token on logout and logout-all
    await pushDevicesRepo.deactivateAllForUser(userId);
  },

  // ─── Magic Link ────────────────────────────────────────────────────────────

  async requestMagicLink(email: string): Promise<void> {
    const emailNormalized = email.trim().toLowerCase();
    const user = await authRepo.findUserByNormalizedEmail(emailNormalized);

    // Rule S-09: Always respond the same whether or not email exists
    if (!user) {
      return;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await authRepo.createAuthToken({
      kind: 'magic_link',
      token_hash: tokenHash,
      user_id: user.id,
      email: user.email_normalized,
      expires_at: expiresAt,
    });

    const magicLinkUrl = `https://rota.app/magic-link?token=${rawToken}`;
    await getEmailAdapter().sendMagicLink({
      to: user.email,
      magicLinkUrl,
    });
  },

  async verifyMagicLink(rawToken: string): Promise<AuthResponse> {
    const tokenHash = this.hashToken(rawToken);
    const tokenRow = await authRepo.findAuthTokenByHash(tokenHash, 'magic_link');

    if (!tokenRow || tokenRow.consumed_at !== null || tokenRow.expires_at < new Date()) {
      throw new AuthError('UNAUTHORIZED', 'Invalid or expired magic link', 401);
    }

    await authRepo.consumeAuthToken(tokenRow.id);

    if (!tokenRow.user_id) {
      throw new AuthError('UNAUTHORIZED', 'Invalid magic link user association', 401);
    }

    const user = await authRepo.findUserById(tokenRow.user_id);
    if (!user) {
      throw new AuthError('UNAUTHORIZED', 'User not found', 401);
    }

    // Magic link sign-in counts as verified email (AGENTS.md S-07)
    if (!user.email_verified_at) {
      await authRepo.markEmailVerified(user.id);
      user.email_verified_at = new Date();
    }

    const session = await this.issueTokens(user);

    return {
      user: this.toUserDto(user),
      session,
    };
  },

  // ─── Password Reset ────────────────────────────────────────────────────────

  async requestPasswordReset(email: string): Promise<void> {
    const emailNormalized = email.trim().toLowerCase();
    const user = await authRepo.findUserByNormalizedEmail(emailNormalized);

    // Rule S-09: Return identical response
    if (!user) {
      return;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await authRepo.createAuthToken({
      kind: 'password_reset',
      token_hash: tokenHash,
      user_id: user.id,
      email: user.email_normalized,
      expires_at: expiresAt,
    });

    const resetUrl = `https://rota.app/reset-password?token=${rawToken}`;
    await getEmailAdapter().sendPasswordReset({
      to: user.email,
      resetUrl,
    });
  },

  async confirmPasswordReset(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    const tokenRow = await authRepo.findAuthTokenByHash(tokenHash, 'password_reset');

    if (!tokenRow || tokenRow.consumed_at !== null || tokenRow.expires_at < new Date()) {
      throw new AuthError('UNAUTHORIZED', 'Invalid or expired reset token', 401);
    }

    await authRepo.consumeAuthToken(tokenRow.id);

    if (!tokenRow.user_id) {
      throw new AuthError('UNAUTHORIZED', 'Invalid reset token user association', 401);
    }

    const newPasswordHash = await this.hashPassword(newPassword);
    await authRepo.updatePasswordHash(tokenRow.user_id, newPasswordHash);

    // Revoke all existing sessions across devices on password change (Rule S-03)
    await this.logoutAll(tokenRow.user_id);
  },

  // ─── Email Verification Code ───────────────────────────────────────────────

  async verifyEmailCode(userId: string, rawCode: string): Promise<void> {
    const codeHash = this.hashToken(`${userId}:${rawCode}`);
    const tokenRow = await authRepo.findAuthTokenByHash(codeHash, 'email_verify_code');

    if (
      !tokenRow ||
      tokenRow.user_id !== userId ||
      tokenRow.consumed_at !== null ||
      tokenRow.expires_at < new Date()
    ) {
      if (tokenRow) {
        const attempts = await authRepo.incrementTokenAttempts(tokenRow.id);
        if (attempts >= 5) {
          await authRepo.consumeAuthToken(tokenRow.id); // Invalidate after 5 attempts
        }
      }
      throw new AuthError('VALIDATION_ERROR', 'Invalid or expired verification code', 400);
    }

    await authRepo.consumeAuthToken(tokenRow.id);
    await authRepo.markEmailVerified(userId);
  },

  // ─── Me profile & teams ───────────────────────────────────────────────────

  async getMe(userId: string): Promise<MeResponse> {
    const user = await authRepo.findUserById(userId);
    if (!user) {
      throw new AuthError('NOT_FOUND', 'User not found', 404);
    }

    const userTeams = await authRepo.getUserTeams(userId);
    const teams: TeamDto[] = [];

    for (const ut of userTeams) {
      const team = await teamsRepo.findTeamById(ut.team_id);
      if (team) {
        teams.push({
          id: team.id,
          name: team.name,
          timezone: team.timezone,
          role: ut.role,
          status: team.status as 'active',
          createdAt: team.created_at.toISOString(),
        });
      }
    }

    return {
      user: this.toUserDto(user),
      teams,
    };
  },
};

