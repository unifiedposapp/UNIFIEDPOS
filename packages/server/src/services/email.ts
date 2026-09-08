// ─── Transactional email (§37 auth, §5 notifications) ────────────────────────
// Env-gated with ZERO hard dependencies — mirrors observability.ts so the app
// compiles and runs with no mail SDK installed. Providers:
//   • resend    — RESEND_API_KEY      (HTTPS REST via the global fetch)
//   • sendgrid  — SENDGRID_API_KEY    (HTTPS REST via the global fetch)
//   • smtp      — SMTP_* + nodemailer (loaded via a *variable* dynamic import, so
//                 TypeScript does not require it to compile; `npm i nodemailer`
//                 to activate)
//   • none      — safe no-op that only logs (default in dev with no keys)
//
// SECURITY CONTRACT: sendEmail() NEVER throws and NEVER returns secret material.
// Callers (e.g. /forgot-password) must not expose one-time tokens to clients in
// production — they email the token and return a uniform response instead.

/** Minimal env shape so the module is unit-testable with a plain object. */
export type EnvLike = Record<string, string | undefined>;

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type EmailProvider = 'resend' | 'sendgrid' | 'smtp' | 'none';

export interface EmailResult {
  delivered: boolean;
  provider: EmailProvider;
  /** Why delivery did not happen (no-provider, provider error, ...). */
  reason?: string;
  /** Provider message id, when available. */
  id?: string;
}

/**
 * Resolve the active provider: an explicit EMAIL_PROVIDER wins; otherwise infer
 * from whichever credential is present. Returns 'none' when nothing is set.
 */
export function resolveEmailProvider(env: EnvLike = process.env): EmailProvider {
  const explicit = (env.EMAIL_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'resend' || explicit === 'sendgrid' || explicit === 'smtp' || explicit === 'none') {
    return explicit;
  }
  if (env.RESEND_API_KEY) return 'resend';
  if (env.SENDGRID_API_KEY) return 'sendgrid';
  if (env.SMTP_HOST) return 'smtp';
  return 'none';
}

/** True when a real provider is configured (callers use this to gate token exposure). */
export function isEmailConfigured(env: EnvLike = process.env): boolean {
  return resolveEmailProvider(env) !== 'none';
}

/**
 * Fail-closed gate for whether /forgot-password may return the raw reset token
 * to the caller. This is TRUE only for a NON-production request where the reset
 * email did NOT actually deliver (i.e. local dev with no mail provider), so the
 * flow stays testable without a live inbox. In production the token is NEVER
 * returned, even if delivery failed — it is only ever emailed. Extracted as a
 * pure function so the security rule is unit-tested and cannot silently drift.
 */
export function canExposeResetToken(nodeEnv: string | undefined, delivered: boolean): boolean {
  return nodeEnv !== 'production' && !delivered;
}

/** The From header value; defaults to a clearly-labelled no-reply address. */
export function emailFrom(env: EnvLike = process.env): string {
  return (env.EMAIL_FROM || 'Unified POS <no-reply@unifiedpos.local>').trim();
}

/** Split "Display Name <addr@x>" into parts (SendGrid wants a structured from). */
export function parseFrom(from: string): { name?: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<\s*([^>]+?)\s*>\s*$/);
  if (m) return { name: m[1] || undefined, email: m[2] };
  return { email: from.trim() };
}

/** First origin in a comma-separated list (used to derive the app base URL). */
function firstOrigin(list: string | undefined): string | undefined {
  if (!list) return undefined;
  const first = list.split(',').map((s) => s.trim()).filter(Boolean)[0];
  return first && first !== '*' ? first : undefined;
}

/** Public base URL used to build links in emails (no trailing slash). */
export function appBaseUrl(env: EnvLike = process.env): string {
  const base = env.APP_BASE_URL || firstOrigin(env.CORS_ORIGIN) || 'http://localhost:5173';
  return base.replace(/\/+$/, '');
}

