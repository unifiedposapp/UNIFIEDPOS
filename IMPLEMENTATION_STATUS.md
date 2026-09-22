# Unified POS System — Implementation Status

> Last verified: full `npm run build` (shared + server + web) exits 0; server and
> web `tsc --noEmit` exit 0; `vitest run` = **470 passed / 5 DB-gated skipped**
> across 26 suites; coverage gate clears (86% stmts, 72% branch, 92% funcs, 88% lines).

## Executive Summary

The Unified POS System is a comprehensive **Business Operating System** built to
the 54-segment specification "The Ultimate Architecture". All five development
phases (§48) plus the cross-cutting platform, intelligence, compliance and
depth/hardening work are implemented end to end: **121 Prisma models**, **54
server route modules**, **54 web pages**, a dependency-free background job
scheduler (16 registered jobs), real-time SSE + Web Push, statistical AI
(forecasting / anomaly / RFM), an env-gated S3 media adapter, an env-gated Stripe
PSP, and fraud detection — all multi-tenant, event-driven and offline-first.

On top of the specification, **ten market-dominance subsystems** are implemented
and wired into navigation, API and database: per-country fiscalisation, local
payment rails with settlement reconciliation, agentic back-office replenishment,
vertical solution packs, embedded finance, agentic commerce with signed mandates,
the offline store mesh with write fencing, franchise royalties and consolidation,
an installable partner-app ecosystem with custom fields, and privacy-safe peer
benchmarking.

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
- **§7/§37 Cashier drawer isolation** — one register = one cashier at a time, with an
  **individual re-entry PIN** per cashier: occupancy is enforced at open time, held
  tickets are private to their owner, and a locked drawer (manual or idle auto-lock)
  refuses every sale, refund and cash move with `423 REGISTER_LOCKED` until the same
  cashier re-authenticates. See *Register drawer locks* below.
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
- **Background job scheduler** — dependency-free in-process tick + job registry (16 jobs: campaigns, payouts, webhook retry, retention purge, low-stock, stored-value & loyalty expiry, **fiscal transmit-pending + backfill-seals, finance daily sweep, agent auto-replenish, franchise royalty close, benchmark snapshot refresh, mesh lease watchdog**), `JobRun` observability, single-leader via `SCHEDULER_ENABLED`.
- **Real-time SSE** — `/realtime/stream` (JWT via query/cookie/header) bridging `eventBus` to browsers; web hook with shared ref-counted `EventSource` replaces 30s polling (120s fallback poll retained).
- **Web Push (VAPID)** — RFC 8291 (aes128gcm) + RFC 8292 (ES256) implemented natively with `node:crypto` (no `web-push` dep), env-gated; service-worker `push`/`notificationclick` handlers.
- **Media storage adapter** — AWS SigV4 hand-rolled (no SDK); S3 when configured, DB (base64) fallback; MediaAsset routes + library UI.

### Market-dominance subsystems ✅

Each is a pure, unit-tested service + a route module + a page; all ten are driven
by the `globalJobs.ts` scheduler additions.

- **Fiscalisation / e-invoicing** (`fiscalization.ts`, `/fiscal`, Fiscal) — 26
  country regimes plus a `SIMPLE` baseline; canonical document payload → HMAC seal
  → hash-chained document chain with **verify-chain**, sequence-gap detection, ISO
  check digits, TLV/QR blocks, retention windows and a queued transmitter with
  exponential back-off. Bridge availability is env-gated per country.
- **Payment rails + settlement** (`paymentRails.ts`, `settlement.ts`, `/rails`,
  Rails) — IBAN mod-97, ABA routing, sort code, CLABE, BSB, NUBAN, IFSC, VPA,
  CPF/CNPJ, PIX key types, E.164 and till-number validation; a rail routing table
  that picks instant/standard/wire by currency and ceiling with its fee, and
  statement reconciliation that classifies amount/fee/timing/unmatched variances
  and scores batch health.
- **Agentic back-office** (`replenishment.ts`, `/agent`, Agent Ops) —
  service-level safety stock, reorder point, EOQ, pack/minimum rounding, urgency
  scoring and ABC class; cash/line/supplier guardrails trim the least urgent lines
  and report what was deferred; drafts purchase orders that **a human approves**.
