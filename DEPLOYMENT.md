# Deployment Runbook — Unified POS

This runbook covers taking the Unified POS monorepo from source to a production,
globally-deployable service. The application ships as a **single container** that
serves both the Express API (`/api/*`) and the built React SPA from one origin,
backed by **PostgreSQL 16**. Everything below is verified against the actual code
in this repository.

---

## 1. Architecture at a glance

```
                 ┌─────────────┐        ┌──────────────────────────┐
   Browser ─────▶│  CDN / WAF  │───────▶│  App container (node:20)  │
   (SPA + PWA)   └─────────────┘        │  Express API + static SPA │
                                        └────────────┬─────────────┘
                                                     │ Prisma
                                        ┌────────────▼─────────────┐
                                        │  PostgreSQL 16 (managed) │
                                        │  + optional PgBouncer     │
                                        └───────────────────────────┘
```

- **Stateless app tier.** Auth is JWT + httpOnly cookies; idempotency keys and the
  security-critical rate-limit counters live in Postgres (`IdempotencyKey`,
  `RateLimitCounter`). There is no in-process session store, so you can run any
  number of replicas behind a load balancer.
- **Single image.** `packages/web/dist` is served by the API (`WEB_DIST`), so one
  container is a complete deployment. You may instead host the SPA on a CDN and
  run the API separately (see §10).
- **Health probes.** `GET /api/health` (liveness), `GET /api/ready` (checks the DB
  before traffic is routed in), `GET /api/metrics` (Prometheus text, token-gated).

---

## 2. Prerequisites

- Docker + Docker Compose (for container deploys), **or** Node 20 + a PostgreSQL 16
  instance (for bare-metal/PaaS deploys).
- A committed, in-sync `package-lock.json` (the build uses `npm ci`).
- A transactional email provider (Resend, SendGrid, or any SMTP host) — **required
  in production** so password resets are emailed, never returned to the client.

---

## 3. Configuration & secrets

Copy `.env.example` to `.env` for local runs, or set these as secrets in your host's
dashboard. Values marked **REQUIRED** have no safe fallback: the server refuses to
start (or refuses to sign tokens) when they are missing under `NODE_ENV=production`.

| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV` | yes | Set `production` in prod. Enables secure cookies and fail-closed reset-token handling. |
| `PORT` | yes | Port the API listens on (default `3001`). |
| `DATABASE_URL` | yes | Prisma PostgreSQL connection string. |
| `JWT_SECRET` | **yes** | Token signing key. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. |
| `ENCRYPTION_KEY` | **yes** | AES-256-GCM key for credentials at rest. **Changing it after data is written makes existing rows undecryptable.** Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. |
| `CORS_ORIGIN` | yes | Comma-separated allow-list of browser origins (your public URL(s)). |
| `TRUST_PROXY` | yes | Proxy hops to trust behind Docker/Cloud Run/nginx (use `1`). |
| `WEB_DIST` | single-container | Absolute path to the built SPA (`/app/packages/web/dist` in the image). |
| `SKIP_MIGRATIONS` | no | `true` to run migrations from a one-off job instead of on every boot (recommended for multi-replica). |
| `STRICT_PROD_CONFIG` | recommended | `true` to **refuse to boot** when the startup production-config review (`packages/server/src/services/productionConfig.ts`) finds any error: missing/placeholder `JWT_SECRET` or `ENCRYPTION_KEY`, no email provider, a CORS wildcard, or no `DATABASE_URL`. Without it the same review only logs, so a mis-deploy is visible in the boot logs either way. |
| `APP_BASE_URL` | recommended | Public base URL used to build links in emails (falls back to `CORS_ORIGIN`). |
| `EMAIL_PROVIDER` / `RESEND_API_KEY` / `SENDGRID_API_KEY` / `SMTP_*` | **prod** | Transactional email. See §7. |
| `EMAIL_FROM` | no | From header (default `Unified POS <no-reply@unifiedpos.local>`). |
| `COOKIE_SAMESITE` / `COOKIE_SECURE` | no | Cookie hardening (`COOKIE_SECURE` auto-on in production). |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` | for real card payments | Without them the app uses a built-in simulator. Card data is tokenized client-side (PCI SAQ-A scope). |
| `SENTRY_DSN` / `SENTRY_TRACES_SAMPLE_RATE` | no | Error tracking. Then `npm i @sentry/node` (loaded via a runtime-only dynamic import). |
| `METRICS_TOKEN` | no | Bearer token to scrape `GET /api/metrics` (open if unset — keep it off the public internet). |
| `DISABLE_CSP` | no | Debug only; leave off in production. |

