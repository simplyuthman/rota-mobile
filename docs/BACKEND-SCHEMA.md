# Rota — Backend and Database Schema

**Document status:** Draft v1.1 (revised after adversarial review; every ruling applied)

**Interpretation:** "Background Schema" is treated as the backend/database schema for implementation.

**Database:** PostgreSQL, split into a **control plane** and **two shards** (Section 7).

**Primary key convention:** UUID unless a provider-defined identifier is required.

**Time convention:** Store instants as `timestamptz` in UTC. Shifts display in the team's IANA time zone; quiet hours use the user's IANA time zone.

## 1. Modeling principles

- A team is the tenant boundary. All team-owned records carry `team_id` directly or through a parent whose team is verified.
- The server is authoritative for roles, subscription entitlements, settings, swap approval, and payment status.
- Use foreign keys, unique constraints, check constraints, and transactions to enforce domain invariants.
- **Same-team integrity** is enforced by `UNIQUE (team_id, id)` on parent tables and composite foreign keys such as `(team_id, shift_id) REFERENCES shifts(team_id, id)`.
- **No foreign key crosses the control-plane/shard line.** Postgres cannot make one across databases. Columns such as `user_id` on shard tables are plain `uuid`, validated in code.
- Keep an audit/activity record for material changes. Activity text is not stored rendered: store `event_type` plus structured `params`.
- Payment ledger rows are immutable; corrections create new rows.
- Do not trust IDs or roles supplied by the mobile client.
- Shard routing key is `team_id`, mapped by a stable hash to one of two PostgreSQL databases.

## 2. Entity relationship overview

```
CONTROL PLANE                                   SHARD (rota_shard_0 / rota_shard_1)
users ──< auth_sessions                         teams ──< team_memberships
  │   ──< auth_tokens                             │            │
  ├── user_settings (keyed by user)               ├── invitations
  ├── push_devices                                ├── shifts ──< shift_assignments >── team_memberships
  ├── user_team_index(user_id, team_id, ...)      ├── swap_requests ───────────────────┘
  team_directory(team_id → shard_id)              ├── activity_events
  idempotency_keys                                ├── subscriptions ──< billing_ledger_entries
  billing_quotes                                  ├── domain_outbox_events
  payment_webhook_events (global)                 ├── notification_jobs
                                                  └── product_events
```

`user_settings` hangs off `users` (it is keyed by user, not membership). `team_memberships` connects users to teams and defines role/status. A user can belong to more than one team. Every query scopes membership and resources to the selected team. Control-plane/shard links are by plain `uuid` only.

## 3. Core tables

The SQL below is a baseline, not a complete migration. Add enums, triggers, and provider-specific fields as implementation choices are finalized.

### 3.1 Control plane: users, sessions, tokens

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  email_normalized text NOT NULL UNIQUE,
  password_hash text,
  display_name text NOT NULL DEFAULT '',
  email_verified_at timestamptz,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'pending_deletion')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,
  token_family_id uuid NOT NULL,          -- this is the access token's `sid` claim
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  replaced_by_session_id uuid REFERENCES auth_sessions(id),
  device_label text,
  last_used_at timestamptz,
  ip_hash text,
  user_agent_summary text
);

CREATE INDEX auth_sessions_user_active_idx
  ON auth_sessions(user_id, expires_at) WHERE revoked_at IS NULL;

