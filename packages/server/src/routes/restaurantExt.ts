// ─── §17 Restaurant extensions: QR ordering, catering, food-cost ─────────────
// Mounted at /api/restaurant AFTER the core restaurant router (fall-through), so
// existing table/kitchen/menu routes are untouched. Guest-facing QR ordering
// lives in routes/publicOrdering.ts (unauthenticated).

import { Router, Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { emitEvent } from '../services/eventBus.js';
import { appBaseUrl } from '../services/email.js';
import { round2 } from '../services/moneyMath.js';

const router = Router();

const qrUrl = (token: string) => `${appBaseUrl()}/order/${token}`;

// ─── QR ordering tokens (scan-to-order per table) ────────────────────────────

// POST /api/restaurant/tables/:id/qr-token - generate/rotate a table's QR token
router.post('/tables/:id/qr-token', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const table = await prisma.restaurantTable.findFirst({ where: { id: String(req.params.id), organizationId: orgId } });
    if (!table) return res.status(404).json({ success: false, message: 'Table not found' });
    const token = crypto.randomBytes(12).toString('hex');
    const updated = await prisma.restaurantTable.update({ where: { id: table.id }, data: { qrToken: token } });
    await createAuditEvent({ organizationId: orgId, actorId: req.user!.employeeId, action: 'QR_TOKEN_ISSUED', resourceType: 'RESTAURANT_TABLE', resourceId: table.id });
    res.json({ success: true, data: { tableId: updated.id, number: updated.number, qrToken: token, url: qrUrl(token) } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/restaurant/tables/:id/qr-token - current token + scannable URL
router.get('/tables/:id/qr-token', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const table = await prisma.restaurantTable.findFirst({ where: { id: String(req.params.id), organizationId: orgId } });
    if (!table) return res.status(404).json({ success: false, message: 'Table not found' });
    res.json({ success: true, data: { tableId: table.id, number: table.number, qrToken: table.qrToken, url: table.qrToken ? qrUrl(table.qrToken) : null } });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/restaurant/tables/:id/qr-token - disable scan-to-order for a table
router.delete('/tables/:id/qr-token', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const table = await prisma.restaurantTable.findFirst({ where: { id: String(req.params.id), organizationId: orgId } });
    if (!table) return res.status(404).json({ success: false, message: 'Table not found' });
    await prisma.restaurantTable.update({ where: { id: table.id }, data: { qrToken: null } });
    res.json({ success: true, message: 'QR token revoked' });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Catering orders (§17) ───────────────────────────────────────────────────

const cateringSchema = z.object({
  contactName: z.string().min(1),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email().optional(),
  eventDate: z.string(),
  guests: z.number().int().positive(),
  menuPackage: z.string().optional(),
  items: z.array(z.object({ productId: z.string(), name: z.string().optional(), quantity: z.number().int().positive(), price: z.number().nonnegative() })).optional(),
  total: z.number().nonnegative().optional(),
  deposit: z.number().nonnegative().optional(),
  customerId: z.string().optional(),
  locationId: z.string().optional(),
  deliveryAddress: z.string().optional(),
  notes: z.string().optional(),
});

// GET /api/restaurant/catering - list (filter by status)
router.get('/catering', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const where: any = { organizationId: orgId };
    if (req.query.status) where.status = String(req.query.status);
    const orders = await prisma.cateringOrder.findMany({ where, orderBy: { eventDate: 'desc' } });
    res.json({ success: true, data: orders });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/restaurant/catering - create
router.post('/catering', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(cateringSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const b = req.body;
    const itemsTotal = Array.isArray(b.items) ? round2(b.items.reduce((s: number, i: any) => s + i.price * i.quantity, 0)) : 0;
    const order = await prisma.cateringOrder.create({
      data: {
        organizationId: orgId,
        contactName: b.contactName,
        contactPhone: b.contactPhone,
        contactEmail: b.contactEmail,
        eventDate: new Date(b.eventDate),
        guests: b.guests,
        menuPackage: b.menuPackage,
        items: b.items ?? undefined,
        total: b.total ?? itemsTotal,
        deposit: b.deposit ?? 0,
        customerId: b.customerId,
        locationId: b.locationId,
        deliveryAddress: b.deliveryAddress,
        notes: b.notes,
      },
    });
    await emitEvent({ organizationId: orgId, event: 'catering.created', data: { cateringId: order.id, contactName: order.contactName, eventDate: order.eventDate, guests: order.guests, total: Number(order.total) } });
    res.status(201).json({ success: true, data: order });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/restaurant/catering/:id
router.get('/catering/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const order = await prisma.cateringOrder.findFirst({ where: { id: String(req.params.id), organizationId: req.user!.organizationId! } });
    if (!order) return res.status(404).json({ success: false, message: 'Catering order not found' });
    res.json({ success: true, data: order });
  } catch (error) {
    handleError(error, res);
  }
});

const cateringStatusSchema = z.object({ status: z.enum(['PENDING', 'CONFIRMED', 'PREPARING', 'DELIVERED', 'CANCELLED']) });

// PUT /api/restaurant/catering/:id/status
router.put('/catering/:id/status', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(cateringStatusSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const existing = await prisma.cateringOrder.findFirst({ where: { id: String(req.params.id), organizationId: orgId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Catering order not found' });
    const updated = await prisma.cateringOrder.update({ where: { id: existing.id }, data: { status: req.body.status } });
    await emitEvent({ organizationId: orgId, event: 'catering.updated', data: { cateringId: updated.id, status: updated.status } });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Food-cost / margin analysis (§17) ───────────────────────────────────────
// Computes cost vs. sell price per menu item (falling back to the full product
// catalog when no menu is configured) and flags items above a target food-cost %.

interface FoodCostRow {
  productId: string;
  name: string;
  category: string | null;
  sellPrice: number;
  costPrice: number;
  foodCostPct: number;
  margin: number;
  marginPct: number;
  aboveTarget: boolean;
}

function buildRow(productId: string, name: string, category: string | null, sell: number, cost: number, target: number): FoodCostRow {
  const foodCostPct = sell > 0 ? (cost / sell) * 100 : 0;
  const margin = sell - cost;
  const marginPct = sell > 0 ? (margin / sell) * 100 : 0;
  return { productId, name, category, sellPrice: round2(sell), costPrice: round2(cost), foodCostPct: round2(foodCostPct), margin: round2(margin), marginPct: round2(marginPct), aboveTarget: foodCostPct > target };
}

// GET /api/restaurant/menu/food-cost?target=35
router.get('/menu/food-cost', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const target = Number(req.query.target) > 0 ? Number(req.query.target) : 35;

    const menuItems = await prisma.menuCategoryItem.findMany({
      where: { category: { organizationId: orgId } },
      include: { category: { select: { name: true } } },
    });

    let rows: FoodCostRow[] = [];
    if (menuItems.length > 0) {
      const productIds = [...new Set(menuItems.map((i) => i.productId))];
      const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, costPrice: true, price: true } });
      const pmap = new Map(products.map((p) => [p.id, p]));
      rows = menuItems
        .map((i) => {
          const p = pmap.get(i.productId);
          if (!p) return null;
          const sell = i.displayPrice != null ? Number(i.displayPrice) : Number(p.price);
          return buildRow(p.id, p.name, i.category?.name ?? null, sell, Number(p.costPrice), target);
        })
        .filter((r): r is FoodCostRow => r !== null);
    } else {
      // Fallback: whole catalog (useful for retail COGS/margin analysis too).
      const products = await prisma.product.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { id: true, name: true, costPrice: true, price: true, category: { select: { name: true } } },
        take: 1000,
      });
      rows = products.map((p) => buildRow(p.id, p.name, p.category?.name ?? null, Number(p.price), Number(p.costPrice), target));
    }

    const count = rows.length;
    const avgFoodCostPct = count ? round2(rows.reduce((s, r) => s + r.foodCostPct, 0) / count) : 0;
    const avgMarginPct = count ? round2(rows.reduce((s, r) => s + r.marginPct, 0) / count) : 0;
    const aboveTarget = rows.filter((r) => r.aboveTarget);

    res.json({
      success: true,
      data: {
        targetFoodCostPct: target,
        source: menuItems.length > 0 ? 'MENU' : 'CATALOG',
        summary: { itemCount: count, avgFoodCostPct, avgMarginPct, aboveTargetCount: aboveTarget.length },
        aboveTarget: aboveTarget.sort((a, b) => b.foodCostPct - a.foodCostPct),
        items: rows.sort((a, b) => b.foodCostPct - a.foodCostPct),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
