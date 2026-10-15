# Rota — Mobile Shift Scheduling for Small Teams

> Effortless shift scheduling, swap management, and roster notifications for restaurants, cafés, and small teams (5–40 staff).

---

## 1. Quick Links
- **Platform**: Verified on Android development build via EAS Build.
- **Backend API**: Fastify + PostgreSQL (Control Plane + 2 Data Shards) + 2 Redis instances (Cache + BullMQ).
- **Mobile Client**: React Native + Expo + Expo Router + TanStack Query + Zustand.
- **Design System**: DM Sans typography, 4px spacing scale, semantic color roles with dynamic Light/Dark/System theming.

---

## 2. Monorepo Structure

```
rota/
  apps/
    mobile/                     # Expo Router mobile app (Android development build)
  services/
    api/                        # Fastify API (Kysely, PostgreSQL, Redis, Pino)
      migrations/
        control-plane/          # 0001_initial.sql (users, sessions, directory, quotes)
        shard/                  # 0001_initial.sql (teams, shifts, swaps, ledger)
  packages/
    contracts/                  # Shared Zod schemas and API request/response types
    config/                     # Shared plan constants (cents), trial and seat limits
  sites/
    links/                      # Static HTTPS link site (Android App Links)
  load-tests/                   # k6 load testing scripts (200 VUs, p95 <= 500ms)
  docs/                         # Project documentation, decision records, evidence
```

---

## 3. Running Locally

### Prerequisites
- Node.js Active LTS (pinned in `.nvmrc`)
- pnpm `>= 12.0.0`
- Docker & Docker Compose (for local PostgreSQL & Redis)

### Step 1: Install Dependencies
```bash
cd rota
pnpm install
```

### Step 2: Configure Environment
Copy `.env.example` to `.env` in `rota/` and in `rota/apps/mobile/`:
```bash
cp .env.example .env
cp apps/mobile/.env.example apps/mobile/.env
```

### Step 3: Start Infrastructure
```bash
docker compose up -d
```
This boots:
- PostgreSQL on port 5432 (creates `control_plane`, `rota_shard_0`, and `rota_shard_1`).
- Cache Redis on port 6379 (`allkeys-lru` eviction).
- Queue Redis on port 6380 (`noeviction` for BullMQ).

### Step 4: Run Database Migrations
```bash
pnpm migrate
```

### Step 5: Start API Service
```bash
pnpm dev:api
```
Health checks:
- Liveness: `curl http://localhost:3000/health/live`
- Readiness: `curl http://localhost:3000/health/ready`

### Step 6: Start Mobile App
```bash
pnpm --filter @rota/mobile start
```

---

## 4. Quality & Testing Commands

```bash
# Typecheck all packages
pnpm typecheck

# Lint all packages
pnpm lint

# Run unit & integration test suites
pnpm test

# Generate design tokens from tokens.css
pnpm tokens
```

---

## 5. App Store Billing Notice (Production Architecture)

In a commercial production deployment distributed through the **Apple App Store** and **Google Play Store**, digital subscriptions sold directly to end users inside mobile apps fall under app store in-app purchase policies:
- **Apple In-App Purchase (IAP)** and **Google Play Billing** require a 15–30% fee for digital goods and services consumed within the app.
- Multi-platform B2B / SaaS tools often qualify for reader or multiplatform exceptions when accounts and seats are primarily provisioned and billed via a web management portal, or they integrate native StoreKit / Google Play Billing adapters.
- **For this graduation build (Mobile Task A)**: Billing is handled via **Flutterwave in test mode** behind a provider-neutral payment adapter (`adapters/payments/flutterwave/`), simulating webhook-driven recurring billing, seat proration, and append-only ledger accounting without submitting production binary builds to store review.
