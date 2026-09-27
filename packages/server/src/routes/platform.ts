// ─── PLATFORM ADMIN CONSOLE ──────────────────────────────────────────────────
// The SaaS-operator surface: monitor every tenant and user across all
// organizations, manage the platform plans tenants buy, record tenant
// payments, and drive the account lifecycle (suspend / restore / cancel /
// archive / purge). Every route here is cross-tenant and therefore guarded by
// requireSuperAdmin — regular store users never reach it. Mounted at
// /api/platform and /api/v1/platform.

import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireSuperAdmin } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { normalizeCurrency } from '../data/currencies.js';
import {
  computeAccountStatus,
  normalizeMonthly,
  type AccountStatus,
} from '../services/platformBilling.js';

const router = Router();

// The whole console is platform-operator only.
router.use(authMiddleware, requireSuperAdmin);

// Lifecycle actions we surface in the History feed.
const LIFECYCLE_ACTIONS = [
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_RESTORED',
  'ACCOUNT_CANCELLED',
  'ACCOUNT_ARCHIVED',
  'ACCOUNT_REINSTATED',
  'ACCOUNT_PURGED',
  'ACCOUNT_PAYMENT_RECORDED',
  'ACCOUNT_PLAN_ASSIGNED',
  'USER_DEACTIVATED',
  'USER_REACTIVATED',
  'USER_CREATED',
];

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);

/** Decimal-safe row mapper for the numeric platform fields. */
const num = (v: unknown): number => (v == null ? 0 : Number(v));

// ─── Overview ────────────────────────────────────────────────────────────────

// GET /api/platform/overview — headline platform metrics.
router.get('/overview', async (_req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const [orgs, userCount, revenueAgg, planCount] = await Promise.all([
      prisma.organization.findMany({
        select: {
          status: true,
          isActive: true,
          trialEnd: true,
          currentPeriodEnd: true,
          platformPlan: { select: { priceMonthly: true, interval: true } },
        },
      }),
      prisma.user.count(),
      prisma.platformPayment.aggregate({ _sum: { amount: true } }),
      prisma.platformPlan.count({ where: { active: true } }),
    ]);

    const byStatus: Record<AccountStatus, number> = {
      ACTIVE: 0, TRIALING: 0, PAST_DUE: 0, SUSPENDED: 0, CANCELLED: 0, ARCHIVED: 0,
    };
    let mrr = 0;
    for (const o of orgs) {
      const st = computeAccountStatus(o, now);
      byStatus[st] += 1;
      // MRR counts paying tenants only (active), not trials/archived/cancelled.
      if (st === 'ACTIVE' && o.platformPlan) {
        mrr += normalizeMonthly(Number(o.platformPlan.priceMonthly), o.platformPlan.interval);
      }
    }

    res.json({
      success: true,
      data: {
        tenants: orgs.length,
        users: userCount,
        activePlans: planCount,
        byStatus,
        mrr: Number(mrr.toFixed(2)),
        lifetimeRevenue: num(revenueAgg._sum.amount),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Organizations (tenant accounts) ─────────────────────────────────────────

// GET /api/platform/organizations?status=&q= — every tenant with derived state.
router.get('/organizations', async (req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const q = String(req.query.q || '').trim().toLowerCase();
    const statusFilter = String(req.query.status || '').trim().toUpperCase();

    const orgs = await prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true,
        name: true,
        email: true,
        country: true,
        currency: true,
        industry: true,
        status: true,
        isActive: true,
        trialEnd: true,
        currentPeriodEnd: true,
        createdAt: true,
        platformPlan: { select: { id: true, name: true, priceMonthly: true, interval: true } },
        employees: {
          where: { user: { role: 'OWNER' } },
          take: 1,
          select: { user: { select: { name: true, email: true } } },
        },
        _count: { select: { employees: true } },
      },
    });

    let rows = orgs.map((o) => ({
      id: o.id,
      name: o.name,
      email: o.email,
      country: o.country,
      currency: o.currency,
      industry: o.industry,
      status: computeAccountStatus(o, now),
      storedStatus: o.status,
      isActive: o.isActive,
      trialEnd: o.trialEnd,
      currentPeriodEnd: o.currentPeriodEnd,
      createdAt: o.createdAt,
      users: o._count.employees,
      owner: o.employees[0]?.user ?? null,
      plan: o.platformPlan
        ? {
            id: o.platformPlan.id,
            name: o.platformPlan.name,
            priceMonthly: num(o.platformPlan.priceMonthly),
            interval: o.platformPlan.interval,
          }
        : null,
    }));

    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || (r.email || '').toLowerCase().includes(q));

    res.json({ success: true, data: rows });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/platform/organizations/:id/plan — assign (or clear) a tenant's plan
// and start its trial / coverage window.
const assignPlanSchema = z.object({
  platformPlanId: z.string().nullable().optional(),
  startTrial: z.boolean().optional(),
});
router.post('/organizations/:id/plan', validateRequest(assignPlanSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = String(req.params.id);
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) {
      res.status(404).json({ success: false, error: 'Organization not found' });
      return;
    }
    const { platformPlanId, startTrial } = req.body;

    const plan = platformPlanId ? await prisma.platformPlan.findUnique({ where: { id: platformPlanId } }) : null;
    const now = new Date();
    const data: Record<string, unknown> = { platformPlanId: platformPlanId ?? null };
    if (plan && startTrial && plan.trialDays > 0) {
      data.trialEnd = addDays(now, plan.trialDays);
      data.currentPeriodEnd = null;
      data.status = 'TRIALING';
    } else if (plan) {
      const months = plan.interval === 'YEAR' ? 12 : 1;
      data.currentPeriodEnd = addDays(now, months * 30);
      data.trialEnd = null;
      data.status = 'ACTIVE';
    }
    data.isActive = true;

    const updated = await prisma.organization.update({ where: { id: organizationId }, data });
    await createAuditEvent({
      organizationId,
      action: 'ACCOUNT_PLAN_ASSIGNED',
      resourceType: 'ORGANIZATION',
      resourceId: organizationId,
      newValue: { platformPlanId: platformPlanId ?? null, status: data.status },
      metadata: { by: req.user!.email },
    });
    res.json({ success: true, data: { ...updated, status: computeAccountStatus(updated) } });
  } catch (error) {
    handleError(error, res);
  }
});

// Lifecycle transitions. Each sets the operator-owned status + timestamp and
// writes an audit event under that tenant.
async function transition(
  req: AuthRequest,
  res: Response,
  patch: Record<string, unknown>,
  action: string,
): Promise<void> {
  const organizationId = String(req.params.id);
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) {
    res.status(404).json({ success: false, error: 'Organization not found' });
    return;
  }
  const updated = await prisma.organization.update({ where: { id: organizationId }, data: patch });
  await createAuditEvent({
    organizationId,
    action,
    resourceType: 'ORGANIZATION',
    resourceId: organizationId,
    previousValue: { status: org.status, isActive: org.isActive },
    newValue: { status: patch.status, isActive: patch.isActive },
    metadata: { by: req.user!.email },
  });
  res.json({ success: true, data: { ...updated, status: computeAccountStatus(updated) } });
}