-- Password reset, magic link, and email verification code tokens.
CREATE TABLE auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL
    CHECK (kind IN ('password_reset', 'magic_link', 'email_verify_code')),
  token_hash text NOT NULL UNIQUE,         -- always hashed, never raw
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  email text,
  attempts integer NOT NULL DEFAULT 0,     -- brute-force guard for one-time codes
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_tokens_user_kind_idx ON auth_tokens(user_id, kind, expires_at);
```

Notes:

- Access tokens last 15 minutes and carry `sid = token_family_id`. Logout and logout-all write the revoked `sid` values to Redis (`auth:revoked:{sid}`) for 15 minutes. If Redis is flushed, the worst case is 15 minutes.
- Store only a hash of refresh tokens. Reuse of a consumed token rejects the request and revokes the family. Never store raw reset, magic-link, or refresh tokens, and never log them.

### 3.2 Shard: teams and memberships

```sql
CREATE TABLE teams (
  id uuid PRIMARY KEY,                      -- minted by the API, registered in team_directory
  name text NOT NULL,
  timezone text NOT NULL,                   -- IANA; shifts always display in this zone
  created_by_user_id uuid NOT NULL,         -- control-plane user; no FK across databases
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed')), -- billing restriction is derived from subscriptions.status
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- The `industry` column is removed until a feature reads it.

CREATE TABLE team_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,                    -- control-plane user; validated in code
  role text NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'active', 'suspended', 'removed')),
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id),
  UNIQUE (team_id, id)                      -- target for composite same-team foreign keys
);

CREATE INDEX memberships_team_status_idx ON team_memberships(team_id, status);
CREATE INDEX memberships_user_status_idx ON team_memberships(user_id, status);

-- Backstop: at most one active owner. The API enforces the rules first.
CREATE UNIQUE INDEX one_active_owner ON team_memberships(team_id)
  WHERE role = 'owner' AND status = 'active';
```

**Owner rules (enforced in the API, returning `409 OWNER_IMMUTABLE`):** the owner cannot change their own role, deactivate their own membership, or set another member's role to Owner. A unique index stops two owners but not zero, and a violation would surface as a 500, so the index is only a backstop. Ownership transfer is out of MVP.

**Seat model:** seats are purchased capacity (`subscriptions.purchased_seats`). Active memberships, counting owner and managers, never exceed it. Pending invitations do not reserve seats. Activating a membership runs in one transaction:

```sql
BEGIN;
SELECT purchased_seats FROM subscriptions WHERE team_id = $1 FOR UPDATE;
SELECT count(*) FROM team_memberships WHERE team_id = $1 AND status = 'active';
-- if count = purchased_seats: ROLLBACK and return 409 SEAT_LIMIT
UPDATE team_memberships SET status = 'active', activated_at = now() WHERE id = $2;
COMMIT;
```

The row lock serializes concurrent activations, so two accepts on the last seat give exactly one success.

### 3.3 Shard: invitations

```sql
CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email_normalized text,
  intended_role text NOT NULL CHECK (intended_role IN ('manager', 'staff')),
  token_hash text NOT NULL UNIQUE,          -- ALWAYS hashed; token = {teamId}.{random}
  invited_by_membership_id uuid NOT NULL,   -- always the owner's membership
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz NOT NULL,
  accepted_by_user_id uuid,                 -- control-plane user
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (team_id, invited_by_membership_id)
    REFERENCES team_memberships(team_id, id)
);

CREATE INDEX invitations_team_status_idx ON invitations(team_id, status, expires_at);
```

Invitation tokens are built as `{teamId}.{random}`, so the server finds the shard before lookup. Acceptance validates, in one transaction: expiry, one-time use, intended email when present, **a verified email** when the invite is email-bound, team and subscription state, and seat capacity (Section 3.2). The same token string doubles as the "invite code" for the Enter invite code screen.

### 3.4 Shard: shifts and assignments

```sql
CREATE TABLE shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  title text NOT NULL,
  location_label text,
  notes text,                               -- never cached, never in push, never shown to staff
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'cancelled')),
  created_by_membership_id uuid NOT NULL,
  updated_by_membership_id uuid,
  published_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, id),
  CHECK (ends_at > starts_at),
  CHECK (ends_at - starts_at <= interval '24 hours'),   -- overnight allowed, max 24h
  FOREIGN KEY (team_id, created_by_membership_id) REFERENCES team_memberships(team_id, id),
  FOREIGN KEY (team_id, updated_by_membership_id) REFERENCES team_memberships(team_id, id)
);

