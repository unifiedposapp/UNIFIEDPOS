/**
 * Sales-channel connectors (§8 omnichannel) — Shopify, WooCommerce, BigCommerce.
 *
 * The previous `/commerce/integrations/:id/sync` counted local rows and set a
 * status flag, which is a sync that calls nobody. This module replaces that
 * pretence: it stores an encrypted merchant credential, makes real authenticated
 * REST calls, imports orders idempotently, pushes catalog and stock, and verifies
 * inbound webhook signatures before trusting them.
 *
 * Credentials are AES-256-GCM encrypted at rest (services/crypto) and never
 * returned by any endpoint — the list route exposes only `hasToken`.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { decryptText, encryptText } from '../services/crypto.js';
import {
  describeFailure,
  fetchChannelOrders,
  fetchChannelProducts,
  isChannelProvider,
  mapExternalOrder,
  mapExternalProduct,
  providerLabel,
  pushInventory,
  pushProduct,
  testConnection,
  verifyChannelWebhook,
  type ChannelCredentials,
  type ChannelProvider,
} from '../services/channels.js';

const router = Router();

const MANAGERS = requireRole('OWNER', 'ADMIN', 'MANAGER');

const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

type ConnectionRow = {
  id: string;
  organizationId: string;
  provider: string;
  label: string;
  shopDomain: string;
  accessTokenEncrypted: string | null;
  webhookSecretEncrypted: string | null;
  apiVersion: string | null;
  scopes: string[];
  locationMap: unknown;
  status: string;
  lastSyncAt: Date | null;
  lastError: string | null;
  cursor: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function publicView(row: ConnectionRow) {
  return {
    id: row.id,
    provider: row.provider,
    providerLabel: providerLabel(row.provider),
    label: row.label,
    shopDomain: row.shopDomain,
    apiVersion: row.apiVersion,
    scopes: row.scopes,
    locationMap: row.locationMap,
    status: row.status,
    lastSyncAt: row.lastSyncAt,
    lastError: row.lastError,
    cursor: row.cursor,
    // Presence flags only: the token itself never leaves the server.
    hasToken: Boolean(row.accessTokenEncrypted),
    hasWebhookSecret: Boolean(row.webhookSecretEncrypted),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function credentialsOf(row: ConnectionRow): ChannelCredentials | null {
  if (!row.accessTokenEncrypted) return null;
  return {
    shopDomain: row.shopDomain,
    accessToken: decryptText(row.accessTokenEncrypted),
    webhookSecret: row.webhookSecretEncrypted ? decryptText(row.webhookSecretEncrypted) : null,
    apiVersion: row.apiVersion,
  };
}

function providerOf(row: { provider: string }): ChannelProvider | null {
  return isChannelProvider(row.provider) ? (row.provider.toUpperCase() as ChannelProvider) : null;
}

/** Deterministic local order number per channel/order pair: re-import is a no-op. */
function channelOrderNumber(connectionId: string, provider: string, externalId: string): string {
  const prefix = provider.slice(0, 3).toUpperCase();
  return `CH-${prefix}-${connectionId.slice(0, 8)}-${externalId}`;
}

// ─── Connections ───────────────────────────────────────────────────────────

const connectionSchema = z.object({
  provider: z.string().min(1),
  label: z.string().min(1).max(160),
  shopDomain: z.string().min(3).max(255),
  accessToken: z.string().min(1).max(4096).optional(),
  webhookSecret: z.string().min(1).max(4096).nullable().optional(),
  apiVersion: z.string().max(40).nullable().optional(),
  locationMap: z.record(z.string()).nullable().optional(),
});

