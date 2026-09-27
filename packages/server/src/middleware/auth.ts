import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../services/crypto.js';
import { SESSION_COOKIE } from '../services/session.js';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    organizationId?: string;
    employeeId?: string;
  };
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  // Dual-mode: accept an Authorization: Bearer header OR the httpOnly session
  // cookie. The header takes precedence when both are present.
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : undefined;
  const cookieToken = (req as any).cookies?.[SESSION_COOKIE] as string | undefined;
  const token = bearer || cookieToken;

  if (!token) {
    res.status(401).json({ success: false, error: 'No authentication token provided' });
    return;
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as {
      id: string;
      email: string;
      role: string;
      organizationId?: string;
      employeeId?: string;
    };
    req.user = decoded;

    // Cross-tenant guard for platform operators. Every tenant-data route in
    // this API reads req.user.organizationId (a JWT claim that only exists when
    // the caller has an Employee row). A SUPER_ADMIN authenticates WITHOUT one,
    // because the operator sits above every tenant. Letting such a token reach a
    // tenant handler makes Prisma throw a null-FK error and surface as a 500.
    // Rather than guard the ~400 call sites individually, we enforce the rule at
    // this single choke point: an organization-less operator may only touch the
    // auth surface and the /platform console; anything else is a clean 403.
    // Tenant users (who always carry an organizationId) are unaffected, so this
    // never changes existing behaviour for them.
    if (req.user.role === 'SUPER_ADMIN' && !req.user.organizationId && !isOrgLessAllowed(req)) {
      res.status(403).json({
        success: false,
        code: 'ORG_CONTEXT_REQUIRED',
        error: 'Platform operators have no organization context; only /auth and /platform APIs are available to this account.',
      });
      return;
    }

    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

// Path prefixes an organization-less SUPER_ADMIN is allowed to reach. Both the
// raw (/api) and versioned (/api/v1) mounts are covered, for the exact segment,
// a nested path, or a query string.
const ORG_LESS_ALLOWED_PREFIXES = ['/api/auth', '/api/platform', '/api/v1/auth', '/api/v1/platform'];
function isOrgLessAllowed(req: AuthRequest): boolean {
  const url = req.originalUrl || req.url || '';
  return ORG_LESS_ALLOWED_PREFIXES.some((p) => url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`));
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}

/**
 * Gates the cross-tenant platform console. Unlike requireRole (which stays
 * within a caller's own organization), SUPER_ADMIN is a platform-operator
 * privilege that intentionally sees across every tenant, so it is a single
 * dedicated role rather than one that any organization can grant itself. The
 * role never comes from self-service register/create (both enum their roles to
 * the four tenant values); it exists only on a seeded/bootstrapped account.
 */
export function requireSuperAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }
  if (req.user.role !== 'SUPER_ADMIN') {
    res.status(403).json({ success: false, error: 'Platform administrator access required' });
    return;
  }
  next();
}
