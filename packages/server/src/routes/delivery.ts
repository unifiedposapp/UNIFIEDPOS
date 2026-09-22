// ─── Delivery dispatch (§ delivery aggregators) ──────────────────────────────
// Turns a paid DELIVERY order into a job a courier network can act on, and
// turns the courier's callbacks back into order status the merchant and the
// customer can see. Connections live in IntegrationConnection (type DELIVERY)
// with the partner secret encrypted at rest, so this needs no new table.
//
// The inbound webhook is mounted separately in index.ts with a RAW body parser:
// a signature over re-serialized JSON verifies nothing.

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError, HttpError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { emitEvent } from '../services/eventBus.js';
import { decryptJson, encryptJson } from '../services/crypto.js';
import { round2 } from '../services/moneyMath.js';
import {
  DELIVERY_STATUSES,
  DELIVERY_CHANNELS,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  buildDispatchPayload,
  dispatchOrder,
  fetchDeliveryStatus,
  findChannel,
  isProgressiveStatus,
  parseStatusWebhook,
  signDeliveryPayload,
  verifyDeliverySignature,
  type DispatchOrder,
} from '../services/deliveryChannels.js';

const router = Router();

const DELIVERY_TYPE = 'DELIVERY';

interface ChannelCredentials {
  apiKey?: string | null;
  webhookSecret?: string | null;
}

interface ChannelConfigJson {
  dispatchUrl?: string | null;
  statusUrlTemplate?: string | null;
  headers?: Record<string, string> | null;
  autoDispatch?: boolean;
}

