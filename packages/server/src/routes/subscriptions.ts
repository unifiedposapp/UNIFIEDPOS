// ─── RECURRING SUBSCRIPTION BILLING ────────────────────────────────────────
// Plans, customer subscriptions, invoices and the manual cycle trigger. All
// billing mechanics live in services/subscriptionBilling.ts; this route is
// auth scoping, validation and response shape only. Mounted at /api/subscriptions
// and /api/v1/subscriptions.

import { Router, Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { isValidCurrency, normalizeCurrency } from '../data/currencies.js';
import {
  BILLING_INTERVALS,
  runSubscriptionCycle,
  startSubscription,
  subscriptionOverview,
  attemptCollection,
} from '../services/subscriptionBilling.js';

const router = Router();

const shape = <T>(rows: T[]): T[] =>
  rows.map((r: any) => ({
    ...r,
    amount: r.amount != null ? Number(r.amount) : r.amount,
  }));

// ─── Plans ───────────────────────────────────────────────────────────────────

// GET /api/subscriptions/plans
router.get('/plans', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const where: Record<string, unknown> = { organizationId };
    if (req.query.active === 'true') where.active = true;
    if (req.query.active === 'false') where.active = false;
    const plans = await prisma.subscriptionPlan.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    res.json({ success: true, data: plans.map((p) => ({ ...p, amount: Number(p.amount) })) });
  } catch (error) {
    handleError(error, res);
  }
});

const planSchema = z.object({
  name: z.string().min(1).max(80),
  code: z.string().max(40).optional(),
  interval: z.enum(BILLING_INTERVALS as [string, ...string[]]).optional(),
  intervalCount: z.number().int().min(1).max(36).optional(),
  amount: z.number().min(0).max(1e9),
  currency: z.string().length(3).optional(),
  trialDays: z.number().int().min(0).max(365).optional(),
  features: z.array(z.string()).optional(),
  active: z.boolean().optional(),
});

// POST /api/subscriptions/plans
router.post('/plans', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(planSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof planSchema>;
    const currency = normalizeCurrency(body.currency || 'USD') || 'USD';
    if (!isValidCurrency(currency)) return res.status(400).json({ success: false, message: 'Unknown currency' });
    const clash = await prisma.subscriptionPlan.findFirst({ where: { organizationId, name: body.name } });
    if (clash) return res.status(409).json({ success: false, message: 'A plan with that name already exists' });
    const plan = await prisma.subscriptionPlan.create({
      data: {
        organizationId,
        name: body.name,
        code: body.code || '',
        interval: body.interval || 'MONTH',
        intervalCount: body.intervalCount || 1,
        amount: body.amount,
        currency,
        trialDays: body.trialDays || 0,
        features: body.features || [],
        active: body.active ?? true,
      },
    });
    await createAuditEvent({ organizationId, actorId: req.user!.employeeId, action: 'SUBSCRIPTION_PLAN_CREATED', resourceType: 'SUBSCRIPTION_PLAN', newValue: { id: plan.id, name: plan.name } });
    res.status(201).json({ success: true, data: { ...plan, amount: Number(plan.amount) } });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/subscriptions/plans/:id
const planUpdateSchema = planSchema.partial();
router.put('/plans/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(planUpdateSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const existing = await prisma.subscriptionPlan.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Plan not found' });
    const body = req.body as z.infer<typeof planUpdateSchema>;
    if (body.currency && !isValidCurrency(normalizeCurrency(body.currency) || '')) {
      return res.status(400).json({ success: false, message: 'Unknown currency' });
    }
    const updated = await prisma.subscriptionPlan.update({
      where: { id: existing.id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.code !== undefined ? { code: body.code } : {}),
        ...(body.interval ? { interval: body.interval } : {}),
        ...(body.intervalCount ? { intervalCount: body.intervalCount } : {}),
        ...(body.amount !== undefined ? { amount: body.amount } : {}),
        ...(body.currency ? { currency: normalizeCurrency(body.currency)! } : {}),
        ...(body.trialDays !== undefined ? { trialDays: body.trialDays } : {}),
        ...(body.features !== undefined ? { features: body.features } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
    });
    res.json({ success: true, data: { ...updated, amount: Number(updated.amount) } });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/subscriptions/plans/:id — deactivate; live subs keep their plan row
router.delete('/plans/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const existing = await prisma.subscriptionPlan.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Plan not found' });
    const liveSubs = await prisma.subscription.count({ where: { planId: existing.id, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } } });
    if (liveSubs > 0) {
      const updated = await prisma.subscriptionPlan.update({ where: { id: existing.id }, data: { active: false } });
      return res.json({ success: true, data: { ...updated, amount: Number(updated.amount) }, message: `Deactivated for new signups; ${liveSubs} live subscription(s) keep billing on it` });
    }
    await prisma.subscriptionPlan.delete({ where: { id: existing.id } });
    res.json({ success: true, data: { id: existing.id, deleted: true } });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Subscriptions ───────────────────────────────────────────────────────────

