/**
 * =============================================================================
 * Rota API — Authentication Middleware
 * =============================================================================
 * AGENTS.md §3.3 (S-03):
 * Verifies 15-minute access token JWT and checks the Redis revoked set for `sid`.
 * Attaches authenticated user to request.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { authService, AuthError } from '../modules/auth/auth.service.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  sid: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
    userId?: string;
    tokenFamilyId?: string;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid Authorization header',
        requestId: request.id,
      },
    });
  }

  const token = authHeader.substring(7).trim();

  try {
    const payload = authService.verifyAccessToken(token);

    // Rule S-03: Check the Redis revoked set for this sid
    const isRevoked = await authService.isSidRevoked(payload.sid);
    if (isRevoked) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Session has been revoked',
          requestId: request.id,
        },
      });
    }

    request.user = {
      id: payload.sub,
      email: payload.email,
      sid: payload.sid,
    };
    request.userId = payload.sub;
    request.tokenFamilyId = payload.sid;
  } catch (err) {
    if (err instanceof AuthError) {
      return reply.status(err.statusCode).send({
        error: {
          code: err.code,
          message: err.message,
          requestId: request.id,
        },
      });
    }

    return reply.status(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired access token',
        requestId: request.id,
      },
    });
  }
}
