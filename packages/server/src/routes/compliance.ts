import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import {
  COMPLIANCE_CHECKLIST, COMPLIANCE_DOMAINS, DOMAIN_LABELS, STATUS_LABELS,
  complianceByDomain, COMPLIANCE_STATS, CONSENT_PURPOSES,
} from '../data/complianceCatalog.js';
import { ROPA_REGISTER } from '../data/ropaRegister.js';
import { createAuditEvent } from '../services/audit.js';

const router = Router();

const DEFAULT_CONSENT = {
  necessary: true,
  functional: false,
  analytics: false,
  marketing: false,
  thirdPartySharing: false,
};

const consentSchema = z.object({
  type: z.enum(['CONSENT', 'COOKIE']).optional(),
  necessary: z.boolean().optional(),
  functional: z.boolean().optional(),
  analytics: z.boolean().optional(),
  marketing: z.boolean().optional(),
  thirdPartySharing: z.boolean().optional(),
  source: z.string().max(64).optional(),
});

const deletionSchema = z.object({
  reason: z.string().max(500).optional().nullable(),
});

const retentionSchema = z.object({
  dataRetentionDays: z.number().int().min(1).max(3650).nullable().optional(),
  legalHold: z.boolean().optional(),
});

const breachSchema = z.object({
  title: z.string().min(1),
  description: z.string().max(2000).optional().nullable(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  affectedRecords: z.number().int().min(0).optional(),
});

const breachNotifySchema = z.object({
  regulator: z.boolean().optional(),
  individuals: z.boolean().optional(),
  note: z.string().max(500).optional(),
});

// GET /api/compliance/checklist — the regulation catalog + consent purposes.
router.get('/checklist', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    res.json({
      success: true,
      data: {
        domains: COMPLIANCE_DOMAINS.map((d) => ({ id: d, label: DOMAIN_LABELS[d] || d })),
        statusLabels: STATUS_LABELS,
        groups: complianceByDomain(),
        items: COMPLIANCE_CHECKLIST,
        purposes: CONSENT_PURPOSES,
        stats: COMPLIANCE_STATS,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/compliance/consent — latest stored consent for this organization.
router.get('/consent', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const rec = await prisma.complianceRecord.findFirst({
      where: { organizationId: orgId, type: { in: ['CONSENT', 'COOKIE'] } },
      orderBy: { createdAt: 'desc' },
    });
    const payload =
      rec?.payload && typeof rec.payload === 'object' && !Array.isArray(rec.payload)
        ? (rec.payload as Record<string, unknown>)
        : null;
    res.json({
      success: true,
      data: {
        consent: payload ? { ...DEFAULT_CONSENT, ...payload } : DEFAULT_CONSENT,
        hasConsent: !!rec,
        updatedAt: rec?.createdAt || null,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/compliance/consent — record consent (banner or Compliance Center).
router.post('/consent', authMiddleware, validateRequest(consentSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { type = 'CONSENT', source, ...prefs } = req.body;
    const payload = {
      ...DEFAULT_CONSENT,
      ...prefs,
      necessary: true, // strictly-necessary processing is always on
      source: source || 'app',
      recordedBy: req.user!.email,
      recordedAt: new Date().toISOString(),
    };
    const rec = await prisma.complianceRecord.create({
      data: { organizationId: orgId, userId: req.user!.id, type, status: 'FULFILLED', payload: payload as any },
    });
    res.status(201).json({ success: true, data: rec });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/compliance/requests — consent + DSAR history (OWNER/ADMIN).
router.get('/requests', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const records = await prisma.complianceRecord.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ success: true, data: records });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/compliance/export — DSAR "access/portability" export (OWNER/ADMIN).
router.post('/export', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const [organization, settings, customers, integrations, activity, customerCount, paymentCount, integrationCount] =
      await Promise.all([
        prisma.organization.findUnique({ where: { id: orgId } }),
        prisma.storeSettings.findUnique({ where: { organizationId: orgId } }),
        prisma.customerProfile.findMany({ where: { organizationId: orgId }, take: 1000 }),
        prisma.integrationConnection.findMany({ where: { organizationId: orgId } }),
        prisma.auditEvent.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 200 }),
        prisma.customerProfile.count({ where: { organizationId: orgId } }),
        prisma.paymentTransaction.count({ where: { organizationId: orgId } }),
        prisma.integrationConnection.count({ where: { organizationId: orgId } }),
      ]);

    // Redact secrets and heavy base64 blobs before exporting.
    const mediaMeta =
      settings && Array.isArray((settings as any).media)
        ? ((settings as any).media as any[]).map((m) => ({ id: m?.id, name: m?.name, type: m?.type, size: m?.size }))
        : [];
    const safeSettings = settings
      ? { ...settings, logoUrl: settings.logoUrl ? '[image]' : null, faviconUrl: settings.faviconUrl ? '[image]' : null, coverUrl: settings.coverUrl ? '[image]' : null, media: mediaMeta }
      : null;
    const safeIntegrations = integrations.map((i) => ({
      id: i.id, provider: i.provider, name: i.name, type: i.type, status: i.status, lastSyncAt: i.lastSyncAt,
    }));
    const safeActivity = activity.map((a) => ({
      id: a.id, action: a.action, resourceType: a.resourceType, resourceId: a.resourceId, createdAt: a.createdAt,
    }));

    const counts = {
      customers: customerCount,
      payments: paymentCount,
      integrations: integrationCount,
      auditEvents: activity.length,
    };
    const bundle = {
      exportedAt: new Date().toISOString(),
      requestedBy: req.user!.email,
      organization,
      storeSettings: safeSettings,
      counts,
      customers,
      integrations: safeIntegrations,
      recentActivity: safeActivity,
    };

    await prisma.complianceRecord.create({
      data: {
        organizationId: orgId,
        userId: req.user!.id,
        type: 'DSAR_EXPORT',
        status: 'FULFILLED',
        payload: { requestedBy: req.user!.email, counts } as any,
      },
    });

    res.json({ success: true, data: bundle });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/compliance/deletion-request — DSAR "right to erasure" (OWNER only).
// Records the request; actual erasure is a governed, out-of-band operation.
router.post(
  '/deletion-request',
  authMiddleware,
  requireRole('OWNER'),
  validateRequest(deletionSchema),
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.user!.organizationId!;
      const rec = await prisma.complianceRecord.create({
        data: {
          organizationId: orgId,
          userId: req.user!.id,
          type: 'DSAR_DELETE',
          status: 'RECEIVED',
          payload: { reason: req.body?.reason || null, requestedBy: req.user!.email, at: new Date().toISOString() } as any,
        },
      });
      res.status(201).json({ success: true, data: rec });
    } catch (error) {
      handleError(error, res);
    }
  }
);

// ── Data retention & legal hold (§37 / DATA_GOVERNANCE) ─────────────────────
router.get('/retention', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const settings = await prisma.storeSettings.findUnique({ where: { organizationId: orgId } });
    res.json({ success: true, data: { dataRetentionDays: settings?.dataRetentionDays ?? null, legalHold: settings?.legalHold ?? false } });
  } catch (error) {
    handleError(error, res);
  }
});

router.put('/retention', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(retentionSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { dataRetentionDays, legalHold } = req.body;
    const settings = await prisma.storeSettings.upsert({
      where: { organizationId: orgId },
      update: {
        ...(dataRetentionDays !== undefined ? { dataRetentionDays } : {}),
        ...(legalHold !== undefined ? { legalHold } : {}),
      },
      create: { organizationId: orgId, storeName: 'Default', dataRetentionDays: dataRetentionDays ?? null, legalHold: legalHold ?? false },
    });
    await createAuditEvent({ organizationId: orgId, actorId: req.user!.employeeId, action: 'RETENTION_POLICY_UPDATED', resourceType: 'COMPLIANCE', newValue: { dataRetentionDays: settings.dataRetentionDays, legalHold: settings.legalHold } });
    res.json({ success: true, data: { dataRetentionDays: settings.dataRetentionDays, legalHold: settings.legalHold } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/compliance/purge — apply the retention policy (OWNER only).
router.post('/purge', authMiddleware, requireRole('OWNER'), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const settings = await prisma.storeSettings.findUnique({ where: { organizationId: orgId } });
    if (settings?.legalHold) {
      res.status(409).json({ success: false, error: 'Purge blocked: a legal hold is active' });
      return;
    }
    if (!settings?.dataRetentionDays) {
      res.status(400).json({ success: false, error: 'No retention policy configured' });
      return;
    }
    const cutoff = new Date(Date.now() - settings.dataRetentionDays * 24 * 60 * 60 * 1000);
    const purged = await prisma.customerProfile.deleteMany({ where: { organizationId: orgId, createdAt: { lt: cutoff } } });
    await prisma.complianceRecord.create({
      data: { organizationId: orgId, userId: req.user!.id, type: 'RETENTION_PURGE', status: 'FULFILLED', payload: { cutoff: cutoff.toISOString(), deleted: purged.count } as any },
    });
    res.json({ success: true, data: { deleted: purged.count, cutoff: cutoff.toISOString() } });
  } catch (error) {
    handleError(error, res);
  }
});

// ── Breach register & notification (§37 / SECURITY_BREACH) ──────────────────
router.get('/breaches', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const incidents = await prisma.breachIncident.findMany({ where: { organizationId: req.user!.organizationId! }, orderBy: { detectedAt: 'desc' } });
    res.json({ success: true, data: incidents });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/breaches', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(breachSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const incident = await prisma.breachIncident.create({
      data: { organizationId: orgId, title: req.body.title, description: req.body.description ?? null, severity: req.body.severity ?? 'MEDIUM', affectedRecords: req.body.affectedRecords ?? 0 },
    });
    await createAuditEvent({ organizationId: orgId, actorId: req.user!.employeeId, action: 'BREACH_DETECTED', resourceType: 'BREACH', resourceId: incident.id, newValue: { title: incident.title, severity: incident.severity } });
    res.status(201).json({ success: true, data: incident });
  } catch (error) {
    handleError(error, res);
  }
});

router.put('/breaches/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const { status, severity, affectedRecords, description } = req.body || {};
    const incident = await prisma.breachIncident.update({
      where: { id },
      data: {
        ...(status ? { status, ...(status === 'ASSESSED' ? { assessedAt: new Date() } : {}) } : {}),
        ...(severity ? { severity } : {}),
        ...(affectedRecords !== undefined ? { affectedRecords } : {}),
        ...(description !== undefined ? { description } : {}),
      },
    });
    res.json({ success: true, data: incident });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/breaches/:id/notify', authMiddleware, requireRole('OWNER'), validateRequest(breachNotifySchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const id = String(req.params.id);
    const now = new Date();
    const incident = await prisma.breachIncident.update({
      where: { id },
      data: {
        status: 'NOTIFIED',
        assessedAt: now,
        ...(req.body.regulator ? { regulatorNotifiedAt: now } : {}),
        ...(req.body.individuals ? { individualsNotifiedAt: now } : {}),
      },
    });
    await prisma.complianceRecord.create({
      data: { organizationId: orgId, userId: req.user!.id, type: 'BREACH_NOTIFICATION', status: 'FULFILLED', payload: { incidentId: id, regulator: !!req.body.regulator, individuals: !!req.body.individuals, note: req.body.note ?? null, at: now.toISOString() } as any },
    });
    await createAuditEvent({ organizationId: orgId, actorId: req.user!.employeeId, action: 'BREACH_NOTIFIED', resourceType: 'BREACH', resourceId: id, newValue: { regulator: !!req.body.regulator, individuals: !!req.body.individuals } });
    res.json({ success: true, data: incident });
  } catch (error) {
    handleError(error, res);
  }
});

// ── Record of Processing Activities (GDPR Art. 30) ──────────────────────────
router.get('/ropa', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, data: ROPA_REGISTER });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