CREATE INDEX shifts_team_start_idx ON shifts(team_id, starts_at, id);
CREATE INDEX shifts_team_status_start_idx ON shifts(team_id, status, starts_at);

CREATE TABLE shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'removed', 'completed')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by_membership_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shift_id, membership_id),
  FOREIGN KEY (team_id, shift_id) REFERENCES shifts(team_id, id) ON DELETE CASCADE,
  FOREIGN KEY (team_id, membership_id) REFERENCES team_memberships(team_id, id),
  FOREIGN KEY (team_id, assigned_by_membership_id) REFERENCES team_memberships(team_id, id)
);

CREATE INDEX assignments_member_team_idx
  ON shift_assignments(team_id, membership_id, status);
CREATE INDEX assignments_shift_idx ON shift_assignments(shift_id);
```

**Overlap policy: always block. No override. No setting.** `shift_assignments` carries no time range, so overlap is prevented by a lock, not a constraint:

```sql
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended($membership_id::text, 0));
-- Check Draft and Published assignments with status 'assigned' for this member
-- whose shift range overlaps [$starts_at, $ends_at); cancelled shifts are ignored.
-- If any row matches: ROLLBACK and return 409 SHIFT_OVERLAP.
INSERT INTO shift_assignments ...;
COMMIT;
```

The lock is taken before the check so two managers cannot both pass it. Swap approval takes the same lock for the target.

**Visibility:** staff read only `status = 'published'` shifts for their team, without `notes`. Managers and owners read everything. Redis caches only the published, note-free calendar.

Daylight saving is handled by UTC storage plus a zone-aware date library at the edges.

### 3.5 Shard: swap requests

```sql
CREATE TABLE swap_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL,
  requester_membership_id uuid NOT NULL,
  target_membership_id uuid NOT NULL,       -- direct handoff: one nominated colleague
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'declined', 'withdrawn', 'expired')),
  target_accepted_at timestamptz,           -- NULL = waiting for colleague; set = waiting for manager
  expired_reason text,                      -- e.g. 'shift_cancelled', 'shift_started', 'timeout'
  message text,
  reviewed_by_membership_id uuid,
  reviewed_at timestamptz,
  decision_note text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (requester_membership_id <> target_membership_id),
  CHECK (status <> 'approved' OR target_accepted_at IS NOT NULL),
  FOREIGN KEY (team_id, shift_id) REFERENCES shifts(team_id, id),
  FOREIGN KEY (team_id, requester_membership_id) REFERENCES team_memberships(team_id, id),
  FOREIGN KEY (team_id, target_membership_id) REFERENCES team_memberships(team_id, id),
  FOREIGN KEY (team_id, reviewed_by_membership_id) REFERENCES team_memberships(team_id, id)
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

-- One pending swap per shift and requester. Two taps from two devices carry
-- different idempotency keys, so this index is the real duplicate guard.
CREATE UNIQUE INDEX swaps_one_pending
  ON swap_requests(shift_id, requester_membership_id) WHERE status = 'pending';
