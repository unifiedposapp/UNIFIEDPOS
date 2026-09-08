import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { encryptJson } from '../services/crypto.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { emitEvent } from '../services/eventBus.js';

/**
 * Commerce Hub routes (§3 Commerce Hub, §13 Omnichannel Commerce, §48 Phase 3).
 * One order system + one inventory system across STORE / WEBSITE / MOBILE_APP /
 * SOCIAL / MARKETPLACE / PHONE / POP_UP, with fulfillment for pickup, curbside,
 * local delivery, and shipping, plus marketplace integrations and omnichannel
 * (available-to-promise) inventory.
 */

const router = Router();

const ONLINE_CHANNELS = ['WEBSITE', 'MOBILE_APP', 'SOCIAL', 'MARKETPLACE', 'PHONE', 'POP_UP'];

// ─── Zod schemas ───────────────────────────────────────────────

const channelSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  channelType: z.string().optional(),
  platform: z.string().optional(),
  url: z.string().optional(),
  isActive: z.boolean().optional(),
  config: z.any().optional(),
});

const zoneSchema = z.object({
  name: z.string().min(1),
  locationId: z.string().optional().nullable(),
  radiusMiles: z.number().optional(),
  baseFee: z.number().optional(),
  perMileFee: z.number().optional(),
  minOrder: z.number().optional(),
  maxDistance: z.number().optional(),
  zipCodes: z.any().optional(),
  isActive: z.boolean().optional(),
});

const deliveryDetailsSchema = z.object({
  recipientName: z.string().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  phoneNumber: z.string().optional(),
});

const onlineOrderSchema = z.object({
  channel: z.string().min(1),
  fulfillmentType: z.string().min(1), // PICKUP, CURBSIDE, DELIVERY, SHIP
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().positive(),
        unitPrice: z.number().optional(),
        variantId: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .min(1),
  customerId: z.string().optional(),
  locationId: z.string().optional(),
  notes: z.string().optional(),
  couponCode: z.string().optional(),
  tipAmount: z.number().optional(),
  serviceCharge: z.number().optional(),
  status: z.string().optional(),
  scheduledAt: z.string().optional(),
  delivery: deliveryDetailsSchema.optional(),
  distanceMiles: z.number().optional(),
});

const integrationSchema = z.object({
  provider: z.string().min(1),
  type: z.string().min(1),
  name: z.string().min(1),
  config: z.any().optional(),
});

const statusSchema = z.object({ status: z.string().min(1) });

// ─── Helpers ───────────────────────────────────────────────────

async function nextOrderNumber(organizationId: string): Promise<string> {
  const count = await prisma.order.count({ where: { organizationId } });
  return `ORD-${Date.now()}-${count + 1}`;
}

async function defaultLocationId(organizationId: string, requested?: string): Promise<string | null> {
  if (requested) return requested;
  const loc = await prisma.location.findFirst({ where: { organizationId } });
  return loc?.id || null;
}

// ─── Commerce Overview (§13, §20) ──────────────────────────────

router.get('/overview', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [channels, onlineOrders, pendingFulfillments, activeDeliveries, integrations, todayOnline] =
      await Promise.all([
        prisma.salesChannel.findMany({ where: { organizationId: orgId, isActive: true } }),
        prisma.order.count({ where: { organizationId: orgId, channel: { in: ONLINE_CHANNELS } } }),
        prisma.orderFulfillment.count({
          where: { status: { in: ['PENDING', 'PREPARING'] }, order: { organizationId: orgId } },
        }),
        prisma.orderFulfillment.count({
          where: { type: 'DELIVERY', status: 'OUT_FOR_DELIVERY', order: { organizationId: orgId } },
        }),
        prisma.integrationConnection.count({
          where: { organizationId: orgId, type: { in: ['ECOMMERCE', 'MARKETPLACE', 'DELIVERY'] }, status: 'CONNECTED' },
        }),
        prisma.order.count({
          where: { organizationId: orgId, channel: { in: ONLINE_CHANNELS }, createdAt: { gte: startOfDay } },
        }),
      ]);

    // Revenue by channel
    const grouped = await prisma.order.groupBy({
      by: ['channel'],
      where: { organizationId: orgId, status: { in: ['PAID', 'COMPLETED', 'FULFILLED'] } },
      _sum: { totalAmount: true },
      _count: { _all: true },
    });

    res.json({
      success: true,
      data: {
        activeChannels: channels.length,
        onlineOrders,
        onlineOrdersToday: todayOnline,
        pendingFulfillments,
        activeDeliveries,
        connectedIntegrations: integrations,
        revenueByChannel: grouped.map((g) => ({
          channel: g.channel,
          revenue: Number(g._sum.totalAmount || 0),
          orders: g._count._all,
        })),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Sales Channels (§13) ──────────────────────────────────────

router.get('/channels', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const channels = await prisma.salesChannel.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: channels });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/channels', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(channelSchema), async (req: AuthRequest, res: Response) => {
  try {
    const channel = await prisma.salesChannel.create({
      data: { ...req.body, organizationId: req.user!.organizationId! },
    });
    res.status(201).json({ success: true, data: channel });
  } catch (error) {
    handleError(error, res);
  }
});

router.put('/channels/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(channelSchema.partial()), async (req: AuthRequest, res: Response) => {
  try {
    const channel = await prisma.salesChannel.update({
      where: { id: String(req.params.id) },
      data: req.body,
    });
    res.json({ success: true, data: channel });
  } catch (error) {
    handleError(error, res);
  }
});

