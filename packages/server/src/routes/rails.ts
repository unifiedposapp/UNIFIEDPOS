// ─── Local payment rails + settlement reconciliation ─────────────────────────
// Two jobs in one router. (1) Rail accounts: register the instruments a store
// actually receives money through (IBAN, UPI VPA, PIX key, M-PESA paybill, ACH
// …) and validate the identifier with the rail's own check-digit algorithm, so a
// typo never becomes a failed payroll or a refund to a stranger. (2) Settlement:
// import the acquirer's statement lines and reconcile them against internal
// Payment rows, which is the difference between "we took money" and "the bank
// agrees we took this much, minus these fees".

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { RAILS, railByCode, railsForCountry, defaultRailForCountry, railCoverage, supportsCurrency } from '../data/paymentRails.js';
import {
  validateRailIdentifier,
  isKnownIdentifierKind,
  addBusinessDays,
  railFee,
  withinRailLimit,
  chooseRail,
} from '../services/paymentRails.js';
import { reconcileBatch, batchHealth, groupBySettlementDate, floatDays, type ProviderLine, type InternalPayment } from '../services/settlement.js';

const router = Router();

async function orgCountry(organizationId: string): Promise<{ countryCode: string | null; currency: string }> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { countryCode: true, currency: true } });
  return { countryCode: org?.countryCode || null, currency: String(org?.currency || 'USD').toUpperCase() };
}

