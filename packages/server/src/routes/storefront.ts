// ─── ONLINE STOREFRONT (public multi-channel ordering) ───────────────────────
// Epos Now's core promise: one stock number across the shop floor and the web.
// This module gives every location a branded public store URL where customers
// order PICKUP / CURBSIDE / DELIVERY / SHIP without an account.
//
// Rules that make this safe to expose to the open internet:
//   * Prices, tax and fees are ALWAYS computed server-side. The client sends
//     product ids and quantities — nothing else of monetary value.
//   * Availability is read from the same InventoryBalance rows the till
//     decrements, so the web cannot oversell the shelf.
//   * Order status is readable only through a per-order claim token, never by
//     enumeration.
//   * Every write is scoped to the storefront's own organizationId.

import { Router, Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError, HttpError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { emitEvent } from '../services/eventBus.js';
import { sendEmail, isEmailConfigured, appBaseUrl } from '../services/email.js';
import { round2 } from '../services/moneyMath.js';
import { autoDispatchOrder } from './delivery.js';

const router = Router();

export const FULFILLMENT_OPTIONS = ['PICKUP', 'CURBSIDE', 'DELIVERY', 'SHIP'] as const;
const ORDER_STATUSES = ['CONFIRMED', 'PROCESSING', 'READY', 'COMPLETED', 'CANCELLED'] as const;

/** Public URL of a storefront (served by the SPA at /shop/:slug). */
export function storefrontUrl(slug: string): string {
  return `${appBaseUrl()}/shop/${slug}`;
}

/** Turn "Downtown Counter" into "downtown-counter-7f3a". */
function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'store';
  return `${base}-${crypto.randomBytes(2).toString('hex')}`;
}

async function findOwnedStorefront(organizationId: string, id: string) {
  const row = await prisma.storefront.findFirst({ where: { id, organizationId } });
  if (!row) throw new HttpError(404, 'Storefront not found');
  return row;
}

/** Menu = active products of the org, grouped by category, with live stock. */
async function buildStorefrontMenu(organizationId: string, locationId: string | null) {
  const products = await prisma.product.findMany({
    where: { organizationId, isActive: true },
    include: { category: { select: { name: true } } },
    orderBy: { name: 'asc' },
    take: 1000,
  });
  if (!products.length) return [];

  const balances = await prisma.inventoryBalance.findMany({
    where: { productId: { in: products.map((p) => p.id) }, ...(locationId ? { locationId } : {}) },
    select: { productId: true, quantity: true },
  });
  const stock = new Map<string, number>();
  for (const b of balances) stock.set(b.productId, (stock.get(b.productId) || 0) + b.quantity);

  const groups = new Map<string, any[]>();
  for (const p of products) {
    const groupName = p.category?.name || 'Shop';
    // Only PHYSICAL goods are stock-tracked (see shared PRODUCT_TYPES); a
    // service, download or gift card is always orderable.
    const tracked = p.type === 'PHYSICAL' && stock.has(p.id);
    const quantity = stock.get(p.id) ?? 0;
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName)!.push({
      productId: p.id,
      name: p.name,
      sku: p.sku,
      type: p.type,
      description: p.description,
      imageUrl: p.imageUrl,
      price: round2(Number(p.price)),
      available: !tracked || quantity > 0,
      stock: tracked ? quantity : null,
    });
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, items]) => ({ name, items }));
}

// ═══════════════════════════════════════════════════════════ PUBLIC (no auth)

const publicOrderSchema = z.object({
  fulfillmentType: z.enum(FULFILLMENT_OPTIONS),
  items: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().positive().max(1000), notes: z.string().max(500).optional() })).min(1).max(200),
  customer: z.object({
    name: z.string().max(120).optional(),
    email: z.string().email().optional(),
    phone: z.string().max(40).optional(),
  }).optional(),
  delivery: z.object({
    recipientName: z.string().max(120).optional(),
    addressLine1: z.string().max(200).optional(),
    addressLine2: z.string().max(200).optional(),
    city: z.string().max(120).optional(),
    state: z.string().max(120).optional(),
    postalCode: z.string().max(40).optional(),
    country: z.string().max(60).optional(),
    phoneNumber: z.string().max(40).optional(),
  }).optional(),
  pickupSlot: z.string().max(80).optional(),
  notes: z.string().max(1000).optional(),
});