```

**Swap rules:**

- MVP swap is a direct handoff. Open offers and two-way trades are out of MVP.
- Flow: requester creates → colleague accepts (`target_accepted_at` set) or declines (`status = 'declined'`) → manager approves only after acceptance.
- Eligible shift: published, in the future, and the requester is currently assigned.
- Expiry: a pending swap expires when the shift starts or 7 days after creation, whichever is first. Cancelling a shift sets its pending swaps to `expired` with `expired_reason = 'shift_cancelled'`, in the same transaction.
- Approver cannot be the requester or the target. If the owner is the requester and no manager exists, the owner may approve, and the activity event is tagged `self_approved` (enforced in the service, not by `CHECK`).

**Approval transaction:**

1. Lock the swap request and relevant shift/assignment rows (`SELECT … FOR UPDATE`).
2. Verify the request is pending, `target_accepted_at` is set, and the reviewer is Owner/Manager in the same team and neither requester nor target (owner exception above).
3. Take `pg_advisory_xact_lock(hashtextextended(target_membership_id::text, 0))` and re-check eligibility, overlaps, and current assignments.
4. Update assignment rows atomically.
5. Set request status, reviewer, and time.
6. Insert the activity and outbox events in the same transaction.
7. Commit; notifications are delivered asynchronously.

### 3.6 Shard: activity feed

```sql
CREATE TABLE activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  actor_membership_id uuid,
  event_type text NOT NULL,
  subject_type text,
  subject_id uuid,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,   -- structured params; replaces rendered `summary` and `metadata`
  visibility text NOT NULL DEFAULT 'team'
    CHECK (visibility IN ('team', 'managers', 'owner', 'participants')),
  participant_membership_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),   -- transaction start time
  FOREIGN KEY (team_id, actor_membership_id) REFERENCES team_memberships(team_id, id)
);

CREATE INDEX activity_team_cursor_idx
  ON activity_events(team_id, created_at DESC, id DESC);
```

Billing events use `owner`. Swap events use `participants`, which means the listed people plus owner and managers. Params never contain shift notes. The client renders text from `event_type` plus `params`, in the viewer's language and the team's time zone.

**Cursor query:**

```sql
SELECT id, event_type, subject_type, subject_id, params,
       created_at::text AS created_at_text
FROM activity_events
WHERE team_id = $1
  AND ( $2::timestamptz IS NULL
        OR (created_at, id) < ($2::timestamptz, $3::uuid) )
  AND (visibility = 'team'
    OR (visibility = 'managers' AND $role IN ('owner','manager'))
    OR (visibility = 'owner' AND $role = 'owner')
    OR (visibility = 'participants'
        AND ($role IN ('owner','manager')
             OR $membership_id = ANY(participant_membership_ids))))
ORDER BY created_at DESC, id DESC
LIMIT $4;
```

- The cursor is base64url of `{createdAt: <created_at::text>, id}`. `created_at::text` keeps microseconds; the cursor never passes through a JavaScript `Date`.
- **Guarantee:** no duplicates, ever. Rows committed after the first page loaded appear on the next pull to refresh. A row committed late with an older timestamp (`now()` is the transaction start) appears only after a refresh.
- Validate the cursor, cap page size (20–50), and return `nextCursor` only when another page may exist.
- Capture `EXPLAIN ANALYZE` before and after the index, **for a staff view and an owner view**. The index matches the team-wide ordering; the visibility predicate is a filter on top of it, so the plans must be recorded per role.
- Seed at least 10,000 records.
- Redis caches the newest 50 raw events per team for 30 seconds (`team:{id}:feed:first:v{n}`). Filtering per viewer happens in code; if filtering leaves fewer rows than the page size, read the database.

### 3.7 Control plane: user settings and push devices

```sql
CREATE TABLE user_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  timezone text NOT NULL,                   -- IANA, from the device on first launch; NO default
  quiet_hours_enabled boolean NOT NULL DEFAULT false,
  quiet_hours_start time,
  quiet_hours_end time,
  notification_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  language text NOT NULL DEFAULT 'en',      -- stored and synced; row shown in UI only when a second language ships
  theme text NOT NULL DEFAULT 'system'
    CHECK (theme IN ('light', 'dark', 'system')),
  field_updated_at jsonb NOT NULL DEFAULT '{}',  -- server-stamped time per accepted field
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CHECK (
    quiet_hours_enabled = false
    OR (quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL)
  )
);

CREATE TABLE push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  token_hash text NOT NULL,
  token_ciphertext text,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  device_label text,
  active boolean NOT NULL DEFAULT true,
  deactivated_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, token_hash)
);

