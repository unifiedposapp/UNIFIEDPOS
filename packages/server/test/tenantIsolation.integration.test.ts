import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { app } from '../src/index';
import { prisma } from '../src/db/client';

// ─── Tenant-isolation HTTP integration suite (DB-gated) ─────────────────────
// The multi-tenant promise: two businesses on the same deployment must never
// see each other's rows — not through list endpoints, and (the classic hole)
// not through a by-id route that forgets to scope the lookup. This suite drives
// the REAL express app over HTTP (supertest, no network listener) with tokens
// from real /auth/register calls, then proves organization A cannot read every
// category of organization B's data.
//
// Skipped by default; run against a disposable database with:
//   RUN_DB_TESTS=1 DATABASE_URL=postgresql://... npx vitest run tenantIsolation

const RUN = process.env.RUN_DB_TESTS === '1';
const suite = RUN ? describe : describe.skip;

const rand = () => crypto.randomBytes(6).toString('hex');

suite('tenant isolation over HTTP (DB-gated integration)', () => {
  let tokenA: string;
  let tokenB: string;
  let orgA: string;
  let orgB: string;
  let locationB: string;

  // Organization B's resources, seeded directly; A must never see any of them.
  const secret: Record<string, string> = {};

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    // Two self-registered tenants (real auth path, real JWTs).
    const register = async (label: string) =>
      request(app)
        .post('/api/auth/register')
        .send({
          name: `Iso ${label}`,
          email: `iso-${label}-${rand()}@isolation.test`,
          password: 'Iso_Test_2026',
          organizationName: `Iso Corp ${label} ${rand()}`,
          country: 'United States',
          countryCode: 'US',
          currency: 'USD',
        });

    const resA = await register('A');
    const resB = await register('B');
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    tokenA = resA.body.data.token;
    tokenB = resB.body.data.token;
    orgA = resA.body.data.organization.id;
    orgB = resB.body.data.organization.id;
    locationB = (await prisma.location.findFirst({ where: { organizationId: orgB } }))!.id;

    // Seed one resource of every category under test into B, straight through
    // Prisma — the routes under test must not be the thing that leaks them.
    const orderB = await prisma.order.create({
      data: { orderNumber: `ISO-B-${rand()}`, organizationId: orgB, locationId: locationB, status: 'COMPLETED', totalAmount: 42.42 },
    });
    secret.order = orderB.id;

    const paymentB = await prisma.payment.create({
      data: { orderId: orderB.id, method: 'CASH', amount: 42.42 },
    });
    secret.payment = paymentB.id;

    const customerB = await prisma.customer.create({
      data: { organizationId: orgB, name: 'B Secret Customer', email: `b-${rand()}@isolation.test` },
    });
    secret.customer = customerB.id;

    const fiscalB = await prisma.fiscalDocument.create({
      data: { organizationId: orgB, profileCode: 'US-DEFAULT', receiptNumber: `ISO-B-${rand()}`, total: 42.42, payloadHash: rand() },
    });
    secret.fiscal = fiscalB.id;

    const agreementB = await prisma.franchiseAgreement.create({
      data: { organizationId: orgB, entityCode: `B-ENT-${rand()}`, franchiseeName: 'B Franchisee', startDate: new Date() },
    });
    secret.franchise = agreementB.id;

    const fenceB = await prisma.meshFence.create({
      data: { organizationId: orgB, locationId: locationB, leaderDeviceId: 'iso-b-device' },
    });
    secret.fence = fenceB.id;
    secret.locationB = locationB;

    const installB = await prisma.appInstallation.create({
      data: { organizationId: orgB, appCode: 'iso-app', appName: 'Isolation App', scopes: [] },
    });
    secret.install = installB.id;

    const fieldB = await prisma.customFieldDefinition.create({
      data: { organizationId: orgB, entity: 'ORDER', fieldKey: `iso_${rand()}`, label: 'B Custom Field' },
    });
    secret.field = fieldB.id;

    const mandateB = await prisma.agentMandate.create({
      data: {
        organizationId: orgB,
        agentId: `iso-agent-${rand()}`,
        nonce: rand(),
        items: [],
        ceilingAmount: 100,
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
        signature: rand(),
      },
    });
    secret.mandate = mandateB.id;

    const batchB = await prisma.settlementBatch.create({
      data: { organizationId: orgB, railCode: 'ACH', batchDate: new Date(), grossAmount: 100 },
    });
    secret.settlement = batchB.id;

    const snapshotB = await prisma.benchmarkSnapshot.create({
      data: { organizationId: orgB, metricKey: 'avg_basket', periodStart: new Date('2026-09-01'), periodEnd: new Date('2026-09-21'), cohortSize: 9 },
    });
    secret.benchmark = snapshotB.id;
  }, 60_000);

  afterAll(async () => {
    // Tear the two tenants down the same way the operator cleanup script does:
    // discover every table keyed by organizationId/userId and clear our rows.
    try {
      const ids = [orgA, orgB].filter(Boolean);
      const userIds = (await prisma.user.findMany({ where: { email: { endsWith: '@isolation.test' } }, select: { id: true } })).map((u) => u.id);
      if (ids.length || userIds.length) {
        await prisma.$executeRawUnsafe(`SET session_replication_role = 'replica'`);
        const cols = await prisma.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
          `SELECT table_name, column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name IN ('organizationId','userId')`,
        );
        for (const { table_name, column_name } of cols) {
          const idsFor = column_name === 'organizationId' ? ids : userIds;
          if (!idsFor.length) continue;
          await prisma.$executeRawUnsafe(`DELETE FROM "${table_name}" WHERE "${column_name}" IN ('${idsFor.join("','")}')`).catch(() => undefined);
        }
        if (userIds.length) await prisma.$executeRawUnsafe(`DELETE FROM users WHERE id IN ('${userIds.join("','")}')`).catch(() => undefined);
        if (ids.length) await prisma.$executeRawUnsafe(`DELETE FROM organizations WHERE id IN ('${ids.join("','")}')`).catch(() => undefined);
        await prisma.$executeRawUnsafe(`SET session_replication_role = 'origin'`).catch(() => undefined);
      }
    } catch (error) {
      console.warn('[tenantIsolation] teardown skipped:', (error as Error).message);
    }
    await prisma.$disconnect();
  });

  /** A list endpoint must answer 200 for A and never contain B's row id. */
  const listHides = async (path: string, secretId: string, label: string) => {
    const res = await request(app).get(path).set(bearer(tokenA));
    expect(res.status, label).toBe(200);
    expect(JSON.stringify(res.body), `${label}: A must not see B's row`).not.toContain(secretId);
  };

  /** A by-id route must refuse B's row to A outright (404, not a bare 200). */
  const byIdRefuses = async (path: string, label: string) => {
    const res = await request(app).get(path).set(bearer(tokenA));
    expect([404, 403], `${label}: A got ${res.status} for B's row`).toContain(res.status);
  };

  it('orders: A cannot list or fetch B order', async () => {
    await listHides('/api/orders?limit=100', secret.order, 'orders list');
    await byIdRefuses(`/api/orders/${secret.order}`, 'orders by id');
  });

  it('payments: A cannot fetch B payment by id', async () => {
    await byIdRefuses(`/api/payments/${secret.payment}`, 'payments by id');
  });

  it('customers: A cannot list or fetch B customer', async () => {
    await listHides('/api/customers?limit=100', secret.customer, 'customers list');
    await byIdRefuses(`/api/customers/${secret.customer}`, 'customers by id');
  });

  it('fiscal documents: A cannot list or fetch B receipt', async () => {
    await listHides('/api/fiscal/documents', secret.fiscal, 'fiscal list');
    await byIdRefuses(`/api/fiscal/documents/${secret.fiscal}`, 'fiscal by id');
  });

  it('franchise: A cannot see B agreement', async () => {
    await listHides('/api/franchise/agreements', secret.franchise, 'franchise agreements');
  });

  it('mesh: A cannot read B location fence', async () => {
    await byIdRefuses(`/api/mesh/locations/${secret.locationB}`, 'mesh location');
  });

  it('apps: A cannot see B installation or custom field', async () => {
    await listHides('/api/apps/installs', secret.install, 'app installs');
    await listHides('/api/apps/fields', secret.field, 'custom fields');
  });

  it('agents: A cannot see B mandate', async () => {
    await listHides('/api/agents/mandates', secret.mandate, 'agent mandates');
  });

  it('rails: A cannot list or fetch B settlement batch', async () => {
    await listHides('/api/rails/settlements', secret.settlement, 'settlements list');
    await byIdRefuses(`/api/rails/settlements/${secret.settlement}`, 'settlement by id');
  });

  it('benchmark: A cannot see B snapshot', async () => {
    await listHides('/api/benchmark/snapshots', secret.benchmark, 'benchmark snapshots');
  });

  it('positive control: B still sees its own rows with its own token', async () => {
    // Isolation must not be over-blocking: the owner reads everything fine.
    const order = await request(app).get(`/api/orders/${secret.order}`).set(bearer(tokenB));
    expect(order.status).toBe(200);
    const fiscal = await request(app).get('/api/fiscal/documents').set(bearer(tokenB));
    expect(JSON.stringify(fiscal.body)).toContain(secret.fiscal);
  });
});
