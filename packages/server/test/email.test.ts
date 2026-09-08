import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  resolveEmailProvider,
  isEmailConfigured,
  canExposeResetToken,
  emailFrom,
  parseFrom,
  appBaseUrl,
  buildResetLink,
  sendEmail,
  sendPasswordResetEmail,
} from '../src/services/email';

// ─── Provider resolution ────────────────────────────────────────────────────
describe('resolveEmailProvider', () => {
  it('honours an explicit EMAIL_PROVIDER over inferred keys', () => {
    expect(resolveEmailProvider({ EMAIL_PROVIDER: 'sendgrid', RESEND_API_KEY: 're_x' })).toBe('sendgrid');
  });

  it('normalises case/whitespace and rejects unknown explicit values', () => {
    expect(resolveEmailProvider({ EMAIL_PROVIDER: '  Resend ' })).toBe('resend');
    // Unknown explicit value falls through to inference (here: none).
    expect(resolveEmailProvider({ EMAIL_PROVIDER: 'carrier-pigeon' })).toBe('none');
  });

  it('infers the provider from whichever credential is present', () => {
    expect(resolveEmailProvider({ RESEND_API_KEY: 're_x' })).toBe('resend');
    expect(resolveEmailProvider({ SENDGRID_API_KEY: 'SG.x' })).toBe('sendgrid');
    expect(resolveEmailProvider({ SMTP_HOST: 'smtp.x.com' })).toBe('smtp');
  });

  it('prefers resend > sendgrid > smtp when several keys exist', () => {
    expect(resolveEmailProvider({ RESEND_API_KEY: 'a', SENDGRID_API_KEY: 'b', SMTP_HOST: 'c' })).toBe('resend');
    expect(resolveEmailProvider({ SENDGRID_API_KEY: 'b', SMTP_HOST: 'c' })).toBe('sendgrid');
  });

  it('returns none when nothing is configured', () => {
    expect(resolveEmailProvider({})).toBe('none');
    expect(isEmailConfigured({})).toBe(false);
    expect(isEmailConfigured({ RESEND_API_KEY: 're_x' })).toBe(true);
  });
});

// ─── The security gate ──────────────────────────────────────────────────────
describe('canExposeResetToken (fail-closed)', () => {
  it('NEVER exposes the token in production, delivered or not', () => {
    expect(canExposeResetToken('production', false)).toBe(false);
    expect(canExposeResetToken('production', true)).toBe(false);
  });

  it('exposes inline only in non-production AND when email did not deliver', () => {
    expect(canExposeResetToken('development', false)).toBe(true);
    expect(canExposeResetToken(undefined, false)).toBe(true);
    // Delivered => no need to leak the token even in dev.
    expect(canExposeResetToken('development', true)).toBe(false);
    expect(canExposeResetToken(undefined, true)).toBe(false);
  });
});

// ─── From / base-url helpers ────────────────────────────────────────────────
describe('emailFrom / parseFrom', () => {
  it('defaults to a labelled no-reply address', () => {
    expect(emailFrom({})).toBe('Unified POS <no-reply@unifiedpos.local>');
    expect(emailFrom({ EMAIL_FROM: '  Acme <hi@acme.test>  ' })).toBe('Acme <hi@acme.test>');
  });

  it('splits a display name from the address', () => {
    expect(parseFrom('Acme <hi@acme.test>')).toEqual({ name: 'Acme', email: 'hi@acme.test' });
    expect(parseFrom('hi@acme.test')).toEqual({ email: 'hi@acme.test' });
    expect(parseFrom('<hi@acme.test>')).toEqual({ email: 'hi@acme.test' });
  });
});

describe('appBaseUrl / buildResetLink', () => {
  it('prefers APP_BASE_URL and strips trailing slashes', () => {
    expect(appBaseUrl({ APP_BASE_URL: 'https://pos.example.com///' })).toBe('https://pos.example.com');
  });

  it('falls back to the first CORS origin, skipping wildcards', () => {
    expect(appBaseUrl({ CORS_ORIGIN: 'https://a.com, https://b.com' })).toBe('https://a.com');
    expect(appBaseUrl({ CORS_ORIGIN: '*' })).toBe('http://localhost:5173');
  });

  it('defaults to localhost when nothing is set', () => {
    expect(appBaseUrl({})).toBe('http://localhost:5173');
  });

  it('builds a reset link that URL-encodes the token', () => {
    const link = buildResetLink('a/b+c=d', { APP_BASE_URL: 'https://pos.example.com' });
    expect(link).toBe('https://pos.example.com/reset-password?token=a%2Fb%2Bc%3Dd');
  });
});