CREATE INDEX push_devices_user_active_idx ON push_devices(user_id) WHERE active = true;
```

**Settings rules:**

- The `PATCH` sends only changed fields. The server stamps each accepted field in `field_updated_at`; the most recent accepted change per field wins. A single row-level `updated_at` is not enough: a tablet sending the whole object would overwrite quiet hours with stale values while changing the theme.
- Documented weakness: a stale device can still overwrite the same field after it comes back online.
- Settings edits are blocked offline.
- Timezone is set from the device zone on first launch (the row is created then) and validated as an IANA name. There is no `'UTC'` default, so quiet hours never silently run in UTC.
- Quiet-hour evaluation handles overnight ranges (22:00–06:00) and daylight-saving transitions in the **user's** time zone.
- Notification categories: shift changes, swaps, billing, activity (each toggleable); security is not toggleable and is the only urgent category.

**Push token rules:**

- `POST /me/push-tokens` **upserts by token and reassigns `user_id`**, so a shared phone never leaves Alice's token active for Bob.
- Logout and logout-all send the device token to deactivate (`active = false`, `deactivated_at` set).
- Invalid tokens reported by the push service are deleted.
- If raw tokens must be stored, protect them as credentials and never log them. Push payloads never carry shift notes.

### 3.8 Subscriptions, ledger, quotes, webhook events

Subscriptions and the ledger live on the team's shard. Quotes, idempotency keys, and webhook events live in the control plane.

```sql
-- SHARD
CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL UNIQUE REFERENCES teams(id) ON DELETE CASCADE,
  plan text NOT NULL CHECK (plan IN ('starter', 'team', 'business')),
  status text NOT NULL DEFAULT 'trialing'
    CHECK (status IN ('trialing', 'active', 'past_due', 'grace', 'restricted', 'cancelled')),
  currency char(3) NOT NULL DEFAULT 'USD',
  base_price_cents integer NOT NULL CHECK (base_price_cents >= 0),
  included_seats integer NOT NULL CHECK (included_seats > 0),
  extra_seat_price_cents integer,
  purchased_seats integer NOT NULL,         -- seats are purchased capacity
  current_recurring_cents integer NOT NULL, -- recurring amount currently in effect
  scheduled_plan text,                      -- scheduled change applied by the billing scheduler
  scheduled_purchased_seats integer,
  scheduled_effective_at timestamptz,
  trial_ends_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  grace_until timestamptz,                  -- 7 days after a failed renewal
  provider_customer_id text,
  provider_subscription_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Seat ceilings: Starter 5; Team 15 to 38; Business 40 to 100 (operational ceiling).
  CHECK (
       (plan = 'starter'  AND purchased_seats = 5)
    OR (plan = 'team'     AND purchased_seats BETWEEN 15 AND 38)
    OR (plan = 'business' AND purchased_seats BETWEEN 40 AND 100)
  )
);
-- active_seat_count is dropped: a counter races under concurrency. Active
-- memberships are counted inside the activation transaction instead.

CREATE TABLE billing_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  entry_type text NOT NULL
    CHECK (entry_type IN ('charge', 'credit', 'refund', 'adjustment')),
  amount_cents integer NOT NULL,            -- SIGNED: charges positive; credits and refunds negative
  currency char(3) NOT NULL,
  reason text NOT NULL,
  plan_after text NOT NULL,                 -- state after this row, so state can be rebuilt
  purchased_seats_after integer NOT NULL,
  period_start timestamptz,
  period_end timestamptz,
  idempotency_key text NOT NULL UNIQUE,
  provider_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
       (entry_type = 'charge' AND amount_cents >= 0)
    OR (entry_type IN ('credit', 'refund') AND amount_cents <= 0)
    OR entry_type = 'adjustment'
  )
);
-- A downgrade moves no money: it writes a zero-amount 'adjustment' row so the
-- subscription state can still be rebuilt from the ledger.

CREATE INDEX ledger_team_created_idx ON billing_ledger_entries(team_id, created_at DESC);

