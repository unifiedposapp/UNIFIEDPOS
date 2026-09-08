import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';

const router = Router();

// ══════════════════════════════════════════════════════════════
// PRODUCT CATALOG (§11) — Brands, Variants, Modifiers, Tax Rules,
// Price Lists, Bundles, Kits and Composite Products.
// Basic product + category CRUD lives in routes/products.ts.
// ══════════════════════════════════════════════════════════════

// ── Brands ────────────────────────────────────────────────────
const brandSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});

router.get('/brands', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const brands = await prisma.brand.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: brands });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/brands', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(brandSchema), async (req: AuthRequest, res: Response) => {
  try {
    const brand = await prisma.brand.create({
      data: { ...req.body, organizationId: req.user!.organizationId! },
    });
    res.status(201).json({ success: true, data: brand });
  } catch (error) {
    handleError(error, res);
  }
});

router.put('/brands/:id', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const brand = await prisma.brand.update({ where: { id: String(req.params.id) }, data: req.body });
    res.json({ success: true, data: brand });
  } catch (error) {
    handleError(error, res);
  }
});

router.delete('/brands/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.brand.update({ where: { id: String(req.params.id) }, data: { isActive: false } });
    res.json({ success: true, message: 'Brand deactivated' });
  } catch (error) {
    handleError(error, res);
  }
});

// ── Tax Rules ─────────────────────────────────────────────────
const taxRuleSchema = z.object({
  name: z.string().min(1),
  rate: z.number().min(0).max(100),
  isActive: z.boolean().optional(),
});

router.get('/tax-rules', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const rules = await prisma.taxRule.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: rules });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/tax-rules', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(taxRuleSchema), async (req: AuthRequest, res: Response) => {
  try {
    const rule = await prisma.taxRule.create({
      data: { ...req.body, organizationId: req.user!.organizationId! },
    });
    res.status(201).json({ success: true, data: rule });
  } catch (error) {
    handleError(error, res);
  }
});

router.put('/tax-rules/:id', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const rule = await prisma.taxRule.update({ where: { id: String(req.params.id) }, data: req.body });
    res.json({ success: true, data: rule });
  } catch (error) {
    handleError(error, res);
  }
});

router.delete('/tax-rules/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.taxRule.update({ where: { id: String(req.params.id) }, data: { isActive: false } });
    res.json({ success: true, message: 'Tax rule deactivated' });
  } catch (error) {
    handleError(error, res);
  }
});

// ── Product Variants ──────────────────────────────────────────
const variantSchema = z.object({
  productId: z.string().min(1),
  name: z.string().min(1),
  value: z.string().min(1),
  priceAdj: z.number().optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
});

router.get('/products/:productId/variants', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const variants = await prisma.productVariant.findMany({
      where: { productId: String(req.params.productId) },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: variants });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/variants', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(variantSchema), async (req: AuthRequest, res: Response) => {
  try {
    const variant = await prisma.productVariant.create({ data: req.body });
    res.status(201).json({ success: true, data: variant });
  } catch (error) {
    handleError(error, res);
  }
});

router.delete('/variants/:id', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.productVariant.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true, message: 'Variant deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

// ── Modifier Groups & Modifiers ───────────────────────────────
const modifierGroupSchema = z.object({
  name: z.string().min(1),
  minSelect: z.number().optional(),
  maxSelect: z.number().optional(),
});

router.get('/modifier-groups', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const groups = await prisma.modifierGroup.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { modifiers: true },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: groups });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/modifier-groups', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(modifierGroupSchema), async (req: AuthRequest, res: Response) => {
  try {
    const group = await prisma.modifierGroup.create({
      data: { ...req.body, organizationId: req.user!.organizationId! },
    });
    res.status(201).json({ success: true, data: group });
  } catch (error) {
    handleError(error, res);
  }
});

router.delete('/modifier-groups/:id', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.modifierGroup.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true, message: 'Modifier group deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

const modifierSchema = z.object({
  name: z.string().min(1),
  modifierGroupId: z.string().optional(),
  productId: z.string().optional(),
  priceAdj: z.number().optional(),
});

router.get('/modifiers', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { modifierGroupId } = req.query;
    const where: any = {};
    if (modifierGroupId) where.modifierGroupId = String(modifierGroupId);
    const modifiers = await prisma.modifier.findMany({ where, orderBy: { name: 'asc' } });
    res.json({ success: true, data: modifiers });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/modifiers', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(modifierSchema), async (req: AuthRequest, res: Response) => {
  try {
    const modifier = await prisma.modifier.create({ data: req.body });
    res.status(201).json({ success: true, data: modifier });
  } catch (error) {
    handleError(error, res);
  }
});

router.delete('/modifiers/:id', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.modifier.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true, message: 'Modifier deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

// ── Price Lists ───────────────────────────────────────────────
const priceListSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.string().optional(),
  isActive: z.boolean().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

router.get('/price-lists', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const lists = await prisma.priceList.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { _count: { select: { items: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: lists });
  } catch (error) {
    handleError(error, res);
  }
});

