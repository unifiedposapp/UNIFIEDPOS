import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';

const router = Router();

// All notification endpoints require an authenticated user.
router.use(authMiddleware);

const createSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
  userId: z.string().optional(),
  data: z.record(z.any()).optional(),
});

const preferenceSchema = z.object({
  email: z.boolean().optional(),
  sms: z.boolean().optional(),
  push: z.boolean().optional(),
  inApp: z.boolean().optional(),
  lowStock: z.boolean().optional(),
  paymentIssues: z.boolean().optional(),
  marketing: z.boolean().optional(),
});

// Scope: org-wide broadcasts (userId = null) plus this user's own notifications.
function scopeWhere(req: AuthRequest) {
  const orgId = req.user!.organizationId!;
  const userId = req.user!.id;
  return {
    organizationId: orgId,
    OR: [{ userId: null }, { userId }],
  };
}

// GET /api/notifications?unread=true&type=LOW_STOCK&page=1&pageSize=20
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const unread = req.query.unread === 'true';
    const type = req.query.type as string | undefined;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));

    const where: any = { ...scopeWhere(req) };
    if (unread) where.isRead = false;
    if (type) where.type = type;

    const [items, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { ...scopeWhere(req), isRead: false } }),
    ]);

    res.json({
      success: true,
      data: { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize), unreadCount },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/notifications/unread-count
router.get('/unread-count', async (req: AuthRequest, res: Response) => {
  try {
    const count = await prisma.notification.count({
      where: { ...scopeWhere(req), isRead: false },
    });
    res.json({ success: true, data: { count } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/notifications/preferences
router.get('/preferences', async (req: AuthRequest, res: Response) => {
  try {
    const prefs = await prisma.notificationPreference.findUnique({
      where: { userId: req.user!.id },
    });
    res.json({
      success: true,
      data: prefs || {
        userId: req.user!.id,
        email: true, sms: false, push: true, inApp: true,
        lowStock: true, paymentIssues: true, marketing: true,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/notifications/preferences
router.put('/preferences', validateRequest(preferenceSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const userId = req.user!.id;
    const prefs = await prisma.notificationPreference.upsert({
      where: { userId },
      create: { organizationId: orgId, userId, ...req.body },
      update: req.body,
    });
    res.json({ success: true, data: prefs });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/notifications — manually create a notification (managers+)
router.post('/', requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(createSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { type, title, message, severity, userId, data } = req.body;
    const notification = await prisma.notification.create({
      data: {
        organizationId: req.user!.organizationId!,
        userId: userId || null,
        type,
        title,
        message,
        severity: severity || 'INFO',
        data: data || undefined,
      },
    });
    res.status(201).json({ success: true, data: notification });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/notifications/:id/read
router.post('/:id/read', async (req: AuthRequest, res: Response) => {
  try {
    const notification = await prisma.notification.findFirst({
      where: { id: String(req.params.id), ...scopeWhere(req) },
    });
    if (!notification) {
      res.status(404).json({ success: false, error: 'Notification not found' });
      return;
    }
    const updated = await prisma.notification.update({
      where: { id: notification.id },
      data: { isRead: true, readAt: new Date() },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/notifications/read-all
router.post('/read-all', async (req: AuthRequest, res: Response) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { ...scopeWhere(req), isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    res.json({ success: true, data: { updated: result.count } });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/notifications/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const notification = await prisma.notification.findFirst({
      where: { id: String(req.params.id), ...scopeWhere(req) },
    });
    if (!notification) {
      res.status(404).json({ success: false, error: 'Notification not found' });
      return;
    }
    await prisma.notification.delete({ where: { id: notification.id } });
    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