// ─── Delivery: no-provider + real providers (fetch mocked) ──────────────────
describe('sendEmail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a safe no-op when no provider is configured', async () => {
    const r = await sendEmail({ to: 'x@y.z', subject: 'Hi', text: 'body' }, {});
    expect(r).toEqual({ delivered: false, provider: 'none', reason: 'no-provider' });
  });

  it('delivers via resend and surfaces the message id', async () => {
    const fetchMock = vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => ({ id: 're_123' }), headers: new Headers() }) as any,
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = await sendEmail({ to: 'x@y.z', subject: 'S', text: 'T' }, { RESEND_API_KEY: 're_k' });
    expect(r).toEqual({ delivered: true, provider: 'resend', id: 're_123' });
    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', expect.any(Object));
  });

  it('reports a resend HTTP failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }) as any));
    const r = await sendEmail({ to: 'x@y.z', subject: 'S', text: 'T' }, { RESEND_API_KEY: 'bad' });
    expect(r).toEqual({ delivered: false, provider: 'resend', reason: 'resend-http-401' });
  });

  it('delivers via sendgrid (202 empty body) and reads the message id header', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ({ ok: true, status: 202, headers: new Headers({ 'x-message-id': 'sg_9' }) }) as any,
      ),
    );
    const r = await sendEmail(
      { to: 'x@y.z', subject: 'S', text: 'T', html: '<p>T</p>' },
      { SENDGRID_API_KEY: 'SG.k', EMAIL_FROM: 'Acme <hi@acme.test>' },
    );
    expect(r).toEqual({ delivered: true, provider: 'sendgrid', id: 'sg_9' });
  });

  it('reports a sendgrid HTTP failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, headers: new Headers() }) as any));
    const r = await sendEmail({ to: 'x@y.z', subject: 'S', text: 'T' }, { SENDGRID_API_KEY: 'SG.k' });
    expect(r.delivered).toBe(false);
    expect(r.provider).toBe('sendgrid');
    expect(r.reason).toBe('sendgrid-http-403');
  });

  it('swallows a network error and returns reason=error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    const r = await sendEmail({ to: 'x@y.z', subject: 'S', text: 'T' }, { RESEND_API_KEY: 're_k' });
    expect(r).toEqual({ delivered: false, provider: 'resend', reason: 'error' });
  });

  it('fails closed when the SMTP module is not installed', async () => {
    const r = await sendEmail(
      { to: 'x@y.z', subject: 'S', text: 'T' },
      { SMTP_HOST: 'smtp.x.com', SMTP_MODULE: '__nonexistent_smtp_module__' },
    );
    expect(r.delivered).toBe(false);
    expect(r.provider).toBe('smtp');
    expect(['smtp-nodemailer-missing', 'smtp-error']).toContain(r.reason);
  });
});

// ─── Password-reset email never leaks the token in its result ───────────────
describe('sendPasswordResetEmail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns delivery metadata only — never the raw token', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) =>
      ({ ok: true, status: 200, json: async () => ({ id: 're_pw' }), headers: new Headers() }) as any,
    );
    vi.stubGlobal('fetch', fetchMock);

    const rawToken = 'super-secret-token-value';
    const r = await sendPasswordResetEmail('user@acme.test', rawToken, { expiresMinutes: 15 }, {
      RESEND_API_KEY: 're_k',
      APP_BASE_URL: 'https://pos.example.com',
    });

    expect(r.delivered).toBe(true);
    // The token must not appear anywhere in the returned metadata...
    expect(JSON.stringify(r)).not.toContain(rawToken);
    // ...but it MUST appear in the emailed body/link (fetch was called with it).
    const call = fetchMock.mock.calls[0]?.[1] as any;
    expect(call.body).toContain('https://pos.example.com/reset-password?token=super-secret-token-value');
  });

  it('is a no-op (delivered:false) when no provider is configured', async () => {
    const r = await sendPasswordResetEmail('user@acme.test', 'tok', {}, {});
    expect(r).toEqual({ delivered: false, provider: 'none', reason: 'no-provider' });
  });
});