// POST /api/platform/organizations/:id/suspend
router.post('/organizations/:id/suspend', (req, res) =>
  transition(req, res, { status: 'SUSPENDED', isActive: false, suspendedAt: new Date() }, 'ACCOUNT_SUSPENDED'));

// POST /api/platform/organizations/:id/restore — back to active, coverage intact.
router.post('/organizations/:id/restore', (req, res) =>
  transition(req, res, { status: 'ACTIVE', isActive: true, suspendedAt: null, canceledAt: null }, 'ACCOUNT_RESTORED'));

// POST /api/platform/organizations/:id/cancel — stops billing, keeps data.
router.post('/organizations/:id/cancel', (req, res) =>
  transition(req, res, { status: 'CANCELLED', isActive: false, canceledAt: new Date() }, 'ACCOUNT_CANCELLED'));

// POST /api/platform/organizations/:id/archive — recoverable soft-delete.
router.post('/organizations/:id/archive', (req, res) =>
  transition(req, res, { status: 'ARCHIVED', isActive: false, archivedAt: new Date() }, 'ACCOUNT_ARCHIVED'));

// POST /api/platform/organizations/:id/reinstate — recover an archived/cancelled tenant.
router.post('/organizations/:id/reinstate', (req, res) =>
  transition(req, res, { status: 'ACTIVE', isActive: true, canceledAt: null, archivedAt: null }, 'ACCOUNT_REINSTATED'));

