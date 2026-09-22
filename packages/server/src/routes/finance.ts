// ─── Embedded finance: working capital underwritten from the merchant's own led
// The float a POS sees is the underwriting file nobody else has: settled daily
// sales, refund and chargeback rates, dormancy, existing debt service. This
// router quotes a facility from that evidence, and repayment is a small daily
// sweep of card sales - the merchant never has to find the cash on a due date.
import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { toJson } from '../utils/json.js';
import {
  underwrite,
  costOfCredit,
  installmentPayment,
  amortizeSchedule,
  debtToRevenue,
  paybackDays,
  effectiveAnnualRate,
  MIN_ACTIVE_MONTHS,
  RISK_BANDS,
  TERM_OPTIONS_MONTHS,
  BASE_RATE_PERCENT,
} from '../services/embeddedFinance.js';
import { collectTradingMetrics, openCreditFacility, runSweepForFacility } from '../services/globalTasks.js';
import { round2 } from '../services/moneyMath.js';

const router = Router();

// GET /api/finance/eligibility - the pre-application view, with its reasoning
router.get('/eligibility', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const windowDays = Math.min(730, Math.max(14, Number(req.query.windowDays) || 180));
    const metrics = await collectTradingMetrics(organizationId, windowDays);
    const decision = underwrite(metrics);
    const existing = await prisma.creditFacility.findMany({
      where: { organizationId, status: { in: ['PENDING', 'APPROVED', 'ACTIVE'] } },
      select: { id: true, status: true, outstanding: true, approvedLimit: true, nextDueDate: true },
    });
    const outstanding = round2(existing.reduce((a, f) => a + Number(f.outstanding), 0));
    res.json({
      success: true,
      data: {
        decision,
        metrics: { ...metrics, series: metrics.series.slice(-60) },
        windowDays,
        minimumMonths: MIN_ACTIVE_MONTHS,
        bands: RISK_BANDS,
        terms: TERM_OPTIONS_MONTHS,
        baseRatePercent: BASE_RATE_PERCENT,
        existing: { facilities: existing, outstanding, debtToRevenue: debtToRevenue(outstanding, decision.annualRevenueProxy) },
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

const applySchema = z.object({
  requestedAmount: z.number().positive().max(5_000_000),
  termMonths: z.number().int().min(1).max(24).optional(),
  acknowledgeTerms: z.boolean().optional(),
});

// POST /api/finance/apply - record an application against the underwriting result
router.post('/apply', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(applySchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof applySchema>;
    const metrics = await collectTradingMetrics(organizationId);
    const decision = underwrite(metrics);
    if (!decision.qualifies) {
      return res.status(422).json({ success: false, message: 'This business is not currently eligible', data: { reasons: decision.declineReasons, decision } });
    }
    if (body.requestedAmount > decision.suggestedLimit) {
      return res.status(400).json({
        success: false,
        message: `The maximum request supported by your trading history is ${decision.suggestedLimit} ${metrics.currency}`,
        data: { suggestedLimit: decision.suggestedLimit },
      });
    }
    const pending = await prisma.creditFacility.findFirst({ where: { organizationId, status: 'PENDING' } });
    if (pending) return res.status(409).json({ success: false, message: 'An application is already awaiting review', data: { facilityId: pending.id } });

    const term = body.termMonths && TERM_OPTIONS_MONTHS.includes(body.termMonths as (typeof TERM_OPTIONS_MONTHS)[number]) ? body.termMonths : 6;
    const facility = await prisma.creditFacility.create({
      data: {
        organizationId,
        status: 'PENDING',
        requestedAmount: round2(body.requestedAmount),
        approvedLimit: round2(body.requestedAmount),
        rate: round2(decision.ratePercent),
        termMonths: term,
        installmentAmount: round2(installmentPayment(body.requestedAmount, decision.ratePercent, term)),
        sweepPercent: round2(decision.sweepPercent),
        score: decision.score,
        scoreBand: decision.band,
        underwriting: toJson(decision),
        eligibility: { windowDays: 180, currency: metrics.currency, appliedAt: new Date().toISOString() },
      },
    });
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'FACILITY_APPLIED',
      resourceType: 'CREDIT_FACILITY',
      resourceId: facility.id,
      newValue: { requestedAmount: facility.requestedAmount, score: facility.score, band: facility.scoreBand, termsAccepted: Boolean(body.acknowledgeTerms) },
    });
    res.status(201).json({ success: true, data: { facility, decision, termsAccepted: Boolean(body.acknowledgeTerms) } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/finance/facilities - everything drawn, everything owed
router.get('/facilities', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const [facilities, due] = await Promise.all([
      prisma.creditFacility.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.loanRepayment.findMany({ where: { organizationId, status: { in: ['DUE', 'PARTIAL', 'OVERDUE'] } }, orderBy: { dueDate: 'asc' }, take: 60 }),
    ]);
    const outstanding = round2(facilities.reduce((a, f) => a + Number(f.outstanding), 0));
    res.json({
      success: true,
      data: {
        facilities,
        upcoming: due,
        outstanding,
        utilisation: round2(facilities.reduce((a, f) => a + Number(f.drawnAmount), 0)),
        nextDue: due[0]?.dueDate || null,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

const decideSchema = z.object({
  approvedLimit: z.number().positive().optional(),
  ratePercent: z.number().min(0).max(100).optional(),
  termMonths: z.number().int().min(1).max(24).optional(),
  sweepPercent: z.number().min(0).max(100).optional(),
  reason: z.string().max(400).optional(),
});

// POST /api/finance/facilities/:id/approve - a human approves; the model only recommends
router.post('/facilities/:id/approve', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(decideSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const pending = await prisma.creditFacility.findFirst({ where: { id: String(req.params.id), organizationId, status: 'PENDING' } });
    if (!pending) return res.status(404).json({ success: false, message: 'No pending application with that id' });
    const body = req.body as z.infer<typeof decideSchema>;
    const limit = round2(Number(body.approvedLimit || pending.requestedAmount));
    const rate = Number(body.ratePercent || pending.rate);
    const term = Math.trunc(Number(body.termMonths || pending.termMonths));
    const sweep = Number(body.sweepPercent ?? pending.sweepPercent);

    await prisma.creditFacility.update({ where: { id: pending.id }, data: { status: 'CLOSED', closedAt: new Date(), decidedBy: req.user!.id } });
    const facility = await openCreditFacility(organizationId, { principal: limit, termMonths: term, ratePercent: rate, sweepPercent: sweep, actorId: req.user!.id });
    const cost = costOfCredit(limit, rate, term);
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'FACILITY_APPROVED',
      resourceType: 'CREDIT_FACILITY',
      resourceId: facility.id,
      previousValue: { applicationId: pending.id, status: 'PENDING' },
      newValue: { limit, rate, term, sweep, cost },
    });
    res.status(201).json({ success: true, data: { facility, applicationId: pending.id, cost } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/finance/facilities/:id/decline - with a reason the merchant can see
router.post('/facilities/:id/decline', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const pending = await prisma.creditFacility.findFirst({ where: { id: String(req.params.id), organizationId, status: 'PENDING' } });
    if (!pending) return res.status(404).json({ success: false, message: 'No pending application with that id' });
    const reason = String(req.body?.reason || 'Not approved').slice(0, 400);
    const updated = await prisma.creditFacility.update({
      where: { id: pending.id },
      data: { status: 'DECLINED', decidedBy: req.user!.id, eligibility: { ...(pending.eligibility as object | {}), declineReason: reason, decidedAt: new Date().toISOString() } },
    });
    await createAuditEvent({ organizationId, actorId: req.user!.employeeId, action: 'FACILITY_DECLINED', resourceType: 'CREDIT_FACILITY', resourceId: pending.id, newValue: { reason } });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/finance/facilities/:id - the schedule, with what the sweep has covered
router.get('/facilities/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const facility = await prisma.creditFacility.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!facility) return res.status(404).json({ success: false, message: 'Facility not found' });
    const repayments = await prisma.loanRepayment.findMany({ where: { facilityId: facility.id, organizationId }, orderBy: { period: 'asc' } });
    const paid = round2(repayments.reduce((a, r) => a + Number(r.paidAmount), 0));
    const totalPayable = round2(repayments.reduce((a, r) => a + Number(r.total), 0));
    const yesterday = await prisma.order.aggregate({
      where: { organizationId, status: { in: ['COMPLETED', 'PAID', 'FULFILLED'] }, completedAt: { gte: new Date(Date.now() - 86_400_000) } },
      _sum: { totalAmount: true },
    });
    const dailySales = round2(Number(yesterday._sum.totalAmount || 0));
    const sweepAmount = round2((dailySales * Number(facility.sweepPercent || 0)) / 100);
    res.json({
      success: true,
      data: {
        facility,
        repayments,
        progress: { paid, totalPayable, remaining: round2(totalPayable - paid), percentPaid: totalPayable > 0 ? round2((paid / totalPayable) * 100) : 0 },
        projection: {
          yesterdayNetSales: dailySales,
          sweepAmount,
          daysToClear: paybackDays(Number(facility.outstanding), sweepAmount),
          apr: effectiveAnnualRate(Number(facility.rate)),
        },
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/finance/facilities/:id/sweep - settle today's share by hand
router.post('/facilities/:id/sweep', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const facility = await prisma.creditFacility.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!facility) return res.status(404).json({ success: false, message: 'Facility not found' });
    const result = await runSweepForFacility(facility.id);
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'FACILITY_SWEPT',
      resourceType: 'CREDIT_FACILITY',
      resourceId: facility.id,
      newValue: result,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/finance/position - the dashboard tile: capacity, cost, next due
router.get('/position', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const [metrics, facilities, next] = await Promise.all([
      collectTradingMetrics(organizationId),
      prisma.creditFacility.findMany({ where: { organizationId, status: { in: ['ACTIVE', 'APPROVED'] } }, select: { outstanding: true, approvedLimit: true, installmentAmount: true } }),
      prisma.loanRepayment.findFirst({ where: { organizationId, status: { in: ['DUE', 'PARTIAL', 'OVERDUE'] } }, orderBy: { dueDate: 'asc' } }),
    ]);
    const decision = underwrite(metrics);
    const outstanding = round2(facilities.reduce((a, f) => a + Number(f.outstanding), 0));
    const available = round2(Math.max(0, decision.suggestedLimit - outstanding));
    res.json({
      success: true,
      data: {
        qualifies: decision.qualifies,
        band: decision.band,
        score: decision.score,
        suggestedLimit: decision.suggestedLimit,
        available,
        outstanding,
        monthlyDebtService: round2(facilities.reduce((a, f) => a + Number(f.installmentAmount), 0)),
        debtToRevenue: debtToRevenue(outstanding, decision.annualRevenueProxy),
        ratePercent: decision.ratePercent,
        sweepPercent: decision.sweepPercent,
        nextDue: next ? { dueDate: next.dueDate, amount: Number(next.total), status: next.status } : null,
        declineReasons: decision.declineReasons,
        factors: decision.factors,
        confidence: decision.confidence,
        currency: metrics.currency,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

const quoteSchema = z.object({
  principal: z.number().positive().max(5_000_000),
  annualRatePercent: z.number().min(0).max(120).optional(),
  months: z.number().int().min(1).max(36).optional(),
});

// POST /api/finance/quote - what this money actually costs before taking it
router.post('/quote', authMiddleware, validateRequest(quoteSchema), async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as z.infer<typeof quoteSchema>;
    const organizationId = req.user!.organizationId!;
    const decision = underwrite(await collectTradingMetrics(organizationId));
    const rate = Number(body.annualRatePercent ?? decision.ratePercent);
    const months = Math.trunc(Number(body.months || 6));
    const cost = costOfCredit(body.principal, rate, months);
    const schedule = amortizeSchedule(body.principal, rate, months, new Date());
    res.json({
      success: true,
      data: {
        principal: body.principal,
        rate,
        months,
        ...cost,
        suggestedRate: decision.ratePercent,
        firstThree: schedule.slice(0, 3),
        lastRow: schedule[schedule.length - 1] || null,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
