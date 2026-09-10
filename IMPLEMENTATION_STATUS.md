# Unified POS System — Implementation Status

> Last verified: full `npm run build` (shared + server + web) exits 0; server and
> web `tsc --noEmit` exit 0; `vitest run` = **174 passed / 5 DB-gated skipped**;
> coverage gate clears (86% stmts, 72% branch, 92% funcs, 88% lines).

## Executive Summary

The Unified POS System is a comprehensive **Business Operating System** built to
the 54-segment specification "The Ultimate Architecture". All five development
phases (§48) plus the cross-cutting platform, intelligence, compliance and
depth/hardening work are implemented end to end: **104 Prisma models**, **43
server route modules**, **44 web pages**, a dependency-free background job
scheduler, real-time SSE + Web Push, statistical AI (forecasting / anomaly /
RFM), an env-gated S3 media adapter, an env-gated Stripe PSP, and fraud
detection — all multi-tenant, event-driven and offline-first.

Only **§24 Hardware** (physical device drivers) and the spec-deferred
**client SDKs** remain out of scope by design.

## Architecture Overview

- **Monorepo**: npm workspaces — `packages/shared`, `packages/server`, `packages/web`.
- **Backend**: Express 4 + TypeScript (ESM) + Prisma 5.22 + PostgreSQL 16.
- **Frontend**: React 18 + Vite 6 + Tailwind + Zustand + react-router-dom 7, route-level code-splitting (`React.lazy`).
- **Auth**: JWT (Bearer) **and** httpOnly cookie sessions with CSRF double-submit; tokens carry `organizationId` + `employeeId`.
- **Multi-tenancy**: every tenant-owned record carries `organizationId`.
- **API versioning (§28)**: a single route table is dual-mounted at both `/api/*` and `/api/v1/*`.
- **Events (§27)**: a central `eventBus` fans out to notifications, webhooks (with retry), SSE realtime, and Web Push.

## Implementation Status by Segment

### Phase 1 — POS Foundation ✅
- **§4 Tenant model** — Platform → Organization → Location → Register → Device.
- **§6/§7 POS** — catalog, cart, variants/modifiers, discounts, taxes, tips, hold/recall, customer assignment; payment methods CASH, CARD, TAP, CHIP, APPLE_PAY, GOOGLE_PAY, GIFT_CARD, STORE_CREDIT, ACH, QR.
- **§8 Orders** — full lifecycle DRAFT → HELD → CONFIRMED → PAID → PROCESSING → FULFILLED → COMPLETED → CANCELLED → REFUNDED → PARTIALLY_REFUNDED.
- **§9/§10 Payments** — PSP orchestration, AUTHORIZED → CAPTURED → SETTLED → RECONCILED, refunds/voids/disputes/chargebacks, payouts & settlements, **payment links** (shareable tokenised checkout).
- **§11 Catalog** — products, categories, brands, variants, modifier groups, tax rules.
- **§12 Inventory** — states, movements, multi-location balances, batches/lots/serials/expiry, low-stock alerts.
- **§14 Customer 360**, **§15 Employee OS**, **§16 Audit**, **§41 Register lifecycle**, **§42 Receipts**, **§43 Returns/Refunds**, **§44 Inventory↔Order consistency**, **§45 Canonical data flow**.

### Phase 2 — Business Operations ✅
- Loyalty & stored value, purchasing/suppliers, multi-location enterprise, accounting integration.
- **§25/§26 Offline-first** — `offlineService` (IndexedDB, deviceId/sequence/enqueue/flush) + `SyncTransaction` ledger + idempotent batch ingest (`/sync`).
- **§5 Notifications** — Notification/NotificationPreference models, `notifyFromEvent` rules, bell badge, NotificationsPage.

### Phase 3 — Commerce Hub ✅
- Sales channels, online ordering, fulfillment (pickup/delivery), marketplace integrations, omnichannel inventory (`commerce.ts` + CommercePage).

### Phase 4 — Intelligence ✅
- **AI insights** (`/ai/insights`), **statistical depth** (`/ai` fall-through): least-squares **forecasting** with learned day-of-week seasonality + confidence bands, **z-score anomaly detection**, **RFM segmentation**.
- **AI Copilot** — natural-language business Q&A with an env-gated LLM bridge (OpenAI-compatible) and a deterministic fallback.
- Automated marketing, labor optimization.

