// ─── REGISTER ACCESS MIDDLEWARE (§37 Security / §7 Point of Sale) ───────────
// Enforces the drawer-lock rule at the edge of every money-moving route: a
// cashier whose register session is locked cannot create orders, take payments,
// refund or move cash — not because the UI hides the buttons, but because the
// server refuses. A lock screen that is merely decorative can be bypassed by
// typing a request; this cannot.
import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { decideRegisterAccess, findOpenSession, OpenSessionLike } from '../services/registerAccess.js';

export interface RegisterRequest extends AuthRequest {
  /** The caller's own open session (never another cashier's), if any. */
  registerSession?: OpenSessionLike | null;
}

/**
 * Reject the request while the CALLER's open register session is locked.
 *
 * The session is looked up by the employee id carried in the verified token, so
 * the check is inherently per-cashier: cashier B's token can never resolve (or
 * unlock) cashier A's session, and one cashier's lock can never block another.
 * Callers with no open session at all pass — back-office work (reports,
 * inventory) must stay usable without a drawer.
 *
 * The payload carries `code: 'REGISTER_LOCKED'` plus the session identity so a
 * client can reopen the lock screen instead of showing a generic failure.
 */
export function requireUnlockedRegister(req: RegisterRequest, res: Response, next: NextFunction): void {
  findOpenSession(req.user?.employeeId)
    .then((session) => {
      req.registerSession = session; // reuse downstream (order → drawer stamping)
      if (decideRegisterAccess(session) === 'LOCKED') {
        res.status(423).json({
          success: false,
          code: 'REGISTER_LOCKED',
          error: 'Register is locked. Enter your personal PIN to continue.',
          data: { sessionId: session!.id, registerId: session!.registerId, locked: true },
        });
        return;
      }
      next();
    })
    .catch(next);
}
