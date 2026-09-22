# Global Launch Checklist — Unified POS

Everything that must be true before the first paying merchant in the first
country, and before each additional region. Technical evidence already
produced by the codebase is linked inline; the remaining items need a human
decision, a signature, or money.

Legend: `[ ]` open · `[x]` done · Owner = who must act · Lead = realistic lead time.

## 0. Technical readiness (evidence already on file)

| Area | State | Evidence |
| --- | --- | --- |
| Feature completeness | All blueprint + hardening modules implemented | `IMPLEMENTATION_STATUS.md` |
| Unit/integration tests | 496 passed / 16 skipped; tenant-isolation suite 16/16 against real Postgres | `npx vitest run`, `packages/server/test/` |
| Typechecks & build | Server + web `tsc` clean, production Vite build green | CI `ci.yml` |
| Security review | L3 deep review 0 findings on `main` | pre-push gate, Qoder security |
| Production config gate | Boot **refuses** with `STRICT_PROD_CONFIG=true` on weak/missing config (proved 2026-09-22: 2 errors → exit 1; clean config → boots) | `packages/server/src/services/productionConfig.ts` |
| Load capacity (single instance, prod mode) | 3,000/3,000 requests, 0 failures, ~725 req/s; floor-plan API p95 ≈ 102 ms under 50-way concurrency | `node scripts/load-test.mjs --base http://<host> --concurrency 50 --requests 60` |
| Abuse protection | Global limiter verified live (single-IP flood correctly throttled at 100 req/min); health probes exempt | `packages/server/src/middleware/rateLimiter.ts` |
| Backups | `pg_dump` custom-format backup + **restore drill comparing 126 tables / 11k+ rows → PASS** | `node scripts/backup.mjs && node scripts/restore-drill.mjs` |
| Referential integrity | FK-orphan audit tool (found & fixed 39 dev-DB orphans) | `node scripts/integrity.mjs` |
| Secrets | Production secrets kit generated (per-region JWT + encryption keys, metrics token, DB password) — stored OUTSIDE the repo | Desktop `Unified POS Production Secrets.txt` → password manager, then delete |
| Demo-data safety | Seed refuses to run in production without `ALLOW_PROD_SEED=true` | `packages/server/src/db/seed.ts` |
| Multi-currency / SSO / i18n / RTL / a11y | Hardening tranche shipped | commit `cdf6b63`, User Manual §32.11–32.13 |

## 1. Accounts & credentials — Owner: CEO/ops — Lead: 1–2 weeks

- [ ] Domain(s) + TLS (per region, e.g. `us.pos.app`, `eu.pos.app`) — buy today.
- [ ] Cloud account (pick ONE to start: Fly.io/Render/Railway single region, or AWS ECS per `deploy/aws/`).
- [ ] Managed Postgres (RDS/Neon/Supabase) + **PgBouncer** pooler; set the kit's `POSTGRES_PASSWORD`; nightly automated snapshots ON.
- [ ] Stripe **live-mode approval** (business registration needed first) + `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`.
- [ ] Local rails per launch market (Flutterwave/DPO/Paystack/M-Pesa/…): partner contracts and API credentials. **Code validates the identifiers; only a signed agreement moves the money.**
- [ ] Transactional email: Resend/SendGrid account + verified sending domain (SPF/DKIM/DMARC) → `RESEND_API_KEY`/`SMTP_*`, `EMAIL_FROM`, `APP_BASE_URL`.
- [ ] S3-compatible bucket + keys for media (`AWS_S3_*`) or accept DB-stored media at first.
- [ ] Sentry account → `SENTRY_DSN`; uptime monitor (BetterStack/healthchecks.io) hitting `/api/health` + `/api/ready`.
- [ ] VAPID keys: generated locally for dev; for production regenerate on the deployed host (`POST /api/push/vapid-keys`, OWNER) with a real `VAPID_SUBJECT` email.
- [ ] All secrets pasted into the host's secret store from the kit file — **never committed**; delete the kit file after import.