router.delete('/channels/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.salesChannel.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true, message: 'Channel deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

router.get('/channels/:id/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const channel = await prisma.salesChannel.findUnique({ where: { id: String(req.params.id) } });
    if (!channel) return res.status(404).json({ success: false, error: 'Channel not found' });
    const agg = await prisma.order.aggregate({
      where: { organizationId: orgId, channel: channel.key, status: { in: ['PAID', 'COMPLETED', 'FULFILLED'] } },
      _sum: { totalAmount: true },
      _count: { _all: true },
    });
    res.json({
      success: true,
      data: { channel, orders: agg._count._all, revenue: Number(agg._sum.totalAmount || 0) },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Online / Omnichannel Orders (§8, §13) ─────────────────────

router.get('/orders', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { channel, status, fulfillmentType } = req.query as Record<string, string>;
    const where: any = { organizationId: orgId };
    if (channel) where.channel = channel;
    else where.channel = { in: ONLINE_CHANNELS }; // default: online orders only
    if (status) where.status = status;
    if (fulfillmentType) where.fulfillmentType = fulfillmentType;

    const orders = await prisma.order.findMany({
      where,
      include: { items: true, fulfillments: true, customer: true, payments: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ success: true, data: orders });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/orders', authMiddleware, validateRequest(onlineOrderSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const {
      channel, fulfillmentType, items, customerId, locationId, notes, couponCode,
      tipAmount, serviceCharge, status, scheduledAt, delivery, distanceMiles,
    } = req.body;

    const locId = await defaultLocationId(orgId, locationId);

    // Resolve product prices & names
    const productIds = items.map((i: any) => i.productId);
    const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
    const productMap = new Map(products.map((p) => [p.id, p]));

    let subtotal = 0;
    const orderItems = items.map((item: any) => {
      const product = productMap.get(item.productId);
      const unitPrice = item.unitPrice != null ? item.unitPrice : Number(product?.price || 0);
      const lineTotal = unitPrice * item.quantity;
      subtotal += lineTotal;
      return {
        productId: item.productId,
        variantId: item.variantId || null,
        productName: product?.name || '',
        quantity: item.quantity,
        unitPrice,
        discountAmt: 0,
        taxAmt: 0,
        totalAmount: lineTotal,
        notes: item.notes,
      };
    });

    // Tax
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    const taxRate = Number(org?.taxRate || 0);
    const taxAmount = subtotal * (taxRate / 100);

    // Delivery fee (only for DELIVERY)
    let deliveryFee = 0;
    if (fulfillmentType === 'DELIVERY') {
      const zone = await prisma.deliveryZone.findFirst({
        where: { organizationId: orgId, isActive: true, ...(locId ? { locationId: locId } : {}) },
      });
      if (zone) {
        const dist = distanceMiles ?? Number(zone.radiusMiles);
        deliveryFee = Number(zone.baseFee) + Number(zone.perMileFee) * dist;
      }
    }

    const totalAmount = subtotal + taxAmount + deliveryFee + Number(tipAmount || 0) + Number(serviceCharge || 0);
    const orderNumber = await nextOrderNumber(orgId);

    const order = await prisma.order.create({
      data: {
        orderNumber,
        organizationId: orgId,
        locationId: locId,
        employeeId: req.user!.employeeId,
        customerId: customerId || null,
        channel,
        status: status || 'CONFIRMED',
        subtotal,
        discountAmount: 0,
        taxAmount,
        totalAmount,
        tipAmount: tipAmount || 0,
        serviceCharge: serviceCharge || 0,
        couponCode: couponCode || null,
        fulfillmentType,
        notes,
        items: { create: orderItems },
        fulfillments: {
          create: {
            type: fulfillmentType,
            status: 'PENDING',
            scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
            deliveryFee,
            distanceMiles: distanceMiles ?? null,
            ...(delivery || {}),
          },
        },
      },
      include: { items: true, fulfillments: true, customer: true },
    });

    await emitEvent({
      organizationId: orgId,
      event: 'order.created',
      data: { orderId: order.id, orderNumber, channel, fulfillmentType, totalAmount },
      metadata: { source: 'commerce' },
    });

    res.status(201).json({ success: true, data: order });
  } catch (error) {
    handleError(error, res);
  }
});

router.get('/orders/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: String(req.params.id), organizationId: req.user!.organizationId },
      include: { items: true, fulfillments: true, payments: true, customer: true, location: true },
    });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    res.json({ success: true, data: order });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/orders/:id/cancel', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const order = await prisma.order.findFirst({ where: { id: String(req.params.id), organizationId: orgId } });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED' },
    });
    await prisma.orderFulfillment.updateMany({
      where: { orderId: order.id },
      data: { status: 'CANCELLED' },
    });
    await emitEvent({ organizationId: orgId, event: 'order.cancelled', data: { orderId: order.id } });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Fulfillment queue (§5 Fulfillment, §13) ───────────────────

