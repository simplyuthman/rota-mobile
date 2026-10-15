-- ==============================================================================
-- Migration: 0001_initial — Control Plane Schema
-- Database: control_plane
-- ==============================================================================
-- Tables in this migration (BACKEND-SCHEMA.md §3.1, §3.7, §3.8, §7):
--   users, auth_sessions, auth_tokens
--   user_settings, push_devices
--   team_directory, user_team_index
--   idempotency_keys, billing_quotes, payment_webhook_events
--
-- Rules enforced here:
--   - No foreign key crosses the control-plane/shard line (AGENTS.md §2.2)
--   - All instants are timestamptz in UTC (BACKEND-SCHEMA.md §1)
--   - Tokens are always hashed; raw values are never stored (AGENTS.md S-06)
-- ==============================================================================

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ==============================================================================
-- 1. Users
-- ==============================================================================
CREATE TABLE users (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text        NOT NULL,
  email_normalized    text        NOT NULL UNIQUE,
  password_hash       text,                          -- NULL for magic-link-only accounts
  display_name        text        NOT NULL DEFAULT '',
  email_verified_at   timestamptz,
  status              text        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'pending_deletion')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ==============================================================================
-- 2. Auth sessions (refresh token storage, rotation)
-- Access tokens are JWTs (not stored). Logout/logout-all write revoked
-- `sid` (token_family_id) to Redis with a 15-minute TTL.
-- ==============================================================================
CREATE TABLE auth_sessions (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash      text        NOT NULL UNIQUE,  -- hashed; never raw (AGENTS.md S-06)
  token_family_id         uuid        NOT NULL,          -- sid claim on the access token
  created_at              timestamptz NOT NULL DEFAULT now(),
  expires_at              timestamptz NOT NULL,
  consumed_at             timestamptz,                   -- set when rotated
  revoked_at              timestamptz,                   -- set on logout or family revocation
  replaced_by_session_id  uuid        REFERENCES auth_sessions(id),
  device_label            text,
  last_used_at            timestamptz,
  ip_hash                 text,
  user_agent_summary      text
);

CREATE INDEX auth_sessions_user_active_idx
  ON auth_sessions(user_id, expires_at)
  WHERE revoked_at IS NULL;

-- ==============================================================================
-- 3. Auth tokens (password reset, magic link, email verification codes)
-- ==============================================================================
CREATE TABLE auth_tokens (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text        NOT NULL
    CHECK (kind IN ('password_reset', 'magic_link', 'email_verify_code')),
  token_hash    text        NOT NULL UNIQUE,   -- always hashed, never raw (AGENTS.md S-06)
  user_id       uuid        REFERENCES users(id) ON DELETE CASCADE,
  email         text,                          -- for pre-signup magic links
  attempts      integer     NOT NULL DEFAULT 0, -- brute-force guard for one-time codes
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_tokens_user_kind_idx
  ON auth_tokens(user_id, kind, expires_at);

-- ==============================================================================
-- 4. User settings
-- Keyed by user (one row per user, not per membership).
-- timezone has no default — it is set from the device on first launch (P-07).
-- ==============================================================================
CREATE TABLE user_settings (
  user_id                     uuid        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  timezone                    text        NOT NULL,  -- IANA; NO DEFAULT (AGENTS.md P-07)
  quiet_hours_enabled         boolean     NOT NULL DEFAULT false,
  quiet_hours_start           time,
  quiet_hours_end             time,
  notification_preferences    jsonb       NOT NULL DEFAULT '{}',
  language                    text        NOT NULL DEFAULT 'en',
  theme                       text        NOT NULL DEFAULT 'system'
    CHECK (theme IN ('light', 'dark', 'system')),
  field_updated_at            jsonb       NOT NULL DEFAULT '{}', -- server-stamped per accepted field
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  version                     integer     NOT NULL DEFAULT 1,
  CHECK (
    quiet_hours_enabled = false
    OR (quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL)
  )
);

-- ==============================================================================
-- 5. Push devices
-- Upserted by (provider, token_hash); user_id is reassigned on shared phones.
-- ==============================================================================
CREATE TABLE push_devices (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        text        NOT NULL,
  token_hash      text        NOT NULL,              -- hashed; token_ciphertext holds the encrypted raw value
  token_ciphertext text,
  platform        text        NOT NULL CHECK (platform IN ('ios', 'android')),
  device_label    text,
  active          boolean     NOT NULL DEFAULT true,
  deactivated_at  timestamptz,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, token_hash)
);

CREATE INDEX push_devices_user_active_idx
  ON push_devices(user_id)
  WHERE active = true;

-- ==============================================================================
-- 6. Team directory (shard routing)
-- Maps team_id → shard_id. Consulted by every team-scoped request.
-- Routing function: crc32(team_id) mod 2 (documented in SHARDING.md).
-- ==============================================================================
CREATE TABLE team_directory (
  team_id     uuid        PRIMARY KEY,
  shard_id    smallint    NOT NULL CHECK (shard_id IN (0, 1)),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ==============================================================================
-- 7. User–team index (control plane denormalization)
-- Keeps a denormalized copy of each user's memberships for login resolution.
-- Authoritative source is always the shard; this index is reconcilable.
-- ==============================================================================
CREATE TABLE user_team_index (
  user_id   uuid  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id   uuid  NOT NULL,   -- plain uuid; no FK across databases (AGENTS.md §2.2)
  role      text  NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  status    text  NOT NULL,
  PRIMARY KEY (user_id, team_id)
);

-- ==============================================================================
-- 8. Idempotency keys
-- Stored per (scope, key) so payment and non-payment operations cannot collide.
-- ==============================================================================
CREATE TABLE idempotency_keys (
  key           text        NOT NULL,
  scope         text        NOT NULL,
  request_hash  text        NOT NULL,
  response      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

-- ==============================================================================
-- 9. Billing quotes (control plane)
-- Created before checkout; checkout charges exactly the quoted amount.
-- Expires at the earlier of 30 minutes or period end (M-07).
-- ==============================================================================
CREATE TABLE billing_quotes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       uuid        NOT NULL,   -- plain uuid; shard found via team_directory
  inputs        jsonb       NOT NULL,   -- plan, seats, effective_at, period bounds, current_recurring_cents
  amount_cents  integer     NOT NULL,   -- checkout charges exactly this; never recomputed (M-07)
  expires_at    timestamptz NOT NULL,   -- earlier of 30 min or period end
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ==============================================================================
-- 10. Payment webhook events (global dedupe)
-- Lives in the control plane so duplicate events are deduped across shards.
-- Signature must be verified BEFORE reading the payload (M-09).
-- ==============================================================================
CREATE TABLE payment_webhook_events (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text        NOT NULL,
  provider_event_id text        NOT NULL,
  team_id           uuid,       -- from checkout metadata; routes to a shard
  event_type        text        NOT NULL,
  payload_hash      text        NOT NULL,
  status            text        NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'queued', 'processed', 'failed', 'ignored_duplicate')),
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  failure_reason    text,
  UNIQUE (provider, provider_event_id)  -- global dedupe guard (M-10)
);
