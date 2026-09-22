// ─── Fiscalization: per-country signed receipts and e-invoicing ──────────────
// The legal spine of a global POS. Every completed sale is sealed into a hash
// chain (Germany TSE, France anti-fraud TVA, Italy SdI, Saudi ZATCA phase-2,
// Kenya eTIMS …) so a merchant can prove to an auditor that nothing was edited
// and nothing is missing. Transmission to a government bridge is env-gated and
// simulated unless FISCAL_BRIDGE_URL is configured.

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { encryptText } from '../services/crypto.js';
import {
  FISCAL_PROFILES,
  DEFAULT_FISCAL_PROFILE,
  fiscalProfileFor,
  fiscalProfileByCode,
  fiscalCoverage,
  isKnownFiscalCountry,
} from '../data/fiscalProfiles.js';
import { TAX_PROFILES, taxProfileFor, taxProfilesByRegion, taxCoverage, suggestedTaxRateFor } from '../data/taxProfiles.js';
import { COMPLIANCE_PROFILES, complianceFor, complianceProfilesByRegion, complianceCoverage, isKnownComplianceCountry } from '../data/complianceProfiles.js';
import {
  SEAL_ALGORITHM,
  MAX_TRANSMIT_ATTEMPTS,
  fiscalSalt,
  sealOrder,
  transmitPendingBatch,
  verifyFiscalChain,
  verifyFiscalSeal,
  findSequenceGaps,
  retentionUntil,
  isFiscalBridgeConfigured,
  decodeTlv,
  latestChainLink,
  formatReceiptNumber,
} from '../services/fiscalization.js';

const router = Router();

async function orgContext(organizationId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { countryCode: true, country: true, currency: true, name: true } });
  const countryCode = org?.countryCode || null;
  return { org, countryCode, currency: String(org?.currency || 'USD').toUpperCase(), profile: fiscalProfileFor(countryCode) };
}