### Phase 5 — Platform ✅
- **Developer portal** with catalog-driven marketplace (~137 providers / 20 categories), API keys, OAuth, sandbox, **webhooks with retry/backoff**.
- **Observability/NFR** — env-gated Sentry (dynamic import), Prometheus-style `/api/metrics`, health/readiness.
- **Enterprise** — UN M49 global-region coverage, global provisioning.

### Cross-cutting sections ✅
- **§17 Restaurant** — tables/floor plans, KDS, courses, split checks **plus QR scan-to-order (public guest flow), catering orders, and food-cost analysis**.
- **§19 Loyalty/Marketing** — points, rewards, campaigns, segmentation, automated offers.
- **§31 Financial OS** — accounting entries, reconciliation, tax reporting, expenses, COGS, margins.
- **§36 Idempotency** (DB-backed) and **§37 Rate limiting** (hybrid DB + in-memory) **and Fraud detection** (env-tunable risk scoring → ALLOW/REVIEW/BLOCK + alert queue + scheduled retention purge).
- **Compliance center** — Privacy / GDPR / CCPA / PCI-DSS.

### Depth & production hardening ✅
- **Background job scheduler** — dependency-free in-process tick + job registry (9 jobs: campaigns, payouts, webhook retry, retention purge, low-stock, stored-value & loyalty expiry), `JobRun` observability, single-leader via `SCHEDULER_ENABLED`.
- **Real-time SSE** — `/realtime/stream` (JWT via query/cookie/header) bridging `eventBus` to browsers; web hook with shared ref-counted `EventSource` replaces 30s polling (120s fallback poll retained).
- **Web Push (VAPID)** — RFC 8291 (aes128gcm) + RFC 8292 (ES256) implemented natively with `node:crypto` (no `web-push` dep), env-gated; service-worker `push`/`notificationclick` handlers.
- **Media storage adapter** — AWS SigV4 hand-rolled (no SDK); S3 when configured, DB (base64) fallback; MediaAsset routes + library UI.

### Out of scope (by design)
- **§24 Hardware** — physical device drivers.
- **Client SDKs** (JavaScript/Python) — spec-deferred; the REST API + developer catalog are complete.

## Data Model

**104 Prisma models.** Groups: Tenant (Organization, Location, Register, Device, Region, Warehouse), Identity (User, Employee, Role, Permission, EmployeeLocation, TimeEntry), Customer & Loyalty, Catalog (Product, Variant, Category, Brand, ModifierGroup, Modifier, TaxRule), Inventory (Balance, Movement, Batch, SerialNumber, Supplier), Orders (Order, OrderItem, OrderDiscount, OrderTax, OrderFulfillment), Payments (Payment, Refund, Dispute, Payout, Settlement, GiftCard, StoreCredit, **PaymentLink**), Restaurant (Table, Course, **QrToken**, **CateringOrder**), Commerce, Accounting, Notifications, Platform (Webhook, ApiKey, Integration, **JobRun**, **PushSubscription**, **MediaAsset**), Security (AuditEvent, IdempotencyKey, RateLimitCounter, SyncTransaction, **FraudAlert**), Compliance.

A baseline migration lives in `packages/server/prisma/migrations/` (applied by the Docker entrypoint via `migrate deploy`).

## Server Routes (dual-mounted at `/api` and `/api/v1`)

`auth, inventory, inventory-ops, products, catalog, orders, reports, settings, locations, registers, customers, audit, receipts, webhooks, loyalty, restaurant (+ restaurant-ext: QR/catering/food-cost), accounting, employees, suppliers, purchasing, ai (+ ai-analytics: forecast/anomalies/segments), developer, system, payments, marketing, copilot, enterprise, retail, permissions, devices, commerce, sync, notifications, compliance, fraud, payment-links, public (guest QR ordering), realtime (SSE), push (VAPID), media`.

Public (no-auth) surfaces: `/api/payment-links/public/:token` (+ `/pay`), `/api/public/*` guest QR ordering, `/api/realtime/stream` (token-authenticated), Stripe webhook at `/api/webhooks/stripe`.

## Frontend Pages (44)

Auth/public shell: Login, Register, Reset Password, Legal, **PayLink (`/pay/:token`)**, **GuestOrder (`/order/:token`)** — the two guest pages render outside the auth gate.

Authenticated app: POS, Orders, Inventory, Catalog, **Media**, Transfers, Purchasing, Suppliers, Customers, Loyalty, Marketing, AI Insights, **Predictive Analytics**, Copilot, Employees, Permissions, Registers, Devices, Hardware, Accounting, Reports, Developer, Webhooks, Enterprise, System, Sync, Notifications, Audit, **Fraud**, Compliance, Settings, Restaurant, **Restaurant Ops (QR/catering/food-cost)**, Retail, Commerce, Payments, **Payment Links**, Receipt.