/** Shared shape of a public storefront payload (GET /public/:slug and order ack). */
async function publicStorefrontPayload(row: any) {
  const [settings, org, menu, location] = await Promise.all([
    prisma.storeSettings.findUnique({ where: { organizationId: row.organizationId }, select: { storeName: true, currency: true } }),
    prisma.organization.findUnique({ where: { id: row.organizationId }, select: { name: true, countryCode: true, taxRate: true } }),
    buildStorefrontMenu(row.organizationId, row.locationId),
    row.locationId
      ? prisma.location.findUnique({ where: { id: row.locationId }, select: { name: true, address: true, phone: true } })
      : Promise.resolve(null),
  ]);
  return {
    slug: row.slug,
    name: row.name,
    headerText: row.headerText,
    themeColor: row.themeColor,
    locationName: location,
    storeName: settings?.storeName || org?.name || 'Our Store',
    currency: settings?.currency || 'USD',
    countryCode: org?.countryCode || null,
    fulfillmentTypes: Array.isArray(row.fulfillmentTypes) ? row.fulfillmentTypes : [...FULFILLMENT_OPTIONS],
    pickupSlots: Array.isArray(row.pickupSlotsJson) ? row.pickupSlotsJson : null,
    deliveryFee: row.deliveryFee != null ? round2(Number(row.deliveryFee)) : 0,
    minOrderAmount: row.minOrderAmount != null ? round2(Number(row.minOrderAmount)) : 0,
    payOnPickup: row.payOnPickup,
    taxRate: round2(Number(org?.taxRate || 0)),
    menu,
  };
}

