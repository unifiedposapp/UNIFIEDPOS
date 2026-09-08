import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';

const router = Router();

const categorySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  color: z.string().optional(),
  sortOrder: z.number().optional(),
});

const productSchema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  barcode: z.string().optional(),
  description: z.string().optional(),
  price: z.number().positive(),
  costPrice: z.number().positive(),
  categoryId: z.string().uuid().optional().or(z.literal('')),
  brandId: z.string().uuid().optional().or(z.literal('')),
  imageUrl: z.string().optional(),
});

// ─── Categories ───────────────────────────────────────────────

router.get('/categories', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const categories = await prisma.category.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { _count: { select: { products: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json({ success: true, data: categories });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/categories', authMiddleware, validateRequest(categorySchema), async (req: AuthRequest, res: Response) => {
  try {
    const category = await prisma.category.create({ data: { ...req.body, organizationId: req.user!.organizationId! } });
    res.status(201).json({ success: true, data: category });
  } catch (error) {
    handleError(error, res);
  }
});

router.put('/categories/:id', authMiddleware, validateRequest(categorySchema.partial()), async (req: AuthRequest, res: Response) => {
  try {
    const category = await prisma.category.update({ where: { id: String(req.params.id) }, data: req.body });
    res.json({ success: true, data: category });
  } catch (error) {
    handleError(error, res);
  }
});

router.delete('/categories/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.category.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true, message: 'Category deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Products ─────────────────────────────────────────────────

router.get('/products', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { search, categoryId, page = '1', pageSize = '20' } = req.query;
    const where: any = { organizationId: req.user!.organizationId };

    if (search) {
      where.OR = [
        { name: { contains: String(search), mode: 'insensitive' } },
        { sku: { contains: String(search), mode: 'insensitive' } },
        { barcode: { contains: String(search), mode: 'insensitive' } },
      ];
    }
    if (categoryId) where.categoryId = String(categoryId);

    const skip = (Number(page) - 1) * Number(pageSize);
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { category: true, inventory: { take: 1 } },
        orderBy: { name: 'asc' },
        skip, take: Number(pageSize),
      }),
      prisma.product.count({ where }),
    ]);

    const enriched = products.map((p: any) => ({
      ...p,
      stock: p.inventory?.[0]?.quantity ?? 0,
      inventory: undefined,
    }));

    res.json({ success: true, data: { items: enriched, total, page: Number(page), pageSize: Number(pageSize), totalPages: Math.ceil(total / Number(pageSize)) } });
  } catch (error) {
    handleError(error, res);
  }
});

router.get('/products/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: String(req.params.id) },
      include: { category: true, brand: true, variants: true, inventory: { take: 1 } },
    });
    if (!product) { res.status(404).json({ success: false, message: 'Product not found' }); return; }
    res.json({ success: true, data: { ...product, stock: (product as any).inventory?.[0]?.quantity ?? 0, inventory: undefined } });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/products', authMiddleware, validateRequest(productSchema), async (req: AuthRequest, res: Response) => {
  try {
    const data = { ...req.body };
    if (!data.categoryId) delete data.categoryId;
    if (!data.brandId) delete data.brandId;

    const product = await prisma.product.create({
      data: { ...data, organizationId: req.user!.organizationId! },
      include: { category: true },
    });

    await createAuditEvent({
      organizationId: req.user!.organizationId!, actorId: req.user!.employeeId,
      action: 'PRODUCT_CREATED', resourceType: 'PRODUCT', resourceId: product.id,
      newValue: { name: product.name, sku: product.sku, price: Number(product.price) },
    });

    res.status(201).json({ success: true, data: product });
  } catch (error) {
    handleError(error, res);
  }
});

router.put('/products/:id', authMiddleware, validateRequest(productSchema.partial()), async (req: AuthRequest, res: Response) => {
  try {
    const data = { ...req.body };
    if (data.categoryId === '') delete data.categoryId;
    if (data.brandId === '') delete data.brandId;

    const product = await prisma.product.update({ where: { id: String(req.params.id) }, data, include: { category: true } });

    await createAuditEvent({
      organizationId: req.user!.organizationId!, actorId: req.user!.employeeId,
      action: 'PRODUCT_UPDATED', resourceType: 'PRODUCT', resourceId: product.id,
      newValue: data,
    });

    res.json({ success: true, data: product });
  } catch (error) {
    handleError(error, res);
  }
});

router.delete('/products/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.product.update({ where: { id: String(req.params.id) }, data: { isActive: false } });
    await createAuditEvent({
      organizationId: req.user!.organizationId!, actorId: req.user!.employeeId,
      action: 'PRODUCT_DELETED', resourceType: 'PRODUCT', resourceId: String(req.params.id),
    });
    res.json({ success: true, message: 'Product deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Low Stock ────────────────────────────────────────────────

router.get('/low-stock', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const balances = await prisma.inventoryBalance.findMany({
      where: {
        product: { organizationId: req.user!.organizationId, isActive: true },
      },
      include: { product: { include: { category: true } } },
      orderBy: { quantity: 'asc' },
    });
    // Filter in JS for reorder point comparison
    const lowStock = balances.filter(b => b.quantity <= b.reorderPoint);
    res.json({ success: true, data: lowStock });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
