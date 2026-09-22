// ─── Agentic commerce: a machine-readable storefront with signed mandates ─────
// Buying agents are arriving, and the merchant's answer needs three parts: a
// catalog the agent can read (JSON-LD), a way to declare what it may do
// (the well-known descriptor), and an authorisation the merchant can verify
// cryptographically instead of trusting a user agent string. Nothing is sold on
// an unverifiable signature, and nothing is sold above the ceiling a human set.

import { Router, Response } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { toJson } from '../utils/json.js';
import { requestUrlBase } from '../utils/requestUrl.js';
import { getJwtSecret } from '../services/crypto.js';
import { round2 } from '../services/moneyMath.js';
import {
  MANDATE_SPEC_VERSION,
  AGENT_SIGNATURE_ALG,
  MAX_MANDATE_TTL_SECONDS,
  MAX_MANDATE_LINES,
  buildMandate,
  signMandate,
  verifyMandateSignature,
  evaluateMandate,
  productToJsonLd,
  catalogToJsonLd,
  agentDescriptor,
  type Mandate,
  type CatalogItemPrice,
} from '../services/agenticCommerce.js';

const router = Router();

/**
 * Per-tenant signing key. Deriving it from the JWT secret plus the org id means
 * one merchant's key can never forge another merchant's mandate, and a leaked
 * tenant key stays scoped to that tenant.
 */
function mandateSecret(organizationId: string): string {
  const base = process.env.MANDATE_SIGNING_KEY || getJwtSecret();
  return crypto.createHmac('sha256', base).update(`mandate:${organizationId}`).digest('hex');
}

async function storefrontEnabled(organizationId: string): Promise<boolean> {
  const install = await prisma.appInstallation.findFirst({ where: { organizationId, appCode: 'AGENT_STOREFRONT', status: 'INSTALLED' } });
  return Boolean(install);
}

function baseUrl(req: AuthRequest): string {
  return requestUrlBase(req);
}

const mandateBodySchema = z.object({
  agentId: z.string().min(3).max(120),
  agentName: z.string().max(120).optional(),
  principalEmail: z.string().email().optional().nullable(),
  mandateType: z.enum(['PURCHASE', 'GIFT', 'REPLENISH']).optional(),
  currency: z.string().length(3).optional(),
  ceilingAmount: z.number().positive(),
  ttlSeconds: z.number().int().min(60).max(MAX_MANDATE_TTL_SECONDS).optional(),
  fulfilment: z.enum(['PICKUP', 'DELIVERY', 'SHIP', 'DIGITAL']).optional().nullable(),
  locationId: z.string().max(64).optional().nullable(),
  items: z
    .array(
      z.object({
        sku: z.string().max(120).optional().nullable(),
        productId: z.string().max(64).optional().nullable(),
        gtin: z.string().max(64).optional().nullable(),
        quantity: z.number().int().positive(),
        maxUnitPrice: z.number().min(0).optional().nullable(),
      })
    )
    .min(1)
    .max(MAX_MANDATE_LINES),
});