-- CONTROL PLANE
CREATE TABLE billing_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,                    -- plain uuid; shard found via team_directory
  inputs jsonb NOT NULL,                    -- plan, seats, effective_at, period bounds, current_recurring_cents
  amount_cents integer NOT NULL,            -- checkout charges exactly this amount
  expires_at timestamptz NOT NULL,          -- earlier of 30 minutes or period end
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  key text NOT NULL,
  scope text NOT NULL,
  request_hash text NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

CREATE TABLE payment_webhook_events (       -- global, so duplicates are deduped across shards
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  team_id uuid,                             -- from checkout metadata; routes to a shard
  event_type text NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'queued', 'processed', 'failed', 'ignored_duplicate')),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  failure_reason text,
  UNIQUE (provider, provider_event_id)
);
```

**Plan constants and formula:**

| Plan | Base | Included seats | Extra seat | Seat ceiling |
|---|---:|---:|---:|---:|
| Starter | 2000 | 5 | unavailable | 5 |
| Team | 5000 | 15 | 300 | 38 |
| Business | 12000 | 40 | 200 | 100 |

`recurring_amount(plan, seats) = base + max(0, seats - included) × extra`. Never use floating-point arithmetic for money. Team at 39 seats would cost 12,200 cents against Business at 12,000, hence the Team ceiling of 38.

**Billing state:**

- New teams start `trialing` on Starter limits for 14 days, no card. First confirmed checkout sets `active`. A trial that ends unpaid becomes `restricted` (read-only).
- Failed renewal → `past_due` → `grace` (7 days, `grace_until`) → `restricted`. Team restriction is derived from `subscriptions.status`; `teams.status` has no billing values.
- The hourly billing scheduler applies scheduled changes at period end, starts renewal charges, moves `past_due` → `grace` → `restricted`, and ends trials.
- Changes are classified by cost: `new_amount > current_amount` is immediate and applies after payment confirmation; otherwise it is scheduled.

**Immutability:** deny UPDATE/DELETE to the application role on ledger entries; add a trigger if appropriate. Corrections are new rows. Reconciliation detects a provider event that was accepted but never processed.

### 3.9 Shard: outbox, notification jobs, product events

```sql
CREATE TABLE domain_outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid REFERENCES teams(id),
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);

CREATE INDEX outbox_unpublished_idx
  ON domain_outbox_events(created_at) WHERE published_at IS NULL;

CREATE TABLE notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_event_id uuid NOT NULL REFERENCES domain_outbox_events(id),
  user_id uuid NOT NULL,                    -- control-plane user; no FK across databases
  team_id uuid REFERENCES teams(id),
  category text NOT NULL,                   -- shift | swap | billing | activity | security
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {type, teamId, entityId} only; never notes
  collapse_key text,                        -- delayed items for one user collapse into one digest push
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  provider_message_id text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (outbox_event_id, user_id, category)   -- relay may publish twice; sends may not
);

CREATE INDEX notification_due_idx
  ON notification_jobs(status, scheduled_for) WHERE status IN ('pending', 'failed');

CREATE TABLE product_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id),
  actor_user_id uuid,
  event_type text NOT NULL
    CHECK (event_type IN ('team_created', 'invite_sent', 'invite_accepted',
                          'shift_published', 'swap_requested', 'swap_decided', 'plan_changed')),
  props jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**Pipeline rules:**

- `notification_jobs` is the source of truth. BullMQ only executes. A repeatable job every minute re-enqueues due rows in `pending` or `failed`, so a Redis flush cannot delete delayed sends.
- The unique key stops duplicates if the outbox relay publishes, crashes before setting `published_at`, and publishes again.
- Before sending, the worker re-checks that the entity still matches the event (a delayed "shift published" is dropped if the shift was cancelled at 3am; mark it `cancelled`).
- Delayed items for one user collapse into one digest push via `collapse_key`; superseded rows are set to `cancelled` with `last_error_code = 'collapsed'`.
- Urgent means security events only (new sign-in, logout-all, password change). Every other category obeys quiet hours.
- Push payloads carry `{type, teamId, entityId}` only; the app maps them to a screen.