- **Vertical solutions** (`verticalSolutions.ts`, `/verticals`, Verticals) — 14
  trade packs declaring fields, settings deltas and register hints; install applies
  the delta, retire reverts only what the merchant has not since edited.
- **Embedded finance** (`embeddedFinance.ts`, `/finance`, Finance) — underwriting
  from the store's own trading history (score, band, limit, decline codes, factor
  breakdown), annuity amortisation, effective-vs-nominal rate, term sheets, and a
  capped daily sweep applied oldest-instalment-first with leftover reported.
- **Agentic commerce** (`agenticCommerce.ts`, `/agents` + public `/wellKnown`,
  Agent Storefront) — JSON-LD Product/Offer/ItemList catalogue, `/.well-known/unifiedpos[/{merchantId}]`
  descriptors, and canonical-JSON HMAC **mandates** with ceiling, TTL, per-line
  price guards and a nonce, evaluated through a specific rejection-code ladder.
- **Store mesh** (`mesh.ts`, `/mesh`, Mesh) — deterministic leader election
  (role → priority → heartbeat → id), membership-hashed terms, leases with takeover
  epochs, `acceptWrite` fencing (STALE_EPOCH/FUTURE_EPOCH/STALE_LEADER/STALE_SEQUENCE), delta-merging
  conflict resolution and a HEALTHY/DEGRADED/ISOLATED roll-up.
- **Franchise** (`franchise.ts`, `/franchise`, Franchise) — percent/tiered/per-item/fixed
  royalty models with agreed exclusions and monthly minimums printed as an
  auditable calculation trail, cost-plus transfer pricing, and consolidated P&L
  with intercompany eliminations, unrealised profit and royalty ageing.
- **Ecosystem** (`appCatalog.ts`, `customFields.ts`, `/apps`, Apps) — 11 catalog
  apps with declared scopes/endpoints/events, write-implies-read scope closure, a
  HIGH/MEDIUM/LOW risk gate that needs an explicit 428 acknowledgement to install,
  show-once revocable tokens, and typed custom fields with edge-strict coercion.
- **Peer benchmarking** (`benchmark.ts`, `/benchmark`, Benchmark) — k-anonymity
  suppression per metric, 5th/95th percentile clipping, injected Laplace noise, and
  a published privacy ledger (cohort size, k, ε, noise, participation) so a
  suppressed cell reads as the model working.

### Out of scope (by design)
- **§24 Hardware** — physical device drivers.
- **Client SDKs** (JavaScript/Python) — spec-deferred; the REST API + developer catalog are complete.

## Data Model

**121 Prisma models.** Groups: Tenant (Organization, Location, Register, Device, Region, Warehouse), Identity (User, Employee, Role, Permission, EmployeeLocation, TimeEntry), Customer & Loyalty, Catalog (Product, Variant, Category, Brand, ModifierGroup, Modifier, TaxRule), Inventory (Balance, Movement, Batch, SerialNumber, Supplier), Orders (Order, OrderItem, OrderDiscount, OrderTax, OrderFulfillment), Payments (Payment, Refund, Dispute, Payout, Settlement, GiftCard, StoreCredit, **PaymentLink**), Restaurant (Table, Course, **QrToken**, **CateringOrder**), Commerce, Accounting, Notifications, Platform (Webhook, ApiKey, Integration, **JobRun**, **PushSubscription**, **MediaAsset**), Security (AuditEvent, IdempotencyKey, RateLimitCounter, SyncTransaction, **FraudAlert**), Compliance, and the new **Global Expansion** group: FiscalDevice, FiscalDocument, RailAccount, SettlementBatch, SettlementLine, ReplenishmentRun, VerticalInstallation, CreditFacility, LoanRepayment, AgentMandate, MeshFence, FranchiseAgreement, RoyaltyAccrual, AppInstallation, CustomFieldDefinition, CustomFieldValue, BenchmarkSnapshot.

