import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';

const router = Router();

const locationSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  phone: z.string().optional(),
});

// GET /api/locations
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const locations = await prisma.location.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: locations });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/locations
router.post('/', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(locationSchema), async (req: AuthRequest, res: Response) => {
  try {
    const location = await prisma.location.create({
      data: { ...req.body, organizationId: req.user!.organizationId! },
    });
    res.status(201).json({ success: true, data: location });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/locations/:id
router.put('/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(locationSchema.partial()), async (req: AuthRequest, res: Response) => {
  try {
    const location = await prisma.location.update({ where: { id: String(req.params.id) }, data: req.body });
    res.json({ success: true, data: location });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/locations/:id
router.delete('/:id', authMiddleware, requireRole('OWNER'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.location.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true, message: 'Location deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