> Never commit the real `.env`. `.dockerignore` and `.gitignore` both exclude it, so
> secrets are never baked into the image.

---

## 4. Local production preview (Docker Compose)

```bash
cp .env.example .env
# Set strong POSTGRES_PASSWORD, JWT_SECRET, ENCRYPTION_KEY, and CORS_ORIGIN.
docker compose up --build -d
# Open http://localhost:3001 and create the first account via Register.
```

`docker compose up` starts **db** and **app** only. The `migrate`, `backup`, and
`pooling` services are gated behind Compose **profiles** and never start by default.

---

## 5. Database & migrations

- A committed baseline migration lives at
  `packages/server/prisma/migrations/20260907000000_init/`.
- **On container boot**, `docker-entrypoint.sh` runs `prisma migrate deploy`
  (idempotent) unless `SKIP_MIGRATIONS=true` or the migrations folder is absent.

**Fresh database (normal deploy):** nothing to do — the entrypoint applies the
baseline on first boot.

**Multi-replica (recommended):** decouple migrations from boot so replicas never
race each other:

```bash
docker compose run --rm migrate          # one-off: applies migrate deploy, then exits
# then run the app with SKIP_MIGRATIONS=true
```

**Existing database created with `prisma db push`** (e.g. a dev DB you are
promoting): mark the baseline as already applied so `migrate deploy` does not try
to recreate existing tables:

```bash
npx prisma migrate resolve --applied 20260907000000_init \
  --schema=packages/server/prisma/schema.prisma
```

**Changing the schema later:** run `npx prisma migrate dev --name <change>` locally,
commit the new migration folder, and let `migrate deploy` apply it. CI (§12) fails
if `schema.prisma` drifts from the committed migrations.

---

## 6. Deploying to a host

The image is portable — any Docker host works (Render, Railway, Fly.io, a VPS,
AWS ECS, Google Cloud Run).

> **Ready-made platform configs live in [`deploy/`](deploy/README.md):** `fly.toml`
> (multi-region, with a dedicated `scheduler` process group), `deploy/aws/` (ECS
> Fargate web + scheduler task definitions, service, and a setup README),
> `render.yaml` (web service + scheduler worker + managed Postgres), `railway.json`,
> and `deploy/regions/*.env.example` (per-region secret templates). Each encodes
> the same three-role model described in §11.

**Build & run the image:**

```bash
docker build -t unified-pos:latest .
docker run -d --name unified-pos -p 3001:3001 \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://user:pass@host:5432/unified_pos?schema=public" \
  -e JWT_SECRET="..." -e ENCRYPTION_KEY="..." \
  -e CORS_ORIGIN="https://pos.example.com" \
  -e TRUST_PROXY=1 \
  unified-pos:latest
```

**PaaS notes:**
- Point the platform's health check at `/api/health` (liveness) and, if supported,
  use `/api/ready` for traffic gating. The image already declares a `HEALTHCHECK`.
- Set `TRUST_PROXY=1` so `req.ip` and rate limiting see the real client behind the
  platform proxy.
- Use a **managed PostgreSQL** (Render/Railway/Neon/Superset/RDS/Cloud SQL). Prefer
  a private network link over a public DB endpoint.
