// ─── Production configuration review (§37 hardening, global-deploy readiness) ─
// A single, pure, unit-tested pass over the environment that reports everything
// an operator must fix before going live. It never mutates state and never
// throws — it returns findings so the caller (index.ts) decides whether to warn
// loudly or, under STRICT_PROD_CONFIG, refuse to boot.
//
// Why this exists: getJwtSecret()/getEncryptionKey() already fail-closed in
// production, but only lazily, on first use, one variable at a time. This gives
// ONE consolidated report at startup — covering the gaps that do not throw on
// their own (no email provider, a CORS wildcard, an open metrics endpoint, an
// untrusted proxy, the payment simulator still active) — so a mis-deploy is
// obvious in the logs instead of silently degrading in production.

import { resolveEmailProvider } from './email.js';

/** Minimal env shape so the module is unit-testable with a plain object. */
export type EnvLike = Record<string, string | undefined>;

export type ConfigSeverity = 'error' | 'warn';

export interface ConfigFinding {
  severity: ConfigSeverity;
  /** Stable machine-readable code (assertions/tests key off this). */
  code: string;
  /** Human-readable remediation guidance. */
  message: string;
}

export interface ConfigReview {
  /** True when there are zero `error`-severity findings. */
  ok: boolean;
  isProduction: boolean;
  findings: ConfigFinding[];
}

// Placeholder values shipped in .env.example. If any of these survive into a
// production deployment the secret was never rotated — flag it as an error.
const PLACEHOLDER_JWT = 'your-super-secret-jwt-key-change-in-production';
const PLACEHOLDER_ENC = 'change-me-to-a-long-random-passphrase';

function isProduction(env: EnvLike): boolean {
  return String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function has(v: string | undefined): v is string {
  return Boolean(v && v.trim().length > 0);
}

function origins(env: EnvLike): string[] {
  return (env.CORS_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Review the environment for production readiness. Returns every finding; the
 * caller decides how to react. In NON-production this still reports informational
 * warnings but never marks the review as failed (ok stays true), so local dev is
 * never blocked by it.
 */
export function reviewProductionConfig(env: EnvLike = process.env): ConfigReview {
  const prod = isProduction(env);
  const findings: ConfigFinding[] = [];
  const push = (severity: ConfigSeverity, code: string, message: string) =>
    findings.push({ severity, code, message });

  // ── Database ───────────────────────────────────────────────────────────
  if (!has(env.DATABASE_URL)) {
    push('error', 'database_url_missing', 'DATABASE_URL is not set — the app cannot reach PostgreSQL.');
  }

  // ── Secrets (fail-closed at use time, but report early + together) ──────
  const jwt = env.JWT_SECRET;
  if (!has(jwt)) {
    push('error', 'jwt_secret_missing', 'JWT_SECRET is not set — tokens cannot be signed in production.');
  } else if (jwt === PLACEHOLDER_JWT || jwt.trim().length < 32) {
    push(
      'error',
      'jwt_secret_weak',
      'JWT_SECRET is a placeholder or shorter than 32 chars. Generate one: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))".',
    );
  }

  const enc = env.ENCRYPTION_KEY;
  if (!has(enc)) {
    push(
      'error',
      'encryption_key_missing',
      'ENCRYPTION_KEY is not set — credentials at rest cannot be encrypted. Losing/rotating it later makes existing rows undecryptable.',
    );
  } else if (enc === PLACEHOLDER_ENC) {
    push(
      'error',
      'encryption_key_placeholder',
      'ENCRYPTION_KEY is still the .env.example placeholder. Generate one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))".',
    );
  }

  // ── CORS ─────────────────────────────────────────────────────────────────
  const cors = origins(env);
  if (prod && cors.includes('*')) {
    push('error', 'cors_wildcard', 'CORS_ORIGIN contains "*" — credentialed requests must use an explicit origin allow-list.');
  }
  if (prod && cors.some((o) => /localhost|127\.0\.0\.1/.test(o))) {
    push('warn', 'cors_localhost', 'CORS_ORIGIN still lists a localhost origin in production — replace it with the real public URL(s).');
  }

  // ── Transactional email (required in production for password resets) ─────
  if (prod && resolveEmailProvider(env) === 'none') {
    push(
      'error',
      'email_provider_missing',
      'No transactional email provider configured (RESEND_API_KEY / SENDGRID_API_KEY / SMTP_HOST). Password resets will silently NOT be sent in production.',
    );
  }
  if (prod && !has(env.APP_BASE_URL)) {
    push('warn', 'app_base_url_missing', 'APP_BASE_URL is unset — emailed links fall back to CORS_ORIGIN. Set it to the public SPA URL.');
  }

  // ── Reverse proxy / client IP (rate limiting correctness) ────────────────
  if (prod && !has(env.TRUST_PROXY)) {
    push('warn', 'trust_proxy_unset', 'TRUST_PROXY is unset behind a load balancer/CDN — req.ip and rate limiting may see the proxy address. Set TRUST_PROXY=1.');
  }

  // ── Observability endpoint exposure ──────────────────────────────────────
  if (prod && !has(env.METRICS_TOKEN)) {
    push('warn', 'metrics_token_unset', 'METRICS_TOKEN is unset — GET /api/metrics is unauthenticated. Set a bearer token or keep the endpoint off the public internet.');
  }
  if (prod && String(env.DISABLE_CSP || '').toLowerCase() === 'true') {
    push('warn', 'csp_disabled', 'DISABLE_CSP=true in production weakens the Content-Security-Policy. Leave it off unless debugging.');
  }

  // ── Payments ───────────────────────────────────────────────────────────────
  if (prod && !has(env.STRIPE_SECRET_KEY)) {
    push('warn', 'payments_simulator', 'STRIPE_SECRET_KEY is unset — card payments run on the built-in SIMULATOR and no real money moves. Intentional only for staging.');
  }

  // In non-production we surface the same findings for awareness but never fail.
  const errors = findings.filter((f) => f.severity === 'error');
  return { ok: prod ? errors.length === 0 : true, isProduction: prod, findings };
}

/**
 * Format a review as a multi-line log block. Pure so it is trivially testable.
 */
export function formatConfigReview(review: ConfigReview): string {
  if (review.findings.length === 0) {
    return '[config] production configuration review: no issues found.';
  }
  const lines = review.findings.map(
    (f) => `  ${f.severity === 'error' ? 'ERROR' : 'WARN '} [${f.code}] ${f.message}`,
  );
  const head = review.isProduction
    ? `[config] production configuration review — ${review.findings.length} finding(s):`
    : `[config] configuration review (non-production, informational) — ${review.findings.length} finding(s):`;
  return [head, ...lines].join('\n');
}

/** True when STRICT_PROD_CONFIG is enabled (boot refuses to start on errors). */
export function strictProdConfig(env: EnvLike = process.env): boolean {
  return String(env.STRICT_PROD_CONFIG ?? '').trim().toLowerCase() === 'true';
}