## 4. Database constraints and transactional invariants

- Membership uniqueness: one row per `(team_id, user_id)`.
- Exactly zero-or-one active owner is protected by `one_active_owner`; owner self-demotion, self-deactivation, and promotion of others return `409 OWNER_IMMUTABLE` before the index is reached.
- Shift end after start, and at most 24 hours.
- Assignment, swap, and activity rows reference shifts and memberships through composite `(team_id, id)` foreign keys.
- Only Owner/Manager may mutate shifts; only Owner/Manager may approve/reject swaps.
- A member cannot hold overlapping assignments (advisory lock plus check, Draft and Published, status `assigned`).
- A swap transitions from Pending only once; at most one pending swap per shift and requester; approval requires `target_accepted_at`.
- Swap approval and assignment changes are atomic.
- Seat capacity and membership activation are serialized by `SELECT ... FOR UPDATE` on the subscription row; active memberships never exceed `purchased_seats`.
- Provider webhook event ID is unique per provider (globally, in the control plane).
- Ledger idempotency key is unique; ledger rows are append-only; amounts are signed.
- Activity event insertion is coupled to the domain mutation in the same transaction.
- Cache invalidation: bump the team cache version in the request right after commit; the outbox event repeats it as a safety net.

## 5. Indexing strategy

Initial indexes:

- `team_memberships(team_id, status)` and `(user_id, status)`; partial unique `one_active_owner`.
- `shifts(team_id, starts_at, id)` and `(team_id, status, starts_at)`.
- `shift_assignments(team_id, membership_id, status)`.
- `swap_requests(team_id, status, created_at DESC, id DESC)`, `(target_membership_id, status)`, and partial unique `swaps_one_pending`.
- `activity_events(team_id, created_at DESC, id DESC)`.
- `billing_ledger_entries(team_id, created_at DESC)`.
- Partial indexes for active sessions, active push devices, unpublished outbox events, and due notification jobs.

Capture actual query plans (feed: staff and owner views) and avoid speculative indexes. An index increases write cost and storage. If a filter column is later added to the feed query, re-capture the plan.

## 6. Redis key and invalidation conventions

**Queue and cache run on separate Redis instances.** BullMQ requires no eviction; a cache wants eviction. If only one free instance exists, set `noeviction`, give every cache key a TTL, and keep the cache small.

Cache instance:

- `team:{id}:roster:v{n}` (name and role only; no email)
- `team:{id}:cal:pub:{start}:{end}:v{n}` (published, note-free calendar only; drafts and notes are never cached)
- `team:{id}:feed:first:v{n}` (newest 50 raw events, 30 s TTL; filtered per viewer in code)
- `auth:revoked:{sid}` (15-minute TTL; revoked session ids)
- Rate limits (sliding window; `429` with `Retry-After`; per account and per IP, IP limit higher):
  - `rate:login:acct:{emailHash}` 5/min; `rate:login:ip:{ipHash}` 30/min
  - `rate:pwreset:email:{emailHash}` 3/hour; `rate:pwreset:ip:{ipHash}` 10/hour
  - `rate:invite:{teamId}` 20/hour
  - `rate:checkout:{teamId}` 5/hour
  - `rate:feed:{userId}` 60/min

Queue instance: keys managed by the job library.

Every cache key has a bounded TTL. Cache values are derived and may be discarded. After a shift or membership mutation, bump the team version **in the request right after commit**; the outbox event repeats it. Never cache active subscriptions, payment status, credit balances, or webhook idempotency records.

## 7. Two-database sharding simulation

Create two separate PostgreSQL databases (e.g. `rota_shard_0`, `rota_shard_1`) plus a small control-plane database.

