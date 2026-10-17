/**
 * =============================================================================
 * Rota API — Sliding-Window Redis Rate Limiter
 * =============================================================================
 * AGENTS.md §3.3 (S-08):
 * Rate limit with Redis, never in-memory state. Sliding window, 429 with Retry-After.
 * Keyed per account AND per IP:
 *   - Login: 5/min per account, 30/min per IP
 *   - Password reset: 3/hour per email, 10/hour per IP
 *   - Invites: 20/hour per team
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { redisCache } from '../db/redis.js';

export interface RateLimitOptions {
  scope: string;
  maxRequests: number;
  windowSeconds: number;
  identifierExtractor: (request: FastifyRequest) => string | undefined;
}

export function createRateLimiter(options: RateLimitOptions) {
  return async function rateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const identifier = options.identifierExtractor(request);
    if (!identifier) {
      return; // If no identifier extracted, bypass
    }

    const key = `ratelimit:${options.scope}:${identifier}`;
    const now = Date.now();
    const windowStart = now - options.windowSeconds * 1000;

    try {
      // Use Redis sorted set for clean sliding-window tracking
      const multi = redisCache.multi();
      multi.zremrangebyscore(key, 0, windowStart);
      multi.zadd(key, now, `${now}:${Math.random().toString(36).slice(2)}`);
      multi.zcard(key);
      multi.expire(key, options.windowSeconds);

      const results = await multi.exec();
      if (!results) return;

      const count = results[2]?.[1] as number;

      if (count > options.maxRequests) {
        reply.header('Retry-After', options.windowSeconds);
        return reply.status(429).send({
          error: {
            code: 'RATE_LIMITED',
            message: `Too many requests for ${options.scope}. Please try again later.`,
            requestId: request.id,
            details: { retryAfterSeconds: options.windowSeconds },
          },
        });
      }
    } catch {
      // If Redis has a transient error, fail open rather than breaking legitimate traffic
    }
  };
}

// Pre-configured rate limiters per Rule S-08:
export const rateLimits = {
  loginAccount: createRateLimiter({
    scope: 'login:account',
    maxRequests: 5,
    windowSeconds: 60,
    identifierExtractor: (req) =>
      typeof (req.body as Record<string, unknown> | null | undefined)?.['email'] === 'string'
        ? ((req.body as Record<string, unknown>)['email'] as string).toLowerCase().trim()
        : undefined,
  }),

  loginIp: createRateLimiter({
    scope: 'login:ip',
    maxRequests: 30,
    windowSeconds: 60,
    identifierExtractor: (req) => req.ip,
  }),

  passwordResetEmail: createRateLimiter({
    scope: 'reset:email',
    maxRequests: 3,
    windowSeconds: 3600,
    identifierExtractor: (req) =>
      typeof (req.body as Record<string, unknown> | null | undefined)?.['email'] === 'string'
        ? ((req.body as Record<string, unknown>)['email'] as string).toLowerCase().trim()
        : undefined,
  }),

  passwordResetIp: createRateLimiter({
    scope: 'reset:ip',
    maxRequests: 10,
    windowSeconds: 3600,
    identifierExtractor: (req) => req.ip,
  }),

  invitesTeam: createRateLimiter({
    scope: 'invites:team',
    maxRequests: 20,
    windowSeconds: 3600,
    identifierExtractor: (req) => (req.params as Record<string, string> | null | undefined)?.['teamId'],
  }),

  checkoutTeam: createRateLimiter({
    scope: 'checkout:team',
    maxRequests: 5,
    windowSeconds: 3600,
    identifierExtractor: (req) =>
      (req.params as Record<string, string> | undefined)?.['teamId'] ||
      (req.headers['x-team-id'] as string | undefined),
  }),

  feedUser: createRateLimiter({
    scope: 'feed:user',
    maxRequests: process.env['LOAD_TEST'] === '1' ? 10_000 : 60,
    windowSeconds: 60,
    identifierExtractor: (req) => req.user?.id || req.ip,
  }),
};
