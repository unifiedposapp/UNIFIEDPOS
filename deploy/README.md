# Global deployment assets

Everything here deploys the **same portable image** built from the repo-root
[`Dockerfile`](../Dockerfile) — Express API + built SPA on one origin, backed by
PostgreSQL 16. Pick the platform that fits; the operational model (stateless web
tier + a single scheduler leader + region-per-tenant stacks) is identical across
all of them.

| Platform | Files | Scheduler leader | Migrations |
|---|---|---|---|
| **Fly.io** (recommended for multi-region) | [`../fly.toml`](../fly.toml) | `scheduler` process group | `[release]` command (once/deploy) |
| **AWS ECS Fargate** | [`aws/`](./aws) | separate `unified-pos-scheduler` service | one-off `run-task` (CD does it) |
| **Render** | [`../render.yaml`](../render.yaml) | `unified-pos-scheduler` worker | web boot (or one-off shell) |
| **Railway** | [`../railway.json`](../railway.json) | 2nd service, `SCHEDULER_ENABLED=true` | web boot |
| **Docker Compose** (self-host/VPS) | [`../docker-compose.yml`](../docker-compose.yml) | `SCHEDULER_ENABLED` on one replica | `migrate` profile / boot |
| **Per-region env** | [`regions/`](./regions) | — | — |
| **CI/CD** | [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml), [`deploy.yml`](../.github/workflows/deploy.yml) | — | CD runs migrations |

## The three deployment roles (same image, different env)

1. **Web/API** — `SCHEDULER_ENABLED=false`, `SKIP_MIGRATIONS=true`. Scale to N
   replicas behind the load balancer. No sticky sessions required (JWT/cookies +
   DB-backed idempotency & rate-limit counters).
2. **Scheduler** — `SCHEDULER_ENABLED=true`, `SKIP_MIGRATIONS=true`. Run **exactly
   one** per stack (per region) so background jobs — campaign launch, payouts,
   webhook retry, retention purge, low-stock, stored-value/loyalty expiry,
   reconciliation — never double-fire.
3. **Migrator** — a one-off `prisma migrate deploy` (Fly `[release]`, the compose
   `migrate` profile, or an ECS `run-task`). Decoupled from boot so rolling
   replicas never race.

## Railway (multi-service) notes

`railway.json` configures a single service's build/deploy. To mirror the model
above on Railway, create **two services from this same repo**:

- `web` — Dockerfile build; set `SCHEDULER_ENABLED=false`, `SKIP_MIGRATIONS=false`
  (or true + a manual migrate), and all REQUIRED env from `regions/*.env.example`.
  Enable the public domain; health check `/api/health`.
- `scheduler` — Dockerfile build; set `SCHEDULER_ENABLED=true`,
  `SKIP_MIGRATIONS=true`, and the same DB/secrets. No public domain needed.
- Add a **PostgreSQL** plugin and reference its `DATABASE_URL` in both services.

## CI/CD

- [`ci.yml`](../.github/workflows/ci.yml) — build · test · coverage gate ·
  `docker build`, plus a Prisma migration-drift check against ephemeral Postgres.
- [`deploy.yml`](../.github/workflows/deploy.yml) — after CI is green on `main`,
  builds the image, pushes to **GHCR**, then deploys to the platform chosen by the
  `DEPLOY_TARGET` repo variable (`fly` | `ecs` | `none`) and runs the
  [smoke test](../scripts/smoke-test.mjs) against `SMOKE_URL`. With no target set
  it only builds + pushes, so it is safe to enable before a platform is wired.

## Global rollout checklist (per region)

1. Provision managed **PostgreSQL 16** in-region (private network + pooler).
2. Create **unique** `JWT_SECRET` and `ENCRYPTION_KEY` (never shared across
   regions); store `ENCRYPTION_KEY` in the DR vault.
3. Set region-specific `CORS_ORIGIN` + `APP_BASE_URL` to the public URL.
4. Configure a **transactional email provider** (required — resets must send).
5. Set `TRUST_PROXY=1`, `METRICS_TOKEN`, and `STRICT_PROD_CONFIG=true`.
6. Deploy **web** (N replicas) + **scheduler** (1) + run the **migrator** once.
7. Check boot logs for the `[config]` review — it must report no ERROR findings.
8. Put CDN/WAF + TLS in front; wire health checks (`/api/health`, `/api/ready`).
9. Run `SMOKE_URL=<region-url> npm run smoke` before routing traffic.
10. Route tenants to their home region at DNS; confirm data residency.

Full operator detail (backups/DR, pooling, multi-region residency, security
checklist, observability) lives in [`../DEPLOYMENT.md`](../DEPLOYMENT.md).