// POST /api/platform/organizations/:id/purge — PERMANENT, irreversible.
// Requires the exact organization name as `confirm`. Cascades away all of the
// tenant's business data (orders, payments, audit) and cannot be undone.
const purgeSchema = z.object({ confirm: z.string().min(1) });
router.post('/organizations/:id/purge', validateRequest(purgeSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = String(req.params.id);
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) {
      res.status(404).json({ success: false, error: 'Organization not found' });
      return;
    }
    if (req.body.confirm !== org.name) {
      res.status(400).json({ success: false, error: 'Confirmation text does not match the organization name' });
      return;
    }
    // Purging deletes the tenant's audit rows too, so the deletion record is
    // emitted to the server log rather than the (about-to-vanish) database.
    console.warn(`[platform] ${req.user!.email} permanently purged organization ${org.id} (${org.name})`);
    await prisma.organization.delete({ where: { id: organizationId } });
    res.json({ success: true, data: { id: organizationId, purged: true } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/platform/organizations/:id/payments — record a tenant payment.
// Extends the paid-through date and restores the tenant to ACTIVE.
const paymentSchema = z.object({
  amount: z.number().min(0),
  months: z.number().int().min(1).max(120).default(1),
  method: z.string().max(24).optional(),
  reference: z.string().max(120).optional(),
  currency: z.string().length(3).optional(),
});
router.post('/organizations/:id/payments', validateRequest(paymentSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = String(req.params.id);
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) {
      res.status(404).json({ success: false, error: 'Organization not found' });
      return;
    }
    const { amount, months, method, reference, currency } = req.body;
    const now = new Date();
    // Extend from whichever is later: existing paid-through date or today.
    const base = org.currentPeriodEnd && org.currentPeriodEnd > now ? org.currentPeriodEnd : now;
    const periodCoveredUntil = addDays(base, months * 30);

    const payment = await prisma.platformPayment.create({
      data: {
        organizationId,
        amount,
        currency: normalizeCurrency(currency || 'USD') || 'USD',
        method: method || 'OTHER',
        reference: reference || null,
        periodCoveredUntil,
        recordedById: req.user!.id,
      },
    });
    const updated = await prisma.organization.update({
      where: { id: organizationId },
      data: { currentPeriodEnd: periodCoveredUntil, trialEnd: null, status: 'ACTIVE', isActive: true, suspendedAt: null },
    });
    await createAuditEvent({
      organizationId,
      action: 'ACCOUNT_PAYMENT_RECORDED',
      resourceType: 'ORGANIZATION',
      resourceId: organizationId,
      newValue: { amount, months, periodCoveredUntil },
      metadata: { by: req.user!.email },
    });
    res.status(201).json({ success: true, data: { payment, organization: updated } });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Users (cross-tenant) ────────────────────────────────────────────────────

// GET /api/platform/users — every user across all organizations.
router.get('/users', async (_req: AuthRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        mfaEnabled: true,
        createdAt: true,
        employee: { select: { organization: { select: { id: true, name: true } } } },
      },
    });
    res.json({
      success: true,
      data: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        isActive: u.isActive,
        mfaEnabled: u.mfaEnabled,
        createdAt: u.createdAt,
        organization: u.employee?.organization ?? null,
      })),
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/platform/users — create a user into a chosen organization.
const platformUserSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['OWNER', 'ADMIN', 'MANAGER', 'CASHIER']),
  organizationId: z.string().min(1, 'Organization is required'),
});
router.post('/users', validateRequest(platformUserSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { name, email, password, role, organizationId } = req.body;
    const [existing, org] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      prisma.organization.findUnique({ where: { id: organizationId } }),
    ]);
    if (existing) {
      res.status(409).json({ success: false, error: 'Email already in use' });
      return;
    }
    if (!org) {
      res.status(404).json({ success: false, error: 'Organization not found' });
      return;
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { name, email, password: hashedPassword, role, isActive: true },
        select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
      });
      await tx.employee.create({ data: { organizationId, userId: created.id, position: role } });
      return created;
    });
    await createAuditEvent({
      organizationId,
      action: 'USER_CREATED',
      resourceType: 'USER',
      resourceId: user.id,
      newValue: { email, role },
      metadata: { by: req.user!.email },
    });
    res.status(201).json({ success: true, data: user });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/platform/users/:id/deactivate | /reactivate — toggle a user account.