The new models are deliberately relation-free (they carry `organizationId` but no Prisma relations), so they migrate cleanly onto a live database and are joined in memory.

A baseline migration lives in `packages/server/prisma/migrations/` (applied by the Docker entrypoint via `migrate deploy`); the expansion ships as `20260921120000_global_expansion`.

## Server Routes (dual-mounted at `/api` and `/api/v1`)

`auth, inventory, inventory-ops, products, catalog, orders, reports, settings, locations, registers, customers, audit, receipts, webhooks, loyalty, restaurant (+ restaurant-ext: QR/catering/food-cost), accounting, employees, suppliers, purchasing, ai (+ ai-analytics: forecast/anomalies/segments), developer, system, payments, marketing, copilot, enterprise, retail, permissions, devices, commerce, sync, notifications, compliance, fraud, payment-links, public (guest QR ordering), realtime (SSE), push (VAPID), media, **fiscal, rails, agent (replenishment), verticals, finance, agents (agentic commerce), mesh, franchise, apps, benchmark**`.

Public (no-auth) surfaces: `/api/payment-links/public/:token` (+ `/pay`), `/api/public/*` guest QR ordering, `/api/agents/public/*` (machine-readable catalogue, mandate verification, order status), `/api/realtime/stream` (token-authenticated), Stripe webhook at `/api/webhooks/stripe`, and the RFC 8615 discovery documents at `/.well-known/unifiedpos` and `/.well-known/unifiedpos/{merchantId}`.

## Frontend Pages (54)

Auth/public shell: Login, Register, Reset Password, Legal, **PayLink (`/pay/:token`)**, **GuestOrder (`/order/:token`)** — the two guest pages render outside the auth gate.

Authenticated app: POS, Orders, Inventory, Catalog, **Media**, Transfers, Purchasing, Suppliers, Customers, Loyalty, Marketing, AI Insights, **Predictive Analytics**, Copilot, Employees, Permissions, Registers, Devices, Hardware, Accounting, Reports, Developer, Webhooks, Enterprise, System, Sync, Notifications, Audit, **Fraud**, Compliance, Settings, Restaurant, **Restaurant Ops (QR/catering/food-cost)**, Retail, Commerce, Payments, **Payment Links**, Receipt.

Market-dominance screens: **Fiscalization (`/fiscalization`), Rails (`/rails`), AgentOps (`/agent-ops`), Verticals (`/verticals`), Finance (`/finance`), AgentStorefront (`/agents`), Mesh (`/mesh`), Franchise (`/franchise`), Apps (`/apps`), Benchmark (`/benchmark`)** — each lazy-loaded, grouped in navigation, and localised in all five languages.

Navigation is grouped into luxury "collections" and fully i18n-localised (en master + es/fr/de/pt) via `t(labelKey)`.

## Security & Compliance

- JWT + httpOnly cookie sessions, CSRF double-submit, dual-mode auth middleware.
- Organization-scoped isolation, RBAC (OWNER/ADMIN/MANAGER/CASHIER), granular permissions.
- bcrypt password hashing, MFA (TOTP) + lockout, helmet CSP (Stripe widgets allowed), CORS, Zod validation on all inputs.
- DB-backed idempotency + hybrid rate limiting (stricter on `/auth` and `/payments`).
- AES-256-GCM encryption at rest for sensitive fields; PCI-safe tokenised cards (SAQ-A scope — no raw PAN touches the server).
- Immutable audit log; fraud risk scoring with an ops alert queue.

## Register drawer locks (per-cashier isolation)

- **Individual PIN** per employee (`Employee.registerPin`, bcrypt-hashed, never
  returned): 4–8 digits, repeats (`1111`) and straight runs (`1234`) rejected;
  rotation requires the current PIN, so an unattended screen cannot be hijacked.
- **Handover lock** on `RegisterSession` (`locked`, `lockedAt`, `lockReason`,
  `lockedCount`). `middleware/registerAccess.ts` gates 6 order routes + 3 payment
  routes: a locked session cannot create, discount, hold, cancel, refund, void or
  settle anything (HTTP 423). Closing a drawer also requires unlocking first.