**Control plane holds:** `users`, `auth_sessions`, `auth_tokens`, `user_settings`, `push_devices`, `team_directory(team_id, shard_id)`, `user_team_index(user_id, team_id, role, status)`, `idempotency_keys`, `billing_quotes`, and a global `payment_webhook_events`.

**Shards hold the team-owned tables:** `teams`, `team_memberships`, `invitations`, `shifts`, `shift_assignments`, `swap_requests`, `activity_events`, `subscriptions`, `billing_ledger_entries`, `domain_outbox_events`, `notification_jobs`, `product_events`.

```sql
-- CONTROL PLANE
CREATE TABLE team_directory (
  team_id uuid PRIMARY KEY,
  shard_id smallint NOT NULL CHECK (shard_id IN (0, 1)),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_team_index (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id uuid NOT NULL,                    -- plain uuid; no FK across databases
  role text NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  status text NOT NULL,
  PRIMARY KEY (user_id, team_id)
);
```

**Routing:**

- Route team-owned records by a stable function such as `hash(team_id) mod 2`. Use a stable, documented hash (not a runtime-randomized language hash). Record the result in `team_directory` and test it.
- Remove cross-database foreign keys. Columns such as `user_id` on shard tables are plain `uuid` validated in code.
- **Login** reads `user_team_index` for memberships. The index is updated after the shard commit by the outbox relay and is reconcilable; authorization always re-checks membership on the shard.
- **Invitations** arrive with only a token. Tokens are built as `{teamId}.{random}`, so the server finds the shard before lookup.
- **Webhooks** arrive with only a provider event. Checkout sends `team_id` in provider metadata so the event routes to a shard. `UNIQUE (provider, provider_event_id)` lives in the control plane so dedupe is global.
- A request resolves the team, selects the shard, then applies membership and role checks against authoritative shard records.
- Cross-shard reporting, aggregate billing reports, and moving a team require fan-out or the control-plane index.
- A very large team can become a hot shard because all its data shares one key. Options: move that team to a dedicated shard, partition high-volume tables by time, or use a more granular key with a migration plan.

Document migration, backup, routing, consistency, and failure behaviour in `SHARDING.md`.

## 8. Migration and data lifecycle

- All schema changes are versioned SQL migrations.
- Prefer additive migrations; deploy code that supports both shapes before removing old columns (`industry`, `active_seat_count`, `summary`, `metadata` are dropped early because no data exists yet).
- Define retention for audit events, push tokens, sessions, invitations, auth tokens, and webhook payload metadata.
- Do not delete ledger history.
- Establish backup and restore procedures before production.
- Data export/deletion requirements require privacy/legal review, especially for activity records and the billing ledger.

## 9. Schema validation checklist

- [ ] Every tenant-owned table has a clear team scope.
- [ ] Same-team relationships use composite `(team_id, id)` foreign keys (assignments, swaps, activity).
- [ ] No foreign key crosses the control-plane/shard line.
- [ ] `one_active_owner`, `swaps_one_pending`, and the shift duration `CHECK` exist.
- [ ] `auth_tokens`, `billing_quotes`, `idempotency_keys`, `team_directory`, and `user_team_index` exist.
- [ ] Activity cursor index and before/after `EXPLAIN ANALYZE` (staff and owner views) are saved.
- [ ] Cursor carries `created_at::text`, never a JS `Date`.
- [ ] At least 10,000 activity records are seeded.
- [ ] Ledger UPDATE/DELETE is prevented for the application role; amounts are signed.
- [ ] Webhook event IDs (global) and payment idempotency keys are unique.
- [ ] Swap approval and overlap checks have concurrency tests.
- [ ] Seat-limit check is race-safe (`FOR UPDATE`, two-accepts test).
- [ ] Notification unique key `(outbox_event_id, user_id, category)` exists.
- [ ] `user_settings.timezone` has no default; `field_updated_at` is populated per field.
- [ ] Shard routing is deterministic and covered by tests.
