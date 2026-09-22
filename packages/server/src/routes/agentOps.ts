// ─── Agentic back-office: forecast-driven replenishment with a human veto ─────
// The buying agent does the arithmetic nobody wants to do at 22:00 - read the
// demand history, add safety stock for the agreed service level, respect pack
// sizes and supplier lead times, trim to the spend cap - and then stops. Nothing
// is committed until a manager approves the draft, which is what makes an
// autonomous back office acceptable to the person who signs the cheques.

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { DEFAULT_SERVICE_LEVEL, daysOfCover, describePlan } from '../services/replenishment.js';
import {
  buildReplenishmentPlan,
  saveReplenishmentRun,
  approveReplenishmentRun,
  loadDemandSeries,
} from '../services/globalTasks.js';
import { round2 } from '../services/moneyMath.js';

const router = Router();

const planSchema = z.object({
  horizonDays: z.number().int().min(1).max(120).optional(),
  lookbackDays: z.number().int().min(7).max(365).optional(),
  serviceLevel: z.number().min(0.5).max(0.9999).optional(),
  maxSpend: z.number().min(0).optional().nullable(),
  maxLines: z.number().int().min(1).max(500).optional().nullable(),
  minQuantity: z.number().int().min(1).max(10_000).optional(),
  excludedSuppliers: z.array(z.string().max(64)).max(50).optional(),
  locationId: z.string().max(64).optional().nullable(),
  productIds: z.array(z.string().max(64)).max(500).optional().nullable(),
  /** Draft the purchase orders straight away instead of waiting for approval. */
  autoOrder: z.boolean().optional(),
});

