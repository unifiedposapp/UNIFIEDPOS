import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { app } from '../src/index';
import { prisma } from '../src/db/client';

// ─── Platform console authorization (DB-gated) ──────────────────────────────
// The whole /api/platform surface is cross-tenant, so it MUST be unreachable to
// everyone but a SUPER_ADMIN: anonymous → 401, a normal store OWNER → 403,
// SUPER_ADMIN → 200. This proves the privilege boundary, not the data logic.
//
// Skipped by default; run against a disposable database with:
//   RUN_DB_TESTS=1 DATABASE_URL=postgresql://... npx vitest run platform

const RUN = process.env.RUN_DB_TESTS === '1';
const suite = RUN ? describe : describe.skip;

const rand = () => crypto.randomBytes(6).toString('hex');

const PROTECTED_GETS = [
  '/api/platform/overview',
  '/api/platform/organizations',
  '/api/platform/users',
  '/api/platform/plans',
  '/api/platform/payments',
  '/api/platform/revenue',
  '/api/platform/history',
];

suite('platform console authorization (DB-gated)', () => {
  let ownerToken: string;
  let superToken: string;
  let superUserId: string;
  let tenantOrg: string;

  beforeAll(async () => {
    // A real store OWNER (self-service registration path).
    const reg = await request(app).post('/api/auth/register').send({
      name: 'Plat Guard',
      email: `plat-guard-${rand()}@platform.test`,
      password: 'Plat_Guard_2026',
      organizationName: `Plat Guard Corp ${rand()}`,
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
    });
    expect(reg.status).toBe(201);
    ownerToken = reg.body.data.token;
    tenantOrg = reg.body.data.organization.id;

    // A platform operator created directly (SUPER_ADMIN is never self-service).
    const email = `plat-root-${rand()}@platform.test`;
    const created = await prisma.user.create({
      data: { email, name: 'Platform Root', password: await bcrypt.hash('Plat_Root_2026', 10), role: 'SUPER_ADMIN', isActive: true },
      select: { id: true },
    });
    superUserId = created.id;
    const login = await request(app).post('/api/auth/login').send({ email, password: 'Plat_Root_2026' });
    expect(login.status).toBe(200);
    superToken = login.body.data.token;
  }, 60_000);

  afterAll(async () => {
    try {
      if (superUserId) await prisma.user.delete({ where: { id: superUserId } }).catch(() => undefined);
      if (tenantOrg) {
        const userIds = (await prisma.user.findMany({ where: { employee: { organizationId: tenantOrg } }, select: { id: true } })).map((u) => u.id);
        await prisma.$executeRawUnsafe(`SET session_replication_role = 'replica'`).catch(() => undefined);
        await prisma.employee.deleteMany({ where: { organizationId: tenantOrg } }).catch(() => undefined);
        if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
        await prisma.organization.delete({ where: { id: tenantOrg } }).catch(() => undefined);
        await prisma.$executeRawUnsafe(`SET session_replication_role = 'origin'`).catch(() => undefined);
      }
    } catch (error) {
      console.warn('[platform.integration] teardown skipped:', (error as Error).message);
    }
    await prisma.$disconnect();
  });

  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('rejects anonymous callers with 401', async () => {
    for (const path of PROTECTED_GETS) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(401);
    }
  });

  it('refuses a store OWNER 403 on every cross-tenant endpoint', async () => {
    for (const path of PROTECTED_GETS) {
      const res = await request(app).get(path).set(bearer(ownerToken));
      expect(res.status, path).toBe(403);
    }
    // And a write path too.
    const write = await request(app).post('/api/platform/organizations/x/suspend').set(bearer(ownerToken));
    expect(write.status).toBe(403);
  });

  it('grants a SUPER_ADMIN 200 on every endpoint', async () => {
    for (const path of PROTECTED_GETS) {
      const res = await request(app).get(path).set(bearer(superToken));
      expect(res.status, path).toBe(200);
      expect(res.body.success, path).toBe(true);
    }
  });
});
