-- ==============================================================================
-- Migration: 0001_initial — Shard Schema
-- Databases: rota_shard_0, rota_shard_1 (applied to both identically)
-- ==============================================================================
-- Tables in this migration (BACKEND-SCHEMA.md §3.2–§3.9):
--   teams, team_memberships, invitations
--   shifts, shift_assignments
--   swap_requests
--   activity_events
--   subscriptions, billing_ledger_entries
--   domain_outbox_events, notification_jobs
--   product_events
--
-- Rules enforced here:
--   - No FK crosses the control-plane/shard line (AGENTS.md §2.2, L-09)
--   - user_id columns are plain uuid, validated in code
--   - Same-team integrity via UNIQUE(team_id, id) + composite FKs (BACKEND-SCHEMA.md §1)
--   - Ledger is append-only; UPDATE/DELETE revoked for app role after setup
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ==============================================================================
-- 1. Teams
-- ==============================================================================
CREATE TABLE teams (
  id                  uuid        PRIMARY KEY,          -- minted by the API, registered in team_directory
  name                text        NOT NULL,
  timezone            text        NOT NULL,             -- IANA; shifts always display in this zone (D-02)
  created_by_user_id  uuid        NOT NULL,             -- control-plane user; no FK across DBs
  status              text        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed')),             -- billing restriction derived from subscriptions.status (M-15)
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
  -- 'industry' column is excluded per AGENTS.md X-02
);

-- ==============================================================================
-- 2. Team memberships
-- ==============================================================================
CREATE TABLE team_memberships (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       uuid        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL,   -- control-plane user; validated in code (L-09)
  role          text        NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  status        text        NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'active', 'suspended', 'removed')),
  activated_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id),
  UNIQUE (team_id, id)   -- composite FK target for same-team references
);

CREATE INDEX memberships_team_status_idx ON team_memberships(team_id, status);
CREATE INDEX memberships_user_status_idx ON team_memberships(user_id, status);

-- Backstop: at most one active owner.
-- The API enforces the rule first (OWNER_IMMUTABLE); the index is a safety net (A-04).
CREATE UNIQUE INDEX one_active_owner
  ON team_memberships(team_id)
  WHERE role = 'owner' AND status = 'active';

-- ==============================================================================
-- 3. Invitations
-- Tokens are built as {teamId}.{random} so the shard can be found before lookup.
-- Stored always-hashed (AGENTS.md S-06).
-- Only the Owner can create invitations (AGENTS.md A-05).
-- ==============================================================================
CREATE TABLE invitations (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                 uuid        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email_normalized        text,
  intended_role           text        NOT NULL CHECK (intended_role IN ('manager', 'staff')),
  token_hash              text        NOT NULL UNIQUE,   -- ALWAYS hashed; token = {teamId}.{random}
  invited_by_membership_id uuid       NOT NULL,
  status                  text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at              timestamptz NOT NULL,
  accepted_by_user_id     uuid,       -- control-plane user; no FK
  accepted_at             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (team_id, invited_by_membership_id)
    REFERENCES team_memberships(team_id, id)
);

CREATE INDEX invitations_team_status_idx
  ON invitations(team_id, status, expires_at);

-- ==============================================================================
-- 4. Shifts
-- ==============================================================================
CREATE TABLE shifts (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                     uuid        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  title                       text        NOT NULL,
  location_label              text,
  notes                       text,       -- NEVER cached, NEVER in push, NEVER shown to staff (A-07, D-03)
  starts_at                   timestamptz NOT NULL,
  ends_at                     timestamptz NOT NULL,
  status                      text        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'cancelled')),
  created_by_membership_id    uuid        NOT NULL,
  updated_by_membership_id    uuid,
  published_at                timestamptz,
  cancelled_at                timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, id),   -- composite FK target
  CHECK (ends_at > starts_at),
  CHECK (ends_at - starts_at <= interval '24 hours'),  -- overnight allowed, max 24h
  FOREIGN KEY (team_id, created_by_membership_id) REFERENCES team_memberships(team_id, id),
  FOREIGN KEY (team_id, updated_by_membership_id) REFERENCES team_memberships(team_id, id)
);

CREATE INDEX shifts_team_start_idx        ON shifts(team_id, starts_at, id);
CREATE INDEX shifts_team_status_start_idx ON shifts(team_id, status, starts_at);

-- ==============================================================================
-- 5. Shift assignments
-- Overlap is prevented by advisory lock + check, not a constraint (A-09).
-- ==============================================================================
CREATE TABLE shift_assignments (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                     uuid        NOT NULL,
  shift_id                    uuid        NOT NULL,
  membership_id               uuid        NOT NULL,
  status                      text        NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'removed', 'completed')),
  assigned_at                 timestamptz NOT NULL DEFAULT now(),
  assigned_by_membership_id   uuid,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shift_id, membership_id),
  FOREIGN KEY (team_id, shift_id)                   REFERENCES shifts(team_id, id) ON DELETE CASCADE,
  FOREIGN KEY (team_id, membership_id)              REFERENCES team_memberships(team_id, id),
  FOREIGN KEY (team_id, assigned_by_membership_id)  REFERENCES team_memberships(team_id, id)
);