// GET /api/subscriptions?status=&customerId=
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const where: Record<string, unknown> = { organizationId };
    if (req.query.status) where.status = String(req.query.status).toUpperCase();
    if (req.query.customerId) where.customerId = String(req.query.customerId);
    const subs = await prisma.subscription.findMany({ where, orderBy: { createdAt: 'desc' }, take: Math.min(500, Number(req.query.limit) || 100) });
    const planIds = [...new Set(subs.map((s) => s.planId))];
    const plans = await prisma.subscriptionPlan.findMany({ where: { id: { in: planIds } } });
    const byId = new Map(plans.map((p) => [p.id, { id: p.id, name: p.name, interval: p.interval, intervalCount: p.intervalCount, amount: Number(p.amount), currency: p.currency }]));
    const customerIds = [...new Set(subs.map((s) => s.customerId))];
    const customers = await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true, email: true } });
    const custById = new Map(customers.map((c) => [c.id, c]));
    res.json({
      success: true,
      data: subs.map((s) => ({ ...s, plan: byId.get(s.planId) || null, customer: custById.get(s.customerId) || null })),
    });
  } catch (error) {
    handleError(error, res);
  }
});

const createSchema = z.object({
  customerId: z.string().min(1),
  planId: z.string().min(1),
  externalId: z.string().max(120).optional(),
  trialDaysOverride: z.number().int().min(0).max(365).optional(),
});

