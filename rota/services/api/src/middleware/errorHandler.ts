/**
 * =============================================================================
 * Rota API — Error Handler
 * =============================================================================
 * Converts any thrown error into the standard response envelope:
 *   { "error": { "code": "...", "message": "...", "requestId": "..." } }
 *
 * AGENTS.md §5 (standard error envelope), TRD §5.
 *
 * HTTP status mapping:
 *   - ZodError (validation)          → 422
 *   - RotaError with a code          → uses the code's mapped status
 *   - Everything else                → 500 (internal, message scrubbed in prod)
 *
 * O-01: Never log tokens, passwords, reset/magic links, or shift notes.
 * =============================================================================
 */

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { config } from '../config/env.js';

// ─── Rota domain error ────────────────────────────────────────────────────────

/** Known error codes from AGENTS.md and TRD §5. */
export type ErrorCode =
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'OWNER_IMMUTABLE'
  | 'SEAT_LIMIT'
  | 'SHIFT_OVERLAP'
  | 'SWAP_DUPLICATE'
  | 'PRORATION_NEGATIVE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

const STATUS_MAP: Record<ErrorCode, number> = {
  FORBIDDEN: 403,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  CONFLICT: 409,
  OWNER_IMMUTABLE: 409,
  SEAT_LIMIT: 409,
  SHIFT_OVERLAP: 409,
  SWAP_DUPLICATE: 409,
  PRORATION_NEGATIVE: 500, // assertion failure — must never reach a user
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export class RotaError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly retryAfter?: number | undefined;

  constructor(code: ErrorCode, message: string, retryAfter?: number) {
    super(message);
    this.name = 'RotaError';
    this.code = code;
    this.status = STATUS_MAP[code];
    if (retryAfter !== undefined) {
      this.retryAfter = retryAfter;
    }
  }
}

// ─── Error handler plugin ─────────────────────────────────────────────────────

export async function errorHandlerPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.setErrorHandler(
    (error: FastifyError | RotaError | ZodError | Error, request: FastifyRequest, reply: FastifyReply) => {
      const requestId = String(request.id);

      // Zod validation errors
      if (error instanceof ZodError) {
        const issues = error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        }));
        void reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            issues,
            requestId,
          },
        });
        return;
      }

      // Domain errors
      if (error instanceof RotaError) {
        if (error.retryAfter !== undefined) {
          void reply.header('Retry-After', String(error.retryAfter));
        }
        void reply.status(error.status).send({
          error: {
            code: error.code,
            message: error.message,
            requestId,
          },
        });
        return;
      }

      // Fastify built-in errors (e.g. 404 route not found, 405 method not allowed)
      const fastifyError = error as FastifyError;
      if (fastifyError.statusCode !== undefined && fastifyError.statusCode < 500) {
        void reply.status(fastifyError.statusCode).send({
          error: {
            code: fastifyError.code ?? 'ERROR',
            message: fastifyError.message,
            requestId,
          },
        });
        return;
      }

      // Unexpected errors — log at error level, scrub message in production
      request.log.error({ err: error, requestId }, 'Unhandled server error');

      void reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: config.isProduction
            ? 'An unexpected error occurred'
            : (error.message ?? 'An unexpected error occurred'),
          requestId,
        },
      });
    },
  );
}