- **Occupancy**: `POST /registers/open` refuses a register holding another cashier's
  session (`OCCUPIED` / `LOCKED_TO_OTHER`), scoped to the caller's organization; a
  cashier may not even open a drawer they have no PIN to lock again.
- **Idle auto-lock** — org policy `StoreSettings.registerIdleLockMinutes` (default 5,
  supervisor-editable); the POS arms it and calls `POST /registers/lock`, so the
  server, not the browser, decides. A cashier with no PIN is never trapped.
- **Brute force** — 5 wrong PINs freezes the PIN for 5 minutes (`423 PIN_COOLDOWN`)
  plus a shared DB rate limiter keyed by employee (12/min on both PIN endpoints).
- **Supervisor escape hatches** (all audited): `GET /registers/sessions/active`,
  force unlock, force close, PIN reset. Cashiers never see a colleague's identity —
  only that a register is "in use".
- **POS UI** — `useRegisterLock` + `RegisterLockScreen` (full-screen PIN pad), real
  register name in the header, manual "Lock register", and RegistersPage with PIN
  setup, lock/unlock, occupancy column and the supervisor drawer console.

## Testing

- `vitest` suites in each package's `test/` folder (excluded from the production `tsc` build).
- **Pure unit coverage**: moneyMath (FIFO gift-card/store-credit), currencies, crypto (AES-GCM), payment provider + Stripe webhook signature, email, payment methods, escpos, i18n parity, product types, **aiEngine** (regression/forecast/anomaly/RFM), **fraud** (`scoreFraud` verdicts + thresholds), **scheduler** (registry, overlap guard, success/failure capture), **registerAccess** (PIN strength, hash/verify, freeze arithmetic, idle window, occupancy verdicts, sales gate).
- **Market-dominance unit coverage** (10 further suites, all pure, no database): `fiscalization` (canonical payload → seal → chain breakage, sequence gaps, TLV, retention, back-off, bridge env matrix), `paymentRails` (IBAN/ABA/CLABE/CPF/CNPJ/NUBAN/IFSC/VPA/BSB vectors, rail choice), `settlement` (variance classification, tolerance, duplicates, batch health), `replenishment` (z-scores, safety stock, EOQ, pack rounding, guardrail trimming, supplier roll-up), `embeddedFinance` (annuity + amortisation to the cent, underwriting decline codes, term-sheet monotonicity, sweep allocation), `mesh` (election determinism, quorum, fencing, lease takeover, conflict merge), `franchise` (banded royalty with auditable steps, exclusions, transfer pricing, consolidation eliminations), `benchmark` (percentiles, clipping, injected Laplace draw, k-suppression, participation), `agenticCommerce` (canonical JSON, sign/verify/tamper, every rejection code, JSON-LD shape), `customFields` (slug/definition validation, per-type coercion, scope closure, token issue/verify).
- **Live route smoke** — `npm run smoke:global` (`scripts/smoke-global.mjs`) registers a throwaway tenant against a running server and walks all ten subsystems end to end: fiscal device + seal + `chain/verify`, rail validation + settlement reconciliation, a replenishment run, a vertical pack through its 428 confirmation gate, underwriting + quote, app install + token verify + custom field values, a signed mandate verified (and a tampered one rejected 401) on the public surface, mesh claim/heartbeat/commit with an invented-epoch write fenced off at 409, a franchise agreement + accrual + consolidation, and the benchmark cohort endpoints. It paces itself on 429s, so a run takes a few minutes.
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
payment links, QR/catering/food-cost) are complete and verified green. On top of
the specification, the ten market-dominance subsystems (fiscalisation, payment
rails + settlement, agentic replenishment, vertical packs, embedded finance,
agentic commerce, store mesh, franchise consolidation, partner-app ecosystem,
peer benchmarking) are implemented end to end — pure services with unit tests,
route modules, scheduler jobs, pages and navigation. The artifact is buildable,
horizontally scalable and deployable; remaining tasks are operational (host,
secrets, live payment/email/S3/push providers, TLS/CDN, backups, compliance
attestations) plus the intentionally out-of-scope hardware drivers and client
SDKs.
