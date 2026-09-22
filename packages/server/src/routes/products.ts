import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError, HttpError } from '../middleware/error.js';
import { buildLabel, scannedCodeCandidates } from '../services/barcodes.js';
import { round2 } from '../services/moneyMath.js';

const router = Router();

const productSchema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  barcode: z.string().optional(),
  description: z.string().optional(),
  type: z.enum(['PHYSICAL', 'SERVICE', 'DIGITAL', 'GIFT_CARD', 'NON_INVENTORY']).optional(),
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
    const { search, categoryId, type, isActive } = req.query;
    const where: any = { organizationId: req.user!.organizationId };
    
    if (search) where.name = { contains: String(search), mode: 'insensitive' };
    if (categoryId) where.categoryId = String(categoryId);
    if (type) where.type = String(type);
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

// GET /api/products/scan/:code - resolve a scanned barcode (UPC/EAN tolerant)
// A scanner may report the code with dashes, or as a 12-digit UPC-A while the
// catalog stores the 13-digit EAN form, so every equivalent is tried.
router.get('/scan/:code', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const candidates = scannedCodeCandidates(String(req.params.code));
    if (!candidates.length) throw new HttpError(400, 'Nothing was scanned');
    const product = await prisma.product.findFirst({
      where: {
        organizationId: req.user!.organizationId!,
        OR: [{ barcode: { in: candidates } }, { sku: { in: candidates } }],
      },
      include: { inventory: { select: { quantity: true, reserved: true } }, category: { select: { name: true } } },
    });
    if (!product) return res.status(404).json({ success: false, message: 'No product carries that code' });
    res.json({
      success: true,
      data: {
        ...product,
        stock: product.inventory.reduce((s, i) => s + i.quantity - i.reserved, 0),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// ════════════════════════════════════════════════════ BARCODE LABEL SHEETS

const labelsSchema = z.object({
  /** Explicit selection; omit (or set includeAll) to take the whole catalog. */
  productIds: z.array(z.string().min(1)).max(1000).optional(),
  includeAll: z.boolean().optional(),
  categoryId: z.string().optional(),
  /** Only products that still have no code of their own. */
  missingBarcodesOnly: z.boolean().optional(),
  /** Labels printed per product (shelf-edge strips usually want several). */
  copies: z.number().int().min(1).max(50).optional(),
  /** Persist generated internal codes back onto the catalog so reprints match. */
  persistBarcodes: z.boolean().optional(),
});

// POST /api/products/labels - build a printable label sheet
router.post('/labels', authMiddleware, validateRequest(labelsSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof labelsSchema>;

    const where: any = { organizationId: orgId, isActive: true };
    if (body.categoryId) where.categoryId = body.categoryId;
    if (body.missingBarcodesOnly) where.barcode = null;
    if (!body.includeAll) {
      if (!body.productIds?.length) throw new HttpError(400, 'Select at least one product');
      where.id = { in: body.productIds };
    }

    const [products, settings, org] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { category: { select: { name: true } }, taxRule: { select: { rate: true } } },
        orderBy: { name: 'asc' },
        take: 1000,
      }),
      prisma.storeSettings.findUnique({ where: { organizationId: orgId }, select: { currency: true, storeName: true } }),
      prisma.organization.findUnique({ where: { id: orgId }, select: { taxRate: true } }),
    ]);
    if (!products.length) throw new HttpError(404, 'No products matched that selection');

    const currency = settings?.currency || 'USD';
    const orgTax = Number(org?.taxRate || 0);
    const copies = body.copies ?? 1;

    const labels: any[] = [];
    const toPersist: { id: string; barcode: string }[] = [];
    for (const p of products) {
      const { label, generated } = buildLabel(
        { id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, type: p.type, price: p.price, costPrice: p.costPrice },
        {
          organizationId: orgId,
          currency,
          categoryName: p.category?.name ?? null,
          taxPercent: p.taxRule ? round2(Number(p.taxRule.rate)) : orgTax ? round2(orgTax) : null,
        },
      );
      if (generated) toPersist.push({ id: p.id, barcode: label.barcode });
      for (let c = 0; c < copies; c++) labels.push(label);
    }

    // A printed code must never change, so the generated ones are stored back.
    if (body.persistBarcodes && toPersist.length) {
      await prisma.$transaction(toPersist.map((t) => prisma.product.update({ where: { id: t.id }, data: { barcode: t.barcode } })));
    }

    res.json({
      success: true,
      data: {
        storeName: settings?.storeName || null,
        currency,
        taxRate: round2(orgTax),
        copies,
        labelCount: labels.length,
        generatedCodes: body.persistBarcodes ? toPersist.length : 0,
        saved: Boolean(body.persistBarcodes) && toPersist.length > 0,
        labels,
      },
    });
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