// GET /api/channels/providers - what can be connected, and what it needs
router.get('/providers', authMiddleware, (_req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    data: [
      {
        provider: 'SHOPIFY',
        label: 'Shopify',
        credentialLabel: 'Admin API access token',
        credentialHint: 'Settings > Apps > Develop apps > API credentials > Admin API access token (write_products, read_orders, write_inventory)',
        webhookHint: 'Create webhooks for orders/create, orders/paid, products/update with format JSON; the signing secret is the app client secret.',
      },
      {
        provider: 'WOOCOMMERCE',
        label: 'WooCommerce',
        credentialLabel: 'Consumer key:consumer secret',
        credentialHint: 'WooCommerce > Settings > Advanced > REST API > Add key (Read/Write). Paste as "ck_xxx:cs_xxx".',
        webhookHint: 'WooCommerce > Settings > Advanced > Webhooks — the secret field is the signing secret.',
      },
      {
        provider: 'BIGCOMMERCE',
        label: 'BigCommerce',
        credentialLabel: 'Store API access token',
        credentialHint: 'Settings > API accounts > Create API account (Products, Orders, Inventory read/write).',
        webhookHint: 'Webhooks > Create > scope "store/order/*"; the client secret signs the payload.',
      },
    ],
  });
});

// GET /api/channels
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const rows = await prisma.channelConnection.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } });
    res.json({ success: true, data: rows.map(publicView) });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/channels - add a connection and prove the credentials immediately
router.post('/', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = connectionSchema.parse(req.body);
    const provider = String(body.provider).toUpperCase();
    if (!isChannelProvider(provider)) {
      return res.status(400).json({ success: false, message: `Unsupported channel provider "${body.provider}"` });
    }
    if (!body.accessToken) {
      return res.status(400).json({ success: false, message: 'An API access token is required to connect a channel' });
    }

    const shopDomain = body.shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');

    const created = await prisma.channelConnection.create({
      data: {
        organizationId,
        provider,
        label: body.label,
        shopDomain,
        accessTokenEncrypted: encryptText(body.accessToken),
        webhookSecretEncrypted: body.webhookSecret ? encryptText(body.webhookSecret) : null,
        apiVersion: body.apiVersion ?? null,
        locationMap: body.locationMap ?? undefined,
        status: 'PENDING',
      },
    });

    // A connection that has never answered is not "connected" — ask now.
    const probe = await testConnection(provider as ChannelProvider, credentialsOf(created as ConnectionRow)!);
    const saved = await prisma.channelConnection.update({
      where: { id: created.id },
      data: probe.ok
        ? { status: 'CONNECTED', lastError: null, lastSyncAt: new Date() }
        : { status: 'ERROR', lastError: describeFailure(probe) },
    });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'CHANNEL_CONNECTED',
      resourceType: 'CHANNEL_CONNECTION',
      resourceId: created.id,
      newValue: { provider, shopDomain, status: saved.status },
    });

    res.status(201).json({ success: true, data: publicView(saved as ConnectionRow), probe: probe.ok ? 'OK' : describeFailure(probe) });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/channels/:id
