import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';

const router = Router();

const supplierSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
});

// GET /api/suppliers
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      where: { organizationId: req.user!.organizationId! },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: suppliers });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/suppliers
router.post('/', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const data = supplierSchema.parse(req.body);
    const supplier = await prisma.supplier.create({
      data: { ...data, organizationId: req.user!.organizationId! },
    });
    res.status(201).json({ success: true, data: supplier });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/suppliers/:id
router.put('/:id', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const data = supplierSchema.partial().parse(req.body);
    const supplier = await prisma.supplier.update({
      where: { id: String(req.params.id) },
      data,
    });
    res.json({ success: true, data: supplier });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/suppliers/:id
router.delete('/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.supplier.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true, message: 'Supplier deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