/** Build the password-reset link for a raw (single-use) token. */
export function buildResetLink(rawToken: string, env: EnvLike = process.env): string {
  return `${appBaseUrl(env)}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

async function sendViaResend(msg: EmailMessage, from: string, key: string): Promise<EmailResult> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
  });
  if (!res.ok) return { delivered: false, provider: 'resend', reason: `resend-http-${res.status}` };
  const data: any = await res.json().catch(() => ({}));
  return { delivered: true, provider: 'resend', id: data?.id };
}

async function sendViaSendGrid(msg: EmailMessage, from: string, key: string): Promise<EmailResult> {
  const parsed = parseFrom(from);
  const content: { type: string; value: string }[] = [{ type: 'text/plain', value: msg.text }];
  if (msg.html) content.push({ type: 'text/html', value: msg.html });
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: msg.to }] }],
      from: parsed,
      subject: msg.subject,
      content,
    }),
  });
  // SendGrid answers 202 with an empty body on success.
  if (!res.ok) return { delivered: false, provider: 'sendgrid', reason: `sendgrid-http-${res.status}` };
  return { delivered: true, provider: 'sendgrid', id: res.headers.get('x-message-id') || undefined };
}

async function sendViaSmtp(msg: EmailMessage, from: string, env: EnvLike): Promise<EmailResult> {
  try {
    // Variable specifier => TS leaves this a runtime-only import (no compile dep).
    const moduleName = env.SMTP_MODULE || 'nodemailer';
    const nodemailer: any = await import(moduleName);
    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT || 587),
      secure: String(env.SMTP_SECURE || '').toLowerCase() === 'true',
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
    const info = await transporter.sendMail({
      from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return { delivered: true, provider: 'smtp', id: info?.messageId };
  } catch (e: any) {
    const message = String(e?.message || e);
    const missing = /Cannot find|ERR_MODULE_NOT_FOUND|Could not resolve/i.test(message);
    return { delivered: false, provider: 'smtp', reason: missing ? 'smtp-nodemailer-missing' : 'smtp-error' };
  }
}

/**
 * Send an email through the configured provider. Never throws — returns a result
 * so callers can degrade safely (and, for one-time tokens, fail closed).
 */
export async function sendEmail(msg: EmailMessage, env: EnvLike = process.env): Promise<EmailResult> {
  const provider = resolveEmailProvider(env);
  const from = emailFrom(env);
  try {
    switch (provider) {
      case 'resend':
        return await sendViaResend(msg, from, env.RESEND_API_KEY as string);
      case 'sendgrid':
        return await sendViaSendGrid(msg, from, env.SENDGRID_API_KEY as string);
      case 'smtp':
        return await sendViaSmtp(msg, from, env);
      default:
        console.warn(`[email] No provider configured — not sending "${msg.subject}" to ${msg.to}.`);
        return { delivered: false, provider: 'none', reason: 'no-provider' };
    }
  } catch (e: any) {
    // Network/parse failure — swallow so a mail outage can never crash a request.
    console.error('[email] send failed:', e?.message || e);
    return { delivered: false, provider, reason: 'error' };
  }
}

/**
 * Send the password-reset email for a raw (single-use) token. The token is only
 * ever placed in the emailed link — this function returns delivery metadata, NOT
 * the token, so the caller cannot accidentally leak it.
 */
export async function sendPasswordResetEmail(
  to: string,
  rawToken: string,
  opts: { expiresMinutes?: number } = {},
  env: EnvLike = process.env,
): Promise<EmailResult> {
  const minutes = opts.expiresMinutes ?? 15;
  const link = buildResetLink(rawToken, env);
  return sendEmail(
    {
      to,
      subject: 'Reset your Unified POS password',
      text:
        `We received a request to reset your Unified POS password.\n\n` +
        `Open this link to choose a new password (valid ${minutes} minutes):\n${link}\n\n` +
        `If you didn't request this, you can safely ignore this email.`,
      html:
        `<p>We received a request to reset your Unified POS password.</p>` +
        `<p><a href="${link}">Choose a new password</a> — valid for ${minutes} minutes.</p>` +
        `<p>If you didn't request this, you can safely ignore this email.</p>`,
    },
    env,
  );
}