async function setUserActive(req: AuthRequest, res: Response, isActive: boolean, action: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: String(req.params.id) },
      select: { id: true, email: true, isActive: true, employee: { select: { organizationId: true } } },
    });
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { isActive },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    if (user.employee?.organizationId) {
      await createAuditEvent({
        organizationId: user.employee.organizationId,
        action,
        resourceType: 'USER',
        resourceId: user.id,
        previousValue: { isActive: user.isActive },
        newValue: { isActive },
        metadata: { by: req.user!.email },
      });
    }
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
}
router.post('/users/:id/deactivate', (req, res) => setUserActive(req, res, false, 'USER_DEACTIVATED'));
router.post('/users/:id/reactivate', (req, res) => setUserActive(req, res, true, 'USER_REACTIVATED'));

// ─── Platform plans (SaaS tiers) ─────────────────────────────────────────────

// GET /api/platform/plans
router.get('/plans', async (_req: AuthRequest, res: Response) => {
  try {
    const plans = await prisma.platformPlan.findMany({ orderBy: { priceMonthly: 'asc' } });
    res.json({ success: true, data: plans.map((p) => ({ ...p, priceMonthly: num(p.priceMonthly) })) });
  } catch (error) {
    handleError(error, res);
  }
});

const planSchema = z.object({
  name: z.string().min(1).max(80),
  code: z.string().max(40).optional(),
  priceMonthly: z.number().min(0),
  interval: z.enum(['MONTH', 'YEAR']).optional(),
  trialDays: z.number().int().min(0).max(365).optional(),
  features: z.array(z.string()).optional(),
  active: z.boolean().optional(),
});

// POST /api/platform/plans
router.post('/plans', validateRequest(planSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { name, code, priceMonthly, interval, trialDays, features, active } = req.body;
    const slug = (code || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const plan = await prisma.platformPlan.create({
      data: {
        name,
        code: slug,
        priceMonthly,
        interval: interval || 'MONTH',
        trialDays: trialDays ?? 0,
        features: features ? JSON.stringify(features) : undefined,
        active: active ?? true,
      },
    });
    res.status(201).json({ success: true, data: { ...plan, priceMonthly: num(plan.priceMonthly) } });
  } catch (error) {
    handleError(error, res);
  }
});

// PATCH /api/platform/plans/:id
const planPatchSchema = planSchema.partial();
router.patch('/plans/:id', validateRequest(planPatchSchema), async (req: AuthRequest, res: Response) => {
  try {
    const data = { ...req.body } as Record<string, unknown>;
    if (Array.isArray(req.body.features)) data.features = JSON.stringify(req.body.features);
    const plan = await prisma.platformPlan.update({ where: { id: String(req.params.id) }, data });
    res.json({ success: true, data: { ...plan, priceMonthly: num(plan.priceMonthly) } });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Payments ledger + revenue ───────────────────────────────────────────────

// GET /api/platform/payments — cross-tenant payment ledger.
router.get('/payments', async (_req: AuthRequest, res: Response) => {
  try {
    const payments = await prisma.platformPayment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: { organization: { select: { id: true, name: true } } },
    });
    res.json({
      success: true,
      data: payments.map((p) => ({ ...p, amount: num(p.amount) })),
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/platform/revenue?months=12 — monthly revenue series.
router.get('/revenue', async (req: AuthRequest, res: Response) => {
  try {
    const months = Math.min(36, Math.max(1, Number(req.query.months || 12)));
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const payments = await prisma.platformPayment.findMany({
      where: { createdAt: { gte: start } },
      select: { amount: true, createdAt: true },
    });
    const series: { month: string; total: number }[] = [];
    for (let i = 0; i < months; i += 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - (months - 1) + i, 1);
      series.push({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, total: 0 });
    }
    const index = new Map(series.map((s) => [s.month, s]));
    for (const p of payments) {
      const key = `${p.createdAt.getFullYear()}-${String(p.createdAt.getMonth() + 1).padStart(2, '0')}`;
      const bucket = index.get(key);
      if (bucket) bucket.total += num(p.amount);
    }
    for (const s of series) s.total = Number(s.total.toFixed(2));
    res.json({ success: true, data: { months, series, lifetimeRevenue: series.reduce((a, s) => a + s.total, 0) } });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── History ─────────────────────────────────────────────────────────────────

// GET /api/platform/history?limit= — cross-org lifecycle audit feed.
router.get('/history', async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(300, Math.max(1, Number(req.query.limit || 100)));
    const events = await prisma.auditEvent.findMany({
      where: { action: { in: LIFECYCLE_ACTIONS } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        action: true,
        resourceType: true,
        resourceId: true,
        previousValue: true,
        newValue: true,
        metadata: true,
        createdAt: true,
        organization: { select: { id: true, name: true } },
      },
    });
    res.json({ success: true, data: events });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
