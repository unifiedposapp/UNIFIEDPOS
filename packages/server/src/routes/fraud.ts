// ─── §37 Fraud alert management ──────────────────────────────────────────────
// Read/resolve the FraudAlerts raised by services/fraud.ts during payment
// authorisation. Alerts are created automatically; this router is the ops queue.

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';

const router = Router();

// GET /api/fraud - list alerts (filter by status/rule/severity)
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { status, rule, severity, limit = '50' } = req.query;
    const where: any = { organizationId: orgId };
    if (status) where.status = String(status);
    if (rule) where.rule = String(rule);
    if (severity) where.severity = String(severity);
    const alerts = await prisma.fraudAlert.findMany({ where, orderBy: { createdAt: 'desc' }, take: Number(limit) });
    res.json({ success: true, data: alerts });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/fraud/stats - queue counts by status/severity/rule (before /:id)
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const [byStatus, bySeverity, byRule, open] = await Promise.all([
      prisma.fraudAlert.groupBy({ by: ['status'], where: { organizationId: orgId }, _count: { _all: true } }),
      prisma.fraudAlert.groupBy({ by: ['severity'], where: { organizationId: orgId }, _count: { _all: true } }),
      prisma.fraudAlert.groupBy({ by: ['rule'], where: { organizationId: orgId }, _count: { _all: true } }),
      prisma.fraudAlert.count({ where: { organizationId: orgId, status: { in: ['OPEN', 'REVIEWING'] } } }),
    ]);
    const toMap = (rows: { [k: string]: any; _count: { _all: number } }[], key: string) =>
      rows.reduce<Record<string, number>>((acc, r) => {
        acc[String(r[key])] = r._count._all;
        return acc;
      }, {});
    res.json({
      success: true,
      data: { open, byStatus: toMap(byStatus as any, 'status'), bySeverity: toMap(bySeverity as any, 'severity'), byRule: toMap(byRule as any, 'rule') },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/fraud/:id
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const alert = await prisma.fraudAlert.findFirst({
      where: { id: String(req.params.id), organizationId: req.user!.organizationId! },
    });
    if (!alert) return res.status(404).json({ success: false, message: 'Fraud alert not found' });
    res.json({ success: true, data: alert });
  } catch (error) {
    handleError(error, res);
  }
});

const statusSchema = z.object({
  status: z.enum(['REVIEWING', 'RESOLVED', 'DISMISSED']),
  note: z.string().optional(),
});

// PUT /api/fraud/:id/status - move an alert through the review lifecycle
router.put('/:id/status', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(statusSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const existing = await prisma.fraudAlert.findFirst({ where: { id: String(req.params.id), organizationId: orgId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Fraud alert not found' });
    const closed = req.body.status === 'RESOLVED' || req.body.status === 'DISMISSED';
    const updated = await prisma.fraudAlert.update({
      where: { id: existing.id },
      data: {
        status: req.body.status,
        resolvedAt: closed ? new Date() : null,
        resolvedBy: closed ? req.user!.id : null,
        metadata: req.body.note ? { ...(existing.metadata as any || {}), resolutionNote: req.body.note } : existing.metadata as any,
      },
    });
    await createAuditEvent({ organizationId: orgId, actorId: req.user!.employeeId, action: 'FRAUD_ALERT_UPDATED', resourceType: 'FRAUD_ALERT', resourceId: existing.id, previousValue: { status: existing.status }, newValue: { status: req.body.status, note: req.body.note } });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