// GET /api/rails/catalog - the rail table and this market's defaults
router.get('/catalog', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { countryCode, currency } = await orgCountry(req.user!.organizationId!);
    res.json({
      success: true,
      data: {
        countryCode,
        currency,
        available: railsForCountry(countryCode),
        defaultRail: defaultRailForCountry(countryCode),
        coverage: railCoverage(),
        rails: RAILS,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/rails/market/:countryCode - what works in a given market
router.get('/market/:countryCode', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const code = String(req.params.countryCode || '').toUpperCase();
    const rails = railsForCountry(code);
    res.json({
      success: true,
      data: {
        countryCode: code,
        rails,
        defaultRail: defaultRailForCountry(code),
        currencies: [...new Set(rails.flatMap((r) => r.currencies))],
        // A market with only SWIFT has no domestic rail wired up yet.
        domestic: rails.some((r) => r.code !== 'SWIFT'),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

const validateSchema = z.object({
  kind: z.string().min(2).max(32),
  identifier: z.string().min(1).max(500),
  keyType: z.string().max(24).optional().nullable(),
});

// POST /api/rails/validate - check an identifier without saving it
router.post('/validate', authMiddleware, validateRequest(validateSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { kind, identifier, keyType } = req.body as z.infer<typeof validateSchema>;
    if (!isKnownIdentifierKind(kind)) {
      return res.status(400).json({ success: false, message: `Unknown identifier kind "${kind}"`, data: { known: RAILS.map((r) => r.identifierKind).filter((k, i, a) => a.indexOf(k) === i) } });
    }
    res.json({ success: true, data: validateRailIdentifier(kind, identifier, keyType ?? null) });
  } catch (error) {
    handleError(error, res);
  }
});

const quoteSchema = z.object({
  countryCode: z.string().max(2).optional(),
  amount: z.number().positive(),
  currency: z.string().max(3).optional(),
  /** Percent + fixed cost of *this* rail, so a route choice is a real comparison. */
  feePercent: z.number().min(0).max(100).optional(),
  feeFixed: z.number().min(0).optional(),
});

// POST /api/rails/quote - which rail should carry this payment, and what it costs
router.post('/quote', authMiddleware, validateRequest(quoteSchema), async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as z.infer<typeof quoteSchema>;
    const { countryCode: orgCountryCode, currency: orgCurrency } = await orgCountry(req.user!.organizationId!);
    const countryCode = (body.countryCode || orgCountryCode || '').toUpperCase() || null;
    const currency = (body.currency || orgCurrency).toUpperCase();
    const rails = railsForCountry(countryCode);
    const chosen = chooseRail(rails, body.amount, currency);
    if (!chosen) return res.status(400).json({ success: false, message: `No rail in ${countryCode || 'this market'} can carry ${currency} ${body.amount}` });
    const fee = railFee(body.amount, { percent: body.feePercent ?? 0, fixed: body.feeFixed ?? 0 });
    res.json({
      success: true,
      data: {
        rail: chosen,
        amount: body.amount,
        currency,
        fee,
        net: Math.round((body.amount - fee) * 100) / 100,
        settlesOn: addBusinessDays(new Date(), chosen.settlementDays),
        overRailLimit: !withinRailLimit(chosen, body.amount),
        alternatives: rails
          .filter((r) => r.code !== chosen.code && withinRailLimit(r, body.amount) && (!r.currencies.length || r.currencies.includes(currency)))
          .slice(0, 5)
          .map((r) => ({ code: r.code, name: r.name, instant: r.instant, settlementDays: r.settlementDays })),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/rails/accounts - registered receiving instruments
router.get('/accounts', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const accounts = await prisma.railAccount.findMany({ where: { organizationId: req.user!.organizationId! }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] });
    // Never echo a full instrument back: show enough for a human to recognise it.
    res.json({
      success: true,
      data: accounts.map((a) => ({
        ...a,
        identifier: maskIdentifier(a.identifier),
        rail: railByCode(a.railCode),
      })),
    });
  } catch (error) {
    handleError(error, res);
  }
});

function maskIdentifier(value: string): string {
  const raw = String(value || '');
  if (raw.length <= 8) return raw;
  return `${raw.slice(0, 4)}${'•'.repeat(Math.max(4, raw.length - 8))}${raw.slice(-4)}`;
}

const accountSchema = z.object({
  railCode: z.string().min(2).max(24),
  label: z.string().min(2).max(120),
  identifier: z.string().min(3).max(300),
  holderName: z.string().max(160).optional().nullable(),
  countryCode: z.string().max(2).optional(),
  locationId: z.string().optional().nullable(),
  keyType: z.string().max(24).optional().nullable(),
  isPrimary: z.boolean().optional(),
});

// POST /api/rails/accounts - register one, validated by the rail's own algorithm
router.post('/accounts', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(accountSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof accountSchema>;
    const rail = railByCode(body.railCode);
    if (!rail) return res.status(400).json({ success: false, message: `Unknown rail ${body.railCode}` });

    const countryCode = (body.countryCode || (await orgCountry(organizationId)).countryCode || '').toUpperCase() || null;
    if (countryCode && countryCode !== '*' && !rail.countries.includes(countryCode) && !rail.countries.includes('*')) {
      return res.status(400).json({ success: false, message: `${rail.name} is not available in ${countryCode}` });
    }

    const identifier = String(body.identifier).trim();
    const check = validateRailIdentifier(rail.identifierKind, identifier, body.keyType ?? null);
    const clash = await prisma.railAccount.findFirst({ where: { organizationId, railCode: rail.code, identifier } });
    if (clash) return res.status(409).json({ success: false, message: 'That account is already registered' });

    if (body.isPrimary) await prisma.railAccount.updateMany({ where: { organizationId, countryCode: countryCode || undefined }, data: { isPrimary: false } });

    const created = await prisma.railAccount.create({
      data: {
        organizationId,
        railCode: rail.code,
        countryCode: countryCode || rail.countries[0] || 'US',
        label: body.label,
        identifier,
        holderName: body.holderName || null,
        locationId: body.locationId || null,
        verification: check.valid ? 'VERIFIED' : 'FAILED',
        isValid: check.valid,
        validationNote: [check.reason, check.detail].filter(Boolean).join(': ') || null,
        isPrimary: Boolean(body.isPrimary) && check.valid,
        metadata: { kind: rail.identifierKind, normalized: check.normalized ?? null, checkedAt: new Date().toISOString() },
        status: check.valid ? 'ACTIVE' : 'INACTIVE',
      },
    });
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'RAIL_ACCOUNT_CREATED',
      resourceType: 'RAIL_ACCOUNT',
      resourceId: created.id,
      newValue: { railCode: rail.code, verification: created.verification, label: created.label },
    });
    // An invalid instrument is stored (so the operator can fix it) but never active.
    res.status(check.valid ? 201 : 422).json({ success: check.valid, data: { account: { ...created, identifier: maskIdentifier(identifier) }, validation: check } });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/rails/accounts/:id/primary - where refunds and payouts should go
router.put('/accounts/:id/primary', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const existing = await prisma.railAccount.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Rail account not found' });
    if (!existing.isValid) return res.status(409).json({ success: false, message: 'Fix the failed validation on this account before making it primary' });
    await prisma.railAccount.updateMany({ where: { organizationId, countryCode: existing.countryCode }, data: { isPrimary: false } });
    const updated = await prisma.railAccount.update({ where: { id: existing.id }, data: { isPrimary: true } });
    await createAuditEvent({ organizationId, actorId: req.user!.employeeId, action: 'RAIL_ACCOUNT_PRIMARY', resourceType: 'RAIL_ACCOUNT', resourceId: existing.id, newValue: { railCode: existing.railCode } });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/rails/accounts/:id
router.delete('/accounts/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const existing = await prisma.railAccount.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Rail account not found' });
    await prisma.railAccount.update({ where: { id: existing.id }, data: { status: 'INACTIVE', isPrimary: false } });
    await createAuditEvent({ organizationId, actorId: req.user!.employeeId, action: 'RAIL_ACCOUNT_RETIRED', resourceType: 'RAIL_ACCOUNT', resourceId: existing.id, previousValue: { status: existing.status } });
    res.json({ success: true, data: { id: existing.id, retired: true } });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Settlement batches ──────────────────────────────────────────────────────

const reconcileSchema = z.object({
  railCode: z.string().min(2).max(24),
  provider: z.string().max(60).optional(),
  batchDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  currency: z.string().max(3).optional(),
  tolerance: z.number().min(0).max(10_000).optional(),
  feeTolerance: z.number().min(0).max(10_000).optional(),
  /** Pull internal payments automatically for the statement window instead of pasting lines. */
  autoMatchFrom: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  autoMatchTo: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  lines: z
    .array(
      z.object({
        reference: z.string().max(120).optional().nullable(),
        externalReference: z.string().max(120).optional().nullable(),
        providerRef: z.string().max(120).optional().nullable(),
        amount: z.number(),
        fee: z.number().optional(),
        valueDate: z.string().optional().nullable(),
      })
    )
    .min(1, 'At least one statement line is required')
    .max(2000),
});

// POST /api/rails/settlements - import a statement and reconcile it
router.post('/settlements', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(reconcileSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof reconcileSchema>;
    const rail = railByCode(body.railCode);
    if (!rail) return res.status(400).json({ success: false, message: `Unknown rail ${body.railCode}` });
    const { countryCode, currency: orgCurrency } = await orgCountry(organizationId);
    const currency = (body.currency || orgCurrency).toUpperCase();
    if (!supportsCurrency(countryCode, currency)) {
      return res.status(400).json({ success: false, message: `${currency} cannot be settled through rails available in ${countryCode || 'this market'}` });
    }

    const providerLines: ProviderLine[] = body.lines.map((l) => ({
      externalReference: l.externalReference ?? l.reference ?? null,
      providerRef: l.providerRef ?? null,
      amount: Number(l.amount) || 0,
      fee: Number(l.fee ?? 0) || 0,
      valueDate: l.valueDate ?? null,
    }));

    const from = body.autoMatchFrom ? new Date(body.autoMatchFrom) : new Date(Math.min(...providerLines.map((l) => (l.valueDate ? new Date(l.valueDate).getTime() : Date.now()))));
    const to = body.autoMatchTo ? new Date(body.autoMatchTo) : new Date(Math.max(...providerLines.map((l) => (l.valueDate ? new Date(l.valueDate).getTime() : Date.now()))));
    const payments = await prisma.payment.findMany({
      where: { order: { organizationId }, status: { in: ['COMPLETED', 'CAPTURED', 'SETTLED', 'RECONCILED'] }, createdAt: { gte: from, lte: to } },
      select: { id: true, amount: true, reference: true, status: true, metadata: true, orderId: true },
      take: 5000,
    });
    const internal: InternalPayment[] = payments.map((p) => ({
      id: p.id,
      externalReference: p.reference,
      amount: Number(p.amount),
      fee: Number((p.metadata as { fee?: number } | null)?.fee ?? 0) || 0,
      orderId: p.orderId,
      status: p.status,
    }));

    const summary = reconcileBatch(providerLines, internal, { tolerance: body.tolerance, feeTolerance: body.feeTolerance });
    const health = batchHealth(summary);
    const detail = {
      matched: summary.matched,
      amountMismatch: summary.amountMismatch,
      feeMismatch: summary.feeMismatch,
      unmatchedProvider: summary.unmatchedProvider,
      duplicates: summary.duplicates,
      unmatchedInternal: summary.unmatchedInternal,
      unmatchedInternalIds: summary.unmatchedInternalIds,
      variance: summary.variance,
      matchRate: health.matchRate,
      healthLabel: health.label,
      window: { from: from.toISOString(), to: to.toISOString() },
    };
    const batch = await prisma.settlementBatch.create({
      data: {
        organizationId,
        railCode: rail.code,
        countryCode: countryCode || rail.countries[0] || 'US',
        provider: body.provider || 'MANUAL',
        batchDate: body.batchDate ? new Date(body.batchDate) : to,
        currency,
        grossAmount: summary.gross,
        feeAmount: summary.fees,
        expectedNet: summary.expectedNet,
        matchedNet: summary.matchedNet,
        variance: summary.variance,
        lineCount: summary.lineCount,
        matchedCount: summary.matched,
        status: summary.status === 'RECONCILED' ? 'RECONCILED' : 'DISCREPANCY',
        discrepancyDetail: detail,
      },
    });
    await prisma.settlementLine.createMany({
      data: summary.lines.map((l, index) => ({
        batchId: batch.id,
        organizationId,
        externalReference: l.externalReference,
        paymentId: l.paymentId,
        orderId: l.orderId,
        amount: l.amount,
        fee: l.fee,
        valueDate: providerLines[index]?.valueDate ? new Date(providerLines[index].valueDate as string) : null,
        status: l.status,
        note: l.note,
      })),
    });
    // Record which of our own payments the statement never settled, as a note on
    // the batch rather than by mutating the payment (the ledger stays append-only).
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'SETTLEMENT_BATCH_RECONCILED',
      resourceType: 'SETTLEMENT_BATCH',
      resourceId: batch.id,
      newValue: { railCode: rail.code, status: batch.status, matchRate: health.matchRate, variance: summary.variance, unmatchedInternal: summary.unmatchedInternal },
    });
    res.status(201).json({ success: true, data: { batch, summary, health, unmatchedInternalIds: summary.unmatchedInternalIds, byValueDate: groupBySettlementDate(providerLines).map((g) => ({ date: g.date, count: g.lines.length, gross: g.gross, fees: g.fees })) } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/rails/settlements - batches with their money position
router.get('/settlements', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const { status, railCode, limit = '50' } = req.query;
    const where: Record<string, unknown> = { organizationId };
    if (status) where.status = String(status);
    if (railCode) where.railCode = String(railCode).toUpperCase();
    const batches = await prisma.settlementBatch.findMany({ where, orderBy: { batchDate: 'desc' }, take: Math.min(200, Number(limit) || 50) });
    res.json({
      success: true,
      data: {
        batches,
        totals: {
          gross: Math.round(batches.reduce((a, b) => a + Number(b.grossAmount), 0) * 100) / 100,
          variance: Math.round(batches.reduce((a, b) => a + Number(b.variance), 0) * 100) / 100,
          open: batches.filter((b) => b.status === 'OPEN' || b.status === 'DISCREPANCY').length,
        },
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/rails/settlements/:id - one batch, its lines and float behaviour
router.get('/settlements/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const batch = await prisma.settlementBatch.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!batch) return res.status(404).json({ success: false, message: 'Settlement batch not found' });
    const [lines, discrepancy] = await Promise.all([
      prisma.settlementLine.findMany({ where: { batchId: batch.id, organizationId }, orderBy: { createdAt: 'asc' } }),
      prisma.settlementBatch.findMany({ where: { organizationId, status: 'SIGNED_OFF' }, select: { batchDate: true }, take: 100 }),
    ]);
    const rail = railByCode(batch.railCode);
    const promised = rail ? addBusinessDays(batch.batchDate, rail.settlementDays) : batch.batchDate;
    res.json({
      success: true,
      data: {
        batch,
        lines,
        rail,
        health: batchHealth({ gross: Number(batch.grossAmount), expectedNet: Number(batch.expectedNet), matchedNet: Number(batch.matchedNet) }),
        settlement: {
          promisedOn: promised,
          floatDays: floatDays(batch.createdAt, promised),
          instant: rail?.instant ?? false,
          reversible: rail?.reversible ?? false,
        },
        previouslySignedOff: discrepancy.length,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/rails/settlements/:id/sign-off - accept the variance and close it
router.post('/settlements/:id/sign-off', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const batch = await prisma.settlementBatch.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!batch) return res.status(404).json({ success: false, message: 'Settlement batch not found' });
    if (batch.status === 'SIGNED_OFF') return res.status(409).json({ success: false, message: 'This batch is already signed off' });
    const note = String(req.body?.note || '').slice(0, 500) || null;
    const updated = await prisma.settlementBatch.update({
      where: { id: batch.id },
      data: { status: 'SIGNED_OFF', signedOffBy: req.user!.id, signedOffAt: new Date(), discrepancyDetail: { ...((batch.discrepancyDetail as Record<string, unknown> | null) || {}), signOffNote: note } },
    });
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'SETTLEMENT_BATCH_SIGNED_OFF',
      resourceType: 'SETTLEMENT_BATCH',
      resourceId: batch.id,
      previousValue: { status: batch.status, variance: Number(batch.variance) },
      newValue: { status: 'SIGNED_OFF', note },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