- The container runs as a **non-root** user (`posapp`, uid 1001). Ensure any mounted
  volume is writable by that uid.

---

## 7. Transactional email (required in production)

Password resets are emailed via `packages/server/src/services/email.ts`, which has
**zero hard dependencies**. Pick one provider by setting its credential; the
provider is auto-detected (or force it with `EMAIL_PROVIDER`).

| Provider | Env | Notes |
|---|---|---|
| Resend | `RESEND_API_KEY` | HTTPS REST via the global `fetch`. No install. |
| SendGrid | `SENDGRID_API_KEY` | HTTPS REST via the global `fetch`. No install. |
| SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Run `npm i nodemailer` (loaded via a runtime-only dynamic import). |
| None | *(no keys)* | Safe no-op: logs and skips sending. **Dev only.** |

**Security contract:** in production `POST /api/auth/forgot-password` **never**
returns the reset token in the response body — it is only ever placed in the emailed
link. The token is returned inline **only** in non-production **and** only when no
email actually delivered (so the flow stays testable locally). This is enforced by
the pure, unit-tested `canExposeResetToken()` gate.

Set `APP_BASE_URL` (e.g. `https://pos.example.com`) so the emailed reset link points
at your public SPA (`/reset-password?token=…`, which the SPA consumes automatically).

---

## 8. Connection pooling

Each app replica opens its own Prisma pool, so total connections ≈
`replicas × pool size`. Under load or with many replicas, put a pooler in front of
Postgres to cap backend connections:

- **Compose (optional):** start the bundled PgBouncer with the `pooling` profile and
  point the app at it:
  ```bash
  docker compose --profile pooling up -d
  # app DATABASE_URL host becomes pgbouncer:6432 instead of db:5432
  ```
  It runs in **transaction** pooling mode (suits Prisma). Pin the image tag for prod.
- **Managed:** use your provider's pooler (e.g. PgBouncer/Supavisor/RDS Proxy) and
  set `DATABASE_URL` to the pooled endpoint.

Keep `DATABASE_URL` percent-encoded if the password contains `@ : / ?`.

---

## 9. Backups & disaster recovery

- **Logical backups (bundled):** run the `backup` profile to `pg_dump` the database
  in custom format into the `backups` volume:
  ```bash
  docker compose run --rm backup
  # restore:
  pg_restore -U <user> -d <db> --clean --if-exists /backups/<file>.dump
  ```
  Schedule this from host cron / a CI schedule / your provider's backup service.
- **Managed:** prefer your database provider's automated PITR (point-in-time
  recovery) + off-site snapshots for production.
- **DR objectives:** decide your RPO/RTO. For a payments system, target frequent
  (e.g. ≤ 15 min) backups and a tested restore procedure. Store the `ENCRYPTION_KEY`
  and `JWT_SECRET` in your secrets manager — losing `ENCRYPTION_KEY` makes encrypted
  credential rows permanently unreadable.
- **Test restores** periodically; an untested backup is not a backup.

---

## 10. CDN, caching & the SPA/PWA

- The SPA is a Vite build with **route-level code-splitting** (`React.lazy`) and a
  stable, long-cacheable `vendor-react` chunk. Serve `packages/web/dist` behind a
  CDN and set long `Cache-Control` on the hashed `/assets/*` files; keep
  `index.html` short-lived (or no-cache) so releases are picked up immediately.
- **Option A (single container):** the API serves the SPA — put the CDN in front of
  the whole origin.
- **Option B (split):** host `packages/web/dist` on a static CDN and run the API
  separately; set `CORS_ORIGIN` to the SPA origin and `APP_BASE_URL` accordingly.
- **PWA:** `manifest.webmanifest`, icons, and a service worker (`sw.js`) are already
  present. After choosing your domain, set an **absolute** `og:image`/`twitter:image`
  URL in `packages/web/index.html` so social previews render.