router.get('/fulfillment', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { status, type } = req.query as Record<string, string>;
    const where: any = { order: { organizationId: orgId } };
    if (status) where.status = status;
    if (type) where.type = type;

    const fulfillments = await prisma.orderFulfillment.findMany({
      where,
      include: { order: { include: { customer: true, location: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ success: true, data: fulfillments });
  } catch (error) {
    handleError(error, res);
  }
});

router.put('/fulfillment/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const allowed = [
      'recipientName', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country',
      'phoneNumber', 'courier', 'carrier', 'trackingNumber', 'notes', 'etaMinutes', 'scheduledAt',
    ];
    const data: any = {};
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];
    if (data.scheduledAt) data.scheduledAt = new Date(data.scheduledAt);

    const fulfillment = await prisma.orderFulfillment.update({
      where: { id: String(req.params.id) },
      data,
      include: { order: true },
    });
    res.json({ success: true, data: fulfillment });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/fulfillment/:id/status', authMiddleware, validateRequest(statusSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { status } = req.body;
    const existing = await prisma.orderFulfillment.findFirst({
      where: { id: String(req.params.id), order: { organizationId: orgId } },
      include: { order: true },
    });
    if (!existing) return res.status(404).json({ success: false, error: 'Fulfillment not found' });

    const data: any = { status };
    const now = new Date();
    if (status === 'READY') data.readyAt = now;
    if (status === 'DELIVERED') data.deliveredAt = now;
    if (status === 'COMPLETED') data.pickedUpAt = now;

    const fulfillment = await prisma.orderFulfillment.update({
      where: { id: existing.id },
      data,
      include: { order: true },
    });

    // Sync order status with fulfillment progress (§43 payment/order state sync)
    if (status === 'DELIVERED' || status === 'COMPLETED' || status === 'SHIPPED') {
      await prisma.order.update({ where: { id: existing.orderId }, data: { status: 'FULFILLED' } });
      await emitEvent({ organizationId: orgId, event: 'order.fulfilled', data: { orderId: existing.orderId, status } });
    }

    res.json({ success: true, data: fulfillment });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Pickup & Curbside (§13) ───────────────────────────────────

