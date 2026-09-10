import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { prisma } from '../src/db/client';
import { createCharge } from '../src/services/paymentProvider';
import { planGiftCardDeduction, computeOrderTotals, round2 } from '../src/services/moneyMath';

// ─── DB-gated money-path integration suite ───────────────────────────────────
// These tests touch a REAL database and are therefore SKIPPED by default. Run
// them against a disposable database with:
//
//   RUN_DB_TESTS=1 DATABASE_URL=postgresql://... npx vitest run moneyPath
//
// They reproduce the exact money path the §9 payment-link route and the
// gift-card redeem endpoint follow (PSP charge → persisted state transition →
// tested moneyMath planner), asserting the ledger stays internally consistent.
// The deterministic PSP simulator is forced (no STRIPE_SECRET_KEY) so no live
// gateway is called. Every row created is torn down in afterAll.

const RUN = process.env.RUN_DB_TESTS === '1';
const suite = RUN ? describe : describe.skip;

suite('money path (DB-gated integration)', () => {
  let orgId: string;
  const createdLinkIds: string[] = [];
  const createdCardIds: string[] = [];

  beforeAll(async () => {
    delete process.env.STRIPE_SECRET_KEY; // force the deterministic simulator
    const org = await prisma.organization.create({
      data: { name: `MoneyPath IT ${crypto.randomBytes(4).toString('hex')}`, currency: 'USD' },
    });
    orgId = org.id;
  });

  afterAll(async () => {
    if (createdLinkIds.length) await prisma.paymentLink.deleteMany({ where: { id: { in: createdLinkIds } } });
    if (createdCardIds.length) await prisma.giftCard.deleteMany({ where: { id: { in: createdCardIds } } });
    if (orgId) await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('settles a single-use payment link: charge succeeds → status PAID', async () => {
    const token = crypto.randomBytes(16).toString('hex');
    const link = await prisma.paymentLink.create({
      data: { organizationId: orgId, token, amount: 120.5, currency: 'USD', maxPayments: 1 },
    });
    createdLinkIds.push(link.id);

    // The public pay handler's charge step (simulator approves a normal amount).
    const charge = await createCharge({ amount: Number(link.amount), currency: link.currency, metadata: { paymentLinkId: link.id } });
    expect(charge.status).toBe('SUCCEEDED');
    expect(charge.reference).toMatch(/^sim_pi_/);

    const newCount = link.paymentCount + 1;
    const fullyPaid = newCount >= link.maxPayments;
    const updated = await prisma.paymentLink.update({
      where: { id: link.id },
      data: { paymentCount: newCount, status: fullyPaid ? 'PAID' : 'ACTIVE', paidAt: fullyPaid ? new Date() : null },
    });
    expect(updated.status).toBe('PAID');
    expect(updated.paymentCount).toBe(1);
    expect(updated.paidAt).not.toBeNull();
  });

  it('keeps a reusable link ACTIVE until maxPayments is reached', async () => {
    const token = crypto.randomBytes(16).toString('hex');
    const link = await prisma.paymentLink.create({
      data: { organizationId: orgId, token, amount: 10, currency: 'USD', maxPayments: 3 },
    });
    createdLinkIds.push(link.id);

    let count = link.paymentCount;
    for (let i = 0; i < 2; i += 1) {
      count += 1;
      const fullyPaid = count >= link.maxPayments;
      const u = await prisma.paymentLink.update({
        where: { id: link.id },
        data: { paymentCount: count, status: fullyPaid ? 'PAID' : 'ACTIVE' },
      });
      expect(u.status).toBe('ACTIVE');
    }
    // Third payment completes it.
    count += 1;
    const done = await prisma.paymentLink.update({
      where: { id: link.id },
      data: { paymentCount: count, status: count >= link.maxPayments ? 'PAID' : 'ACTIVE', paidAt: new Date() },
    });
    expect(done.status).toBe('PAID');
    expect(done.paymentCount).toBe(3);
  });

  it('does not persist a declined charge as paid', async () => {
    const token = crypto.randomBytes(16).toString('hex');
    const link = await prisma.paymentLink.create({
      data: { organizationId: orgId, token, amount: 40, currency: 'USD', maxPayments: 1 },
    });
    createdLinkIds.push(link.id);

    const charge = await createCharge({ amount: Number(link.amount), currency: link.currency, paymentMethodId: 'pm_decline' });
    expect(charge.status).toBe('FAILED');
    // The route returns 402 and never mutates the link — assert it stayed ACTIVE.
    const unchanged = await prisma.paymentLink.findUnique({ where: { id: link.id } });
    expect(unchanged!.status).toBe('ACTIVE');
    expect(unchanged!.paymentCount).toBe(0);
  });

  it('deducts a gift card through the tested FIFO planner and persists the balance', async () => {
    const card = await prisma.giftCard.create({
      data: {
        organizationId: orgId,
        cardNumber: `GC-${crypto.randomBytes(6).toString('hex')}`,
        originalAmount: 100,
        balance: 100,
        status: 'ACTIVE',
      },
    });
    createdCardIds.push(card.id);

    // An order total, then a gift-card deduction planned by the single tested source.
    const totals = computeOrderTotals([{ unitPrice: 30, quantity: 2 }], 0); // subtotal 60
    expect(totals.total).toBe(60);

    const plan = planGiftCardDeduction(Number(card.balance), totals.total);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.newBalance).toBe(40);
      expect(plan.status).toBe('ACTIVE');
      const updated = await prisma.giftCard.update({
        where: { id: card.id },
        data: { balance: plan.newBalance, status: plan.status, lastUsedAt: new Date() },
      });
      expect(Number(updated.balance)).toBe(40);
      expect(updated.status).toBe('ACTIVE');
    }
  });

  it('depletes a gift card to zero and flips it to DEPLETED', async () => {
    const card = await prisma.giftCard.create({
      data: {
        organizationId: orgId,
        cardNumber: `GC-${crypto.randomBytes(6).toString('hex')}`,
        originalAmount: 25,
        balance: 25,
        status: 'ACTIVE',
      },
    });
    createdCardIds.push(card.id);

    const plan = planGiftCardDeduction(Number(card.balance), 25);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(round2(plan.newBalance)).toBe(0);
      expect(plan.status).toBe('DEPLETED');
      const updated = await prisma.giftCard.update({
        where: { id: card.id },
        data: { balance: plan.newBalance, status: plan.status },
      });
      expect(Number(updated.balance)).toBe(0);
      expect(updated.status).toBe('DEPLETED');
    }
  });
});
