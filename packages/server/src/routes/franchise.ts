// ─── Franchise: agreements, royalty accruals, transfer pricing, consolidation ─
// A network lives or dies on whether the royalty number can be audited without
// a phone call. So the engine here is the same pure maths the tests cover: the
// agreement defines the model, the ledger supplies the base, and every accrual
// stores the step-by-step calculation next to the total it produced.

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { jsonOrNull } from '../utils/json.js';
import { round2 } from '../services/moneyMath.js';
import {
  computeRoyalty,
  transferPrice,
  royaltyAging,
  periodLabel,
  normalizeTiers,
  type RoyaltyAgreement,
} from '../services/franchise.js';
import { accrueRoyalties, consolidatedPnlFor } from '../services/globalTasks.js';

const router = Router();

const ROYALTY_MODELS = ['PERCENT', 'TIERED', 'PER_ITEM', 'FIXED'] as const;

function agreementAsRoyalty(agreement: {
  royaltyModel?: string | null;
  royaltyPercent?: unknown;
  tiers?: unknown;
  perItemFee?: unknown;
  fixedMonthly?: unknown;
  minimumMonthly?: unknown;
  marketingFundPercent?: unknown;
  exclusions?: unknown;
}): RoyaltyAgreement {
  return {
    royaltyModel: String(agreement.royaltyModel || 'PERCENT').toUpperCase() as RoyaltyAgreement['royaltyModel'],
    royaltyPercent: Number(agreement.royaltyPercent || 0),
    tiers: Array.isArray(agreement.tiers) ? (agreement.tiers as RoyaltyAgreement['tiers']) : null,
    perItemFee: Number(agreement.perItemFee || 0),
    fixedMonthly: Number(agreement.fixedMonthly || 0),
    minimumMonthly: Number(agreement.minimumMonthly || 0),
    marketingFundPercent: Number(agreement.marketingFundPercent || 0),
    exclusions: Array.isArray(agreement.exclusions) ? (agreement.exclusions as string[]) : [],
  };
}

// GET /api/franchise/agreements - the whole network on one page
router.get('/agreements', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const where: Record<string, unknown> = { organizationId };
    if (req.query.status) where.status = String(req.query.status);
    const [agreements, locations] = await Promise.all([
      prisma.franchiseAgreement.findMany({ where, orderBy: { entityCode: 'asc' } }),
      prisma.location.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    ]);
    const nameById = new Map(locations.map((l) => [l.id, l.name]));
    const rows = agreements.map((a) => ({
      ...a,
      royaltyPercent: Number(a.royaltyPercent),
      perItemFee: Number(a.perItemFee),
      fixedMonthly: Number(a.fixedMonthly),
      minimumMonthly: Number(a.minimumMonthly),
      marketingFundPercent: Number(a.marketingFundPercent),
      transferMarkupPercent: Number(a.transferMarkupPercent),
      locationName: a.locationId ? nameById.get(a.locationId) || null : null,
    }));
    res.json({ success: true, data: { agreements: rows, models: ROYALTY_MODELS, entityCount: new Set(rows.map((r) => r.entityCode)).size } });
  } catch (error) {
    handleError(error, res);
  }
});

const agreementSchema = z.object({
  entityCode: z.string().min(1).max(40),
  franchiseeName: z.string().min(2).max(160),
  locationId: z.string().max(64).optional().nullable(),
  royaltyModel: z.enum(ROYALTY_MODELS).optional(),
  royaltyPercent: z.number().min(0).max(100).optional(),
  tiers: z.array(z.object({ upTo: z.number().min(0).nullable(), percent: z.number().min(0).max(100) })).max(12).optional().nullable(),
  perItemFee: z.number().min(0).optional(),
  fixedMonthly: z.number().min(0).optional(),
  minimumMonthly: z.number().min(0).optional(),
  marketingFundPercent: z.number().min(0).max(100).optional(),
  transferMarkupPercent: z.number().min(0).max(100).optional(),
  exclusions: z.array(z.string().max(30)).max(10).optional().nullable(),
  currency: z.string().length(3).optional(),
  startDate: z.string().datetime({ offset: true }).or(z.string().length(10)).optional(),
  endDate: z.string().datetime({ offset: true }).or(z.string().length(10)).optional().nullable(),
});

