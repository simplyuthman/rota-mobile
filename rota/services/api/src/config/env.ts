/**
 * =============================================================================
 * Rota API — Environment Configuration
 * =============================================================================
 * Validates all required environment variables at startup using Zod.
 * If a required variable is missing, the process throws immediately with a
 * clear error message rather than failing silently at runtime.
 *
 * AGENTS.md S-01: Keep every secret on the server. Never log these values.
 * =============================================================================
 */

import { z } from 'zod';

const envSchema = z.object({
  // ── Runtime ──────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('127.0.0.1'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // ── PostgreSQL — Control Plane ────────────────────────────────────────────
  DATABASE_CONTROL_URL: z.string().url(),
  DATABASE_CONTROL_READ_URL: z.string().url(),

  // ── PostgreSQL — Shard 0 ─────────────────────────────────────────────────
  DATABASE_SHARD_0_URL: z.string().url(),
  DATABASE_SHARD_0_READ_URL: z.string().url(),

  // ── PostgreSQL — Shard 1 ─────────────────────────────────────────────────
  DATABASE_SHARD_1_URL: z.string().url(),
  DATABASE_SHARD_1_READ_URL: z.string().url(),

  // ── Redis — Cache instance ───────────────────────────────────────────────
  REDIS_CACHE_URL: z.string().url(),

  // ── Redis — Queue instance (BullMQ, noeviction) ──────────────────────────
  REDIS_QUEUE_URL: z.string().url(),

  // ── Auth ─────────────────────────────────────────────────────────────────
  JWT_SECRET: z.string().min(32),
  REFRESH_TOKEN_SECRET: z.string().min(32),

  // ── Email — Resend (docs/decisions/002-email-provider.md) ────────────────
  RESEND_API_KEY: z.string().startsWith('re_'),
  EMAIL_FROM: z.string().email(),

  // ── Payments — Flutterwave (Phase 7, test mode only) ─────────────────────
  // Optional during Tier 1 build; validated more strictly in Phase 7.
  FLUTTERWAVE_SECRET_KEY: z.string().optional(),
  FLUTTERWAVE_WEBHOOK_SECRET: z.string().optional(),

  // ── Observability — Sentry ───────────────────────────────────────────────
  // Optional during local development.
  SENTRY_DSN: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parsed and validated environment configuration.
 * Import this object instead of `process.env` anywhere in the server.
 * Throws at startup if any required variable is missing or malformed.
 */
function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`❌ Invalid environment configuration:\n${formatted}\n\nSee .env.example`);
  }

  return result.data;
}

export const env = loadEnv();

/**
 * Derived configuration (computed from env, no external reads).
 */
export const config = {
  isProduction: env.NODE_ENV === 'production',
  isDevelopment: env.NODE_ENV === 'development',
  isTest: env.NODE_ENV === 'test',

  corsOrigins: env.CORS_ORIGINS.split(',').map((o) => o.trim()),

  /** Access token lifetime: 15 minutes (AGENTS.md S-03). */
  accessTokenTtlMs: 15 * 60 * 1000,

  /** Refresh token lifetime: 30 days. */
  refreshTokenTtlMs: 30 * 24 * 60 * 60 * 1000,

  /** Read-your-own-writes window: 5 seconds after a user's write (TRD §2). */
  readYourOwnWritesMs: 5_000,

  /** Trial period: 14 days (AGENTS.md §2.2). */
  trialDaysMs: 14 * 24 * 60 * 60 * 1000,

  /** Grace period: 7 days after failed renewal (AGENTS.md M-15). */
  gracePeriodMs: 7 * 24 * 60 * 60 * 1000,

  /** Quote expiry: 30 minutes (AGENTS.md M-07). */
  quoteExpiryMs: 30 * 60 * 1000,

  /**
   * Plan constants (cents) — AGENTS.md §2.2, M-02.
   * Never hardcode prices anywhere except this object.
   */
  plans: {
    starter: {
      basePriceCents: 2000,
      includedSeats: 5,
      extraSeatPriceCents: null as null,
      seatCeiling: 5,
    },
    team: {
      basePriceCents: 5000,
      includedSeats: 15,
      extraSeatPriceCents: 300,
      seatCeiling: 38,
    },
    business: {
      basePriceCents: 12000,
      includedSeats: 40,
      extraSeatPriceCents: 200,
      seatCeiling: 100,
    },
  },
} as const;

export type PlanName = keyof typeof config.plans;
