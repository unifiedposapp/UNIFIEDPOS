import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { authMiddleware, type AuthRequest } from '../src/middleware/auth';
import { getJwtSecret } from '../src/services/crypto';

// ─── Cross-tenant guard for platform operators ──────────────────────────────
// A SUPER_ADMIN signs in WITHOUT an organizationId (no Employee row). The whole
// tenant-data surface assumes that claim exists, so before this guard such a
// token reached a handler and blew up as a null-FK 500. authMiddleware now
// rejects it with a clean 403 everywhere except /auth and /platform. These run
// with no database: authMiddleware only verifies a token and inspects the path.

function token(payload: Record<string, unknown>): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '5m' } as jwt.SignOptions);
}

interface FakeRes {
  statusCode: number;
  body: any;
  status(code: number): FakeRes;
  json(body: any): FakeRes;
}

function mockRes(): FakeRes {
  const res: any = { statusCode: 0, body: null };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: any) => { res.body = body; return res; };
  return res as FakeRes;
}

function run(req: Partial<AuthRequest>) {
  const res = mockRes();
  const next = vi.fn();
  authMiddleware(req as AuthRequest, res as any, next);
  return { res, next };
}

const ORG_LESS_SUPER = { id: 'u1', email: 'root@platform.test', role: 'SUPER_ADMIN' };
const BEARER = (t: string) => ({ authorization: `Bearer ${t}` });

describe('authMiddleware cross-tenant guard', () => {
  it('403s an organization-less SUPER_ADMIN on a tenant endpoint', () => {
    const { res, next } = run({
      headers: BEARER(token(ORG_LESS_SUPER)) as any,
      originalUrl: '/api/notifications',
    });
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('ORG_CONTEXT_REQUIRED');
    expect(next).not.toHaveBeenCalled();
  });

  it('treats a compliance write the same way (was a latent 500)', () => {
    const { res, next } = run({
      headers: BEARER(token(ORG_LESS_SUPER)) as any,
      originalUrl: '/api/compliance/consent',
    });
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows an organization-less SUPER_ADMIN on the platform console', () => {
    for (const path of ['/api/platform/overview', '/api/v1/platform/organizations']) {
      const { res, next } = run({ headers: BEARER(token(ORG_LESS_SUPER)) as any, originalUrl: path });
      expect(next, path).toHaveBeenCalledTimes(1);
      expect(res.statusCode, path).toBe(0);
    }
  });

  it('allows an organization-less SUPER_ADMIN on the auth surface', () => {
    for (const path of ['/api/auth/me', '/api/auth/logout']) {
      const { next } = run({ headers: BEARER(token(ORG_LESS_SUPER)) as any, originalUrl: path });
      expect(next, path).toHaveBeenCalledTimes(1);
    }
  });

  it('does NOT change behaviour for a normal tenant user (has org)', () => {
    const { next } = run({
      headers: BEARER(token({ ...ORG_LESS_SUPER, role: 'OWNER', organizationId: 'org_1' })) as any,
      originalUrl: '/api/notifications',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does NOT change behaviour for a dual-role operator who also has an org', () => {
    const { next } = run({
      headers: BEARER(token({ ...ORG_LESS_SUPER, organizationId: 'org_1' })) as any,
      originalUrl: '/api/retail/dashboard',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('still 401s with no bearer token at all', () => {
    const { res, next } = run({ headers: {} as any, originalUrl: '/api/notifications' });
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
