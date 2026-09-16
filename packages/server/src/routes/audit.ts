import { Router, Response } from 'express';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';

const router = Router();

// GET /api/audit
router.get('/', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const { action, resourceType, page = '1', pageSize = '50' } = req.query;
    const where: any = { organizationId: req.user!.organizationId };
    if (action) where.action = String(action);
    if (resourceType) where.resourceType = String(resourceType);

    const skip = (Number(page) - 1) * Number(pageSize);
    const [events, total] = await Promise.all([
      prisma.auditEvent.findMany({ where, include: { actor: { select: { id: true, user: { select: { name: true, email: true } } } } }, orderBy: { createdAt: 'desc' }, skip, take: Number(pageSize) }),
      prisma.auditEvent.count({ where }),
    ]);

    res.json({ success: true, data: { items: events, total, page: Number(page), pageSize: Number(pageSize) } });
  } catch (error) { handleError(error, res); }
});

export default router;