// GET /api/storefront/public/:slug - the public shop page
router.get('/public/:slug', async (req, res: Response) => {
  try {
    const row = await prisma.storefront.findUnique({ where: { slug: String(req.params.slug) } });
    if (!row || !row.isEnabled) return res.status(404).json({ success: false, message: 'This store is not open online' });
    res.json({ success: true, data: await publicStorefrontPayload(row) });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/storefront/public/:slug/order - place an order (money computed here)
router.post('/public/:slug/order', validateRequest(publicOrderSchema), async (req, res: Response) => {
  try {
    const row = await prisma.storefront.findUnique({ where: { slug: String(req.params.slug) } });
    if (!row || !row.isEnabled) throw new HttpError(404, 'This store is not open online');

    const orgId = row.organizationId;
    const body = req.body as z.infer<typeof publicOrderSchema>;
    const offered = Array.isArray(row.fulfillmentTypes) ? (row.fulfillmentTypes as string[]) : [...FULFILLMENT_OPTIONS];
    if (!offered.includes(body.fulfillmentType)) {
      throw new HttpError(400, `This store does not offer ${body.fulfillmentType.toLowerCase()}`);
    }

    // ── Prices come from the database, never the request ──────────────────
    const productIds = [...new Set(body.items.map((i) => i.productId))];
    const products = await prisma.product.findMany({ where: { id: { in: productIds }, organizationId: orgId, isActive: true } });
    const pmap = new Map(products.map((p) => [p.id, p]));

    const balances = await prisma.inventoryBalance.findMany({
      where: { productId: { in: productIds }, ...(row.locationId ? { locationId: row.locationId } : {}) },
      select: { productId: true, quantity: true },
    });
    const stock = new Map(balances.map((b) => [b.productId, b.quantity]));

    let subtotal = 0;
    const orderItems: any[] = [];
    for (const item of body.items) {
      const p = pmap.get(item.productId);
      if (!p) throw new HttpError(400, 'One of the selected items is no longer available');
      const tracked = p.type === 'PHYSICAL' && stock.has(p.id);
      if (tracked) {
        const available = stock.get(p.id) || 0;
        if (available < item.quantity) {
          throw new HttpError(409, `${p.name}: only ${available} left`);
        }
      }
      const unitPrice = round2(Number(p.price));
      const lineTotal = round2(unitPrice * item.quantity);
      subtotal += lineTotal;
      orderItems.push({ productId: p.id, productName: p.name, quantity: item.quantity, unitPrice, totalAmount: lineTotal, notes: item.notes });
    }
    subtotal = round2(subtotal);

    const minOrder = row.minOrderAmount != null ? Number(row.minOrderAmount) : 0;
    if (minOrder > 0 && subtotal < minOrder) {
      throw new HttpError(400, `Minimum order is ${minOrder.toFixed(2)}`);
    }

    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { taxRate: true } });
    const taxAmount = round2(subtotal * (Number(org?.taxRate || 0) / 100));
    const deliveryFee = body.fulfillmentType === 'DELIVERY' && row.deliveryFee != null ? round2(Number(row.deliveryFee)) : 0;
    const totalAmount = round2(subtotal + taxAmount + deliveryFee);

    // ── Customer: link to an existing profile by email, else anonymous ─────
    let customerId: string | null = null;
    if (body.customer?.email) {
      const existing = await prisma.customer.findFirst({ where: { organizationId: orgId, email: body.customer.email }, select: { id: true } });
      if (existing) customerId = existing.id;
    }

    const claimToken = crypto.randomBytes(12).toString('hex');
    const count = await prisma.order.count({ where: { organizationId: orgId } });
    const orderNumber = `WEB-${Date.now().toString(36).toUpperCase()}-${count + 1}`;

    const order = await prisma.order.create({
      data: {
        orderNumber,
        organizationId: orgId,
        locationId: row.locationId,
        customerId,
        channel: 'WEBSITE',
        status: 'CONFIRMED',
        currency: (await prisma.storeSettings.findUnique({ where: { organizationId: orgId }, select: { currency: true } }))?.currency || 'USD',
        subtotal,
        taxAmount,
        totalAmount,
        discountAmount: 0,
        tipAmount: 0,
        fulfillmentType: body.fulfillmentType,
        storefrontToken: claimToken,
        notes: [
          `Online storefront: ${row.name}`,
          body.pickupSlot ? `Slot: ${body.pickupSlot}` : null,
          body.notes || null,
        ].filter(Boolean).join(' | '),
        items: { create: orderItems },
        fulfillments: {
          create: {
            type: body.fulfillmentType,
            status: 'PENDING',
            deliveryFee,
            ...(body.delivery || {}),
            phoneNumber: body.delivery?.phoneNumber || body.customer?.phone || null,
            notes: body.pickupSlot ? `Requested slot ${body.pickupSlot}` : null,
          },
        },
      },
      include: { items: true, fulfillments: true },
    });

    // Reserve the stock immediately: an accepted web order must not be sold twice
    // at the counter before the merchant prepares it.
    if (row.locationId) {
      for (const item of orderItems) {
        const product = pmap.get(item.productId);
        if (!product || product.type !== 'PHYSICAL') continue; // services have no stock
        const balance = await prisma.inventoryBalance.findFirst({ where: { productId: item.productId, locationId: row.locationId } });
        if (!balance) continue;
        await prisma.inventoryBalance.update({ where: { id: balance.id }, data: { quantity: { decrement: item.quantity } } });
        await prisma.inventoryMovement.create({
          data: {
            balanceId: balance.id,
            type: 'SALE',
            quantity: -item.quantity,
            reference: order.orderNumber,
            notes: `Online storefront order (${body.fulfillmentType})`,
          },
        });
      }
    }

    await emitEvent({
      organizationId: orgId,
      event: 'order.created',
      data: { orderId: order.id, orderNumber, channel: 'WEBSITE', fulfillmentType: body.fulfillmentType, totalAmount, storefront: row.name },
      metadata: { source: 'storefront' },
    });

    // A merchant who connected a courier with auto-dispatch never touches it.
    const dispatch =
      body.fulfillmentType === 'DELIVERY' ? await autoDispatchOrder(orgId, order.id).catch(() => ({ dispatched: false, reason: 'dispatch_unavailable' })) : null;

    if (body.customer?.email && isEmailConfigured()) {
      await sendEmail({
        to: body.customer.email,
        subject: `We got your order ${orderNumber}`,
        text: `Thanks ${body.customer.name || '!' } — your order ${orderNumber} is confirmed for ${body.fulfillmentType.toLowerCase()}.\nTotal: ${totalAmount.toFixed(2)}.\nTrack it here: ${storefrontUrl(row.slug)}/status/${claimToken}`,
      }).catch(() => undefined);
    }

    res.status(201).json({
      success: true,
      data: {
        orderNumber,
        claimToken,
        status: order.status,
        subtotal,
        taxAmount,
        deliveryFee,
        totalAmount,
        currency: order.currency,
        payOnPickup: row.payOnPickup,
        trackUrl: `${storefrontUrl(row.slug)}/status/${claimToken}`,
        deliveryDispatched: dispatch?.dispatched ?? false,
        items: order.items.map((i) => ({ name: i.productName, quantity: i.quantity, totalAmount: Number(i.totalAmount) })),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/storefront/public/:slug/order/:token - order status by claim token
router.get('/public/:slug/order/:token', async (req, res: Response) => {
  try {
    const row = await prisma.storefront.findUnique({ where: { slug: String(req.params.slug) } });
    if (!row) return res.status(404).json({ success: false, message: 'Store not found' });
    const order = await prisma.order.findFirst({
      where: { storefrontToken: String(req.params.token), organizationId: row.organizationId },
      include: { items: true, fulfillments: true },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        status: order.status,
        fulfillmentType: order.fulfillmentType,
        subtotal: Number(order.subtotal),
        totalAmount: Number(order.totalAmount),
        currency: order.currency,
        placedAt: order.createdAt,
        readyAt: order.fulfillments[0]?.readyAt || null,
        note: order.fulfillments[0]?.notes || null,
        items: order.items.map((i) => ({ name: i.productName, quantity: i.quantity, totalAmount: Number(i.totalAmount) })),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// ═══════════════════════════════════════════════════════════ MERCHANT (auth)

const storefrontSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and dashes only').optional(),
  locationId: z.string().nullable().optional(),
  isEnabled: z.boolean().optional(),
  fulfillmentTypes: z.array(z.enum(FULFILLMENT_OPTIONS)).min(1).optional(),
  pickupSlotsJson: z.array(z.object({ day: z.string().max(40), slots: z.array(z.string().max(20)).max(24) })).optional().nullable(),
  deliveryFee: z.number().min(0).nullable().optional(),
  minOrderAmount: z.number().min(0).nullable().optional(),
  payOnPickup: z.boolean().optional(),
  headerText: z.string().max(280).nullable().optional(),
  themeColor: z.string().max(20).nullable().optional(),
});

// GET /api/storefront - list this organization's storefronts
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const rows = await prisma.storefront.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'asc' } });
    // Pending web orders, counted per storefront by the slug recorded in the
    // order note (orders outlive a deleted storefront, so no FK is trusted here).
    const pending = await prisma.order.groupBy({
      by: ['locationId'],
      where: { organizationId: orgId, channel: 'WEBSITE', status: { in: ['CONFIRMED', 'PROCESSING'] } },
      _count: { _all: true },
    });
    const byLocation = new Map(pending.map((p) => [p.locationId || '__none__', p._count._all]));
    res.json({
      success: true,
      data: rows.map((r) => ({
        ...r,
        url: storefrontUrl(r.slug),
        pendingOrders: r.isEnabled ? byLocation.get(r.locationId || '__none__') || 0 : 0,
        deliveryFee: r.deliveryFee != null ? Number(r.deliveryFee) : null,
        minOrderAmount: r.minOrderAmount != null ? Number(r.minOrderAmount) : null,
      })),
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/storefront - publish a storefront
router.post('/', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(storefrontSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof storefrontSchema>;
    if (body.slug) {
      const clash = await prisma.storefront.findUnique({ where: { slug: body.slug } });
      if (clash) throw new HttpError(409, 'That web address is already taken');
    }
    const row = await prisma.storefront.create({
      data: {
        organizationId: orgId,
        name: body.name,
        slug: body.slug || slugify(body.name),
        locationId: body.locationId || null,
        isEnabled: body.isEnabled ?? false,
        fulfillmentTypes: body.fulfillmentTypes ?? [...FULFILLMENT_OPTIONS],
        pickupSlotsJson: body.pickupSlotsJson ?? undefined,
        deliveryFee: body.deliveryFee ?? null,
        minOrderAmount: body.minOrderAmount ?? null,
        payOnPickup: body.payOnPickup ?? true,
        headerText: body.headerText ?? null,
        themeColor: body.themeColor ?? null,
      },
    });
    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: 'STOREFRONT_CREATED',
      resourceType: 'STOREFRONT',
      resourceId: row.id,
      newValue: { slug: row.slug, name: row.name, isEnabled: row.isEnabled },
    });
    res.status(201).json({ success: true, data: { ...row, url: storefrontUrl(row.slug) } });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/storefront/:id - update (org-scoped)
router.put('/:id', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(storefrontSchema.partial()), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const existing = await findOwnedStorefront(orgId, String(req.params.id));
    const body = req.body as Partial<z.infer<typeof storefrontSchema>>;
    if (body.slug && body.slug !== existing.slug) {
      const clash = await prisma.storefront.findUnique({ where: { slug: body.slug } });
      if (clash) throw new HttpError(409, 'That web address is already taken');
    }
    const updated = await prisma.storefront.update({
      where: { id: existing.id },
      data: {
        ...body,
        fulfillmentTypes: body.fulfillmentTypes ?? undefined,
        pickupSlotsJson: body.pickupSlotsJson === null ? undefined : body.pickupSlotsJson,
      },
    });
    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: 'STOREFRONT_UPDATED',
      resourceType: 'STOREFRONT',
      resourceId: updated.id,
      newValue: { isEnabled: updated.isEnabled, fulfillmentTypes: updated.fulfillmentTypes },
    });
    res.json({ success: true, data: { ...updated, url: storefrontUrl(updated.slug) } });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/storefront/:id - unpublish and remove
router.delete('/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const existing = await findOwnedStorefront(orgId, String(req.params.id));
    await prisma.storefront.delete({ where: { id: existing.id } });
    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: 'STOREFRONT_DELETED',
      resourceType: 'STOREFRONT',
      resourceId: existing.id,
      previousValue: { slug: existing.slug, name: existing.name },
    });
    res.json({ success: true, data: { id: existing.id, deleted: true } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/storefront/orders - web orders awaiting the merchant
router.get('/orders', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const status = req.query.status ? String(req.query.status) : undefined;
    const orders = await prisma.order.findMany({
      where: { organizationId: orgId, channel: 'WEBSITE', storefrontToken: { not: null }, ...(status ? { status } : {}) },
      include: { items: true, fulfillments: true, customer: { select: { name: true, email: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ success: true, data: orders });
  } catch (error) {
    handleError(error, res);
  }
});

const statusSchema = z.object({ status: z.enum(ORDER_STATUSES), note: z.string().max(500).optional() });

// POST /api/storefront/orders/:id/status - accept, ready, complete, cancel
router.post('/orders/:id/status', authMiddleware, validateRequest(statusSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const order = await prisma.order.findFirst({ where: { id: String(req.params.id), organizationId: orgId, storefrontToken: { not: null } } });
    if (!order) throw new HttpError(404, 'Storefront order not found');
    const { status, note } = req.body as z.infer<typeof statusSchema>;

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status,
        ...(note ? { notes: `${order.notes ? order.notes + ' | ' : ''}${status}: ${note}` } : {}),
        ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
        ...(status === 'READY' ? { fulfillments: { updateMany: { where: { orderId: order.id }, data: { status: 'READY', readyAt: new Date() } } } } : {}),
        ...(status === 'COMPLETED' ? { fulfillments: { updateMany: { where: { orderId: order.id }, data: { status: 'COMPLETED', pickedUpAt: new Date() } } } } : {}),
        ...(status === 'CANCELLED' ? { fulfillments: { updateMany: { where: { orderId: order.id }, data: { status: 'CANCELLED' } } } } : {}),
      },
      include: { items: true },
    });

    // A cancelled order gives its stock straight back to the shelf.
    if (status === 'CANCELLED' && order.locationId) {
      for (const item of updated.items) {
        const balance = await prisma.inventoryBalance.findFirst({ where: { productId: item.productId, locationId: order.locationId } });
        if (!balance) continue;
        await prisma.inventoryBalance.update({ where: { id: balance.id }, data: { quantity: { increment: item.quantity } } });
        await prisma.inventoryMovement.create({
          data: { balanceId: balance.id, type: 'RETURN', quantity: item.quantity, reference: order.orderNumber, notes: 'Storefront order cancelled' },
        });
      }
    }

    await emitEvent({
      organizationId: orgId,
      event: 'order.status_changed',
      data: { orderId: order.id, orderNumber: order.orderNumber, status, channel: 'WEBSITE' },
      metadata: { source: 'storefront' },
    });
    res.json({ success: true, data: { id: updated.id, status: updated.status } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/storefront/overview - the numbers a merchant wants on the widget
router.get('/overview', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const window = new Date(Date.now() - 30 * 86400_000);
    const [storefronts, today, month, monthAgg, awaiting] = await Promise.all([
      prisma.storefront.count({ where: { organizationId: orgId, isEnabled: true } }),
      prisma.order.count({ where: { organizationId: orgId, channel: 'WEBSITE', createdAt: { gte: startOfDay } } }),
      prisma.order.count({ where: { organizationId: orgId, channel: 'WEBSITE', createdAt: { gte: window } } }),
      prisma.order.aggregate({ where: { organizationId: orgId, channel: 'WEBSITE', createdAt: { gte: window }, status: { not: 'CANCELLED' } }, _sum: { totalAmount: true } }),
      prisma.order.findMany({
        where: { organizationId: orgId, channel: 'WEBSITE', status: { in: ['CONFIRMED', 'PROCESSING'] } },
        orderBy: { createdAt: 'asc' }, take: 50, include: { items: { select: { productName: true, quantity: true } } },
      }),
    ]);
    res.json({
      success: true,
      data: {
        publishedStorefronts: storefronts,
        ordersToday: today,
        orders30d: month,
        revenue30d: round2(Number(monthAgg._sum.totalAmount || 0)),
        awaitingAction: awaiting.length,
        queue: awaiting,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