- `robots.txt` allows public pages and disallows `/api/`.

---

## 11. Multi-region & data residency

- The app is **region-agnostic** and multi-tenant: each `Organization` carries
  `country`/`countryCode`/`currency`, and all queries are scoped by
  `organizationId`. Enterprise regions/warehouses are modeled in the schema.
- **Data residency** (GDPR/CCPA and local laws) is an **infrastructure decision**:
  deploy the app + database in the required region(s) and keep each tenant's data in
  its home region. The Compliance Center (`/api/compliance`) tracks RoPA, retention,
  legal hold, purge, and breach notification.
- For multi-region, run one stack per region with its own database; do not share a
  single primary across regions unless you have a concrete latency/consistency design.
- Attestations that cannot be satisfied in code (PCI DSS SAQ, KYC/AML, SOC 2, signed
  DPA/DPO, in-country residency, HIPAA BAA) remain **operator responsibilities** and
  are flagged as such in the compliance catalog — they are intentionally not faked.

### 11.1 Three deployment roles (one image)

Every platform config in `deploy/` runs the same image in up to three roles that
only differ by environment:

| Role | Key env | Replicas | Why |
|---|---|---|---|
| **Web/API** | `SCHEDULER_ENABLED=false`, `SKIP_MIGRATIONS=true` | N (autoscale) | Stateless; no sticky sessions needed (JWT/cookies + DB-backed idempotency & rate-limit counters). |
| **Scheduler** | `SCHEDULER_ENABLED=true`, `SKIP_MIGRATIONS=true` | **exactly 1 per region** | The in-process tick loop drives campaigns, payouts, webhook retry, retention purge, low-stock, stored-value/loyalty expiry, and reconciliation. Jobs are idempotent, but a **single leader** avoids duplicate side effects across replicas. |
| **Migrator** | one-off `prisma migrate deploy` | 1 per deploy | Decoupled from boot (Fly `[release]`, compose `migrate` profile, ECS `run-task`) so rolling replicas never race. |

With the recommended **one-stack-per-region** model, each region runs its own
scheduler leader against its own database — there is no cross-region job
coordination to design. If you run multiple web replicas in a region, do **not**
enable the scheduler on them; give it the dedicated process/service/worker each
platform config already defines.

### 11.2 Concrete multi-region rollout

1. Provision managed Postgres 16 (+ pooler) **in each region**; private network.
2. Create **unique** `JWT_SECRET`/`ENCRYPTION_KEY` per region (never shared); vault
   the encryption key for DR.
3. Fill `deploy/regions/<region>.env.example` and load it into the platform secret
   store; set `STRICT_PROD_CONFIG=true`.
4. Deploy web (N) + scheduler (1) + run the migrator once per region.
5. Route tenants to their home region at the DNS/anycast layer (Cloudflare or Route
   53 latency/geolocation); confirm residency.

---

## 12. CI/CD

`.github/workflows/ci.yml` runs on pushes/PRs to `main`:

1. **verify** — `npm ci` → `prisma generate` → `npm run build` (shared + server +
   web type check and Vite build) → `npm run test:coverage` (unit + coverage gate)
   → `docker build`.
2. **db-validate** — spins up an ephemeral Postgres 16, applies the committed
   migration with `prisma migrate deploy`, then asserts **zero schema drift**
   (`prisma migrate diff --exit-code`). A forgotten migration fails the build.

**Continuous deployment** is provided by `.github/workflows/deploy.yml`: after CI is
green on `main` it builds the image, pushes to **GHCR**, deploys to the platform
selected by the `DEPLOY_TARGET` repository variable (`fly` | `ecs` | `none`), and
runs the smoke test (§13) against `SMOKE_URL`. The ECS path runs migrations from a
one-off task before rolling the services. With no target set it only builds +
pushes, so it is safe to enable before a platform is wired. See
[`deploy/README.md`](deploy/README.md) for the required variables/secrets.

