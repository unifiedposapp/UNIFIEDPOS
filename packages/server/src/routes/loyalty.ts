import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { emitEvent } from '../services/eventBus.js';

const router = Router();

const programSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  pointsPerDollar: z.number().min(0).default(1),
  pointsPerVisit: z.number().int().min(0).default(0),
  rewardThreshold: z.number().int().min(1).default(100),
  rewardValue: z.number().min(0).default(10),
});

// GET /api/loyalty/programs
router.get('/programs', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const programs = await prisma.loyaltyProgram.findMany({
      where: { organizationId: req.user!.organizationId! },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: programs });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/loyalty/programs
router.post('/programs', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const data = programSchema.parse(req.body);
    const program = await prisma.loyaltyProgram.create({
      data: { ...data, organizationId: req.user!.organizationId! },
    });
    res.status(201).json({ success: true, data: program });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/loyalty/programs/:id
router.put('/programs/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const data = programSchema.partial().parse(req.body);
    const program = await prisma.loyaltyProgram.update({
      where: { id: String(req.params.id) },
      data,
    });
    res.json({ success: true, data: program });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/loyalty/customers/:customerId/transactions
router.get('/customers/:customerId/transactions', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const transactions = await prisma.loyaltyTransaction.findMany({
      where: {
        organizationId: req.user!.organizationId!,
        customerId: String(req.params.customerId),
      },
      include: { program: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: transactions });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/loyalty/earn - Award points to customer
router.post('/earn', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { customerId, points, reason, referenceType, referenceId } = z.object({
      customerId: z.string(),
      points: z.number().int().positive(),
      reason: z.string().default('EARNED_FROM_PURCHASE'),
      referenceType: z.string().optional(),
      referenceId: z.string().optional(),
    }).parse(req.body);

    const orgId = req.user!.organizationId!;

    // Get active program
    const program = await prisma.loyaltyProgram.findFirst({
      where: { organizationId: orgId, isActive: true },
    });
    if (!program) return res.status(404).json({ success: false, message: 'No active loyalty program' });

    // Get customer's current balance
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const newBalance = customer.loyaltyPoints + points;

    const tx = await prisma.loyaltyTransaction.create({
      data: {
        organizationId: orgId,
        customerId,
        programId: program.id,
        points,
        reason,
        referenceType,
        referenceId,
        balanceAfter: newBalance,
      },
    });

    await prisma.customer.update({
      where: { id: customerId },
      data: { loyaltyPoints: newBalance },
    });

    await emitEvent({
      organizationId: orgId,
      event: 'loyalty.points_earned',
      data: { customerId, points, balance: newBalance, reason },
    });

    res.json({ success: true, data: tx });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/loyalty/redeem - Redeem points
router.post('/redeem', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { customerId, points, reason, referenceType, referenceId } = z.object({
      customerId: z.string(),
      points: z.number().int().positive(),
      reason: z.string().default('REDEEMED_FOR_REWARD'),
      referenceType: z.string().optional(),
      referenceId: z.string().optional(),
    }).parse(req.body);

    const orgId = req.user!.organizationId!;

    const program = await prisma.loyaltyProgram.findFirst({
      where: { organizationId: orgId, isActive: true },
    });
    if (!program) return res.status(404).json({ success: false, message: 'No active loyalty program' });

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    if (customer.loyaltyPoints < points) return res.status(400).json({ success: false, message: 'Insufficient points' });

    const newBalance = customer.loyaltyPoints - points;

    const tx = await prisma.loyaltyTransaction.create({
      data: {
        organizationId: orgId,
        customerId,
        programId: program.id,
        points: -points,
        reason,
        referenceType,
        referenceId,
        balanceAfter: newBalance,
      },
    });

    await prisma.customer.update({
      where: { id: customerId },
      data: { loyaltyPoints: newBalance },
    });

    await emitEvent({
      organizationId: orgId,
      event: 'loyalty.reward_redeemed',
      data: { customerId, points, balance: newBalance },
    });

    res.json({ success: true, data: tx });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