router.get('/price-lists/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const list = await prisma.priceList.findUnique({
      where: { id: String(req.params.id) },
      include: { items: true },
    });
    if (!list) return res.status(404).json({ success: false, error: 'Price list not found' });
    res.json({ success: true, data: list });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/price-lists', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(priceListSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate, ...rest } = req.body;
    const list = await prisma.priceList.create({
      data: {
        ...rest,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        organizationId: req.user!.organizationId!,
      },
    });
    res.status(201).json({ success: true, data: list });
  } catch (error) {
    handleError(error, res);
  }
});

// Upsert an item price for a product within a price list
const priceListItemSchema = z.object({
  productId: z.string().min(1),
  price: z.number(),
});

router.post('/price-lists/:id/items', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(priceListItemSchema), async (req: AuthRequest, res: Response) => {
  try {
    const item = await prisma.priceListItem.upsert({
      where: { priceListId_productId: { priceListId: String(req.params.id), productId: req.body.productId } },
      create: { priceListId: String(req.params.id), productId: req.body.productId, price: req.body.price },
      update: { price: req.body.price },
    });
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    handleError(error, res);
  }
});

router.delete('/price-lists/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.priceList.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true, message: 'Price list deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

// ── Bundles ───────────────────────────────────────────────────
const bundleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number(),
  isActive: z.boolean().optional(),
  items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive() })).optional(),
});

router.get('/bundles', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const bundles = await prisma.bundle.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { items: true },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: bundles });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/bundles', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(bundleSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { items, ...rest } = req.body;
    const bundle = await prisma.bundle.create({
      data: {
        ...rest,
        organizationId: req.user!.organizationId!,
        items: items ? { create: items } : undefined,
      },
      include: { items: true },
    });
    res.status(201).json({ success: true, data: bundle });
  } catch (error) {
    handleError(error, res);
  }
});

router.delete('/bundles/:id', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.bundle.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true, message: 'Bundle deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

// ── Kits ──────────────────────────────────────────────────────
const kitSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  components: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive() })).optional(),
});

router.get('/kits', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const kits = await prisma.kit.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { components: true },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: kits });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/kits', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(kitSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { components, ...rest } = req.body;
    const kit = await prisma.kit.create({
      data: {
        ...rest,
        organizationId: req.user!.organizationId!,
        components: components ? { create: components } : undefined,
      },
      include: { components: true },
    });
    res.status(201).json({ success: true, data: kit });
  } catch (error) {
    handleError(error, res);
  }
});

router.delete('/kits/:id', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.kit.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true, message: 'Kit deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

// ── Composite Products ────────────────────────────────────────
const compositeSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  baseProductId: z.string().optional(),
  isActive: z.boolean().optional(),
});

router.get('/composites', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const composites = await prisma.compositeProduct.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { options: { include: { composite: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: composites });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/composites', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(compositeSchema), async (req: AuthRequest, res: Response) => {
  try {
    const composite = await prisma.compositeProduct.create({
      data: { ...req.body, organizationId: req.user!.organizationId! },
      include: { options: true },
    });
    res.status(201).json({ success: true, data: composite });
  } catch (error) {
    handleError(error, res);
  }
});

const compositeOptionSchema = z.object({
  name: z.string().min(1),
  required: z.boolean().optional(),
  minSelect: z.number().optional(),
  maxSelect: z.number().optional(),
});

router.post('/composites/:id/options', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(compositeOptionSchema), async (req: AuthRequest, res: Response) => {
  try {
    const option = await prisma.compositeProductOption.create({
      data: { ...req.body, compositeId: String(req.params.id) },
      include: { composite: true },
    });
    res.status(201).json({ success: true, data: option });
  } catch (error) {
    handleError(error, res);
  }
});

const compositeValueSchema = z.object({
  productId: z.string().min(1),
  priceAdj: z.number().optional(),
});

router.post('/options/:optionId/values', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(compositeValueSchema), async (req: AuthRequest, res: Response) => {
  try {
    const value = await prisma.compositeProductOptionValue.create({
      data: { ...req.body, optionId: String(req.params.optionId) },
    });
    res.status(201).json({ success: true, data: value });
  } catch (error) {
    handleError(error, res);
  }
});

router.delete('/composites/:id', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.compositeProduct.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true, message: 'Composite product deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

// ── Catalog overview (counts for the UI header) ───────────────
router.get('/overview', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const [brands, taxRules, modifierGroups, priceLists, bundles, kits, composites, variants] = await Promise.all([
      prisma.brand.count({ where: { organizationId: orgId, isActive: true } }),
      prisma.taxRule.count({ where: { organizationId: orgId, isActive: true } }),
      prisma.modifierGroup.count({ where: { organizationId: orgId } }),
      prisma.priceList.count({ where: { organizationId: orgId, isActive: true } }),
      prisma.bundle.count({ where: { organizationId: orgId, isActive: true } }),
      prisma.kit.count({ where: { organizationId: orgId, isActive: true } }),
      prisma.compositeProduct.count({ where: { organizationId: orgId, isActive: true } }),
      prisma.productVariant.count(),
    ]);
    res.json({ success: true, data: { brands, taxRules, modifierGroups, priceLists, bundles, kits, composites, variants } });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