router.get('/pickup', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const fulfillments = await prisma.orderFulfillment.findMany({
      where: { type: { in: ['PICKUP', 'CURBSIDE'] }, order: { organizationId: orgId } },
      include: { order: { include: { customer: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ success: true, data: fulfillments });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/pickup/:id/ready', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const fulfillment = await prisma.orderFulfillment.update({
      where: { id: String(req.params.id) },
      data: { status: 'READY', readyAt: new Date() },
      include: { order: true },
    });
    res.json({ success: true, data: fulfillment });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/pickup/:id/complete', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.orderFulfillment.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ success: false, error: 'Fulfillment not found' });
    const fulfillment = await prisma.orderFulfillment.update({
      where: { id: existing.id },
      data: { status: 'COMPLETED', pickedUpAt: new Date() },
      include: { order: true },
    });
    await prisma.order.update({ where: { id: existing.orderId }, data: { status: 'FULFILLED' } });
    await emitEvent({
      organizationId: req.user!.organizationId!,
      event: 'order.fulfilled',
      data: { orderId: existing.orderId, type: existing.type },
    });
    res.json({ success: true, data: fulfillment });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Delivery zones & dispatch (§13) ───────────────────────────

router.get('/delivery/zones', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const zones = await prisma.deliveryZone.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { location: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: zones });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/delivery/zones', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(zoneSchema), async (req: AuthRequest, res: Response) => {
  try {
    const zone = await prisma.deliveryZone.create({
      data: { ...req.body, organizationId: req.user!.organizationId! },
    });
    res.status(201).json({ success: true, data: zone });
  } catch (error) {
    handleError(error, res);
  }
});

router.put('/delivery/zones/:id', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(zoneSchema.partial()), async (req: AuthRequest, res: Response) => {
  try {
    const zone = await prisma.deliveryZone.update({ where: { id: String(req.params.id) }, data: req.body });
    res.json({ success: true, data: zone });
  } catch (error) {
    handleError(error, res);
  }
});

router.delete('/delivery/zones/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.deliveryZone.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true, message: 'Delivery zone deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

// Compute a delivery fee quote for a zone / distance / order total
router.post('/delivery/quote', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { zoneId, postalCode, distanceMiles, orderTotal } = req.body as {
      zoneId?: string; postalCode?: string; distanceMiles?: number; orderTotal?: number;
    };
    const zone = zoneId
      ? await prisma.deliveryZone.findFirst({ where: { id: zoneId, organizationId: orgId } })
      : await prisma.deliveryZone.findFirst({ where: { organizationId: orgId, isActive: true } });

    if (!zone) return res.status(404).json({ success: false, error: 'No delivery zone configured' });

    const dist = Number(distanceMiles ?? zone.radiusMiles);
    const total = Number(orderTotal ?? 0);
    const eligible = total >= Number(zone.minOrder) && dist <= Number(zone.maxDistance);
    const fee = Number(zone.baseFee) + Number(zone.perMileFee) * dist;
    const etaMinutes = Math.round(dist * 6) + 15; // rough estimate

    res.json({
      success: true,
      data: { zone: zone.name, postalCode: postalCode || null, distanceMiles: dist, deliveryFee: fee, etaMinutes, eligible, minOrder: Number(zone.minOrder) },
    });
  } catch (error) {
    handleError(error, res);
  }
});

router.get('/deliveries', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const deliveries = await prisma.orderFulfillment.findMany({
      where: { type: 'DELIVERY', order: { organizationId: orgId } },
      include: { order: { include: { customer: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ success: true, data: deliveries });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/deliveries/:id/dispatch', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { courier, etaMinutes } = req.body as { courier?: string; etaMinutes?: number };
    const delivery = await prisma.orderFulfillment.update({
      where: { id: String(req.params.id) },
      data: { status: 'OUT_FOR_DELIVERY', courier: courier || null, etaMinutes: etaMinutes ?? null },
      include: { order: true },
    });
    res.json({ success: true, data: delivery });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/deliveries/:id/delivered', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.orderFulfillment.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ success: false, error: 'Delivery not found' });
    const delivery = await prisma.orderFulfillment.update({
      where: { id: existing.id },
      data: { status: 'DELIVERED', deliveredAt: new Date() },
      include: { order: true },
    });
    await prisma.order.update({ where: { id: existing.orderId }, data: { status: 'FULFILLED' } });
    await emitEvent({
      organizationId: req.user!.organizationId!,
      event: 'order.fulfilled',
      data: { orderId: existing.orderId, type: 'DELIVERY' },
    });
    res.json({ success: true, data: delivery });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Marketplace / Commerce integrations (§13, §30) ────────────

const COMMERCE_INTEGRATION_TYPES = ['ECOMMERCE', 'MARKETPLACE', 'DELIVERY'];

router.get('/integrations', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const integrations = await prisma.integrationConnection.findMany({
      where: { organizationId: req.user!.organizationId, type: { in: COMMERCE_INTEGRATION_TYPES } },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: integrations });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/integrations', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(integrationSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { credentials, ...restBody } = req.body;
    const integration = await prisma.integrationConnection.create({
      data: {
        ...restBody,
        ...(credentials !== undefined ? { credentials: encryptJson(credentials) } : {}),
        organizationId: req.user!.organizationId!,
        status: 'CONNECTED',
      },
    });
    res.status(201).json({ success: true, data: integration });
  } catch (error) {
    handleError(error, res);
  }
});

router.put('/integrations/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, status, config } = req.body;
    const integration = await prisma.integrationConnection.update({
      where: { id: String(req.params.id) },
      data: { ...(name !== undefined ? { name } : {}), ...(status !== undefined ? { status } : {}), ...(config !== undefined ? { config } : {}) },
    });
    res.json({ success: true, data: integration });
  } catch (error) {
    handleError(error, res);
  }
});