/** Never hand a secret back to the browser — report presence, not value. */
function publicConnection(row: any) {
  const credentials = decryptJson<ChannelCredentials>(JSON.stringify(row.credentials ?? null)) ?? null;
  const config = (row.config ?? {}) as ChannelConfigJson;
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    status: row.status,
    channel: findChannel(row.provider) ?? null,
    lastSyncAt: row.lastSyncAt,
    errorMessage: row.errorMessage,
    config: {
      dispatchUrl: config.dispatchUrl ?? null,
      statusUrlTemplate: config.statusUrlTemplate ?? null,
      autoDispatch: Boolean(config.autoDispatch),
    },
    hasApiKey: Boolean(credentials?.apiKey),
    hasWebhookSecret: Boolean(credentials?.webhookSecret),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadConnection(organizationId: string, provider: string) {
  const row = await prisma.integrationConnection.findFirst({
    where: { organizationId, provider, type: DELIVERY_TYPE },
    orderBy: { updatedAt: 'desc' },
  });
  return row;
}

function configOf(row: any) {
  const config = (row?.config ?? {}) as ChannelConfigJson;
  const credentials = decryptJson<ChannelCredentials>(JSON.stringify(row?.credentials ?? null)) ?? {};
  return {
    dispatchUrl: config.dispatchUrl || null,
    statusUrlTemplate: config.statusUrlTemplate || null,
    headers: config.headers || null,
    apiKey: credentials.apiKey || null,
    webhookSecret: credentials.webhookSecret || null,
  };
}

// ═══════════════════════════════════════════════════════════════ CATALOG / CRUD

// GET /api/delivery/channels — what can be connected, and is it connected yet
router.get('/channels', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const rows = await prisma.integrationConnection.findMany({ where: { organizationId: orgId, type: DELIVERY_TYPE } });
    const byProvider = new Map(rows.map((r) => [r.provider, r]));
    res.json({
      success: true,
      data: DELIVERY_CHANNELS.map((channel) => {
        const row = byProvider.get(channel.provider);
        return {
          ...channel,
          connected: Boolean(row),
          connectionId: row?.id ?? null,
          status: row?.status ?? 'DISCONNECTED',
        };
      }),
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/delivery/connections
router.get('/connections', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const rows = await prisma.integrationConnection.findMany({
      where: { organizationId: req.user!.organizationId!, type: DELIVERY_TYPE },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: rows.map(publicConnection) });
  } catch (error) {
    handleError(error, res);
  }
});

const connectSchema = z.object({
  provider: z.enum(DELIVERY_CHANNELS.map((c) => c.provider) as [string, ...string[]]),
  name: z.string().min(1).max(120).optional(),
  config: z
    .object({
      dispatchUrl: z.string().url().max(500).nullable().optional(),
      statusUrlTemplate: z.string().max(500).nullable().optional(),
      headers: z.record(z.string().max(80), z.string().max(200)).optional(),
      autoDispatch: z.boolean().optional(),
    })
    .optional(),
  credentials: z
    .object({
      apiKey: z.string().max(400).nullable().optional(),
      webhookSecret: z.string().max(400).nullable().optional(),
    })
    .optional(),
  active: z.boolean().optional(),
});

// POST /api/delivery/connect — create or replace a channel's wiring
router.post('/connect', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(connectSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof connectSchema>;
    if (!findChannel(body.provider)) throw new HttpError(400, 'Unknown delivery channel');
    const existing = await loadConnection(orgId, body.provider);

    // Config merges so a later edit can rotate one secret without losing the URL.
    const previous = (existing?.config ?? {}) as ChannelConfigJson;
    const config: ChannelConfigJson = { ...previous, ...(body.config ?? {}) };
    if (body.config && 'dispatchUrl' in body.config) config.dispatchUrl = body.config.dispatchUrl ?? null;
    if (body.config && 'statusUrlTemplate' in body.config) config.statusUrlTemplate = body.config.statusUrlTemplate ?? null;

    const previousCredentials = decryptJson<ChannelCredentials>(JSON.stringify(existing?.credentials ?? null)) ?? {};
    const credentials: ChannelCredentials = { ...previousCredentials };
    if (body.credentials && 'apiKey' in body.credentials) credentials.apiKey = body.credentials.apiKey ?? null;
    if (body.credentials && 'webhookSecret' in body.credentials) credentials.webhookSecret = body.credentials.webhookSecret ?? null;

    const data = {
      provider: body.provider,
      type: DELIVERY_TYPE,
      name: body.name || findChannel(body.provider)!.name,
      status: body.active === false ? 'DISCONNECTED' : 'CONNECTED',
      config: config as any,
      credentials: encryptJson(credentials) as any,
      errorMessage: null,
    };

    const row = existing
      ? await prisma.integrationConnection.update({ where: { id: existing.id }, data })
      : await prisma.integrationConnection.create({ data: { ...data, organizationId: orgId } });

    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: existing ? 'DELIVERY_CHANNEL_UPDATED' : 'DELIVERY_CHANNEL_CONNECTED',
      resourceType: 'INTEGRATION',
      resourceId: row.id,
      newValue: { provider: row.provider, status: row.status, dispatchUrl: config.dispatchUrl ?? null },
    });
    res.status(existing ? 200 : 201).json({ success: true, data: publicConnection(row) });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/delivery/connect/:id — disconnect (history of dispatched orders stays)
router.delete('/connect/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const row = await prisma.integrationConnection.findFirst({
      where: { id: String(req.params.id), organizationId: req.user!.organizationId!, type: DELIVERY_TYPE },
    });
    if (!row) throw new HttpError(404, 'Delivery connection not found');
    await prisma.integrationConnection.delete({ where: { id: row.id } });
    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: 'DELIVERY_CHANNEL_DISCONNECTED',
      resourceType: 'INTEGRATION',
      resourceId: row.id,
      previousValue: { provider: row.provider },
    });
    res.json({ success: true, data: { id: row.id, deleted: true } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/delivery/connect/:id/ping — prove the handshake without moving goods
router.post('/connect/:id/ping', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const row = await prisma.integrationConnection.findFirst({ where: { id: String(req.params.id), organizationId: orgId, type: DELIVERY_TYPE } });
    if (!row) throw new HttpError(404, 'Delivery connection not found');
    const config = configOf(row);
    const started = Date.now();
    const probe = await dispatchOrder(row.provider, probeOrder(orgId), config);
    const latencyMs = Date.now() - started;
    const updated = await prisma.integrationConnection.update({
      where: { id: row.id },
      data: {
        lastSyncAt: new Date(),
        syncStatus: 'IDLE',
        status: probe.error ? 'ERROR' : 'CONNECTED',
        errorMessage: probe.error ?? null,
      },
    });
    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: 'DELIVERY_CHANNEL_PING',
      resourceType: 'INTEGRATION',
      resourceId: row.id,
      newValue: { ok: !probe.error, simulated: probe.simulated, latencyMs, error: probe.error ?? null },
    });
    res.json({
      success: true,
      data: {
        ok: !probe.error,
        simulated: probe.simulated,
        latencyMs,
        error: probe.error ?? null,
        // The exact bytes a partner must accept, including the signature header.
        sampleRequest: probe.request,
        signatureHeaderPreview: config.webhookSecret
          ? { [TIMESTAMP_HEADER]: '<unix seconds>', [SIGNATURE_HEADER]: signDeliveryPayload('<secret>', '<unix seconds>', '<raw body>') }
          : null,
        status: updated.status,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

/** A never-stored, obviously synthetic order used only by /ping. */
function probeOrder(orgId: string): DispatchOrder {
  return {
    orderId: `ping-${orgId}`,
    orderNumber: 'PING-0000',
    storeName: 'Connectivity test',
    currency: 'USD',
    totalAmount: 0,
    deliveryFee: 0,
    dropoff: { recipientName: 'Test Drop', addressLine1: '1 Test Street', city: 'Testville', postalCode: '00000', country: 'US' },
    items: [{ name: 'Test parcel', quantity: 1 }],
    idempotencyKey: `ping-${Date.now()}`,
  };
}

// ════════════════════════════════════════════════════════════ DISPATCH PIPELINE

/** The order → payload projection, shared by dispatch and the queue preview. */
async function toDispatchOrder(orgId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, organizationId: orgId },
    include: { items: true, fulfillments: true, location: { select: { name: true } } },
  });
  if (!order) throw new HttpError(404, 'Order not found');
  const fulfillment = order.fulfillments.find((f) => f.type === 'DELIVERY') ?? order.fulfillments[0] ?? null;
  if (!fulfillment) throw new HttpError(400, 'This order has no fulfillment to dispatch');
  const settings = await prisma.storeSettings.findUnique({ where: { organizationId: orgId }, select: { storeName: true, currency: true } });
  const dispatch: DispatchOrder = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    storeName: settings?.storeName || order.location?.name || 'Store',
    currency: order.currency || settings?.currency || 'USD',
    totalAmount: round2(Number(order.totalAmount)),
    deliveryFee: round2(Number(fulfillment.deliveryFee || 0)),
    pickupBy: fulfillment.readyAt ?? fulfillment.scheduledAt ?? order.createdAt,
    dropoff: {
      recipientName: fulfillment.recipientName,
      phone: fulfillment.phoneNumber,
      addressLine1: fulfillment.addressLine1,
      addressLine2: fulfillment.addressLine2,
      city: fulfillment.city,
      state: fulfillment.state,
      postalCode: fulfillment.postalCode,
      country: fulfillment.country,
      notes: order.notes,
    },
    items: order.items.map((i) => ({ name: i.productName, quantity: i.quantity })),
  };
  return { order, fulfillment, dispatch };
}