CREATE INDEX assignments_member_team_idx  ON shift_assignments(team_id, membership_id, status);
CREATE INDEX assignments_shift_idx        ON shift_assignments(shift_id);

-- ==============================================================================
-- 6. Swap requests
-- Direct handoff only (A-10). Open offers / two-way trades are out of MVP.
-- ==============================================================================
CREATE TABLE swap_requests (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                   uuid        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  shift_id                  uuid        NOT NULL,
  requester_membership_id   uuid        NOT NULL,
  target_membership_id      uuid        NOT NULL,   -- one nominated colleague
  status                    text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'declined', 'withdrawn', 'expired')),
  target_accepted_at        timestamptz,             -- NULL = waiting; set = waiting for manager
  expired_reason            text,
  message                   text,
  reviewed_by_membership_id uuid,
  reviewed_at               timestamptz,
  decision_note             text,
  idempotency_key           text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CHECK (requester_membership_id <> target_membership_id),
  CHECK (status <> 'approved' OR target_accepted_at IS NOT NULL),  -- approval requires acceptance
  FOREIGN KEY (team_id, shift_id)                   REFERENCES shifts(team_id, id),
  FOREIGN KEY (team_id, requester_membership_id)    REFERENCES team_memberships(team_id, id),
  FOREIGN KEY (team_id, target_membership_id)       REFERENCES team_memberships(team_id, id),
  FOREIGN KEY (team_id, reviewed_by_membership_id)  REFERENCES team_memberships(team_id, id)
);

CREATE INDEX swaps_team_status_created_idx
  ON swap_requests(team_id, status, created_at DESC, id DESC);
CREATE INDEX swaps_requester_created_idx
  ON swap_requests(requester_membership_id, created_at DESC);
CREATE INDEX swaps_target_status_idx
  ON swap_requests(target_membership_id, status);

CREATE UNIQUE INDEX swaps_idempotency_idx
  ON swap_requests(team_id, requester_membership_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- One pending swap per shift and requester (A-10).
-- The primary duplicate guard against two devices using different idempotency keys.
CREATE UNIQUE INDEX swaps_one_pending
  ON swap_requests(shift_id, requester_membership_id)
  WHERE status = 'pending';

-- ==============================================================================
-- 7. Activity events
-- visibility filters what each role can see (A-08, D-01).
-- Cursor: (team_id, created_at DESC, id DESC) — D-01
-- ==============================================================================
CREATE TABLE activity_events (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                     uuid        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  actor_membership_id         uuid,
  event_type                  text        NOT NULL,
  subject_type                text,
  subject_id                  uuid,
  params                      jsonb       NOT NULL DEFAULT '{}',   -- structured params; never rendered text
  visibility                  text        NOT NULL DEFAULT 'team'
    CHECK (visibility IN ('team', 'managers', 'owner', 'participants')),
  participant_membership_ids  uuid[]      NOT NULL DEFAULT '{}',
  created_at                  timestamptz NOT NULL DEFAULT now(),   -- transaction start time
  FOREIGN KEY (team_id, actor_membership_id) REFERENCES team_memberships(team_id, id)
);

-- Feed cursor index — used by the paginated activity query (D-01, D-06)
CREATE INDEX activity_team_cursor_idx
  ON activity_events(team_id, created_at DESC, id DESC);

-- ==============================================================================
-- 8. Subscriptions
-- One per team. billing restriction derived from status, not teams.status (M-15).
-- Seat ceilings enforced by CHECK (AGENTS.md §2.2).
-- ==============================================================================
CREATE TABLE subscriptions (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                   uuid        NOT NULL UNIQUE REFERENCES teams(id) ON DELETE CASCADE,
  plan                      text        NOT NULL CHECK (plan IN ('starter', 'team', 'business')),
  status                    text        NOT NULL DEFAULT 'trialing'
    CHECK (status IN ('trialing', 'active', 'past_due', 'grace', 'restricted', 'cancelled')),
  currency                  char(3)     NOT NULL DEFAULT 'USD',
  base_price_cents          integer     NOT NULL CHECK (base_price_cents >= 0),
  included_seats            integer     NOT NULL CHECK (included_seats > 0),
  extra_seat_price_cents    integer,
  purchased_seats           integer     NOT NULL,   -- purchased capacity; counted via SELECT FOR UPDATE (A-06)
  current_recurring_cents   integer     NOT NULL,   -- recurring amount in effect; updated on each applied change (M-06)
  scheduled_plan            text,                   -- scheduled change for period end
  scheduled_purchased_seats integer,
  scheduled_effective_at    timestamptz,
  trial_ends_at             timestamptz,
  period_start              timestamptz,
  period_end                timestamptz,
  grace_until               timestamptz,            -- 7 days after failed renewal (M-15)
  provider_customer_id      text,
  provider_subscription_id  text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  -- Seat ceilings (AGENTS.md §2.2, M-02):
  --   Starter: exactly 5 seats
  --   Team:    15–38 seats
  --   Business: 40–100 seats
  CHECK (
       (plan = 'starter'  AND purchased_seats = 5)
    OR (plan = 'team'     AND purchased_seats BETWEEN 15 AND 38)
    OR (plan = 'business' AND purchased_seats BETWEEN 40 AND 100)
  )
);

-- ==============================================================================
-- 9. Billing ledger entries
-- APPEND-ONLY. The application role is denied UPDATE/DELETE (set up after migration).
-- Corrections are new rows (M-12).
-- ==============================================================================
CREATE TABLE billing_ledger_entries (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id               uuid        NOT NULL REFERENCES teams(id),
  subscription_id       uuid        NOT NULL REFERENCES subscriptions(id),
  entry_type            text        NOT NULL
    CHECK (entry_type IN ('charge', 'credit', 'refund', 'adjustment')),
  amount_cents          integer     NOT NULL,   -- SIGNED: charges +, credits/refunds -, downgrades = 0 (M-12)
  currency              char(3)     NOT NULL,
  reason                text        NOT NULL,
  plan_after            text        NOT NULL,   -- state after this row, for ledger rebuild
  purchased_seats_after integer     NOT NULL,
  period_start          timestamptz,
  period_end            timestamptz,
  idempotency_key       text        NOT NULL UNIQUE,
  provider_reference    text,
  metadata              jsonb       NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (
       (entry_type = 'charge' AND amount_cents >= 0)
    OR (entry_type IN ('credit', 'refund') AND amount_cents <= 0)
    OR entry_type = 'adjustment'   -- adjustments can be zero (downgrade row)
  )
);

CREATE INDEX ledger_team_created_idx
  ON billing_ledger_entries(team_id, created_at DESC);

-- ==============================================================================
-- 10. Domain outbox events
-- Written in the same transaction as the domain mutation (D-05).
-- The relay publishes to BullMQ; if Redis flushes, the re-enqueue job recovers.
-- ==============================================================================
CREATE TABLE domain_outbox_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         uuid        REFERENCES teams(id),
  event_type      text        NOT NULL,
  aggregate_type  text        NOT NULL,
  aggregate_id    uuid        NOT NULL,
  payload         jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  attempts        integer     NOT NULL DEFAULT 0
);

