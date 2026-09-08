// ─── CSRF protection (double-submit cookie) ───────────────────────────────
// Enforced ONLY for state-changing requests that authenticate via the session
// cookie. Browsers auto-attach cookies cross-origin, which is the CSRF risk;
// requiring the JS-readable pos_csrf cookie to be echoed in an X-CSRF-Token
// header proves the request came from our own SPA (a cross-site attacker cannot
// read that cookie). Requests carrying an explicit Authorization: Bearer header
// are exempt — that header is never auto-attached cross-origin.

import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { CSRF_COOKIE, SESSION_COOKIE, safeEqual } from '../services/session.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfProtection(req: AuthRequest, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();

  // Bearer-token auth is not CSRF-able.
  if (typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')) {
    return next();
  }

  const cookies = (req as any).cookies || {};
  // No session cookie => nothing to protect here; authMiddleware will 401 later.
  if (!cookies[SESSION_COOKIE]) return next();

  const headerToken = req.headers['x-csrf-token'];
  const cookieToken = cookies[CSRF_COOKIE];
  if (typeof headerToken !== 'string' || typeof cookieToken !== 'string' || !safeEqual(headerToken, cookieToken)) {
    res.status(403).json({ success: false, error: 'CSRF token missing or invalid' });
    return;
  }

  next();
}