// GET /api/delivery/queue — delivery orders awaiting or in flight
router.get('/queue', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const orders = await prisma.order.findMany({
      where: {
        organizationId: orgId,
        status: { in: ['CONFIRMED', 'PAID', 'PROCESSING'] },
        fulfillments: { some: { type: 'DELIVERY' } },
      },
      include: { items: { select: { productName: true, quantity: true } }, fulfillments: true, location: { select: { name: true } }, customer: { select: { name: true, phone: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const rows = orders.map((order) => {
      const fulfillment = order.fulfillments.find((f) => f.type === 'DELIVERY')!;
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        channel: order.channel,
        orderStatus: order.status,
        locationName: order.location?.name ?? null,
        totalAmount: round2(Number(order.totalAmount)),
        currency: order.currency,
        placedAt: order.createdAt,
        customer: fulfillment.recipientName || order.customer?.name || null,
        phone: fulfillment.phoneNumber || order.customer?.phone || null,
        address: [fulfillment.addressLine1, fulfillment.city, fulfillment.postalCode].filter(Boolean).join(', '),
        itemCount: order.items.reduce((s, i) => s + i.quantity, 0),
        deliveryStatus: fulfillment.status,
        provider: fulfillment.carrier || null,
        externalId: fulfillment.trackingNumber || null,
        etaMinutes: fulfillment.etaMinutes ?? null,
        dispatchedAt: fulfillment.updatedAt,
      };
    });
    res.json({ success: true, data: rows });
  } catch (error) {
    handleError(error, res);
  }
});

const dispatchSchema = z.object({
  provider: z.string().max(60).optional(),
  idempotencyKey: z.string().max(120).optional(),
  notes: z.string().max(400).optional(),
});

// POST /api/delivery/orders/:orderId/dispatch — hand the order to a channel
router.post('/orders/:orderId/dispatch', authMiddleware, validateRequest(dispatchSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof dispatchSchema>;
    const { order, fulfillment, dispatch } = await toDispatchOrder(orgId, String(req.params.orderId));
    if (fulfillment.trackingNumber && ['PICKED_UP', 'DELIVERED'].includes(fulfillment.status)) {
      throw new HttpError(409, `This delivery is already ${fulfillment.status.toLowerCase()}`);
    }

    const provider = body.provider || fulfillment.carrier || (await pickProvider(orgId));
    if (!provider) throw new HttpError(400, 'No delivery channel is connected. Connect one first.');
    const connection = await loadConnection(orgId, provider);
    if (!connection) throw new HttpError(404, `The ${provider} channel is not connected`);

    const result = await dispatchOrder(provider, { ...dispatch, idempotencyKey: body.idempotencyKey || fulfillment.id }, configOf(connection));
    if (result.error) {
      await prisma.integrationConnection.update({ where: { id: connection.id }, data: { status: 'ERROR', errorMessage: result.error, syncStatus: 'ERROR' } });
      await createAuditEvent({
        organizationId: orgId,
        actorId: req.user!.employeeId,
        action: 'DELIVERY_DISPATCH_FAILED',
        resourceType: 'ORDER',
        resourceId: order.id,
        newValue: { provider, error: result.error },
      });
      throw new HttpError(502, result.error);
    }

    const channel = findChannel(provider);
    const updated = await prisma.orderFulfillment.update({
      where: { id: fulfillment.id },
      data: {
        status: result.status === 'REQUESTED' ? 'OUT_FOR_DELIVERY' : mapToOrderStatus(result.status),
        carrier: channel?.name || provider,
        trackingNumber: result.externalId,
        etaMinutes: result.etaMinutes,
        notes: [
          body.notes || null,
          result.trackingUrl ? `Track: ${result.trackingUrl}` : null,
          result.simulated ? 'Simulated dispatch — no delivery endpoint is configured for this channel.' : null,
        ]
          .filter(Boolean)
          .join(' | ') || fulfillment.notes,
      },
    });
    await prisma.integrationConnection.update({ where: { id: connection.id }, data: { lastSyncAt: new Date(), syncStatus: 'IDLE', errorMessage: null } });
    await emitEvent({
      organizationId: orgId,
      event: 'order.delivered_dispatched',
      data: { orderId: order.id, orderNumber: order.orderNumber, provider, externalId: result.externalId, simulated: result.simulated },
      metadata: { source: 'delivery' },
    });
    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: 'DELIVERY_DISPATCHED',
      resourceType: 'ORDER',
      resourceId: order.id,
      newValue: { provider, externalId: result.externalId, status: updated.status, simulated: result.simulated },
    });
    res.status(201).json({
      success: true,
      data: {
        orderId: order.id,
        provider,
        externalId: result.externalId,
        status: updated.status,
        etaMinutes: result.etaMinutes,
        trackingUrl: result.trackingUrl,
        simulated: result.simulated,
        request: buildDispatchPayload(dispatch, body.idempotencyKey || fulfillment.id),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/delivery/orders/:orderId/track — pull the current status
router.post('/orders/:orderId/track', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { fulfillment } = await toDispatchOrder(orgId, String(req.params.orderId));
    if (!fulfillment.carrier) throw new HttpError(400, 'This order has not been dispatched yet');
    const provider = providerFromCarrier(fulfillment.carrier);
    const connection = provider ? await loadConnection(orgId, provider) : null;
    const status = await fetchDeliveryStatus(configOf(connection), fulfillment.trackingNumber || '', mapFromOrderStatus(fulfillment.status));
    const data: any = {};
    if (status.etaMinutes != null) data.etaMinutes = status.etaMinutes;
    if (status.courier) data.courier = status.courier;
    if (isProgressiveStatus(fulfillment.status, status.status)) {
      data.status = mapToOrderStatus(status.status);
      if (status.status === 'DELIVERED') data.deliveredAt = new Date();
    }
    const updated = Object.keys(data).length ? await prisma.orderFulfillment.update({ where: { id: fulfillment.id }, data }) : fulfillment;
    res.json({
      success: true,
      data: {
        status: updated.status,
        courier: updated.courier,
        etaMinutes: updated.etaMinutes,
        simulated: status.simulated,
        error: status.error ?? null,
        provider: fulfillment.carrier,
        externalId: fulfillment.trackingNumber,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/delivery/overview — the dispatch health board
router.get('/overview', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [connections, fulfillments, delivered] = await Promise.all([
      prisma.integrationConnection.findMany({ where: { organizationId: orgId, type: DELIVERY_TYPE }, orderBy: { name: 'asc' } }),
      prisma.orderFulfillment.findMany({
        where: { type: 'DELIVERY', order: { organizationId: orgId }, createdAt: { gte: since } },
        select: { status: true, carrier: true, trackingNumber: true, deliveredAt: true, createdAt: true, etaMinutes: true },
      }),
      prisma.orderFulfillment.count({ where: { type: 'DELIVERY', status: 'DELIVERED', order: { organizationId: orgId }, deliveredAt: { gte: since } } }),
    ]);
    const byStatus: Record<string, number> = {};
    const byProvider: Record<string, { dispatched: number; delivered: number; minutes: number }> = {};
    let minutesSum = 0;
    let minutesCount = 0;
    for (const f of fulfillments) {
      byStatus[f.status] = (byStatus[f.status] || 0) + 1;
      if (!f.carrier) continue;
      const bucket = byProvider[f.carrier] || { dispatched: 0, delivered: 0, minutes: 0 };
      bucket.dispatched += 1;
      if (f.status === 'DELIVERED') {
        bucket.delivered += 1;
        if (f.deliveredAt) {
          const mins = (new Date(f.deliveredAt).getTime() - new Date(f.createdAt).getTime()) / 60000;
          if (Number.isFinite(mins) && mins >= 0 && mins < 600) {
            minutesSum += mins;
            minutesCount += 1;
            bucket.minutes += mins;
          }
        }
      }
      byProvider[f.carrier] = bucket;
    }
    res.json({
      success: true,
      data: {
        windowDays: 30,
        connections: connections.map(publicConnection),
        dispatched: fulfillments.filter((f) => f.trackingNumber).length,
        delivered,
        awaitingDispatch: fulfillments.filter((f) => !f.trackingNumber).length,
        byStatus,
        averageDeliveryMinutes: minutesCount ? Math.round(minutesSum / minutesCount) : null,
        onTimeRate: fulfillments.length ? round2((delivered / fulfillments.length) * 100) : null,
        byProvider: Object.entries(byProvider).map(([carrier, d]) => ({
          carrier,
          dispatched: d.dispatched,
          delivered: d.delivered,
          averageMinutes: d.delivered ? Math.round(d.minutes / d.delivered) : null,
        })),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// ════════════════════════════════════════════════════════════ STATUS VOCABULARY

/** Channel status → the fulfillment status the rest of the app uses. */
function mapToOrderStatus(status: (typeof DELIVERY_STATUSES)[number]): string {
  switch (status) {
    case 'REQUESTED':
    case 'ACCEPTED':
      return 'PENDING';
    case 'ASSIGNED':
      return 'OUT_FOR_DELIVERY';
    case 'PICKED_UP':
      return 'OUT_FOR_DELIVERY';
    case 'DELIVERED':
      return 'DELIVERED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'FAILED':
    default:
      return 'FAILED';
  }
}

function mapFromOrderStatus(status: string): (typeof DELIVERY_STATUSES)[number] {
  if (status === 'DELIVERED' || status === 'COMPLETED') return 'DELIVERED';
  if (status === 'CANCELLED') return 'CANCELLED';
  if (status === 'FAILED') return 'FAILED';
  if (status === 'OUT_FOR_DELIVERY' || status === 'SHIPPED') return 'PICKED_UP';
  return 'REQUESTED';
}

/** The carrier column stores the display name; resolve it back to a provider key. */
function providerFromCarrier(carrier: string): string | null {
  const match = DELIVERY_CHANNELS.find((c) => c.name === carrier || c.provider === carrier);
  return match?.provider ?? null;
}

async function pickProvider(orgId: string): Promise<string | null> {
  const row = await prisma.integrationConnection.findFirst({
    where: { organizationId: orgId, type: DELIVERY_TYPE, status: 'CONNECTED' },
    orderBy: { updatedAt: 'desc' },
  });
  return row?.provider ?? null;
}

/**
 * Hook for the ordering channels: when a merchant ticked "auto-dispatch" on a
 * connected channel, a fresh DELIVERY order goes to the courier without anyone
 * touching it. Never throws — an ordering flow must not fail because a partner
 * endpoint is down; the order simply stays in the dispatch queue.
 */
export async function autoDispatchOrder(organizationId: string, orderId: string): Promise<{ dispatched: boolean; reason: string }> {
  const connections = await prisma.integrationConnection.findMany({
    where: { organizationId, type: DELIVERY_TYPE, status: 'CONNECTED' },
    orderBy: { updatedAt: 'desc' },
  });
  const target = connections.find((c) => (c.config as ChannelConfigJson | null)?.autoDispatch);
  if (!target) return { dispatched: false, reason: 'no_auto_dispatch_channel' };
  try {
    const { fulfillment, dispatch } = await toDispatchOrder(organizationId, orderId);
    if (fulfillment.type !== 'DELIVERY') return { dispatched: false, reason: 'not_a_delivery_order' };
    if (fulfillment.trackingNumber) return { dispatched: false, reason: 'already_dispatched' };
    const result = await dispatchOrder(target.provider, { ...dispatch, idempotencyKey: fulfillment.id }, configOf(target));
    if (result.error) {
      await prisma.integrationConnection.update({ where: { id: target.id }, data: { status: 'ERROR', errorMessage: result.error, syncStatus: 'ERROR' } });
      return { dispatched: false, reason: result.error };
    }
    const channel = findChannel(target.provider);
    await prisma.orderFulfillment.update({
      where: { id: fulfillment.id },
      data: {
        status: result.status === 'REQUESTED' ? 'OUT_FOR_DELIVERY' : mapToOrderStatus(result.status),
        carrier: channel?.name || target.provider,
        trackingNumber: result.externalId,
        etaMinutes: result.etaMinutes,
        notes: [fulfillment.notes, result.trackingUrl ? `Track: ${result.trackingUrl}` : null, result.simulated ? 'Auto-dispatched (simulated)' : 'Auto-dispatched']
          .filter(Boolean)
          .join(' | '),
      },
    });
    await emitEvent({
      organizationId,
      event: 'order.delivered_dispatched',
      data: { orderId, provider: target.provider, externalId: result.externalId, simulated: result.simulated, auto: true },
      metadata: { source: 'delivery' },
    });
    await createAuditEvent({
      organizationId,
      action: 'DELIVERY_AUTO_DISPATCHED',
      resourceType: 'ORDER',
      resourceId: orderId,
      newValue: { provider: target.provider, externalId: result.externalId, simulated: result.simulated },
    });
    return { dispatched: true, reason: `${target.provider}:${result.externalId}` };
  } catch (error) {
    return { dispatched: false, reason: (error as Error)?.message || 'dispatch_failed' };
  }
}

// ══════════════════════════════════════════════════ INBOUND WEBHOOK (public)

/**
 * POST /api/delivery/webhooks/:provider — courier status callback.
 * Mounted with express.raw() in index.ts; the signature covers the exact bytes.
 */
export async function deliveryWebhookHandler(req: Request, res: Response): Promise<void> {
  const provider = String(req.params.provider || '').trim().toLowerCase();
  const channel = findChannel(provider);
  if (!channel) {
    res.status(404).json({ success: false, message: 'Unknown delivery channel' });
    return;
  }
  const raw = Buffer.isBuffer((req as any).body) ? (req as any).body.toString('utf8') : JSON.stringify((req as any).body ?? '');

  // Which merchant owns this callback? A channel secret is per connection, so
  // try every connection for this provider and accept the first signature that
  // matches — a wrong secret cannot forge one.
  const connections = await prisma.integrationConnection.findMany({ where: { provider, type: DELIVERY_TYPE } });
  let matched: { row: any; secret: string } | null = null;
  for (const row of connections) {
    const secret = decryptJson<ChannelCredentials>(JSON.stringify(row.credentials ?? null))?.webhookSecret;
    if (!secret) continue;
    const verdict = verifyDeliverySignature({
      secret,
      rawBody: raw,
      signature: req.header(SIGNATURE_HEADER) || req.header('signature') || req.header('x-signature'),
      timestamp: req.header(TIMESTAMP_HEADER) || req.header('timestamp'),
    });
    if (verdict.ok) {
      matched = { row, secret };
      break;
    }
  }

  if (!matched) {
    const anySecret = connections.some((row) => decryptJson<ChannelCredentials>(JSON.stringify(row.credentials ?? null))?.webhookSecret);
    res.status(401).json({ success: false, message: anySecret ? 'Invalid webhook signature' : 'No shared secret is configured for this channel' });
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    res.status(400).json({ success: false, message: 'Body is not JSON' });
    return;
  }

  const event = parseStatusWebhook(body);
  if (!event) {
    // Acknowledge unknown vocabulary so the partner stops retrying, but log it.
    await createAuditEvent({
      organizationId: matched.row.organizationId,
      action: 'DELIVERY_WEBHOOK_IGNORED',
      resourceType: 'INTEGRATION',
      resourceId: matched.row.id,
      newValue: { provider, reason: 'unrecognized_status', raw: raw.slice(0, 400) },
    });
    res.json({ received: true, matched: false });
    return;
  }

  try {
    const orgId = matched.row.organizationId;
    const fulfillment =
      (event.externalId
        ? await prisma.orderFulfillment.findFirst({ where: { trackingNumber: event.externalId, order: { organizationId: orgId } }, include: { order: true } })
        : null) ??
      (event.orderId
        ? await prisma.orderFulfillment.findFirst({ where: { orderId: event.orderId, order: { organizationId: orgId }, type: 'DELIVERY' }, include: { order: true } })
        : null);
    if (!fulfillment) {
      await createAuditEvent({
        organizationId: orgId,
        action: 'DELIVERY_WEBHOOK_UNMATCHED',
        resourceType: 'INTEGRATION',
        resourceId: matched.row.id,
        newValue: { provider, externalId: event.externalId, orderId: event.orderId, status: event.status },
      });
      res.json({ received: true, matched: false });
      return;
    }

    const data: any = {};
    if (isProgressiveStatus(fulfillment.status, event.status)) {
      data.status = mapToOrderStatus(event.status);
      if (event.status === 'DELIVERED') data.deliveredAt = new Date();
    }
    if (event.courier) data.courier = event.courier;
    if (event.etaMinutes != null) data.etaMinutes = event.etaMinutes;
    if (event.trackingUrl) data.notes = `Track: ${event.trackingUrl}`;
    const updated = Object.keys(data).length ? await prisma.orderFulfillment.update({ where: { id: fulfillment.id }, data }) : fulfillment;

    // A delivered parcel closes the order; a cancelled one gives stock back.
    if (event.status === 'DELIVERED' && fulfillment.order && !['COMPLETED', 'FULFILLED', 'REFUNDED'].includes(fulfillment.order.status)) {
      await prisma.order.update({ where: { id: fulfillment.orderId }, data: { status: 'COMPLETED', completedAt: new Date() } });
    }
    if (event.status === 'CANCELLED' && fulfillment.order?.locationId) {
      const items = await prisma.orderItem.findMany({ where: { orderId: fulfillment.orderId } });
      for (const item of items) {
        const balance = await prisma.inventoryBalance.findFirst({ where: { productId: item.productId, locationId: fulfillment.order.locationId } });
        if (!balance) continue;
        const product = await prisma.product.findUnique({ where: { id: item.productId }, select: { type: true } });
        if (product?.type !== 'PHYSICAL') continue;
        await prisma.inventoryBalance.update({ where: { id: balance.id }, data: { quantity: { increment: item.quantity } } });
        await prisma.inventoryMovement.create({
          data: { balanceId: balance.id, type: 'RETURN', quantity: item.quantity, reference: fulfillment.order.orderNumber, notes: 'Delivery cancelled by channel' },
        });
      }
    }

    await emitEvent({
      organizationId: orgId,
      event: 'order.delivery_status',
      data: {
        orderId: fulfillment.orderId,
        orderNumber: fulfillment.order?.orderNumber ?? null,
        provider,
        status: updated.status,
        courier: updated.courier,
        etaMinutes: updated.etaMinutes,
      },
      metadata: { source: 'delivery' },
    });
    res.json({ received: true, matched: true, status: updated.status });
  } catch (error) {
    // 500 asks the partner to retry; the event is idempotent thanks to the
    // monotonic status check above.
    console.error('[delivery-webhook] handler error:', error);
    res.status(500).json({ success: false, message: 'Webhook handler error' });
  }
}

export default router;
