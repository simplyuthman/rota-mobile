/**
 * =============================================================================
 * Rota API — Auth Routes
 * =============================================================================
 * AGENTS.md §3.3 (S-01 through S-09) & §4 (L-05):
 * HTTP endpoints for authentication, token rotation, and sessions.
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  SignUpRequestSchema,
  SignInPasswordRequestSchema,
  MagicLinkRequestSchema,
  MagicLinkVerifyRequestSchema,
  RefreshTokenRequestSchema,
  PasswordResetRequestSchema,
  PasswordResetConfirmRequestSchema,
  VerifyEmailCodeRequestSchema,
} from '@rota/contracts';
import { authService } from './auth.service.js';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimits } from '../../middleware/rateLimit.js';

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /auth/signup
   * Creates user, default settings, and returns session + initial access token.
   */
  fastify.post(
    '/auth/signup',
    {
      preHandler: [rateLimits.loginIp],
    },
    async (request, reply) => {
      const body = SignUpRequestSchema.parse(request.body);
      const result = await authService.signUp(body);
      return reply.status(201).send(result);
    }
  );

  /**
   * POST /auth/login
   * Password authentication with account and IP rate limiting (Rule S-08).
   */
  fastify.post(
    '/auth/login',
    {
      preHandler: [rateLimits.loginAccount, rateLimits.loginIp],
    },
    async (request, reply) => {
      const body = SignInPasswordRequestSchema.parse(request.body);
      const result = await authService.signInWithPassword(body);
      return reply.status(200).send(result);
    }
  );

  /**
   * POST /auth/magic-link
   * Request email magic link. Responds same whether email exists (Rule S-09).
   */
  fastify.post(
    '/auth/magic-link',
    {
      preHandler: [rateLimits.loginAccount, rateLimits.loginIp],
    },
    async (request, reply) => {
      const body = MagicLinkRequestSchema.parse(request.body);
      await authService.requestMagicLink(body.email);
      return reply.status(200).send({
        message: 'If an account exists, a sign-in link has been sent to your email.',
      });
    }
  );

  /**
   * POST /auth/magic-link/verify
   * Verifies magic link token and returns session.
   */
  fastify.post('/auth/magic-link/verify', async (request, reply) => {
    const body = MagicLinkVerifyRequestSchema.parse(request.body);
    const result = await authService.verifyMagicLink(body.token);
    return reply.status(200).send(result);
  });

  /**
   * POST /auth/refresh
   * Single-use rotating refresh token (Rule S-04). Replay revokes family.
   */
  fastify.post('/auth/refresh', async (request, reply) => {
    const body = RefreshTokenRequestSchema.parse(request.body);
    const result = await authService.refreshTokens(body.refreshToken);
    return reply.status(200).send(result);
  });

  /**
   * POST /auth/logout
   * Revokes current token family and adds sid to Redis revoked set for 15m (Rule S-03).
   */
  fastify.post(
    '/auth/logout',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (request.tokenFamilyId) {
        await authService.logout(request.tokenFamilyId);
      }
      return reply.status(200).send({ message: 'Logged out successfully.' });
    }
  );

  /**
   * POST /auth/logout-all
   * Revokes all token families for user across all devices (Rule S-03).
   */
  fastify.post(
    '/auth/logout-all',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      await authService.logoutAll(request.userId!);
      return reply.status(200).send({ message: 'All sessions logged out successfully.' });
    }
  );

  /**
   * POST /auth/password-reset
   * Initiates password reset. Responds identically whether email exists (Rule S-09).
   */
  fastify.post(
    '/auth/password-reset',
    {
      preHandler: [rateLimits.passwordResetEmail, rateLimits.passwordResetIp],
    },
    async (request, reply) => {
      const body = PasswordResetRequestSchema.parse(request.body);
      await authService.requestPasswordReset(body.email);
      return reply.status(200).send({
        message: 'If an account exists, a password reset link has been sent.',
      });
    }
  );

  /**
   * POST /auth/password-reset/confirm
   * Resets password and revokes all active sessions (Rule S-03).
   */
  fastify.post('/auth/password-reset/confirm', async (request, reply) => {
    const body = PasswordResetConfirmRequestSchema.parse(request.body);
    await authService.confirmPasswordReset(body.token, body.newPassword);
    return reply.status(200).send({ message: 'Password reset successfully.' });
  });

  /**
   * POST /auth/verify-email
   * Verifies email using 6-digit code.
   */
  fastify.post(
    '/auth/verify-email',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const body = VerifyEmailCodeRequestSchema.parse(request.body);
      await authService.verifyEmailCode(request.userId!, body.code);
      return reply.status(200).send({ message: 'Email verified successfully.' });
    }
  );

  /**
   * GET /me
   * Returns current authenticated user and list of teams.
   */
  fastify.get(
    '/me',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const result = await authService.getMe(request.userId!);
      return reply.status(200).send(result);
    }
  );
};
