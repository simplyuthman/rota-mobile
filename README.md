# Rota — Mobile Shift Scheduling for Small Teams

> Effortless shift scheduling, swap management, and roster notifications for restaurants, cafés, and small teams (5–40 staff).

---

## 1. Quick Links & Graduation Artifacts
- **Platform**: Verified on Android development build via EAS Build.
- **Backend API**: Fastify + PostgreSQL (Control Plane + 2 Data Shards) + 2 Redis instances (Cache + BullMQ).
- **Mobile Client**: React Native + Expo + Expo Router + TanStack Query + Zustand.
- **Design System**: DM Sans typography, 4px spacing scale, semantic color roles with dynamic Light/Dark/System theming.
- **Graduation Evidence Pack**:
  - [Architecture & Pool Sizing](docs/ARCHITECTURE.md)
  - [State & Storage Classification](docs/STATE.md)
  - [Security 8-Threat Model & EXPO_PUBLIC Audit](docs/SECURITY.md)
  - [Database Sharding & Routing](docs/SHARDING.md)
  - [Engineering Learning Log](docs/LEARNING-LOG.md)
  - [k6 Load Test Benchmark Report](load-tests/REPORT.md)
  - [Architecture Decision Records](docs/decisions/)

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

## 5. App Store Billing Notice & Production Architecture

In a commercial production deployment distributed through the **Apple App Store** and **Google Play Store**, digital subscriptions sold directly to end users inside mobile apps fall under app store in-app purchase policies:

### 5.1 Regulatory & Policy Constraints
- **Apple App Store Guideline 3.1.1 (In-App Purchase)**: If an app enables users to unlock features or functionality within the app (such as scheduling extra employee seats or upgrading a team subscription), developers must utilize Apple In-App Purchase (StoreKit 2). Apple levies a commission of 15% (for members of the Small Business Program) or 30% on digital subscription transactions.
- **Google Play Billing Policy (Section 3)**: Similarly requires all developers selling digital content or subscription access within Play-distributed apps to integrate the Google Play Billing system.
- **Enterprise / Multiplatform Services Exception (Apple Guideline 3.1.3(c))**: Apps that operate across multiple platforms (such as enterprise B2B SaaS tools like Slack, Asana, or Deputy) may allow users to access content, subscriptions, or features acquired outside the app (e.g. via a web management portal), provided those subscriptions are also available for purchase via web invoicing and there is no direct in-app call-to-action steering users to an external website.

### 5.2 Graduation Build Architecture (Mobile Task A)
For this graduation build:
1. **Flutterwave Test Mode**: Subscriptions and seat purchases are processed through **Flutterwave test mode** isolated behind a provider-neutral payment adapter (`adapters/payments/flutterwave/`).
2. **Server-Side Financial Integrity**: All seat pricing (cents), proration calculations (Rule M-03), billing quotes (Rule M-07), signature verification (Rules M-08, M-09, M-10), and append-only ledger accounting (Rule M-12) execute on the backend server.
3. **Pluggable Adapter Model**: The payment architecture cleanly decouples business rules from payment gateways. In a production environment requiring App Store compliance, a native StoreKit 2 / Google Play Billing adapter can replace or complement the Flutterwave adapter without altering core ledger or subscription scheduling services.