---

## 13. Smoke test & rollback

**Smoke test** a deployed instance (health + readiness):

```bash
SMOKE_URL=https://pos.example.com npm run smoke
# exits non-zero if /api/health or /api/ready fail
```

**Rollback:** deployments are immutable images. Roll back by re-deploying the
previous image tag. Migrations are forward-only — if a release included a migration,
keep it backward-compatible (expand/contract) so the previous image still runs
against the migrated schema. Restore the database from backup only as a last resort.

---

## 14. Production security checklist

- [ ] `NODE_ENV=production`; strong unique `JWT_SECRET` and `ENCRYPTION_KEY`.
- [ ] Email provider configured — password resets are emailed, never returned.
- [ ] `CORS_ORIGIN` restricted to your real origin(s) (no `*`).
- [ ] `TRUST_PROXY=1` behind the proxy; TLS terminated at the edge (HTTPS only).
- [ ] CSP enabled (do not set `DISABLE_CSP`); `helmet` security headers active.
- [ ] `METRICS_TOKEN` set if `/api/metrics` is reachable; otherwise keep it private.
- [ ] Database on a private network; least-privilege DB role; pooled connections.
- [ ] Container runs as non-root (`posapp`); image built with `npm ci`.
- [ ] Automated backups + a tested restore; secrets stored in a secrets manager.
- [ ] `STRICT_PROD_CONFIG=true`; the startup `[config]` review logs **no ERROR** findings.
- [ ] Background scheduler enabled on **exactly one** leader per region (web replicas off).
- [ ] Rate limiting active: `auth`/`payment` limiters are **DB-backed** (shared
      across replicas); the global `api` limiter is in-memory (per replica).
- [ ] Stripe webhooks: the raw-body route is mounted before the JSON parser — ensure
      your proxy/CDN does not buffer or rewrite the request body.

---

## 15. Observability & scaling

- **Metrics:** `GET /api/metrics` exposes Prometheus text (HTTP classes, payment
  authorizations/captures/refunds, settled/refunded volume, offline-sync outcomes,
  and firing alerts). Counters are **in-process/per-replica** — aggregate them at
  your Prometheus scraper (scrape every replica) rather than expecting a global total
  from one endpoint.
- **Alerts:** thresholds are env-tunable (`ALERT_PAYMENT_FAILURES`,
  `ALERT_PAYMENT_FAILURE_RATE`, `ALERT_SYNC_FAILURES`, `ALERT_HTTP_5XX`) and surface
  as `pos_alert{name=…}` for Alertmanager.
- **Errors:** set `SENTRY_DSN` (+ `npm i @sentry/node`) to enable error tracking.
- **Graceful shutdown:** the server drains connections on `SIGTERM`/`SIGINT` and
  closes the Prisma pool, so rolling deploys and autoscaling are safe. Give the
  container a termination grace period ≥ 10s.
- **Scaling:** add replicas behind the load balancer; the stateless design plus
  DB-backed idempotency/rate-limiting means no sticky sessions are required. Scale
  the database (or add a pooler per §8) as the bottleneck shifts downstream.

---

## 16. Go-live checklist

1. Secrets set (`JWT_SECRET`, `ENCRYPTION_KEY`, DB creds, email provider).
2. `CORS_ORIGIN` + `APP_BASE_URL` point at the real domain; absolute `og:image`.
3. Migrations strategy chosen (boot vs. one-off `migrate` job + `SKIP_MIGRATIONS`).
4. Backups scheduled and a restore tested.
5. CDN/TLS in front; health checks wired; `/api/metrics` protected.
6. CI green on `main`; image built and pushed.
7. `npm run smoke` passes against the deployed URL.
8. Compliance items that are operator responsibilities acknowledged (PCI/KYC/SOC 2/
   DPA/residency).
