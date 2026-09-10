// ─── §17 Public QR ordering (guest scan-to-order) ────────────────────────────
// Unauthenticated, token-gated endpoints mounted at /api/public. A guest scans a
// table's QR code (token stored on RestaurantTable.qrToken), views the menu, and
// sends an order to the kitchen. Prices are ALWAYS resolved server-side (the
// client never dictates them) and the resulting Order flows through the normal
// POS/kitchen pipeline. Payment is settled at the table via the usual flow.

import { Router, Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { prisma } from '../db/client.js';
import { validateRequest, handleError, HttpError } from '../middleware/error.js';
import { emitEvent } from '../services/eventBus.js';
import { round2 } from '../services/moneyMath.js';

const router = Router();

/** Resolve a table by its QR token (throws 404 when unknown/revoked). */
async function tableByToken(token: string) {
  const table = await prisma.restaurantTable.findUnique({ where: { qrToken: token } });
  if (!table) throw new HttpError(404, 'Invalid or revoked QR code');
  return table;
}

interface PublicMenuItem {
  productId: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  available: boolean;
}
interface PublicMenuSection {
  id: string;
  name: string;
  items: PublicMenuItem[];
}

/** Build the guest menu: restaurant menu categories, else the product catalog. */
async function buildMenu(organizationId: string): Promise<PublicMenuSection[]> {
  const cats = await prisma.menuCategory.findMany({ where: { organizationId, isActive: true }, orderBy: { sortOrder: 'asc' } });
  if (cats.length > 0) {
    const items = await prisma.menuCategoryItem.findMany({ where: { category: { organizationId } } });
    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
    const pmap = new Map(products.map((p) => [p.id, p]));
    return cats
      .map((c) => ({
        id: c.id,
        name: c.name,
        items: items
          .filter((i) => i.categoryId === c.id && i.isAvailable)
          .map((i) => {
            const p = pmap.get(i.productId);
            if (!p) return null;
            return {
              productId: p.id,
              name: p.name,
              description: p.description,
              price: i.displayPrice != null ? Number(i.displayPrice) : Number(p.price),
              imageUrl: p.imageUrl,
              available: true,
            } as PublicMenuItem;
          })
          .filter((x): x is PublicMenuItem => x !== null),
      }))
      .filter((c) => c.items.length > 0);
  }

  // Fallback: group active products by their catalog category.
  const products = await prisma.product.findMany({
    where: { organizationId, isActive: true },
    include: { category: { select: { name: true } } },
    take: 500,
  });
  const byCat = new Map<string, PublicMenuItem[]>();
  for (const p of products) {
    const name = p.category?.name || 'Menu';
    if (!byCat.has(name)) byCat.set(name, []);
    byCat.get(name)!.push({ productId: p.id, name: p.name, description: p.description, price: Number(p.price), imageUrl: p.imageUrl, available: true });
  }
  return [...byCat.entries()].map(([name, items], idx) => ({ id: `${idx}-${name}`, name, items }));
}

// GET /api/public/qr/:token - table + menu for the guest
router.get('/qr/:token', async (req, res: Response) => {
  try {
    const table = await tableByToken(String(req.params.token));
    const settings = await prisma.storeSettings.findUnique({ where: { organizationId: table.organizationId }, select: { storeName: true, currency: true } });
    const menu = await buildMenu(table.organizationId);
    res.json({
      success: true,
      data: {
        table: { number: table.number, name: table.name },
        organization: { name: settings?.storeName || 'Our Restaurant', currency: settings?.currency || 'USD' },
        menu,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

const orderSchema = z.object({
  items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive(), notes: z.string().optional() })).min(1),
  customerName: z.string().optional(),
  phone: z.string().optional(),
});

// POST /api/public/qr/:token/order - submit a guest order to the kitchen
router.post('/qr/:token/order', validateRequest(orderSchema), async (req, res: Response) => {
  try {
    const table = await tableByToken(String(req.params.token));
    const orgId = table.organizationId;
    const { items, customerName } = req.body;

    const rawIds = items.map((i: any) => String(i.productId)) as string[];
    const productIds = [...new Set(rawIds)];
    const products = await prisma.product.findMany({ where: { id: { in: productIds }, organizationId: orgId, isActive: true } });
    const pmap = new Map(products.map((p) => [p.id, p]));
    const menuItems = await prisma.menuCategoryItem.findMany({ where: { productId: { in: productIds }, category: { organizationId: orgId } } });
    const displayPrice = new Map(menuItems.map((m) => [m.productId, m.displayPrice]));

    let subtotal = 0;
    const createItems: any[] = [];
    for (const it of items) {
      const p = pmap.get(it.productId);
      if (!p) throw new HttpError(400, `Product ${it.productId} is not available`);
      const dp = displayPrice.get(it.productId);
      const unit = dp != null ? Number(dp) : Number(p.price);
      const lineTotal = round2(unit * it.quantity);
      subtotal += lineTotal;
      createItems.push({ productId: p.id, productName: p.name, quantity: it.quantity, unitPrice: unit, totalAmount: lineTotal, notes: it.notes });
    }
    subtotal = round2(subtotal);

    const settings = await prisma.storeSettings.findUnique({ where: { organizationId: orgId }, select: { currency: true } });
    const currency = settings?.currency || 'USD';
    const orderNumber = `QR-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const order = await prisma.order.create({
      data: {
        orderNumber,
        organizationId: orgId,
        channel: 'MOBILE_APP',
        status: 'CONFIRMED',
        currency,
        subtotal,
        totalAmount: subtotal,
        taxAmount: 0,
        fulfillmentType: 'DINE_IN',
        notes: `QR order — Table ${table.number}${customerName ? ` — ${customerName}` : ''}`,
        items: { create: createItems },
      },
      include: { items: true },
    });

    await prisma.restaurantTable.update({ where: { id: table.id }, data: { status: 'OCCUPIED' } });
    await emitEvent({ organizationId: orgId, event: 'order.created', data: { orderId: order.id, orderNumber, total: subtotal, currency, channel: 'MOBILE_APP', table: table.number } });

    res.status(201).json({ success: true, data: { orderId: order.id, orderNumber, status: order.status, subtotal, currency, itemCount: order.items.length } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/public/qr/:token/order/:orderId - guest order status (QR orders only)
router.get('/qr/:token/order/:orderId', async (req, res: Response) => {
  try {
    const table = await tableByToken(String(req.params.token));
    const order = await prisma.order.findFirst({
      where: { id: String(req.params.orderId), organizationId: table.organizationId, channel: 'MOBILE_APP' },
      include: { items: true },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        status: order.status,
        totalAmount: Number(order.totalAmount),
        currency: order.currency,
        items: order.items.map((i) => ({ name: i.productName, quantity: i.quantity, totalAmount: Number(i.totalAmount) })),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
