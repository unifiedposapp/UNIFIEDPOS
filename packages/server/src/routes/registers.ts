import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';

const router = Router();

const sessionSchema = z.object({
  registerId: z.string().uuid(),
  openingCash: z.number().min(0),
});

const closeSessionSchema = z.object({
  closingCash: z.number().min(0),
  notes: z.string().optional(),
});

// GET /api/registers
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const registers = await prisma.register.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { location: true },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: registers });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/registers
router.post('/', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const register = await prisma.register.create({
      data: { ...req.body, organizationId: req.user!.organizationId! },
    });
    res.status(201).json({ success: true, data: register });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/registers/session — Get current active session
router.get('/session', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const session = await prisma.registerSession.findFirst({
      where: { employeeId: req.user!.employeeId, status: 'OPEN' },
      include: { register: true },
      orderBy: { openedAt: 'desc' },
    });
    res.json({ success: true, data: session });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/registers/open — Open register (start session)
router.post('/open', authMiddleware, validateRequest(sessionSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { registerId, openingCash } = req.body;
    const employeeId = req.user!.employeeId!;

    // Check for existing open session
    const existing = await prisma.registerSession.findFirst({
      where: { employeeId, status: 'OPEN' },
    });
    if (existing) {
      res.status(409).json({ success: false, message: 'You already have an open session' });
      return;
    }

    const session = await prisma.$transaction(async (tx) => {
      const s = await tx.registerSession.create({
        data: { registerId, employeeId, openingCash },
        include: { register: true },
      });
      await tx.register.update({ where: { id: registerId }, data: { status: 'OPEN' } });
      return s;
    });

    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: employeeId,
      action: 'REGISTER_OPENED',
      resourceType: 'REGISTER',
      resourceId: registerId,
      newValue: { sessionId: session.id, openingCash },
    });

    res.status(201).json({ success: true, data: session });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/registers/close — Close register (end session)
router.post('/close', authMiddleware, validateRequest(closeSessionSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { closingCash, notes } = req.body;
    const employeeId = req.user!.employeeId!;

    const session = await prisma.registerSession.findFirst({
      where: { employeeId, status: 'OPEN' },
    });

    if (!session) {
      res.status(404).json({ success: false, message: 'No open session found' });
      return;
    }

    // Calculate expected cash from orders in this session
    const orders = await prisma.order.findMany({
      where: { sessionId: session.id, status: { in: ['COMPLETED', 'PAID'] } },
      select: { totalAmount: true, payments: { where: { method: 'CASH' }, select: { amount: true } } },
    });

    const cashPayments = orders.reduce((sum: number, o: any) => sum + o.payments.reduce((s: number, p: any) => s + Number(p.amount), 0), 0);
    const expectedCash = Number(session.openingCash) + cashPayments;
    const variance = closingCash - expectedCash;

    const closed = await prisma.$transaction(async (tx) => {
      const s = await tx.registerSession.update({
        where: { id: session.id },
        data: { closingCash, expectedCash, variance, status: 'CLOSED', closedAt: new Date(), notes },
        include: { register: true },
      });
      await tx.register.update({ where: { id: session.registerId }, data: { status: 'CLOSED' } });
      return s;
    });

    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: employeeId,
      action: 'REGISTER_CLOSED',
      resourceType: 'REGISTER',
      resourceId: session.registerId,
      newValue: { sessionId: session.id, closingCash, expectedCash, variance },
    });

    res.json({ success: true, data: closed });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