## 2. Legal, fiscal & compliance — Owner: lawyers/local consultants — Lead: 1–6 months per market

- [ ] Terms of Service, Privacy Policy, Cookie Policy, DPA reviewed **per launch jurisdiction** (GDPR, Kenya DPA, Nigeria NDPR, POPIA, LGPD…). Current texts ship in-app but need counsel sign-off.
- [ ] Fiscal registrations, per country — the app emits compliant documents but cannot register you:
  - [ ] KSA: ZATCA Phase 2 certified solution/provider contract.
  - [ ] KE: eTIMS generator/controlled-device agreement.
  - [ ] MX: SAT PAC provider. BR: NFC-e SEFAZ authorizer. IN: GST e-invoice IRN provider (etc. per §32.1 regime you enable).
  - [ ] DE TSE device, IT SdI channel, PL KSeF certificate… as demanded per market.
- [ ] Data-residency mapping: which tenant countries live in which region (`deploy/regions/*.env.example`).
- [ ] PCI scope confirmed SAQ-A (Stripe Elements only — never proxy raw PANs; enforced by design).
- [ ] SCA/3DS enabled per region (EU PSD2 requires it — Stripe handles it once configured).
- [ ] Franchise/enterprise SSO: one real-world integration test against Okta or Entra ID before selling it.

## 3. Operational readiness — Owner: you + first on-call hire — Lead: 2–4 weeks

- [ ] Staging environment on the actual host, running the same image (Dockerfile → ECS/Fly).
- [ ] `STRICT_PROD_CONFIG=true` set on every production task/service (gate proven above).
- [ ] Scheduler leader rule: exactly ONE instance with `SCHEDULER_ENABLED=true` (documented in `.env.example`; enforce in task defs).
- [ ] Backup schedule: nightly `pg_dump` (host-managed or `scripts/backup.mjs` on cron) shipped to off-region storage; **`scripts/restore-drill.mjs` monthly, restore time under 30 min proven**.
- [ ] Rollout: blue/green or rolling deploys via `deploy.yml`; one-click rollback rehearsed (`DEPLOYMENT.md` §13).
- [ ] On-call rotation + alert routing (Sentry → Slack/WhatsApp; uptime monitor → phone).
- [ ] Rate-limit tuning decision: per-IP ceilings are sane defaults (100/min API, 30/min login) — document any per-customer exceptions.
- [ ] `scripts/integrity.mjs` scheduled weekly (orphan detector).
- [ ] Support plumbing: in-app "Getting Help" → a real inbox/ticketing; refund policy workflow rehearsed with Stripe test cards then live.
- [ ] Demo-data policy: production databases never seed (`ALLOW_PROD_SEED` guard); first real merchant created via Register.

## 4. Go-live gates — do not open signup until ALL are ✅

- [ ] One real pilot merchant trading in one country end-to-end (sale → payment → receipt → fiscal queue → settlement reconciliation).
- [ ] Load test re-run against staging at expected 6-month traffic: `node scripts/load-test.mjs --base https://staging… --concurrency 100 --requests 100`.
- [ ] Restore drill passed on the *hosted* database, not just locally.
- [ ] Email deliverability: reset email lands in Gmail/Outlook inboxes (DKIM aligned).
- [ ] Legal docs signed off for the launch country.
- [ ] Stripe live mode: one real charge + one real refund executed.
- [ ] Kill switch rehearsed: `deploy.yml` rollback + DB PITR restore on 5-minute notice.

## 5. Expansion (after region 1 is profitable)

- [ ] Region 2 + 3: copy `deploy/regions/eu.env.example` / `apac.env.example` into the host dashboard with the kit's per-region secrets; residency routing for new signups by country.
- [ ] Per-market fiscal activation in Settings → Fiscal, one regime at a time, with the provider contract for that regime signed (§32.1 of the User Manual describes what the app expects).
- [ ] Enterprise features (SSO/SCIM, franchise consolidation, benchmark cohorts) sold only after the first real integration test of each.