CREATE INDEX outbox_unpublished_idx
  ON domain_outbox_events(created_at)
  WHERE published_at IS NULL;

-- ==============================================================================
-- 11. Notification jobs
-- Source of truth for notifications (L-02). BullMQ only executes.
-- UNIQUE (outbox_event_id, user_id, category) prevents duplicate sends (P-06).
-- ==============================================================================
CREATE TABLE notification_jobs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_event_id     uuid        NOT NULL REFERENCES domain_outbox_events(id),
  user_id             uuid        NOT NULL,   -- control-plane user; no FK across DBs
  team_id             uuid        REFERENCES teams(id),
  category            text        NOT NULL,   -- shift | swap | billing | activity | security
  event_type          text        NOT NULL,
  payload             jsonb       NOT NULL DEFAULT '{}',  -- {type, teamId, entityId} ONLY; never notes (P-05)
  collapse_key        text,                               -- digest collapse for delayed items
  scheduled_for       timestamptz NOT NULL DEFAULT now(),
  status              text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempts            integer     NOT NULL DEFAULT 0,
  provider_message_id text,
  last_error_code     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz,
  UNIQUE (outbox_event_id, user_id, category)   -- relay idempotency (L-02)
);

CREATE INDEX notification_due_idx
  ON notification_jobs(status, scheduled_for)
  WHERE status IN ('pending', 'failed');

-- ==============================================================================
-- 12. Product events (analytics / graduation evidence)
-- ==============================================================================
CREATE TABLE product_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         uuid        NOT NULL REFERENCES teams(id),
  actor_user_id   uuid,       -- control-plane user; no FK
  event_type      text        NOT NULL
    CHECK (event_type IN (
      'team_created', 'invite_sent', 'invite_accepted',
      'shift_published', 'swap_requested', 'swap_decided', 'plan_changed'
    )),
  props           jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ==============================================================================
-- Post-migration security: deny UPDATE/DELETE on the ledger for the app role.
-- The app role is 'rota_app'; adjust if the connection user differs.
-- REVOKE INSERT is NOT done — the app must append rows.
-- ==============================================================================
-- REVOKE UPDATE, DELETE ON billing_ledger_entries FROM rota_app;
-- Uncomment after creating the rota_app role in a companion setup script.