router.delete('/integrations/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.integrationConnection.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true, message: 'Integration disconnected' });
  } catch (error) {
    handleError(error, res);
  }
});

// Trigger a (simulated) sync of products/orders/inventory with the channel
router.post('/integrations/:id/sync', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const connection = await prisma.integrationConnection.findFirst({
      where: { id: String(req.params.id), organizationId: orgId },
    });
    if (!connection) return res.status(404).json({ success: false, error: 'Integration not found' });

    await prisma.integrationConnection.update({ where: { id: connection.id }, data: { syncStatus: 'SYNCING' } });

    // Summarize what would be synchronized (single source of truth, §50)
    const [products, orders, inventory] = await Promise.all([
      prisma.product.count({ where: { organizationId: orgId } }),
      prisma.order.count({ where: { organizationId: orgId, channel: connection.provider.toUpperCase() } }),
      prisma.inventoryBalance.count({ where: { product: { organizationId: orgId } } }),
    ]);

    const updated = await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: { syncStatus: 'IDLE', lastSyncAt: new Date(), status: 'CONNECTED' },
    });

    await emitEvent({
      organizationId: orgId,
      event: 'integration.synced',
      data: { provider: connection.provider, products, orders, inventory },
    });

    res.json({ success: true, data: { integration: updated, synced: { products, orders, inventory } } });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Omnichannel inventory (§13, principle 3: one inventory) ───

router.get('/inventory/omnichannel', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { search } = req.query as Record<string, string>;
    const balances = await prisma.inventoryBalance.findMany({
      where: {
        product: {
          organizationId: orgId,
          ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
        },
      },
      include: { product: true, location: { select: { id: true, name: true } } },
    });

    // Aggregate per product across all locations → available-to-promise
    const byProduct = new Map<string, any>();
    for (const b of balances) {
      const entry = byProduct.get(b.productId) || {
        productId: b.productId,
        name: b.product.name,
        sku: (b.product as any).sku,
        totalOnHand: 0,
        totalReserved: 0,
        availableToPromise: 0,
        reorderPoint: 0,
        locations: [] as any[],
      };
      const available = b.quantity - b.reserved;
      entry.totalOnHand += b.quantity;
      entry.totalReserved += b.reserved;
      entry.availableToPromise += available;
      entry.reorderPoint += b.reorderPoint;
      entry.locations.push({ locationId: b.locationId, locationName: b.location?.name, onHand: b.quantity, reserved: b.reserved, available });
      byProduct.set(b.productId, entry);
    }

    const data = Array.from(byProduct.values()).map((p) => ({
      ...p,
      lowStock: p.availableToPromise <= p.reorderPoint,
    }));

    res.json({ success: true, data });
  } catch (error) {
    handleError(error, res);
  }
});

// Best location to fulfill an online order (endless aisle / cross-location, §13)
router.post('/fulfillment/source', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { productId, quantity } = req.body as { productId: string; quantity?: number };
    const need = Number(quantity ?? 1);

    const balances = await prisma.inventoryBalance.findMany({
      where: { productId, product: { organizationId: orgId } },
      include: { location: { select: { id: true, name: true } } },
    });

    const options = balances
      .map((b) => ({ locationId: b.locationId, locationName: b.location?.name, available: b.quantity - b.reserved }))
      .filter((o) => o.available >= need)
      .sort((a, b) => b.available - a.available);

    res.json({
      success: true,
      data: {
        productId,
        required: need,
        canFulfill: options.length > 0,
        recommendedLocation: options[0] || null,
        options,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