// POST /api/franchise/agreements - create or update one entity's terms
router.post('/agreements', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(agreementSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof agreementSchema>;
    const entityCode = body.entityCode.trim().toUpperCase();
    if (body.locationId) {
      const location = await prisma.location.findFirst({ where: { id: body.locationId, organizationId }, select: { id: true } });
      if (!location) return res.status(400).json({ success: false, message: 'That location does not belong to this organization' });
    }
    if ((body.royaltyModel || 'PERCENT') === 'TIERED' && !normalizeTiers(body.tiers || []).length) {
      return res.status(400).json({ success: false, message: 'A TIERED agreement needs at least one band' });
    }
    const data = {
      franchiseeName: body.franchiseeName.trim(),
      locationId: body.locationId || null,
      royaltyModel: body.royaltyModel || 'PERCENT',
      royaltyPercent: body.royaltyPercent ?? 0,
      tiers: jsonOrNull(body.tiers),
      perItemFee: body.perItemFee ?? 0,
      fixedMonthly: body.fixedMonthly ?? 0,
      minimumMonthly: body.minimumMonthly ?? 0,
      marketingFundPercent: body.marketingFundPercent ?? 0,
      transferMarkupPercent: body.transferMarkupPercent ?? 0,
      exclusions: jsonOrNull(body.exclusions),
      currency: (body.currency || 'USD').toUpperCase(),
      startDate: new Date(body.startDate || new Date()),
      endDate: body.endDate ? new Date(body.endDate) : null,
      status: 'ACTIVE',
    };
    const agreement = await prisma.franchiseAgreement.upsert({
      where: { organizationId_entityCode: { organizationId, entityCode } },
      create: { organizationId, entityCode, ...data },
      update: data,
    });
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'FRANCHISE_AGREEMENT_SAVED',
      resourceType: 'FRANCHISE_AGREEMENT',
      resourceId: agreement.id,
      newValue: { entityCode, royaltyModel: agreement.royaltyModel, royaltyPercent: agreement.royaltyPercent },
    });
    res.status(201).json({ success: true, data: agreement });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/franchise/agreements/:id/status - suspend or terminate, never delete
const statusSchema = z.object({ status: z.enum(['DRAFT', 'ACTIVE', 'SUSPENDED', 'TERMINATED']), reason: z.string().max(400).optional() });

