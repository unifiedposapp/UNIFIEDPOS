// ─── Session cookies & CSRF (§37) ─────────────────────────────────────────
// The SPA can authenticate with an httpOnly session cookie instead of a JWT in
// localStorage, which removes the token from JavaScript reach (XSS hardening).
// We use the double-submit-cookie pattern for CSRF: a second, JS-readable cookie
// holds a random token that the client must echo back in an X-CSRF-Token header
// on state-changing requests.
//
// Auth remains DUAL-MODE: the server accepts either the httpOnly cookie or an
// Authorization: Bearer header, so existing clients keep working while the SPA
// migrates to cookies.

import { Response } from 'express';
import crypto from 'node:crypto';

export const SESSION_COOKIE = 'pos_session';
export const CSRF_COOKIE = 'pos_csrf';

const DEFAULT_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8h — aligns with the default JWT lifetime

function secureFlag(): boolean {
  // Secure cookies require HTTPS. Force on in production; allow an override for
  // local HTTPS proxies. Off in plain-http dev so the cookie is still stored.
  return process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
}

function sameSite(): 'lax' | 'strict' | 'none' {
  const v = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
  return v === 'strict' || v === 'none' ? v : 'lax';
}

function maxAge(): number {
  const n = Number(process.env.COOKIE_MAX_AGE_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_AGE_MS;
}

/** httpOnly session cookie — not readable by JS (XSS hardening). */
export function sessionCookieOptions() {
  return { httpOnly: true, secure: secureFlag(), sameSite: sameSite(), maxAge: maxAge(), path: '/' } as const;
}

/** CSRF cookie — intentionally JS-readable for the double-submit pattern. */
export function csrfCookieOptions() {
  return { httpOnly: false, secure: secureFlag(), sameSite: sameSite(), maxAge: maxAge(), path: '/' } as const;
}

export function issueCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Set both the session and CSRF cookies (call on login / register / MFA verify). */
export function setSessionCookies(res: Response, token: string, csrfToken: string): void {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  res.cookie(CSRF_COOKIE, csrfToken, csrfCookieOptions());
}

/** Clear session cookies (call on logout). */
export function clearSessionCookies(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: secureFlag(), sameSite: sameSite() });
  res.clearCookie(CSRF_COOKIE, { path: '/', httpOnly: false, secure: secureFlag(), sameSite: sameSite() });
}

/** Constant-time string comparison for CSRF tokens. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