Navigation is grouped into luxury "collections" and fully i18n-localised (en master + es/fr/de/pt) via `t(labelKey)`.

## Security & Compliance

- JWT + httpOnly cookie sessions, CSRF double-submit, dual-mode auth middleware.
- Organization-scoped isolation, RBAC (OWNER/ADMIN/MANAGER/CASHIER), granular permissions.
- bcrypt password hashing, MFA (TOTP) + lockout, helmet CSP (Stripe widgets allowed), CORS, Zod validation on all inputs.
- DB-backed idempotency + hybrid rate limiting (stricter on `/auth` and `/payments`).
- AES-256-GCM encryption at rest for sensitive fields; PCI-safe tokenised cards (SAQ-A scope — no raw PAN touches the server).
- Immutable audit log; fraud risk scoring with an ops alert queue.

## Testing

- `vitest` suites in each package's `test/` folder (excluded from the production `tsc` build).
- **Pure unit coverage**: moneyMath (FIFO gift-card/store-credit), currencies, crypto (AES-GCM), payment provider + Stripe webhook signature, email, payment methods, escpos, i18n parity, product types, **aiEngine** (regression/forecast/anomaly/RFM), **fraud** (`scoreFraud` verdicts + thresholds), **scheduler** (registry, overlap guard, success/failure capture).
- **DB-gated integration**: `moneyPath.integration.test.ts` exercises the payment-link charge → PAID transition and gift-card deduction against a real DB. Skipped unless `RUN_DB_TESTS=1` with a disposable `DATABASE_URL`.
- Coverage gate (opt-in via `npm run test:coverage`) scoped to money-critical pure modules; thresholds 70/60/70/70.

```bash
npm test                                             # pure suites (DB-gated file skips)
RUN_DB_TESTS=1 DATABASE_URL=postgresql://... npm test # include the money-path integration suite
npm run test:coverage                                # coverage gate
```

## Deployment

### Production (Docker — recommended)
Multi-stage `Dockerfile` (API + built SPA in one image) and `docker-compose.yml`
(app + PostgreSQL 16). The entrypoint runs `prisma migrate deploy` on boot.

```bash
cp .env.example .env    # POSTGRES_PASSWORD, JWT_SECRET, ENCRYPTION_KEY, CORS_ORIGIN, + optional STRIPE_*/AWS_S3_*/VAPID_*/LLM_*/SENTRY_*/METRICS_TOKEN
docker compose up --build -d
# http://localhost:3001 · health /api/health · readiness /api/ready
```

Deploy the same image to any Docker host (Render, Railway, Fly.io, VPS, ECS,
Cloud Run). Set the `.env.example` vars in the host's secret store.

**Env-gated adapters** run in deterministic simulator/no-op mode when their keys
are absent, so the app is fully functional out of the box:
- Payments — `STRIPE_SECRET_KEY` (else simulator).
- Media — `AWS_S3_BUCKET` + credentials (else DB storage).
- Web Push — `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (else disabled).
- LLM Copilot — `LLM_API_KEY`/`OPENAI_API_KEY` (else deterministic fallback).
- Observability — `SENTRY_DSN`, `METRICS_TOKEN`.
- Scheduler — `SCHEDULER_ENABLED` (default true; enable on exactly one instance), `SCHEDULER_TICK_MS`.

### Local development
```bash
npm install
npx prisma generate --schema=packages/server/prisma/schema.prisma
npm run db:push          # or db:migrate / db:deploy with migration files
npm run db:seed          # dev only — refuses when NODE_ENV=production
npm run dev              # API :3001 + Vite :5173
```

### CI
`.github/workflows/ci.yml` typechecks/builds all packages, builds the Docker
image, runs `npm test`, and validates the Prisma schema against an ephemeral
Postgres on every push and pull request.

## Conclusion

Every in-scope segment of the 54-part specification is implemented across
backend, database and frontend, and the platform depth items (scheduler,
real-time, push, AI statistics, media storage, fraud detection, versioning,
payment links, QR/catering/food-cost) are complete and verified green. The
artifact is buildable, horizontally scalable and deployable; remaining tasks are
operational (host, secrets, live payment/email/S3/push providers, TLS/CDN,
backups, compliance attestations) plus the intentionally out-of-scope hardware
drivers and client SDKs.
