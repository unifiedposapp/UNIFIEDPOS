import { describe, it, expect } from 'vitest';
import {
  reviewProductionConfig,
  formatConfigReview,
  strictProdConfig,
  type EnvLike,
} from '../src/services/productionConfig';

/** A fully-configured production environment — the review should pass clean. */
function goodProdEnv(over: EnvLike = {}): EnvLike {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@db:5432/pos?schema=public',
    JWT_SECRET: 'a'.repeat(48),
    ENCRYPTION_KEY: 'k'.repeat(44),
    CORS_ORIGIN: 'https://pos.example.com',
    TRUST_PROXY: '1',
    APP_BASE_URL: 'https://pos.example.com',
    METRICS_TOKEN: 'scrape-token',
    RESEND_API_KEY: 're_123',
    STRIPE_SECRET_KEY: 'sk_live_123',
    ...over,
  };
}

const codes = (env: EnvLike) => reviewProductionConfig(env).findings.map((f) => f.code);

describe('reviewProductionConfig', () => {
  it('passes clean for a fully-configured production environment', () => {
    const review = reviewProductionConfig(goodProdEnv());
    expect(review.isProduction).toBe(true);
    expect(review.findings).toEqual([]);
    expect(review.ok).toBe(true);
  });

  it('flags a missing email provider as an error in production', () => {
    const env = goodProdEnv({ RESEND_API_KEY: undefined, SENDGRID_API_KEY: undefined, SMTP_HOST: undefined });
    expect(codes(env)).toContain('email_provider_missing');
    expect(reviewProductionConfig(env).ok).toBe(false);
  });

  it('accepts any one email provider', () => {
    expect(codes(goodProdEnv({ RESEND_API_KEY: undefined, SMTP_HOST: 'smtp.example.com' }))).not.toContain('email_provider_missing');
    expect(codes(goodProdEnv({ RESEND_API_KEY: undefined, SENDGRID_API_KEY: 'SG.x' }))).not.toContain('email_provider_missing');
  });

  it('flags placeholder and short JWT secrets', () => {
    expect(codes(goodProdEnv({ JWT_SECRET: 'your-super-secret-jwt-key-change-in-production' }))).toContain('jwt_secret_weak');
    expect(codes(goodProdEnv({ JWT_SECRET: 'short' }))).toContain('jwt_secret_weak');
    expect(codes(goodProdEnv({ JWT_SECRET: undefined }))).toContain('jwt_secret_missing');
  });

  it('flags the placeholder encryption key', () => {
    expect(codes(goodProdEnv({ ENCRYPTION_KEY: 'change-me-to-a-long-random-passphrase' }))).toContain('encryption_key_placeholder');
    expect(codes(goodProdEnv({ ENCRYPTION_KEY: undefined }))).toContain('encryption_key_missing');
  });

  it('flags a CORS wildcard as an error but localhost only as a warning', () => {
    const wild = reviewProductionConfig(goodProdEnv({ CORS_ORIGIN: '*' }));
    expect(wild.findings.find((f) => f.code === 'cors_wildcard')?.severity).toBe('error');

    const local = reviewProductionConfig(goodProdEnv({ CORS_ORIGIN: 'http://localhost:5173' }));
    expect(local.findings.find((f) => f.code === 'cors_localhost')?.severity).toBe('warn');
    expect(local.ok).toBe(true); // warnings do not fail the review
  });

  it('warns when the payment simulator is active and metrics are open in production', () => {
    const env = goodProdEnv({ STRIPE_SECRET_KEY: undefined, METRICS_TOKEN: undefined });
    expect(codes(env)).toEqual(expect.arrayContaining(['payments_simulator', 'metrics_token_unset']));
    expect(reviewProductionConfig(env).ok).toBe(true); // both are warnings
  });

  it('never fails a non-production review, even with everything missing', () => {
    const review = reviewProductionConfig({ NODE_ENV: 'development' });
    expect(review.isProduction).toBe(false);
    expect(review.ok).toBe(true);
    // It still surfaces the missing secrets for awareness.
    expect(review.findings.map((f) => f.code)).toContain('database_url_missing');
  });
});

describe('formatConfigReview', () => {
  it('reports no issues for a clean review', () => {
    expect(formatConfigReview(reviewProductionConfig(goodProdEnv()))).toMatch(/no issues found/);
  });

  it('lists each finding with its severity and code', () => {
    const text = formatConfigReview(reviewProductionConfig(goodProdEnv({ RESEND_API_KEY: undefined })));
    expect(text).toMatch(/ERROR \[email_provider_missing\]/);
  });
});

describe('strictProdConfig', () => {
  it('is true only when STRICT_PROD_CONFIG=true', () => {
    expect(strictProdConfig({ STRICT_PROD_CONFIG: 'true' })).toBe(true);
    expect(strictProdConfig({ STRICT_PROD_CONFIG: 'TRUE' })).toBe(true);
    expect(strictProdConfig({ STRICT_PROD_CONFIG: 'false' })).toBe(false);
    expect(strictProdConfig({})).toBe(false);
  });
});