// GET /api/fiscal/profiles - the regime catalogue plus this tenant's own profile
router.get('/profiles', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { countryCode, profile } = await orgContext(req.user!.organizationId!);
    res.json({
      success: true,
      data: {
        active: { countryCode, profile },
        knownCountry: isKnownFiscalCountry(countryCode),
        coverage: fiscalCoverage(),
        profiles: FISCAL_PROFILES,
        defaultProfile: DEFAULT_FISCAL_PROFILE,
        algorithm: SEAL_ALGORITHM,
        bridgeConfigured: isFiscalBridgeConfigured(),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/fiscal/tax-profiles - country consumption-tax rate reference + this tenant's default
router.get('/tax-profiles', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { countryCode } = await orgContext(req.user!.organizationId!);
    res.json({
      success: true,
      data: {
        active: { countryCode, profile: taxProfileFor(countryCode), suggestedRate: suggestedTaxRateFor(countryCode) },
        coverage: taxCoverage(),
        byRegion: taxProfilesByRegion(),
        profiles: TAX_PROFILES,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/fiscal/compliance - country privacy / data-residency / e-invoice guidance
router.get('/compliance', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { countryCode } = await orgContext(req.user!.organizationId!);
    res.json({
      success: true,
      data: {
        active: { countryCode, profile: complianceFor(countryCode) },
        knownCountry: isKnownComplianceCountry(countryCode),
        coverage: complianceCoverage(),
        byRegion: complianceProfilesByRegion(),
        profiles: COMPLIANCE_PROFILES,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/fiscal/status - one glanceable compliance picture for this tenant
router.get('/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const { countryCode, profile } = await orgContext(organizationId);
    const [devices, byStatus, last, prevHash] = await Promise.all([
      prisma.fiscalDevice.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } }),
      prisma.fiscalDocument.groupBy({ by: ['status'], where: { organizationId }, _count: { _all: true } }),
      prisma.fiscalDocument.findFirst({ where: { organizationId }, orderBy: { sequenceNumber: 'desc' }, select: { receiptNumber: true, sealedAt: true, profileCode: true, sequenceNumber: true } }),
      latestChainLink(organizationId, profile.code),
    ]);
    const counts: Record<string, number> = {};
    for (const row of byStatus) counts[String(row.status)] = row._count._all;
    const totals = Object.values(counts).reduce((a, b) => a + b, 0);
    res.json({
      success: true,
      data: {
        countryCode,
        profile,
        bridgeConfigured: isFiscalBridgeConfigured(),
        sealRequired: profile.requiresSeal,
        deviceRequired: profile.requiresDevice,
        deviceReady: !profile.requiresDevice || devices.some((d) => d.status === 'ACTIVE' && d.profileCode === profile.code),
        devices: devices.map((d) => ({ id: d.id, profileCode: d.profileCode, serialNumber: d.serialNumber, status: d.status, lastSequence: d.lastSequence, lastSignedAt: d.lastSignedAt, locationId: d.locationId })),
        documents: { total: totals, byStatus: counts, lastSealed: last, headHash: prevHash },
        maxAttempts: MAX_TRANSMIT_ATTEMPTS,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

const deviceSchema = z.object({
  profileCode: z.string().min(2).max(24),
  serialNumber: z.string().min(3).max(120),
  activationCode: z.string().max(500).optional(),
  publicKeyRef: z.string().max(500).optional(),
  locationId: z.string().optional().nullable(),
});

// GET /api/fiscal/devices - registrations this tenant holds (secrets never returned)
router.get('/devices', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const devices = await prisma.fiscalDevice.findMany({
      where: { organizationId: req.user!.organizationId! },
      orderBy: { createdAt: 'asc' },
    });
    res.json({
      success: true,
      data: devices.map((d) => ({
        id: d.id,
        profileCode: d.profileCode,
        serialNumber: d.serialNumber,
        status: d.status,
        locationId: d.locationId,
        lastSequence: d.lastSequence,
        lastSignedAt: d.lastSignedAt,
        hasActivationCode: Boolean(d.activationCode),
        publicKeyRef: d.publicKeyRef,
        createdAt: d.createdAt,
      })),
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/fiscal/devices - register a fiscal device / certificate
router.post('/devices', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(deviceSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const profile = fiscalProfileByCode(req.body.profileCode);
    if (!profile) return res.status(400).json({ success: false, message: `Unknown fiscal profile ${req.body.profileCode}` });
    const clash = await prisma.fiscalDevice.findFirst({ where: { organizationId, serialNumber: req.body.serialNumber } });
    if (clash) return res.status(409).json({ success: false, message: 'A device with that serial is already registered' });

    const created = await prisma.fiscalDevice.create({
      data: {
        organizationId,
        profileCode: profile.code,
        serialNumber: req.body.serialNumber,
        locationId: req.body.locationId || null,
        // The activation code / certificate passphrase is a state secret: at rest.
        activationCode: req.body.activationCode ? encryptText(req.body.activationCode) : null,
        publicKeyRef: req.body.publicKeyRef || null,
      },
    });
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'FISCAL_DEVICE_REGISTERED',
      resourceType: 'FISCAL_DEVICE',
      resourceId: created.id,
      newValue: { profileCode: profile.code, serialNumber: created.serialNumber },
    });
    res.status(201).json({ success: true, data: created });
  } catch (error) {
    handleError(error, res);
  }
});

const deviceStatusSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'RETIRED']) });

// PUT /api/fiscal/devices/:id/status - suspend or re-activate a device
router.put('/devices/:id/status', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(deviceStatusSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const existing = await prisma.fiscalDevice.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Fiscal device not found' });
    const updated = await prisma.fiscalDevice.update({ where: { id: existing.id }, data: { status: req.body.status } });
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'FISCAL_DEVICE_UPDATED',
      resourceType: 'FISCAL_DEVICE',
      resourceId: existing.id,
      previousValue: { status: existing.status },
      newValue: { status: updated.status },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/fiscal/devices/:id - retire without erasing history
router.delete('/devices/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const existing = await prisma.fiscalDevice.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Fiscal device not found' });
    // Sealed documents must keep pointing at something explainable, so a device
    // is retired rather than deleted.
    const updated = await prisma.fiscalDevice.update({ where: { id: existing.id }, data: { status: 'RETIRED' } });
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'FISCAL_DEVICE_RETIRED',
      resourceType: 'FISCAL_DEVICE',
      resourceId: existing.id,
      previousValue: { status: existing.status },
      newValue: { status: updated.status },
    });
    res.json({ success: true, data: { id: existing.id, retired: true } });
  } catch (error) {
    handleError(error, res);
  }
});

const sealSchema = z.object({
  orderId: z.string().optional(),
  orderNumber: z.string().optional(),
  receiptNumber: z.string().max(64).optional(),
  documentType: z.enum(['RECEIPT', 'INVOICE', 'CREDIT_NOTE']).optional(),
  total: z.number().optional(),
  vatTotal: z.number().optional(),
  paymentMethod: z.string().max(40).optional(),
  locationId: z.string().optional().nullable(),
});

// POST /api/fiscal/seal - seal a completed sale onto the chain (idempotent)
router.post('/seal', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER', 'CASHIER'), validateRequest(sealSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const { countryCode, currency, profile } = await orgContext(organizationId);
    const body = req.body as z.infer<typeof sealSchema>;

    let order = null;
    if (body.orderId || body.orderNumber) {
      order = await prisma.order.findFirst({
        where: { organizationId, ...(body.orderId ? { id: body.orderId } : { orderNumber: String(body.orderNumber) }) },
        include: { payments: { where: { status: { in: ['COMPLETED', 'CAPTURED', 'SETTLED'] } }, select: { method: true, amount: true } } },
      });
      if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const total = Number(body.total ?? order?.totalAmount ?? 0);
    const vatTotal = Number(body.vatTotal ?? order?.taxAmount ?? 0);
    if (!Number.isFinite(total) || total <= 0) return res.status(400).json({ success: false, message: 'Nothing to seal: this document has no value' });

    const receiptNumber =
      body.receiptNumber ||
      order?.orderNumber ||
      formatReceiptNumber(profile.code.slice(0, 2), (await prisma.fiscalDocument.count({ where: { organizationId, profileCode: profile.code } })) + 1);

    const sealed = await sealOrder({
      organizationId,
      countryCode,
      locationId: body.locationId || order?.locationId || null,
      orderId: order?.id || null,
      receiptNumber,
      documentType: body.documentType || 'RECEIPT',
      total,
      vatTotal,
      currency: String(order?.currency || currency),
      paymentMethod: body.paymentMethod || order?.payments?.[0]?.method || null,
      cashierId: order?.employeeId || req.user!.employeeId || null,
    });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: sealed.recreated ? 'FISCAL_DOCUMENT_RESEALED' : 'FISCAL_DOCUMENT_SEALED',
      resourceType: 'FISCAL_DOCUMENT',
      resourceId: sealed.document.id,
      newValue: { receiptNumber, profileCode: profile.code, total, sequence: sealed.document.sequenceNumber },
    });
    res.status(sealed.recreated ? 200 : 201).json({ success: true, data: { document: sealed.document, profile, recreated: sealed.recreated } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/fiscal/documents - the chain, newest first
router.get('/documents', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const { status, profileCode, receiptNumber, from, to, limit = '50', offset = '0' } = req.query;
    const where: Record<string, unknown> = { organizationId };
    if (status) where.status = String(status);
    if (profileCode) where.profileCode = String(profileCode).toUpperCase();
    if (receiptNumber) where.receiptNumber = { contains: String(receiptNumber) };
    if (from || to) where.sealedAt = { ...(from ? { gte: new Date(String(from)) } : {}), ...(to ? { lte: new Date(String(to)) } : {}) };
    const take = Math.min(200, Math.max(1, Number(limit) || 50));
    const skip = Math.max(0, Number(offset) || 0);
    const [documents, total] = await Promise.all([
      prisma.fiscalDocument.findMany({ where, orderBy: { sequenceNumber: 'desc' }, take, skip }),
      prisma.fiscalDocument.count({ where }),
    ]);
    res.json({ success: true, data: { documents, total, take, skip } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/fiscal/documents/:id - one document, its seal re-verified and QR decoded
router.get('/documents/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const document = await prisma.fiscalDocument.findFirst({
      where: { id: String(req.params.id), organizationId: req.user!.organizationId! },
    });
    if (!document) return res.status(404).json({ success: false, message: 'Fiscal document not found' });
    const salt = fiscalSalt();
    const previous = document.sequenceNumber > 1
      ? await prisma.fiscalDocument.findFirst({
          where: { organizationId: document.organizationId, profileCode: document.profileCode, sequenceNumber: document.sequenceNumber - 1 },
          select: { signedHash: true, receiptNumber: true },
        })
      : null;
    res.json({
      success: true,
      data: {
        document,
        sealValid: verifyFiscalSeal(document, salt),
        linkValid: (document.previousHash || null) === (previous?.signedHash || null),
        previousReceipt: previous?.receiptNumber || null,
        qrFields: document.qrPayload ? decodeTlv(document.qrPayload) : [],
        retentionUntil: retentionUntil(document.sealedAt, fiscalProfileByCode(document.profileCode)?.retentionYears || DEFAULT_FISCAL_PROFILE.retentionYears),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/fiscal/chain/verify - walk the chain and report every break
router.get('/chain/verify', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const { profile: ownProfile } = await orgContext(organizationId);
    const requested = req.query.profileCode ? String(req.query.profileCode).toUpperCase() : ownProfile.code;
    const docs = await prisma.fiscalDocument.findMany({
      where: { organizationId, profileCode: requested },
      orderBy: { sequenceNumber: 'asc' },
      take: Math.min(20_000, Math.max(1, Number(req.query.limit) || 5000)),
      select: { receiptNumber: true, payloadHash: true, previousHash: true, signedHash: true, sequenceNumber: true },
    });
    const check = verifyFiscalChain(
      docs.map((d) => ({ receiptNumber: d.receiptNumber, payloadHash: d.payloadHash, previousHash: d.previousHash, signedHash: d.signedHash })),
      fiscalSalt()
    );
    const gaps = findSequenceGaps(docs.map((d) => d.sequenceNumber));
    res.json({
      success: true,
      data: {
        profileCode: requested,
        ...check,
        sequenceGaps: gaps,
        contiguous: gaps.length === 0,
        firstReceipt: docs[0]?.receiptNumber || null,
        lastReceipt: docs[docs.length - 1]?.receiptNumber || null,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/fiscal/transmit - flush the outbound queue now
router.post('/transmit', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const limit = Math.min(200, Math.max(1, Number(req.body?.limit) || 25));
    const processed = await transmitPendingBatch(limit);
    const remaining = await prisma.fiscalDocument.count({
      where: { organizationId, status: { in: ['SEALED', 'PENDING', 'FAILED'] }, attempts: { lt: MAX_TRANSMIT_ATTEMPTS } },
    });
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'FISCAL_TRANSMIT_RUN',
      resourceType: 'FISCAL_DOCUMENT',
      newValue: { processed, remaining, simulated: !isFiscalBridgeConfigured() },
    });
    res.json({ success: true, data: { processed, remaining, simulated: !isFiscalBridgeConfigured() } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/fiscal/retention - what may legally be purged, and what may not
router.get('/retention', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const groups = await prisma.fiscalDocument.groupBy({
      by: ['profileCode'],
      where: { organizationId },
      _count: { _all: true },
      _min: { sealedAt: true },
      _max: { sealedAt: true },
    });
    const now = new Date();
    const rows = groups.map((g) => {
      const profile = fiscalProfileByCode(g.profileCode) || DEFAULT_FISCAL_PROFILE;
      const oldest = g._min.sealedAt || now;
      const eligibleAt = retentionUntil(oldest, profile.retentionYears);
      return {
        profileCode: profile.code,
        country: profile.country,
        regime: profile.regime,
        retentionYears: profile.retentionYears,
        documents: g._count._all,
        oldestSealedAt: oldest,
        eligibleForPurgeAt: eligibleAt,
        purgeEligible: now >= eligibleAt,
      };
    });
    res.json({ success: true, data: { now, profiles: rows, legalHoldNote: 'Fiscal documents are never removed by the retention job while a legal hold is set.' } });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