// POST /api/subscriptions
router.post('/', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(createSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof createSchema>;
    const sub = await startSubscription(organizationId, body.customerId, body.planId, {
      externalId: body.externalId,
      trialDaysOverride: body.trialDaysOverride,
    });
    await createAuditEvent({ organizationId, actorId: req.user!.employeeId, action: 'SUBSCRIPTION_STARTED', resourceType: 'SUBSCRIPTION', newValue: sub });
    res.status(201).json({ success: true, data: sub });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/subscriptions/overview — dashboard rollup (before '/:id' on purpose)
router.get('/overview', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const data = await subscriptionOverview(req.user!.organizationId!);
    res.json({ success: true, data });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/subscriptions/generate-invoices — run the billing cycle now
router.post('/generate-invoices', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    // The cycle is global by design (the scheduler runs it cross-tenant); a
    // manual tenant run filters its own rows by re-checking each touched
    // subscription's owner afterwards — so expose the whole-tick result.
    const result = await runSubscriptionCycle(req.body?.now ? new Date(String(req.body.now)) : new Date());
    await createAuditEvent({ organizationId, actorId: req.user!.employeeId, action: 'SUBSCRIPTION_CYCLE_RUN', resourceType: 'SUBSCRIPTION', newValue: result });
    res.json({ success: true, data: result });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/subscriptions/:id
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const sub = await prisma.subscription.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found' });
    const [plan, invoices] = await Promise.all([
      prisma.subscriptionPlan.findUnique({ where: { id: sub.planId } }),
      prisma.subscriptionInvoice.findMany({ where: { subscriptionId: sub.id }, orderBy: { periodStart: 'desc' }, take: 120 }),
    ]);
    res.json({
      success: true,
      data: {
        ...sub,
        plan: plan ? { ...plan, amount: Number(plan.amount) } : null,
        invoices: shape(invoices),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/subscriptions/:id/invoices
router.get('/:id/invoices', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const sub = await prisma.subscription.findFirst({ where: { id: String(req.params.id), organizationId }, select: { id: true } });
    if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found' });
    const invoices = await prisma.subscriptionInvoice.findMany({ where: { subscriptionId: sub.id }, orderBy: { periodStart: 'desc' }, take: 240 });
    res.json({ success: true, data: shape(invoices) });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/subscriptions/:id/cancel  { atPeriodEnd?: boolean }
router.post('/:id/cancel', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const sub = await prisma.subscription.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found' });
    const atPeriodEnd = Boolean(req.body?.atPeriodEnd);
    const now = new Date();
    const updated = atPeriodEnd
      ? await prisma.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true, cancelAt: sub.currentPeriodEnd } })
      : await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED', canceledAt: now, cancelAtPeriodEnd: false } });
    if (!atPeriodEnd) {
      // Immediate cancel: open (unpaid) invoices stop being chased.
      await prisma.subscriptionInvoice.updateMany({ where: { subscriptionId: sub.id, status: { in: ['OPEN', 'DUNNING'] } }, data: { status: 'VOID' } });
    }
    await createAuditEvent({ organizationId, actorId: req.user!.employeeId, action: 'SUBSCRIPTION_CANCELLED', resourceType: 'SUBSCRIPTION', newValue: { id: sub.id, atPeriodEnd } });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/subscriptions/:id/reinstate
router.post('/:id/reinstate', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const sub = await prisma.subscription.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found' });
    if (sub.status === 'EXPIRED') return res.status(422).json({ success: false, message: 'Expired subscriptions cannot be reinstated — start a new one' });
    const updated = await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'ACTIVE', canceledAt: null, cancelAt: null, cancelAtPeriodEnd: false },
    });
    await createAuditEvent({ organizationId, actorId: req.user!.employeeId, action: 'SUBSCRIPTION_REINSTATED', resourceType: 'SUBSCRIPTION', newValue: { id: sub.id } });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/subscriptions/:id/collect — one manual collection attempt
router.post('/:id/collect', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const invoice = await prisma.subscriptionInvoice.findFirst({
      where: { id: String(req.params.id), organizationId, status: { in: ['OPEN', 'UNPAID', 'DUNNING'] } },
      select: { id: true },
    });
    if (!invoice) return res.status(404).json({ success: false, message: 'Collectible invoice not found' });
    const outcome = await attemptCollection(invoice.id);
    res.json({ success: outcome.paid, data: outcome, ...(outcome.paid ? {} : { message: outcome.message }) });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/subscriptions/webhook — PSP payment result for a subscription
// invoice. Guarded by SUBSCRIPTION_WEBHOOK_SECRET (constant-time compare),
// not by the session auth middleware: machine callers have no JWT.
router.post('/webhook', async (req, res: Response) => {
  try {
    const secret = process.env.SUBSCRIPTION_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ success: false, message: 'Webhook not configured (set SUBSCRIPTION_WEBHOOK_SECRET)' });
    const provided = String(req.headers['x-webhook-secret'] || '');
    // Constant-time compare over equal-length digests (raw comparison would
    // leak length and prefix timing).
    const hash = (v: string) => crypto.createHash('sha256').update(v).digest();
    if (!provided || !crypto.timingSafeEqual(hash(provided), hash(secret))) {
      return res.status(401).json({ success: false, message: 'Invalid webhook secret' });
    }
    const body = req.body as { invoiceId?: string; subscriptionId?: string; event?: string };
    if (!body.invoiceId || !['payment_succeeded', 'payment_failed'].includes(String(body.event))) {
      return res.status(400).json({ success: false, message: 'Expected { invoiceId, event: payment_succeeded|payment_failed }' });
    }
    if (body.event === 'payment_succeeded') {
      const invoice = await prisma.subscriptionInvoice.findFirst({
        where: { id: body.invoiceId, status: { in: ['OPEN', 'UNPAID', 'DUNNING'] }, ...(body.subscriptionId ? { subscriptionId: body.subscriptionId } : {}) },
      });
      if (!invoice) return res.status(404).json({ success: false, message: 'Open invoice not found' });
      await prisma.subscriptionInvoice.update({ where: { id: invoice.id }, data: { status: 'PAID', paidAt: new Date() } });
      await prisma.subscription.update({ where: { id: invoice.subscriptionId }, data: { status: 'ACTIVE' } });
      return res.json({ success: true, data: { invoiceId: invoice.id, status: 'PAID' } });
    }
    const outcome = await attemptCollection(body.invoiceId); // walks the dunning ladder
    return res.json({ success: true, data: outcome });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
