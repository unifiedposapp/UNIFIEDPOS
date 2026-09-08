import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';

const router = Router();

const productSchema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  barcode: z.string().optional(),
  description: z.string().optional(),
  price: z.number(),
  costPrice: z.number().optional(),
  categoryId: z.string().optional(),
  brandId: z.string().optional(),
  taxRuleId: z.string().optional(),
  imageUrl: z.string().optional(),
  isActive: z.boolean().optional(),
});

// GET /api/products
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { search, categoryId, isActive } = req.query;
    const where: any = { organizationId: req.user!.organizationId };
    
    if (search) where.name = { contains: String(search), mode: 'insensitive' };
    if (categoryId) where.categoryId = String(categoryId);
    if (isActive !== undefined) where.isActive = isActive === 'true';
    
    const products = await prisma.product.findMany({
      where,
      include: {
        category: true,
        variants: true,
        modifiers: true,
        inventory: true,
      },
      orderBy: { name: 'asc' },
    });
    
    // Enrich with total stock
    const enriched = products.map((p: any) => ({
      ...p,
      stock: p.inventory.reduce((sum: number, inv: any) => sum + Number(inv.quantity), 0),
    }));
    
    res.json({ success: true, data: enriched });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/products
router.post('/', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(productSchema), async (req: AuthRequest, res: Response) => {
  try {
    // Check SKU uniqueness within organization
    if (req.body.sku) {
      const existing = await prisma.product.findFirst({
        where: { organizationId: req.user!.organizationId!, sku: req.body.sku },
      });
      if (existing) return res.status(400).json({ success: false, message: 'SKU already exists' });
    }
    
    const product = await prisma.product.create({
      data: { ...req.body, organizationId: req.user!.organizationId! },
      include: { category: true, variants: true, modifiers: true },
    });
    res.status(201).json({ success: true, data: product });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/products/:id
router.put('/:id', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(productSchema.partial()), async (req: AuthRequest, res: Response) => {
  try {
    const product = await prisma.product.update({
      where: { id: String(req.params.id) },
      data: req.body,
      include: { category: true, variants: true, modifiers: true },
    });
    res.json({ success: true, data: product });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/products/:id
router.delete('/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.product.update({
      where: { id: String(req.params.id) },
      data: { isActive: false },
    });
    res.json({ success: true, message: 'Product deactivated' });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/categories/list
router.get('/categories/list', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const categories = await prisma.category.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: categories });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/categories
router.post('/categories', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const category = await prisma.category.create({
      data: { ...req.body, organizationId: req.user!.organizationId! },
    });
    res.status(201).json({ success: true, data: category });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/categories/:id
router.put('/categories/:id', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const category = await prisma.category.update({
      where: { id: String(req.params.id) },
      data: req.body,
    });
    res.json({ success: true, data: category });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/categories/:id
router.delete('/categories/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.category.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true, message: 'Category deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