router.post('/agreements/:id/status', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(statusSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const existing = await prisma.franchiseAgreement.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Agreement not found' });
    const body = req.body as z.infer<typeof statusSchema>;
    const updated = await prisma.franchiseAgreement.update({
      where: { id: existing.id },
      data: { status: body.status, ...(body.status === 'TERMINATED' ? { endDate: new Date() } : {}) },
    });
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'FRANCHISE_AGREEMENT_STATUS',
      resourceType: 'FRANCHISE_AGREEMENT',
      resourceId: existing.id,
      previousValue: { status: existing.status },
      newValue: { status: body.status, reason: body.reason || null },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

const previewSchema = z.object({
  agreement: z.object({
    royaltyModel: z.enum(ROYALTY_MODELS).optional(),
    royaltyPercent: z.number().min(0).max(100).optional(),
    tiers: z.array(z.object({ upTo: z.number().min(0).nullable(), percent: z.number().min(0).max(100) })).optional().nullable(),
    perItemFee: z.number().min(0).optional(),
    fixedMonthly: z.number().min(0).optional(),
    minimumMonthly: z.number().min(0).optional(),
    marketingFundPercent: z.number().min(0).max(100).optional(),
    exclusions: z.array(z.string()).optional().nullable(),
  }),
  period: z.object({
    grossSales: z.number().min(0),
    unitsSold: z.number().int().min(0).optional(),
    excludedByCategory: z.record(z.number().min(0)).optional().nullable(),
    taxableBaseOverride: z.number().min(0).optional().nullable(),
  }),
});

// POST /api/franchise/royalties/preview - what-if, nothing written
router.post('/royalties/preview', authMiddleware, validateRequest(previewSchema), async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as z.infer<typeof previewSchema>;
    const result = computeRoyalty(agreementAsRoyalty(body.agreement), {
      grossSales: body.period.grossSales,
      unitsSold: body.period.unitsSold ?? 0,
      excludedByCategory: body.period.excludedByCategory ?? null,
      taxableBaseOverride: body.period.taxableBaseOverride ?? null,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    handleError(error, res);
  }
});

const accrueSchema = z.object({
  periodStart: z.string().length(10).optional(),
  periodEnd: z.string().length(10).optional(),
});

// POST /api/franchise/royalties/accrue - close a period across every agreement
router.post('/royalties/accrue', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(accrueSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof accrueSchema>;
    // Default: the previous whole calendar month, which is what a royalty
    // statement is actually issued against.
    const now = new Date();
    const periodStart = body.periodStart ? new Date(`${body.periodStart}T00:00:00Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const periodEnd = body.periodEnd ? new Date(`${body.periodEnd}T00:00:00Z`) : new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1));
    if (periodEnd <= periodStart) return res.status(400).json({ success: false, message: 'periodEnd must be after periodStart' });
    const result = await accrueRoyalties(organizationId, periodStart, periodEnd);
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'ROYALTY_ACCRUED',
      resourceType: 'ROYALTY_ACCRUAL',
      newValue: { period: result.period, entities: result.accruals.length, total: round2(result.accruals.reduce((a, r) => a + r.total, 0)) },
    });
    res.json({ success: true, data: { ...result, periodStart, periodEnd } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/franchise/royalties - statements with aging on the unpaid ones
router.get('/royalties', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const where: Record<string, unknown> = { organizationId };
    if (req.query.status) where.status = String(req.query.status);
    const [accruals, agreements] = await Promise.all([
      prisma.royaltyAccrual.findMany({ where, orderBy: { periodStart: 'desc' }, take: 200 }),
      prisma.franchiseAgreement.findMany({ where: { organizationId }, select: { id: true, entityCode: true, franchiseeName: true } }),
    ]);
    const byId = new Map(agreements.map((a) => [a.id, a]));
    const rows = accruals.map((accrual) => {
      const agreement = byId.get(accrual.agreementId);
      // Contracts settle 30 days after the period closes; aging counts from there.
      const dueDate = new Date(new Date(accrual.periodEnd).getTime() + 30 * 86_400_000);
      return {
        ...accrual,
        grossSales: Number(accrual.grossSales),
        taxableBase: Number(accrual.taxableBase),
        royaltyAmount: Number(accrual.royaltyAmount),
        marketingFundAmount: Number(accrual.marketingFundAmount),
        entityCode: agreement?.entityCode || null,
        franchiseeName: agreement?.franchiseeName || null,
        period: periodLabel(accrual.periodStart),
        dueDate,
        aging: accrual.status === 'PAID' ? null : royaltyAging(dueDate),
      };
    });
    const outstandingByBucket: Record<string, number> = {};
    for (const row of rows) {
      if (!row.aging) continue;
      outstandingByBucket[row.aging.bucket] = round2((outstandingByBucket[row.aging.bucket] || 0) + row.royaltyAmount + row.marketingFundAmount);
    }
    res.json({
      success: true,
      data: {
        accruals: rows,
        outstanding: round2(Object.values(outstandingByBucket).reduce((a, b) => a + b, 0)),
        outstandingByBucket,
        collected: round2(rows.filter((r) => r.status === 'PAID').reduce((a, r) => a + r.royaltyAmount + r.marketingFundAmount, 0)),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/franchise/royalties/:id/status - invoice it, mark it paid, flag a dispute
const accrualStatusSchema = z.object({ status: z.enum(['CALCULATED', 'INVOICED', 'PAID', 'DISPUTED']), note: z.string().max(400).optional() });

router.post('/royalties/:id/status', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(accrualStatusSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const existing = await prisma.royaltyAccrual.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Accrual not found' });
    const body = req.body as z.infer<typeof accrualStatusSchema>;
    const updated = await prisma.royaltyAccrual.update({ where: { id: existing.id }, data: { status: body.status } });
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'ROYALTY_STATUS_CHANGED',
      resourceType: 'ROYALTY_ACCRUAL',
      resourceId: existing.id,
      previousValue: { status: existing.status },
      newValue: { status: body.status, note: body.note || null },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

const transferSchema = z.object({
  cost: z.number().min(0),
  markupPercent: z.number().min(0).max(200).optional(),
  freight: z.number().min(0).optional(),
  quantity: z.number().int().min(1).max(1_000_000).optional(),
  fromAgreement: z.string().max(64).optional(),
});

// POST /api/franchise/transfer-price - cost-plus quote for inter-entity stock moves
router.post('/transfer-price', authMiddleware, validateRequest(transferSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof transferSchema>;
    let markup = body.markupPercent ?? 0;
    if (body.fromAgreement) {
      const agreement = await prisma.franchiseAgreement.findFirst({ where: { organizationId, id: body.fromAgreement } });
      if (!agreement) return res.status(404).json({ success: false, message: 'Agreement not found' });
      markup = Number(agreement.transferMarkupPercent);
    }
    const quote = transferPrice(body.cost, markup, body.freight ?? 0, body.quantity ?? 1);
    res.json({ success: true, data: { ...quote, markupPercent: markup } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/franchise/consolidated - brand-level P&L with intercompany eliminated
router.get('/consolidated', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(to.getTime() - 90 * 86_400_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      return res.status(400).json({ success: false, message: 'from/to must be valid dates with to after from' });
    }
    const { entities, consolidated } = await consolidatedPnlFor(organizationId, from, to);
    res.json({ success: true, data: { from, to, entities, consolidated, note: 'Labour is apportioned across locations by revenue share; it is an estimate, not a payroll export.' } });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
