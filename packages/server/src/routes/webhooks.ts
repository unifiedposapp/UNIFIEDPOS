import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';

const router = Router();

const webhookSchema = z.object({
  url: z.string().url(),
  secret: z.string().min(8),
  events: z.array(z.string()).min(1),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});

// GET /api/webhooks - List all webhooks for organization
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const webhooks = await prisma.webhook.findMany({
      where: { organizationId: req.user!.organizationId! },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: webhooks });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/webhooks - Create webhook
router.post('/', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(webhookSchema), async (req: AuthRequest, res: Response) => {
  try {
    const webhook = await prisma.webhook.create({
      data: { ...req.body, organizationId: req.user!.organizationId! },
    });
    res.status(201).json({ success: true, data: webhook });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/webhooks/:id - Update webhook
router.put('/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(webhookSchema.partial()), async (req: AuthRequest, res: Response) => {
  try {
    const webhook = await prisma.webhook.update({
      where: { id: String(req.params.id) },
      data: req.body,
    });
    res.json({ success: true, data: webhook });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/webhooks/:id - Delete webhook
router.delete('/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.webhook.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true, message: 'Webhook deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/webhooks/events - List available event types
router.get('/events', authMiddleware, async (_req: AuthRequest, res: Response) => {
  const eventTypes = [
    'order.created',
    'order.updated',
    'order.completed',
    'order.cancelled',
    'payment.created',
    'payment.authorized',
    'payment.captured',
    'payment.failed',
    'payment.refunded',
    'payment.settled',
    'inventory.changed',
    'inventory.low_stock',
    'inventory.out_of_stock',
    'customer.created',
    'customer.updated',
    'employee.updated',
    'loyalty.points_earned',
    'loyalty.reward_redeemed',
    'refund.created',
    'register.opened',
    'register.closed',
    'device.online',
    'device.offline',
  ];
  
  res.json({ success: true, data: eventTypes });
});

export default router;