router.put('/:id', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const body = connectionSchema.partial().parse(req.body);

    const existing = await prisma.channelConnection.findFirst({ where: { id, organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Channel not found' });

    const updated = await prisma.channelConnection.update({
      where: { id },
      data: {
        label: body.label ?? existing.label,
        shopDomain: body.shopDomain ? body.shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '') : existing.shopDomain,
        accessTokenEncrypted: body.accessToken ? encryptText(body.accessToken) : existing.accessTokenEncrypted,
        webhookSecretEncrypted:
          body.webhookSecret === undefined
            ? existing.webhookSecretEncrypted
            : body.webhookSecret
              ? encryptText(body.webhookSecret)
              : null,
        apiVersion: body.apiVersion === undefined ? existing.apiVersion : body.apiVersion,
        locationMap: body.locationMap === undefined ? existing.locationMap ?? undefined : body.locationMap ?? undefined,
        // A credential change invalidates the previous success.
        status: body.accessToken ? 'PENDING' : existing.status,
      },
    });

    res.json({ success: true, data: publicView(updated as ConnectionRow) });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/channels/:id
router.delete('/:id', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const existing = await prisma.channelConnection.findFirst({ where: { id, organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Channel not found' });

    await prisma.externalProductMapping.deleteMany({ where: { organizationId, channelId: id } });
    await prisma.channelSyncLog.deleteMany({ where: { organizationId, channelId: id } });
    await prisma.channelConnection.delete({ where: { id } });

    res.json({ success: true, data: { id } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/channels/:id/test
router.post('/:id/test', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const row = await prisma.channelConnection.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!row) return res.status(404).json({ success: false, message: 'Channel not found' });

    const provider = providerOf(row);
    if (!provider) return res.status(400).json({ success: false, message: `Unsupported provider "${row.provider}"` });

    const cfg = credentialsOf(row as ConnectionRow);
    if (!cfg) {
      await prisma.channelConnection.update({ where: { id: row.id }, data: { status: 'ERROR', lastError: 'No credential stored' } });
      return res.status(400).json({ success: false, message: 'No credential stored for this channel' });
    }

    const probe = await testConnection(provider, cfg);
    await prisma.channelConnection.update({
      where: { id: row.id },
      data: probe.ok ? { status: 'CONNECTED', lastError: null } : { status: 'ERROR', lastError: describeFailure(probe) },
    });

    res.json({ success: probe.ok, data: probe.ok ? { label: probe.data.label } : null, message: probe.ok ? 'Credentials accepted' : describeFailure(probe) });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Sync ──────────────────────────────────────────────────────────────────

const syncSchema = z.object({
  direction: z.enum(['PUSH', 'PULL']),
  entity: z.enum(['PRODUCTS', 'ORDERS', 'INVENTORY']),
  limit: z.number().int().min(1).max(100).optional(),
  /** PULL PRODUCTS: create a local product when the SKU is unknown. */
  createMissing: z.boolean().optional(),
  /** PUSH: restrict to these local products (defaults to everything mapped). */
  productIds: z.array(z.string().min(1)).max(200).optional(),
  locationId: z.string().min(1).nullable().optional(),
  since: z.string().nullable().optional(),
});

async function pullProducts(organizationId: string, channelId: string, provider: ChannelProvider, cfg: ChannelCredentials, opts: z.infer<typeof syncSchema>) {
  const pulled = await fetchChannelProducts(provider, cfg, opts.limit ?? 50);
  if (!pulled.ok) return { ok: false as const, failure: pulled };

  let processed = 0;
  let failed = 0;
  const unmatched: string[] = [];

  for (const ext of pulled.data) {
    try {
      const existing = await prisma.externalProductMapping.findFirst({
        where: { channelId, OR: [{ externalId: ext.externalId }, ext.sku ? { externalSku: ext.sku } : { externalId: ext.externalId }] },
      });
      if (existing) {
        await prisma.externalProductMapping.update({
          where: { id: existing.id },
          data: { externalId: ext.externalId, externalSku: ext.sku ?? null, lastPushedAt: new Date() },
        });
        processed += 1;
        continue;
      }

      if (!ext.sku) {
        unmatched.push(`${ext.name} (no SKU)`);
        failed += 1;
        continue;
      }

      const local = await prisma.product.findFirst({ where: { organizationId, sku: ext.sku }, select: { id: true } });
      if (local) {
        await prisma.externalProductMapping.create({
          data: { organizationId, channelId, productId: local.id, externalId: ext.externalId, externalSku: ext.sku, lastPushedAt: new Date() },
        });
        processed += 1;
        continue;
      }

      if (!opts.createMissing) {
        unmatched.push(`${ext.name} (${ext.sku})`);
        failed += 1;
        continue;
      }

      const created = await prisma.product.create({
        data: {
          organizationId,
          name: ext.name || ext.sku,
          sku: ext.sku,
          barcode: ext.barcode ?? null,
          description: ext.description ?? null,
          price: money(ext.price),
          costPrice: 0,
          isActive: ext.isActive,
        },
      });
      await prisma.externalProductMapping.create({
        data: { organizationId, channelId, productId: created.id, externalId: ext.externalId, externalSku: ext.sku, lastPushedAt: new Date() },
      });
      processed += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    ok: true as const,
    processed,
    failed,
    message: unmatched.length ? `Unmatched SKUs: ${unmatched.slice(0, 10).join(', ')}` : 'Products imported',
  };
}

async function pullOrders(organizationId: string, connection: ConnectionRow, provider: ChannelProvider, cfg: ChannelCredentials, opts: z.infer<typeof syncSchema>) {
  const pulled = await fetchChannelOrders(provider, cfg, opts.since ?? connection.cursor ?? null, opts.limit ?? 50);
  if (!pulled.ok) return { ok: false as const, failure: pulled };

  let processed = 0;
  let failed = 0;
  let highest = connection.cursor;

  for (const ext of pulled.data) {
    const orderNumber = channelOrderNumber(connection.id, provider, ext.externalId);
    try {
      const existing = await prisma.order.findUnique({ where: { orderNumber }, select: { id: true } });
      if (existing) {
        processed += 1;
        continue;
      }

      const lines: {
        productId: string;
        productName: string;
        quantity: number;
        unitPrice: number;
        totalAmount: number;
      }[] = [];

      for (const line of ext.lines) {
        if (!line.sku) continue;
        const product = await prisma.product.findFirst({
          where: { organizationId, sku: line.sku },
          select: { id: true, name: true, price: true },
        });
        if (!product) continue;
        const unitPrice = money(line.unitPrice || Number(product.price));
        lines.push({
          productId: product.id,
          productName: product.name,
          quantity: Number(line.quantity) || 0,
          unitPrice,
          totalAmount: money(unitPrice * (Number(line.quantity) || 0)),
        });
      }

      if (lines.length === 0) {
        // An order we cannot map to the catalog would corrupt stock and margin;
        // record it as failed rather than importing a phantom sale.
        failed += 1;
        continue;
      }

      const subtotal = money(lines.reduce((s, l) => s + l.totalAmount, 0));
      const total = ext.total > 0 ? money(ext.total) : subtotal;
      const customer = ext.email
        ? await prisma.customer.findFirst({ where: { organizationId, email: ext.email }, select: { id: true } })
        : null;

      const order = await prisma.order.create({
        data: {
          organizationId,
          orderNumber,
          channel: 'WEBSITE',
          status: 'PAID',
          currency: ext.currency || 'USD',
          subtotal,
          totalAmount: total,
          taxAmount: money(Math.max(0, total - subtotal)),
          customerId: customer?.id ?? null,
          notes: `Imported from ${providerLabel(provider)} order ${ext.orderNumber}`,
          createdAt: new Date(ext.createdAt),
          items: { create: lines },
          payments: {
            create: {
              method: 'OTHER',
              provider: provider.toLowerCase(),
              amount: total,
              currency: ext.currency || 'USD',
              status: 'COMPLETED',
              reference: ext.externalId,
              metadata: { channelOrderNumber: ext.orderNumber, importedAt: new Date().toISOString() },
            },
          },
        },
        select: { id: true },
      });

      if (!customer && ext.email) {
        await prisma.order.update({ where: { id: order.id }, data: { notes: `Unlinked customer ${ext.email}` } });
      }

      processed += 1;
      if (!highest || new Date(ext.createdAt) > new Date(highest)) highest = ext.createdAt;
    } catch {
      failed += 1;
    }
  }

  return { ok: true as const, processed, failed, message: 'Orders imported', cursor: highest };
}

async function pushProducts(organizationId: string, channelId: string, provider: ChannelProvider, cfg: ChannelCredentials, opts: z.infer<typeof syncSchema>) {
  const where: Record<string, unknown> = { organizationId, isActive: true };
  if (opts.productIds?.length) where.id = { in: opts.productIds };

  // Without an explicit selection only push what the merchant already mapped, so
  // a sync never silently duplicates the catalog on the storefront.
  const mappings = await prisma.externalProductMapping.findMany({ where: { organizationId, channelId } });
  const mappedProductIds = new Set(mappings.map((m) => m.productId));
  const products = await prisma.product.findMany({
    where,
    take: opts.limit ?? 50,
    select: { id: true, name: true, sku: true, barcode: true, price: true, description: true, isActive: true },
  });

  const targets = opts.productIds?.length ? products : products.filter((p) => mappedProductIds.has(p.id));
  if (targets.length === 0) {
    return {
      ok: true as const,
      processed: 0,
      failed: 0,
      message: 'Nothing to push: map a product to the channel first, or pass productIds',
    };
  }

  let processed = 0;
  let failed = 0;
  let lastError: string | null = null;

  for (const p of targets) {
    const mapping = mappings.find((m) => m.productId === p.id);
    const result = await pushProduct(
      provider,
      cfg,
      {
        id: p.id,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        price: Number(p.price),
        description: p.description,
        isActive: p.isActive,
      },
      mapping?.externalId ?? null,
    );

    if (result.ok) {
      if (mapping) {
        await prisma.externalProductMapping.update({
          where: { id: mapping.id },
          data: { externalId: result.data.externalId, lastPushedAt: new Date() },
        });
      } else {
        await prisma.externalProductMapping.create({
          data: { organizationId, channelId, productId: p.id, externalId: result.data.externalId, externalSku: p.sku, lastPushedAt: new Date() },
        });
      }
      processed += 1;
    } else {
      failed += 1;
      lastError = describeFailure(result);
    }
  }

  return { ok: true as const, processed, failed, message: lastError ?? 'Products pushed' };
}

async function pushInventoryLevels(organizationId: string, channelId: string, provider: ChannelProvider, cfg: ChannelCredentials, opts: z.infer<typeof syncSchema>) {
  const mappings = await prisma.externalProductMapping.findMany({ where: { organizationId, channelId } });
  if (mappings.length === 0) {
    return { ok: true as const, processed: 0, failed: 0, message: 'No product mappings to push stock for' };
  }

  let processed = 0;
  let failed = 0;
  let lastError: string | null = null;

  for (const m of mappings.slice(0, opts.limit ?? 50)) {
    const balances = await prisma.inventoryBalance.findMany({
      where: { productId: m.productId, ...(opts.locationId ? { locationId: opts.locationId } : {}) },
      select: { quantity: true, locationId: true },
    });
    if (balances.length === 0) continue;

    const onHand = balances.reduce((s, b) => s + Number(b.quantity), 0);
    const result = await pushInventory(provider, cfg, {
      externalId: m.externalId,
      // For Shopify this must be the inventory item id, which the mapping stores
      // in `externalVariantId`; the provider rejects a variant id with a clear error.
      inventoryItemId: m.externalVariantId,
      locationId: opts.locationId ?? balances[0].locationId,
      quantity: onHand,
    });

    if (result.ok) processed += 1;
    else {
      failed += 1;
      lastError = describeFailure(result);
    }
  }

  return { ok: true as const, processed, failed, message: lastError ?? 'Stock pushed' };
}

// POST /api/channels/:id/sync
router.post('/:id/sync', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  const organizationId = req.user!.organizationId!;
  const channelId = String(req.params.id);

  let logId: string | null = null;
  try {
    const body = syncSchema.parse(req.body ?? { direction: 'PULL', entity: 'ORDERS' });
    const row = await prisma.channelConnection.findFirst({ where: { id: channelId, organizationId } });
    if (!row) return res.status(404).json({ success: false, message: 'Channel not found' });

    const provider = providerOf(row);
    if (!provider) return res.status(400).json({ success: false, message: `Unsupported provider "${row.provider}"` });

    const cfg = credentialsOf(row as ConnectionRow);
    if (!cfg) {
      await prisma.channelConnection.update({ where: { id: row.id }, data: { status: 'ERROR', lastError: 'No credential stored' } });
      return res.status(400).json({ success: false, message: 'No credential stored for this channel' });
    }

    const log = await prisma.channelSyncLog.create({
      data: { organizationId, channelId, direction: body.direction, entity: body.entity, status: 'PARTIAL', startedAt: new Date() },
    });
    logId = log.id;

    const outcome =
      body.direction === 'PULL' && body.entity === 'PRODUCTS'
        ? await pullProducts(organizationId, channelId, provider, cfg, body)
        : body.direction === 'PULL' && body.entity === 'ORDERS'
          ? await pullOrders(organizationId, row as ConnectionRow, provider, cfg, body)
          : body.direction === 'PUSH' && body.entity === 'PRODUCTS'
            ? await pushProducts(organizationId, channelId, provider, cfg, body)
            : body.direction === 'PUSH' && body.entity === 'INVENTORY'
              ? await pushInventoryLevels(organizationId, channelId, provider, cfg, body)
              : null;

    if (outcome === null) {
      await prisma.channelSyncLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', message: `Unsupported combination ${body.direction}/${body.entity}`, finishedAt: new Date() },
      });
      return res.status(400).json({ success: false, message: `Unsupported combination ${body.direction}/${body.entity}` });
    }

    if (!outcome.ok) {
      const message = describeFailure(outcome.failure);
      await prisma.channelSyncLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', message, finishedAt: new Date() },
      });
      await prisma.channelConnection.update({ where: { id: row.id }, data: { status: 'ERROR', lastError: message } });
      return res.status(502).json({ success: false, message, reason: outcome.failure.reason });
    }

    const status = outcome.failed > 0 ? (outcome.processed > 0 ? 'PARTIAL' : 'FAILED') : 'OK';
    await prisma.channelSyncLog.update({
      where: { id: log.id },
      data: { status, processed: outcome.processed, failed: outcome.failed, message: outcome.message, finishedAt: new Date() },
    });
    await prisma.channelConnection.update({
      where: { id: row.id },
      data: {
        status: 'CONNECTED',
        lastError: status === 'OK' ? null : outcome.message,
        lastSyncAt: new Date(),
        cursor: 'cursor' in outcome && outcome.cursor ? outcome.cursor : row.cursor,
      },
    });

    res.json({
      success: true,
      data: {
        logId: log.id,
        direction: body.direction,
        entity: body.entity,
        status,
        processed: outcome.processed,
        failed: outcome.failed,
        message: outcome.message,
      },
    });
  } catch (error) {
    if (logId) {
      await prisma.channelSyncLog
        .update({ where: { id: logId }, data: { status: 'FAILED', message: (error as Error).message, finishedAt: new Date() } })
        .catch(() => undefined);
    }
    handleError(error, res);
  }
});

// GET /api/channels/:id/logs
router.get('/:id/logs', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const rows = await prisma.channelSyncLog.findMany({
      where: { organizationId, channelId: String(req.params.id) },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: rows });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Product mappings ──────────────────────────────────────────────────────

// GET /api/channels/mappings?channelId=
router.get('/mappings', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const where: Record<string, unknown> = { organizationId };
    if (req.query.channelId) where.channelId = String(req.query.channelId);

    const rows = await prisma.externalProductMapping.findMany({ where, orderBy: { lastPushedAt: 'desc' }, take: 500 });
    const productIds = [...new Set(rows.map((r) => r.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, organizationId },
      select: { id: true, name: true, sku: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    res.json({
      success: true,
      data: rows.map((r) => ({
        ...r,
        productName: byId.get(r.productId)?.name ?? null,
        productSku: byId.get(r.productId)?.sku ?? null,
      })),
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/channels/mappings - link a local product to an external listing
router.post('/mappings', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = z
      .object({
        channelId: z.string().min(1),
        productId: z.string().min(1),
        externalId: z.string().min(1),
        externalSku: z.string().nullable().optional(),
        externalVariantId: z.string().nullable().optional(),
      })
      .parse(req.body);

    const [channel, product] = await Promise.all([
      prisma.channelConnection.findFirst({ where: { id: body.channelId, organizationId }, select: { id: true } }),
      prisma.product.findFirst({ where: { id: body.productId, organizationId }, select: { id: true } }),
    ]);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    const mapping = await prisma.externalProductMapping.upsert({
      where: { channelId_productId: { channelId: body.channelId, productId: body.productId } },
      create: {
        organizationId,
        channelId: body.channelId,
        productId: body.productId,
        externalId: body.externalId,
        externalSku: body.externalSku ?? null,
        externalVariantId: body.externalVariantId ?? null,
      },
      update: {
        externalId: body.externalId,
        externalSku: body.externalSku ?? null,
        externalVariantId: body.externalVariantId ?? null,
      },
    });

    res.status(201).json({ success: true, data: mapping });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/channels/mappings/:mappingId
router.delete('/mappings/:mappingId', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const mapping = await prisma.externalProductMapping.findFirst({
      where: { id: String(req.params.mappingId), organizationId },
    });
    if (!mapping) return res.status(404).json({ success: false, message: 'Mapping not found' });
    await prisma.externalProductMapping.delete({ where: { id: mapping.id } });
    res.json({ success: true, data: { id: mapping.id } });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Inbound webhooks ──────────────────────────────────────────────────────

function topicOf(headers: Request['headers']): string {
  const raw =
    headers['x-shopify-topic'] ??
    headers['x-wc-webhook-topic'] ??
    headers['x-bc-webhook-topic'] ??
    headers['x-bc-webhook-scope'] ??
    '';
  return String(Array.isArray(raw) ? raw[0] : raw).toLowerCase();
}

/**
 * Raw-mounted at POST /api/channels/webhooks/:connectionId.
 *
 * The signature is verified against the stored secret BEFORE anything is parsed,
 * because an unverified body is attacker-controlled. A wrong signature is a 401
 * and nothing is written.
 */
export async function channelWebhookHandler(req: Request, res: Response): Promise<void> {
  try {
    const connectionId = String(req.params.connectionId);
    const connection = await prisma.channelConnection.findFirst({ where: { id: connectionId } });
    if (!connection) {
      res.status(404).json({ success: false, message: 'Unknown channel' });
      return;
    }

    const provider = providerOf(connection);
    if (!provider) {
      res.status(400).json({ success: false, message: `Unsupported provider "${connection.provider}"` });
      return;
    }

    if (!connection.webhookSecretEncrypted) {
      res.status(400).json({ success: false, message: 'This channel has no webhook secret configured' });
      return;
    }
    const secret = decryptText(connection.webhookSecretEncrypted);

    const rawBody: Buffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));

    if (!verifyChannelWebhook(provider, rawBody, req.headers as Record<string, string | string[] | undefined>, secret)) {
      res.status(401).json({ success: false, message: 'Invalid webhook signature' });
      return;
    }

    const topic = topicOf(req.headers);
    const payload = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {};
    const organizationId = connection.organizationId;

    if (topic.includes('order')) {
      const cfg = credentialsOf(connection as ConnectionRow);
      const orderPayload = payload?.id ? payload : payload?.order ?? null;
      if (!cfg || !orderPayload) {
        res.status(400).json({ success: false, message: 'Webhook carried no order payload' });
        return;
      }

      // Reuse the exact same import path as a manual pull so idempotency holds.
      const ext = mapExternalOrder(provider, orderPayload);
      if (!ext) {
        res.status(400).json({ success: false, message: 'Could not read the order payload' });
        return;
      }

      const orderNumber = channelOrderNumber(connection.id, provider, ext.externalId);
      const already = await prisma.order.findUnique({ where: { orderNumber }, select: { id: true } });

      if (!already) {
        const lines: { productId: string; productName: string; quantity: number; unitPrice: number; totalAmount: number }[] = [];
        for (const line of ext.lines) {
          if (!line.sku) continue;
          const product = await prisma.product.findFirst({
            where: { organizationId, sku: line.sku },
            select: { id: true, name: true, price: true },
          });
          if (!product) continue;
          const unitPrice = money(line.unitPrice || Number(product.price));
          lines.push({
            productId: product.id,
            productName: product.name,
            quantity: Number(line.quantity) || 0,
            unitPrice,
            totalAmount: money(unitPrice * (Number(line.quantity) || 0)),
          });
        }

        if (lines.length > 0) {
          const subtotal = money(lines.reduce((s, l) => s + l.totalAmount, 0));
          const total = ext.total > 0 ? money(ext.total) : subtotal;
          await prisma.order.create({
            data: {
              organizationId,
              orderNumber,
              channel: 'WEBSITE',
              status: 'PAID',
              currency: ext.currency || 'USD',
              subtotal,
              totalAmount: total,
              taxAmount: money(Math.max(0, total - subtotal)),
              notes: `Webhook import from ${providerLabel(provider)} order ${ext.orderNumber}`,
              createdAt: new Date(ext.createdAt),
              items: { create: lines },
              payments: {
                create: {
                  method: 'OTHER',
                  provider: provider.toLowerCase(),
                  amount: total,
                  currency: ext.currency || 'USD',
                  status: 'COMPLETED',
                  reference: ext.externalId,
                  metadata: { source: 'webhook', importedAt: new Date().toISOString() },
                },
              },
            },
          });
        }

        await prisma.channelSyncLog.create({
          data: {
            organizationId,
            channelId: connection.id,
            direction: 'PULL',
            entity: 'ORDERS',
            status: lines.length > 0 ? 'OK' : 'FAILED',
            processed: lines.length > 0 ? 1 : 0,
            failed: lines.length > 0 ? 0 : 1,
            message: lines.length > 0 ? `Webhook order ${ext.orderNumber}` : `No catalog match for order ${ext.orderNumber}`,
            startedAt: new Date(),
            finishedAt: new Date(),
          },
        });
      }

      res.json({ success: true, data: { received: true, orderNumber, duplicate: Boolean(already) } });
      return;
    }

    if (topic.includes('product')) {
      const ext = mapExternalProduct(provider, payload);
      if (ext?.sku) {
        const local = await prisma.product.findFirst({ where: { organizationId, sku: ext.sku }, select: { id: true } });
        if (local) {
          await prisma.externalProductMapping.upsert({
            where: { channelId_productId: { channelId: connection.id, productId: local.id } },
            create: {
              organizationId,
              channelId: connection.id,
              productId: local.id,
              externalId: ext.externalId,
              externalSku: ext.sku,
              lastPushedAt: new Date(),
            },
            update: { externalId: ext.externalId, externalSku: ext.sku },
          });
        }
      }
      await prisma.channelSyncLog.create({
        data: {
          organizationId,
          channelId: connection.id,
          direction: 'PULL',
          entity: 'PRODUCTS',
          status: 'OK',
          processed: ext ? 1 : 0,
          message: `Webhook product ${topic}`,
          finishedAt: new Date(),
        },
      });
      res.json({ success: true, data: { received: true } });
      return;
    }

    // Anything else is acknowledged so the provider stops retrying, but nothing
    // is written: an unknown topic is not an order and must not become one.
    res.json({ success: true, data: { received: true, ignored: topic || 'unknown' } });
  } catch (error) {
    handleError(error, res);
  }
}

export default router;