// POST /api/agents/mandates - issue and sign an authorisation for an agent
router.post('/mandates', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER', 'CASHIER'), validateRequest(mandateBodySchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof mandateBodySchema>;
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, currency: true } });
    const currency = (body.currency || org?.currency || 'USD').toUpperCase();

    const mandate = buildMandate({
      agentId: body.agentId,
      principalEmail: body.principalEmail ?? null,
      merchantId: organizationId,
      locationId: body.locationId ?? null,
      mandateType: body.mandateType,
      currency,
      ceilingAmount: body.ceilingAmount,
      ttlSeconds: body.ttlSeconds,
      fulfilment: body.fulfilment ?? null,
      items: body.items,
    });
    const signature = signMandate(mandate, mandateSecret(organizationId));

    const stored = await prisma.agentMandate.create({
      data: {
        organizationId,
        locationId: mandate.locationId ?? null,
        agentId: mandate.agentId,
        agentName: body.agentName || null,
        principalEmail: mandate.principalEmail ?? null,
        mandateType: mandate.mandateType,
        items: toJson(mandate.items),
        ceilingAmount: mandate.ceilingAmount,
        amount: 0,
        currency: mandate.currency,
        nonce: mandate.nonce,
        issuedAt: new Date(mandate.issuedAt),
        expiresAt: new Date(mandate.expiresAt),
        signature,
        signatureAlg: AGENT_SIGNATURE_ALG,
        status: 'ACTIVE',
      },
    });
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'MANDATE_ISSUED',
      resourceType: 'AGENT_MANDATE',
      resourceId: stored.id,
      newValue: { agentId: mandate.agentId, ceiling: mandate.ceilingAmount, lines: mandate.items.length, expiresAt: mandate.expiresAt },
    });
    res.status(201).json({ success: true, data: { mandate: { ...mandate, signature }, stored, merchantName: org?.name || null } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/agents/mandates - what agents have been authorised, and how it ended
router.get('/mandates', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const { status, agentId, limit = '50' } = req.query;
    const where: Record<string, unknown> = { organizationId };
    if (status) where.status = String(status);
    if (agentId) where.agentId = String(agentId);
    const mandates = await prisma.agentMandate.findMany({ where, orderBy: { createdAt: 'desc' }, take: Math.min(200, Number(limit) || 50) });
    const byStatus: Record<string, number> = {};
    for (const m of mandates) byStatus[String(m.status)] = (byStatus[String(m.status)] || 0) + 1;
    res.json({
      success: true,
      data: {
        mandates,
        byStatus,
        spent: round2(mandates.filter((m) => m.status === 'FULFILLED').reduce((a, m) => a + Number(m.amount), 0)),
        spec: MANDATE_SPEC_VERSION,
        algorithm: AGENT_SIGNATURE_ALG,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/agents/mandates/:id/revoke - a human can always pull the plug
router.post('/mandates/:id/revoke', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const existing = await prisma.agentMandate.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Mandate not found' });
    if (existing.status === 'FULFILLED') return res.status(409).json({ success: false, message: 'A fulfilled mandate cannot be revoked - refund the order instead' });
    const updated = await prisma.agentMandate.update({
      where: { id: existing.id },
      data: { status: 'REVOKED', rejectReason: String(req.body?.reason || 'Revoked by merchant').slice(0, 400) },
    });
    await createAuditEvent({ organizationId, actorId: req.user!.employeeId, action: 'MANDATE_REVOKED', resourceType: 'AGENT_MANDATE', resourceId: existing.id, previousValue: { status: existing.status } });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Public machine surface: no session, gated by the storefront install ──────

// GET /api/agents/public/descriptor - what this merchant allows agents to do
router.get('/public/descriptor', async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = String(req.query.merchant || req.query.merchantId || '');
    if (!merchantId) return res.status(400).json({ success: false, message: 'A merchant id is required' });
    const org = await prisma.organization.findFirst({ where: { id: merchantId, isActive: true }, select: { id: true, name: true, currency: true, countryCode: true, industry: true } });
    if (!org || !(await storefrontEnabled(org.id))) return res.status(404).json({ success: false, message: 'This merchant does not publish an agent storefront' });
    const railMethods = ['CARD', 'CASH', 'BANK_TRANSFER'];
    res.json({
      success: true,
      data: agentDescriptor({
        merchantName: org.name,
        merchantId: org.id,
        baseUrl: baseUrl(req),
        countryCode: org.countryCode,
        currency: org.currency,
        paymentMethods: railMethods,
      }),
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/agents/public/catalog.jsonld - the catalog in schema.org vocabulary
router.get('/public/catalog.jsonld', async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = String(req.query.merchant || req.query.merchantId || '');
    if (!merchantId) return res.status(400).json({ success: false, message: 'A merchant id is required' });
    const org = await prisma.organization.findFirst({ where: { id: merchantId, isActive: true }, select: { id: true, name: true, currency: true } });
    if (!org || !(await storefrontEnabled(org.id))) return res.status(404).json({ success: false, message: 'This merchant does not publish an agent storefront' });

    const locationId = req.query.locationId ? String(req.query.locationId) : null;
    const products = await prisma.product.findMany({
      where: { organizationId: org.id, isActive: true, ...(locationId ? { inventory: { some: { locationId } } } : {}) },
      select: { id: true, name: true, sku: true, barcode: true, description: true, imageUrl: true, price: true, taxRule: { select: { rate: true } }, category: { select: { name: true } }, brand: { select: { name: true } } },
      take: Math.min(1000, Number(req.query.limit) || 200),
      orderBy: { name: 'asc' },
    });
    const balances = await prisma.inventoryBalance.groupBy({ by: ['productId'], where: { product: { organizationId: org.id } }, _sum: { quantity: true, reserved: true } });
    const stock = new Map(balances.map((b) => [b.productId, Number(b._sum.quantity || 0) - Number(b._sum.reserved || 0)]));
    const base = baseUrl(req);
    const nodes = products.map((p) =>
      productToJsonLd(
        {
          id: p.id,
          name: p.name,
          description: p.description,
          sku: p.sku,
          gtin: p.barcode,
          image: p.imageUrl,
          brand: p.brand?.name || null,
          category: p.category?.name || null,
          price: Number(p.price),
          currency: org.currency,
          stockQuantity: stock.get(p.id) ?? 0,
          agentPurchasable: true,
          taxPercent: p.taxRule ? Number(p.taxRule.rate) : null,
          locationId,
        },
        base
      )
    );
    res.json({ success: true, data: catalogToJsonLd(nodes, { name: org.name, url: `${base}/api/agents/public/catalog.jsonld?merchant=${org.id}`, locationId }) });
  } catch (error) {
    handleError(error, res);
  }
});

const verifySchema = z.object({
  merchantId: z.string().min(3).max(64),
  mandate: z.record(z.any()),
});

/** Resolve live prices and stock for each mandate line, in mandate order. */
async function quoteMandate(organizationId: string, mandate: Mandate): Promise<(CatalogItemPrice | null)[]> {
  const keys = new Set<string>();
  for (const item of mandate.items || []) {
    if (item.sku) keys.add(String(item.sku));
    if (item.productId) keys.add(String(item.productId));
    if (item.gtin) keys.add(String(item.gtin));
  }
  if (!keys.size) return [];
  const list = [...keys];
  const products = await prisma.product.findMany({
    where: { organizationId, isActive: true, OR: [{ id: { in: list } }, { sku: { in: list } }, { barcode: { in: list } }] },
    select: { id: true, sku: true, barcode: true, price: true },
    take: 500,
  });
  const balances = await prisma.inventoryBalance.groupBy({ by: ['productId'], where: { productId: { in: products.map((p) => p.id) } }, _sum: { quantity: true, reserved: true } });
  const stock = new Map(balances.map((b) => [b.productId, Number(b._sum.quantity || 0) - Number(b._sum.reserved || 0)]));
  return (mandate.items || []).map((item) => {
    const product = products.find((p) => (item.productId && p.id === item.productId) || (item.sku && p.sku === item.sku) || (item.gtin && p.barcode === item.gtin));
    if (!product) return null;
    return { sku: product.sku, productId: product.id, gtin: product.barcode, price: Number(product.price), quantityAvailable: stock.get(product.id) ?? 0, agentPurchasable: true, currency: mandate.currency };
  });
}

function signatureValid(mandate: Mandate, organizationId: string): boolean {
  return verifyMandateSignature(mandate as unknown as Partial<Mandate>, mandateSecret(organizationId));
}

/** Line-for-line total of a quote against the mandate's own quantities. */
function quoteTotal(quoted: (CatalogItemPrice | null)[], mandate: Mandate): number {
  return round2(quoted.reduce((a, q, index) => a + (q ? Number(q.price) * Math.trunc(Number(mandate.items?.[index]?.quantity) || 0) : 0), 0));
}

// POST /api/agents/public/mandate/verify - check a signature and its limits, buy nothing
router.post('/public/mandate/verify', validateRequest(verifySchema), async (req: AuthRequest, res: Response) => {
  try {
    const { merchantId, mandate } = req.body as { merchantId: string; mandate: Mandate };
    const org = await prisma.organization.findFirst({ where: { id: merchantId, isActive: true }, select: { id: true, currency: true } });
    if (!org || !(await storefrontEnabled(org.id))) return res.status(404).json({ success: false, message: 'No agent storefront for this merchant' });
    const known = await prisma.agentMandate.findFirst({ where: { organizationId: org.id, nonce: String(mandate?.nonce || '') } });
    const quoted = await quoteMandate(org.id, mandate);
    const total = quoteTotal(quoted, mandate);
    const verdict = evaluateMandate(mandate, { quoted, total, currency: org.currency });
    const signatureOk = signatureValid(mandate, org.id);
    const replayed = known && ['FULFILLED', 'REJECTED', 'REVOKED', 'EXPIRED'].includes(known.status);
    res.json({
      success: true,
      data: {
        signatureValid: signatureOk,
        algorithm: AGENT_SIGNATURE_ALG,
        spec: MANDATE_SPEC_VERSION,
        replayed: Boolean(replayed),
        recorded: Boolean(known),
        total,
        verdict: replayed ? { accept: false, code: 'MANDATE_USED', message: `this mandate is already ${known?.status}` } : verdict,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

const checkoutSchema = verifySchema.extend({
  channel: z.enum(['AGENT', 'MARKETPLACE']).optional(),
});

// POST /api/agents/public/mandate/checkout - sell against a verified mandate only
router.post('/public/mandate/checkout', validateRequest(checkoutSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { merchantId, mandate } = req.body as { merchantId: string; mandate: Mandate };
    const org = await prisma.organization.findFirst({ where: { id: merchantId, isActive: true }, select: { id: true, name: true, currency: true, countryCode: true, taxRate: true } });
    if (!org || !(await storefrontEnabled(org.id))) return res.status(404).json({ success: false, message: 'No agent storefront for this merchant' });
    if (!signatureValid(mandate, org.id)) {
      return res.status(401).json({ success: false, message: 'Mandate signature does not verify', data: { code: 'BAD_SIGNATURE' } });
    }
    const quoted = await quoteMandate(org.id, mandate);
    const total = quoteTotal(quoted, mandate);
    const verdict = evaluateMandate(mandate, { quoted, total, currency: org.currency });
    if (!verdict.accept) {
      await prisma.agentMandate.updateMany({ where: { organizationId: org.id, nonce: String(mandate.nonce || ''), status: 'ACTIVE' }, data: { status: 'REJECTED', rejectReason: `${verdict.code}: ${verdict.message}` } });
      return res.status(422).json({ success: false, message: verdict.message, data: verdict });
    }

    const orderNumber = `AGT-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
    // The merchant's configured sales-tax rate applies to an agent sale exactly
    // as it does to a cashier one; the mandate ceiling is checked on the net.
    const taxPercent = Number(org.taxRate || 0);
    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          organizationId: org.id,
          locationId: mandate.locationId ?? null,
          orderNumber,
          channel: 'MARKETPLACE',
          status: 'CONFIRMED',
          currency: mandate.currency,
          subtotal: total,
          taxAmount: round2(total * (taxPercent / 100)),
          totalAmount: round2(total * (1 + taxPercent / 100)),
          fulfillmentType: mandate.fulfilment === 'DELIVERY' ? 'DELIVERY' : mandate.fulfilment === 'SHIP' ? 'SHIP' : 'PICKUP',
          notes: `Agent mandate ${mandate.agentId} (nonce ${mandate.nonce})`,
          items: {
            create: (mandate.items || []).map((item, index) => {
              const quote = quoted[index]!;
              return {
                productId: quote.productId!,
                productName: quote.sku || quote.productId || 'Item',
                quantity: Math.trunc(Number(item.quantity)),
                unitPrice: Number(quote.price),
                totalAmount: round2(Number(quote.price) * Math.trunc(Number(item.quantity))),
              };
            }),
          },
        },
        include: { items: true },
      });
      // Hold the stock the order is worth, so two agents cannot both "succeed"
      // against the same last unit. The till releases it when the sale completes.
      for (const line of created.items) {
        const balance = await tx.inventoryBalance.findFirst({ where: { productId: line.productId, ...(mandate.locationId ? { locationId: mandate.locationId } : {}) }, select: { id: true, reserved: true } });
        if (balance) await tx.inventoryBalance.update({ where: { id: balance.id }, data: { reserved: balance.reserved + line.quantity } });
      }
      const stored = await tx.agentMandate.findFirst({ where: { organizationId: org.id, nonce: mandate.nonce } });
      if (stored) await tx.agentMandate.update({ where: { id: stored.id }, data: { status: 'FULFILLED', amount: total, orderId: created.id, fulfilledAt: new Date(), rejectReason: null } });
      else {
        await tx.agentMandate.create({
          data: {
            organizationId: org.id,
            locationId: mandate.locationId ?? null,
            agentId: mandate.agentId,
            principalEmail: mandate.principalEmail ?? null,
            mandateType: mandate.mandateType,
            items: toJson(mandate.items),
            ceilingAmount: mandate.ceilingAmount,
            amount: total,
            currency: mandate.currency,
            nonce: mandate.nonce,
            issuedAt: new Date(mandate.issuedAt),
            expiresAt: new Date(mandate.expiresAt),
            signature: String(mandate.signature || ''),
            signatureAlg: AGENT_SIGNATURE_ALG,
            status: 'FULFILLED',
            fulfilledAt: new Date(),
          },
        });
      }
      return created;
    });

    await createAuditEvent({
      organizationId: org.id,
      action: 'AGENT_ORDER_PLACED',
      resourceType: 'ORDER',
      resourceId: order.id,
      newValue: { agentId: mandate.agentId, nonce: mandate.nonce, total, lines: order.items.length },
    });
    res.status(201).json({
      success: true,
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        total: Number(order.totalAmount),
        currency: order.currency,
        status: order.status,
        mandate: { nonce: mandate.nonce, ceiling: mandate.ceilingAmount, agentId: mandate.agentId },
        merchant: { name: org.name, countryCode: org.countryCode },
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/agents/overview - the merchant's own agent-activity summary
router.get('/overview', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const [mandates, byStatus, install] = await Promise.all([
      prisma.agentMandate.count({ where: { organizationId } }),
      prisma.agentMandate.groupBy({ by: ['status'], where: { organizationId }, _count: { _all: true }, _sum: { amount: true } }),
      prisma.appInstallation.findFirst({ where: { organizationId, appCode: 'AGENT_STOREFRONT' }, select: { status: true } }),
    ]);
    const stats = byStatus.map((s) => ({ status: String(s.status), count: s._count._all, value: round2(Number(s._sum.amount || 0)) }));
    res.json({
      success: true,
      data: {
        total: mandates,
        byStatus: stats,
        published: install?.status === 'INSTALLED',
        spec: MANDATE_SPEC_VERSION,
        installStatus: install?.status || 'NOT_INSTALLED',
        endpoints: {
          descriptor: '/api/agents/public/descriptor?merchant=<id>',
          catalog: '/api/agents/public/catalog.jsonld?merchant=<id>',
          verify: 'POST /api/agents/public/mandate/verify',
          checkout: 'POST /api/agents/public/mandate/checkout',
        },
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