// POST /api/agent/replenish - run the planner and keep the plan as a DRAFT
router.post('/replenish', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(planSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof planSchema>;
    const built = await buildReplenishmentPlan(organizationId, {
      horizonDays: body.horizonDays,
      lookbackDays: body.lookbackDays,
      serviceLevel: body.serviceLevel,
      maxSpend: body.maxSpend ?? null,
      maxLines: body.maxLines ?? null,
      minQuantity: body.minQuantity,
      excludedSuppliers: body.excludedSuppliers,
      locationId: body.locationId ?? null,
      productIds: body.productIds ?? null,
    });
    const run = await saveReplenishmentRun(
      organizationId,
      built,
      {
        trigger: 'MANUAL',
        actorId: req.user!.employeeId ?? null,
        guardrails: {
          serviceLevel: built.plan.serviceLevel,
          maxSpend: body.maxSpend ?? null,
          maxLines: body.maxLines ?? null,
          minQuantity: body.minQuantity ?? 1,
          excludedSuppliers: body.excludedSuppliers ?? [],
        },
      }
    );

    let ordered: { purchaseOrderIds: string[] } | null = null;
    if (body.autoOrder) {
      ordered = await approveReplenishmentRun(organizationId, run.id, req.user!.employeeId ?? null);
    }

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'REPLENISHMENT_PLANNED',
      resourceType: 'REPLENISHMENT_RUN',
      resourceId: run.id,
      newValue: { lines: built.plan.totals.lines, cost: built.plan.totals.cost, trimmed: built.plan.totals.trimmed, autoOrder: Boolean(body.autoOrder) },
    });
    res.status(201).json({
      success: true,
      data: {
        runId: run.id,
        status: ordered ? 'APPROVED' : 'DRAFT',
        horizonDays: built.horizonDays,
        lookbackDays: built.lookbackDays,
        serviceLevel: built.plan.serviceLevel,
        summary: describePlan(built.plan),
        totals: built.plan.totals,
        bySupplier: built.plan.bySupplier,
        items: built.plan.items.filter((i) => i.action === 'ORDER').slice(0, 200),
        watch: built.plan.items.filter((i) => i.action === 'WATCH').slice(0, 25),
        purchaseOrderIds: ordered?.purchaseOrderIds ?? null,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/agent/runs - the draft queue, newest first
router.get('/runs', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const { status, limit = '25' } = req.query;
    const runs = await prisma.replenishmentRun.findMany({
      where: { organizationId, ...(status ? { status: String(status) } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, Number(limit) || 25),
      select: { id: true, trigger: true, horizonDays: true, itemCount: true, supplierCount: true, estimatedCost: true, status: true, approvedAt: true, approvedBy: true, createdAt: true, purchaseOrderIds: true },
    });
    res.json({
      success: true,
      data: {
        runs,
        pending: runs.filter((r) => r.status === 'DRAFT').length,
        committedValue: round2(runs.filter((r) => r.status !== 'DRAFT').reduce((a, r) => a + Number(r.estimatedCost), 0)),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/agent/runs/:id - the full plan, exactly as the agent wrote it
router.get('/runs/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const run = await prisma.replenishmentRun.findFirst({ where: { id: String(req.params.id), organizationId: req.user!.organizationId! } });
    if (!run) return res.status(404).json({ success: false, message: 'Replenishment run not found' });
    const plan = (run.plan || { items: [], bySupplier: [], totals: {} }) as { items: { action?: string }[] };
    res.json({
      success: true,
      data: {
        ...run,
        orderedLines: (plan.items || []).filter((i) => i.action === 'ORDER').length,
        watchLines: (plan.items || []).filter((i) => i.action === 'WATCH').length,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/agent/runs/:id/approve - the human half of the human-in-the-loop
router.post('/runs/:id/approve', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const result = await approveReplenishmentRun(organizationId, String(req.params.id), req.user!.employeeId ?? null);
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'REPLENISHMENT_APPROVED',
      resourceType: 'REPLENISHMENT_RUN',
      resourceId: String(req.params.id),
      newValue: { purchaseOrderIds: result.purchaseOrderIds, lines: result.lineCount },
    });
    res.json({ success: true, data: { ...result, status: 'APPROVED' } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/agent/runs/:id/discard - keep the record, drop the intent
router.post('/runs/:id/discard', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const run = await prisma.replenishmentRun.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!run) return res.status(404).json({ success: false, message: 'Replenishment run not found' });
    if (run.status !== 'DRAFT') return res.status(409).json({ success: false, message: `This run is already ${run.status}` });
    const updated = await prisma.replenishmentRun.update({ where: { id: run.id }, data: { status: 'DISCARDED', approvedBy: req.user!.employeeId ?? null, approvedAt: new Date() } });
    await createAuditEvent({ organizationId, actorId: req.user!.employeeId, action: 'REPLENISHMENT_DISCARDED', resourceType: 'REPLENISHMENT_RUN', resourceId: run.id, previousValue: { status: run.status } });
    res.json({ success: true, data: { id: updated.id, status: updated.status } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/agent/low-stock - what the planner would act on today
router.get('/low-stock', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const balances = await prisma.inventoryBalance.findMany({
      where: { product: { organizationId, isActive: true }, reorderPoint: { gt: 0 } },
      select: { productId: true, locationId: true, quantity: true, reserved: true, reorderPoint: true, product: { select: { name: true, sku: true, price: true, costPrice: true } }, location: { select: { name: true } } },
      take: 5000,
    });
    const short = balances
      .filter((b) => b.quantity - b.reserved <= b.reorderPoint)
      .map((b) => ({
        productId: b.productId,
        sku: b.product.sku,
        name: b.product.name,
        locationId: b.locationId,
        locationName: b.location.name,
        onHand: b.quantity,
        available: b.quantity - b.reserved,
        reorderPoint: b.reorderPoint,
        dailyDemand: round2(b.reorderPoint / 14),
        daysOfCover: daysOfCover(b.quantity - b.reserved, Math.max(0.01, b.reorderPoint / 14)),
        estimatedShortfall: Math.max(0, b.reorderPoint * 2 - (b.quantity - b.reserved)),
        coverValue: round2(Math.max(0, b.reorderPoint * 2 - (b.quantity - b.reserved)) * Number(b.product.costPrice || 0)),
      }))
      .sort((a, b) => (a.daysOfCover ?? 999) - (b.daysOfCover ?? 999));
    res.json({ success: true, data: { items: short.slice(0, 200), total: short.length, exposure: round2(short.reduce((a, i) => a + i.coverValue, 0)) } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/agent/forecast/:productId - the demand profile behind a recommendation
router.get('/forecast/:productId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const productId = String(req.params.productId);
    const product = await prisma.product.findFirst({ where: { id: productId, organizationId }, select: { id: true, name: true, sku: true, costPrice: true, price: true } });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    const lookbackDays = Math.min(365, Math.max(14, Number(req.query.lookbackDays) || 56));
    const horizonDays = Math.min(120, Math.max(1, Number(req.query.horizonDays) || 14));
    const series = await loadDemandSeries(organizationId, productId, { lookbackDays, horizonDays, locationId: req.query.locationId ? String(req.query.locationId) : null });
    const balance = await prisma.inventoryBalance.aggregate({ where: { productId }, _sum: { quantity: true, reserved: true } });
    const onHand = Number(balance._sum.quantity || 0);
    const available = onHand - Number(balance._sum.reserved || 0);
    res.json({
      success: true,
      data: {
        product,
        lookbackDays,
        horizonDays,
        history: series.daily,
        forecast: series.forecast,
        avgPerDay: series.avgPerDay,
        stdDevPerDay: series.stdDevPerDay,
        onHand,
        available,
        daysOfCover: daysOfCover(available, series.avgPerDay),
        serviceLevelDefault: DEFAULT_SERVICE_LEVEL,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/agent/overview - the control-tile numbers
router.get('/overview', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const [drafts, ordered, spent, openPos, products] = await Promise.all([
      prisma.replenishmentRun.aggregate({ where: { organizationId, status: 'DRAFT' }, _count: { _all: true }, _sum: { estimatedCost: true, itemCount: true } }),
      prisma.replenishmentRun.count({ where: { organizationId, status: 'APPROVED' } }),
      prisma.replenishmentRun.aggregate({ where: { organizationId, status: { in: ['APPROVED', 'ORDERED'] } }, _sum: { estimatedCost: true } }),
      prisma.purchaseOrder.count({ where: { organizationId, status: 'DRAFT' } }),
      prisma.product.count({ where: { organizationId, isActive: true } }),
    ]);
    res.json({
      success: true,
      data: {
        drafts: drafts._count._all,
        draftLines: drafts._sum.itemCount || 0,
        draftValue: round2(Number(drafts._sum.estimatedCost || 0)),
        approvedRuns: ordered,
        committedValue: round2(Number(spent._sum.estimatedCost || 0)),
        draftPurchaseOrders: openPos,
        skusTracked: products,
        serviceLevel: DEFAULT_SERVICE_LEVEL,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
