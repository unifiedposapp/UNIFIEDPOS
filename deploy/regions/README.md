# ─────────────────────────────────────────────────────────────────────────────
# Per-region production environment — templates
#
# Recommended global topology: ONE full stack (app + its own PostgreSQL) PER
# REGION. Each stack keeps its tenants' data in-region for residency
# (GDPR/CCPA/local law) and gets its own public URL. Route tenants to their home
# region at your DNS/anycast layer (Cloudflare, Route 53 latency/geolocation).
#
# These files are TEMPLATES — copy the values into your platform's secret store
# (fly secrets, AWS Secrets Manager, Render/Railway env). NEVER commit the real
# values. Each region differs only in the four "REGION-SPECIFIC" lines below;
# every secret must be unique per region (do NOT reuse JWT_SECRET/ENCRYPTION_KEY
# across regions).
#
#   us.env.example     → US-East     (Fly: iad · AWS: us-east-1)
#   eu.env.example     → EU          (Fly: cdg · AWS: eu-central-1)
#   apac.env.example   → Asia-Pacific(Fly: nrt/sin · AWS: ap-northeast-1)
#
# The server's startup production-config review (services/productionConfig.ts)
# fails closed under STRICT_PROD_CONFIG=true if any REQUIRED value is missing —
# check the boot logs after each regional deploy.
# ─────────────────────────────────────────────────────────────────────────────

# ═══ REQUIRED (no safe fallback in production) ═══════════════════════════════
NODE_ENV=production
PORT=3001

# REGION-SPECIFIC — point at this region's own managed PostgreSQL (+ pooler).
DATABASE_URL="postgresql://USER:PASS@REGION_DB_HOST:5432/unified_pos?schema=public"

# REGION-SPECIFIC — this region's public SPA/API origin(s). No wildcards.
CORS_ORIGIN="https://REGION.example.com"

# REGION-SPECIFIC — base URL used in emailed links (password reset).
APP_BASE_URL="https://REGION.example.com"

# Unique per region. Generate:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET="REPLACE-with-a-48-byte-hex-unique-to-this-region"

# Unique per region. CHANGE AFTER DATA IS WRITTEN = ROWS UNDECRYPTABLE.
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Back this up in your DR vault with the same rigor as the database.
ENCRYPTION_KEY="REPLACE-with-a-32-byte-base64-unique-to-this-region"

# ═══ REQUIRED for a real deployment ══════════════════════════════════════════
TRUST_PROXY=1                 # behind the platform LB/CDN so req.ip is real
WEB_DIST=/app/packages/web/dist
STRICT_PROD_CONFIG=true       # refuse to boot on a failed config review

# Transactional email — REQUIRED in prod or password resets silently don't send.
EMAIL_PROVIDER=resend         # resend | sendgrid | smtp
RESEND_API_KEY="re_REPLACE"
EMAIL_FROM="Unified POS <no-reply@example.com>"

# ═══ STRONGLY RECOMMENDED ════════════════════════════════════════════════════
METRICS_TOKEN="REPLACE-scrape-token"   # else GET /api/metrics is unauthenticated
# SENTRY_DSN="https://KEY@ORG.ingest.sentry.io/ID"   # then: npm i @sentry/node
# SENTRY_TRACES_SAMPLE_RATE=0.1

# Payments — unset means the built-in SIMULATOR (no real money).
# Card data is tokenized client-side (PCI SAQ-A scope).
# STRIPE_SECRET_KEY="sk_live_..."
# STRIPE_PUBLISHABLE_KEY="pk_live_..."
# STRIPE_WEBHOOK_SECRET="whsec_..."

# ═══ Scheduler leadership (per stack) ════════════════════════════════════════
# Web/API replicas: false. The single dedicated scheduler process: true.
# (fly.toml process groups / the AWS scheduler service / the Render worker set
# this for you — only override here if you deploy those roles yourself.)
SCHEDULER_ENABLED=false

# ═══ Migrations ══════════════════════════════════════════════════════════════
# true = apply migrations from the one-off release/migrate job (recommended for
# multi-replica); false = run `prisma migrate deploy` on container boot.
SKIP_MIGRATIONS=true

# ═══ OPTIONAL features (see .env.example for the full list) ══════════════════
# COOKIE_SAMESITE=lax
# AWS_S3_BUCKET / AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   (media)
# VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT                     (web push)
# LLM_API_KEY / LLM_MODEL                                                  (copilot)
# FRAUD_* thresholds                                                       (fraud)
