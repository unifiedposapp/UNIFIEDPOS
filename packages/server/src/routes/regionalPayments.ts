// ─── Regional payment endpoints (Paystack / Flutterwave / M-Pesa) ────────────
// The HTTP surface for services/regionalGateways.ts. A merchant connects a
// regional gateway by saving its credentials on an IntegrationConnection of type
// PAYMENT (encrypted at rest, exactly like the delivery channels); initiating a
// charge loads those credentials and drives the provider's real API — or a
// clearly-labelled simulation when nothing is configured.
//
// The inbound provider webhook is mounted separately in index.ts with a RAW body
// parser, because a signature over re-serialised JSON verifies nothing.

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
  REGIONAL_GATEWAYS,
  findRegionalGateway,
  isRegionalConfigured,
  createRegionalCharge,
  verifyRegionalTransaction,
  verifyRegionalWebhook,
  regionalWebhookReference,
  regionalWebhookPaid,
  type RegionalCredentials,
} from '../services/regionalGateways.js';

const router = Router();

const PAYMENT_TYPE = 'PAYMENT';
const SUCCESS_STATUSES = ['COMPLETED', 'CAPTURED', 'SETTLED', 'RECONCILED'];

function publicConnection(row: any) {
  const creds = credsOf(row);
  const config = (row.config ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    status: row.status,
    gateway: findRegionalGateway(row.provider) ?? null,
    configured: isRegionalConfigured((findRegionalGateway(row.provider)?.id || row.provider) as any, creds),
    sandbox: Boolean(config.sandbox),
    lastSyncAt: row.lastSyncAt,
    errorMessage: row.errorMessage,
    hasSecretKey: Boolean(creds.secretKey),
    hasConsumerKey: Boolean(creds.consumerKey),
    hasShortcode: Boolean(creds.shortcode),
    hasWebhookSecret: Boolean(creds.webhookSecret),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Credentials are stored as an encrypted envelope: { blob: "v1:iv:tag:cipher" }.
function credsOf(row: any): RegionalCredentials {
  const blob = row?.credentials?.blob ?? row?.credentials;
  return decryptJson<RegionalCredentials>(typeof blob === 'string' ? blob : null) ?? {};
}

// GET /api/regional/gateways — the catalog plus this org's connection status.
router.get('/gateways', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const rows = await prisma.integrationConnection.findMany({ where: { organizationId: orgId, type: PAYMENT_TYPE } });
    const byProvider = new Map(rows.map((r) => [String(r.provider).toLowerCase(), r]));
    res.json({
      success: true,
      data: {
        gateways: REGIONAL_GATEWAYS.map((g) => ({
          ...g,
          connection: byProvider.get(g.id) ? publicConnection(byProvider.get(g.id)) : null,
          connected: Boolean(byProvider.get(g.id)),
        })),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

const connectSchema = z.object({
  provider: z.string().min(3).max(40),
  name: z.string().min(2).max(120).optional(),
  sandbox: z.boolean().optional(),
  redirectUrl: z.string().max(500).optional().nullable(),
  callbackUrl: z.string().max(500).optional().nullable(),
  baseUrl: z.string().max(500).optional().nullable(),
  secretKey: z.string().max(200).optional().nullable(),
  consumerKey: z.string().max(200).optional().nullable(),
  consumerSecret: z.string().max(200).optional().nullable(),
  shortcode: z.string().max(24).optional().nullable(),
  passkey: z.string().max(120).optional().nullable(),
  webhookSecret: z.string().max(200).optional().nullable(),
});

// PUT /api/regional/connect — add or update a gateway's encrypted credentials.
router.put('/connect', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(connectSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof connectSchema>;
    const gateway = findRegionalGateway(body.provider);
    if (!gateway) return res.status(400).json({ success: false, message: `Unknown regional gateway: ${body.provider}` });

    const credentials: RegionalCredentials = {
      secretKey: body.secretKey ?? null,
      consumerKey: body.consumerKey ?? null,
      consumerSecret: body.consumerSecret ?? null,
      shortcode: body.shortcode ?? null,
      passkey: body.passkey ?? null,
      webhookSecret: body.webhookSecret ?? null,
      sandbox: body.sandbox ?? false,
      redirectUrl: body.redirectUrl ?? null,
      callbackUrl: body.callbackUrl ?? null,
      baseUrl: body.baseUrl ?? null,
    };
    const data = {
      organizationId: orgId,
      provider: gateway.id,
      type: PAYMENT_TYPE,
      name: body.name || gateway.name,
      status: 'CONNECTED',
      config: { sandbox: Boolean(body.sandbox), redirectUrl: body.redirectUrl ?? null, callbackUrl: body.callbackUrl ?? null },
      credentials: { blob: encryptJson(credentials) },
    };
    const existing = await prisma.integrationConnection.findFirst({ where: { organizationId: orgId, provider: gateway.id, type: PAYMENT_TYPE } });
    const row = existing
      ? await prisma.integrationConnection.update({ where: { id: existing.id }, data })
      : await prisma.integrationConnection.create({ data });

    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: 'REGIONAL_GATEWAY_CONNECTED',
      resourceType: 'INTEGRATION',
      resourceId: row.id,
      newValue: { provider: gateway.id, configured: isRegionalConfigured(gateway.id, credentials) },
    });
    res.json({ success: true, data: publicConnection({ ...row, credentials: data.credentials }) });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/regional/connect/:id — retire a connection.
router.delete('/connect/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const row = await prisma.integrationConnection.findFirst({ where: { id: String(req.params.id), organizationId: orgId, type: PAYMENT_TYPE } });
    if (!row) throw new HttpError(404, 'Gateway connection not found');
    await prisma.integrationConnection.delete({ where: { id: row.id } });
    await createAuditEvent({ organizationId: orgId, actorId: req.user!.employeeId, action: 'REGIONAL_GATEWAY_DISCONNECTED', resourceType: 'INTEGRATION', resourceId: row.id, previousValue: { provider: row.provider } });
    res.json({ success: true, data: { id: row.id, removed: true } });
  } catch (error) {
    handleError(error, res);
  }
});

const chargeSchema = z.object({
  provider: z.string().min(3).max(40),
  orderId: z.string().uuid().optional(),
  amount: z.number().positive().optional(),
  currency: z.string().max(3).optional(),
  email: z.string().max(200).optional(),
  phoneNumber: z.string().max(24).optional(),
  reference: z.string().max(120).optional(),
  description: z.string().max(200).optional(),
});

// POST /api/regional/charge — initiate a charge through a regional gateway.
router.post('/charge', authMiddleware, validateRequest(chargeSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof chargeSchema>;
    const gateway = findRegionalGateway(body.provider);
    if (!gateway) return res.status(400).json({ success: false, message: `Unknown regional gateway: ${body.provider}` });

    let amount = body.amount;
    let currency = body.currency;
    let order: { id: string; orderNumber: string; totalAmount: any; currency: string } | null = null;
    if (body.orderId) {
      order = await prisma.order.findFirst({ where: { id: body.orderId, organizationId: orgId }, select: { id: true, orderNumber: true, totalAmount: true, currency: true } });
      if (!order) throw new HttpError(404, 'Order not found');
      amount = amount ?? round2(Number(order.totalAmount));
      currency = currency ?? order.currency;
    }
    if (!amount) return res.status(400).json({ success: false, message: 'An amount is required (pass one, or an orderId to derive it)' });

    const conn = await prisma.integrationConnection.findFirst({ where: { organizationId: orgId, provider: gateway.id, type: PAYMENT_TYPE } });
    const creds = credsOf(conn);
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { currency: true } });
    const finalCurrency = currency || org?.currency || 'USD';

    const result = await createRegionalCharge(gateway.id, {
      amount: Number(amount),
      currency: finalCurrency,
      email: body.email,
      phoneNumber: body.phoneNumber,
      reference: body.reference,
      description: body.description,
      metadata: order ? { orderId: order.id, orderNumber: order.orderNumber } : undefined,
    }, creds);

    // Persist a Payment only when this is tied to a real order; a standalone
    // checkout initiation stays stateless (nothing to reconcile against yet).
    let paymentId: string | undefined;
    if (order) {
      const status = result.status === 'SIMULATED' || result.status === 'SUCCEEDED' ? 'COMPLETED' : result.status === 'FAILED' ? 'DECLINED' : 'AUTHORIZED';
      const payment = await prisma.payment.create({
        data: {
          orderId: order.id,
          method: gateway.id === 'mpesa' ? 'MOBILE_MONEY' : 'CARD',
          provider: gateway.id,
          amount: Number(amount),
          currency: result.currency,
          status,
          reference: result.reference,
          authorizationId: result.processorReference ?? null,
          metadata: { simulated: result.simulated, redirectUrl: result.redirectUrl ?? null, description: result.message },
        },
      });
      paymentId = payment.id;
    }

    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: 'REGIONAL_CHARGE_INITIATED',
      resourceType: 'PAYMENT',
      resourceId: paymentId || result.reference,
      newValue: { provider: gateway.id, status: result.status, simulated: result.simulated, reference: result.reference },
    });

    res.status(result.status === 'FAILED' ? 502 : 201).json({ success: result.status !== 'FAILED', data: { ...result, paymentId } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/regional/verify/:provider/:reference — poll a charge's final status.
router.get('/verify/:provider/:reference', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const gateway = findRegionalGateway(String(req.params.provider));
    if (!gateway) return res.status(400).json({ success: false, message: 'Unknown regional gateway' });
    const conn = await prisma.integrationConnection.findFirst({ where: { organizationId: orgId, provider: gateway.id, type: PAYMENT_TYPE } });
    const result = await verifyRegionalTransaction(gateway.id, String(req.params.reference), credsOf(conn));

    // Reconcile a linked Payment when verification proves the money landed.
    if (result.paid && !result.simulated) {
      const payment = await prisma.payment.findFirst({ where: { reference: result.reference, order: { organizationId: orgId } }, include: { order: true } });
      if (payment && !SUCCESS_STATUSES.includes(payment.status)) {
        await prisma.payment.update({ where: { id: payment.id }, data: { status: 'COMPLETED' } });
        await reconcileOrder(payment.orderId);
      }
    }
    res.json({ success: true, data: result });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Inbound webhook (public; mounted with express.raw() in index.ts) ─────────
export async function regionalWebhookHandler(req: Request, res: Response): Promise<void> {
  const provider = String(req.params.provider || '').trim().toLowerCase();
  const gateway = findRegionalGateway(provider);
  if (!gateway) {
    res.status(404).json({ success: false, message: 'Unknown gateway' });
    return;
  }
  try {
    // A webhook is public, so there is no org context; try every connection for
    // this provider and accept the first whose secret verifies the signature.
    const conns = await prisma.integrationConnection.findMany({ where: { provider: gateway.id, type: PAYMENT_TYPE } });
    const headers = req.headers as Record<string, string | string[] | undefined>;
    let verified: { event: any; unsigned?: boolean } | null = null;
    let matchedOrgId: string | null = null;
    for (const conn of conns) {
      const creds = credsOf(conn);
      const v = verifyRegionalWebhook(gateway.id, (req as any).body, headers, creds);
      if (v) { verified = { event: v.event, unsigned: v.unsigned }; matchedOrgId = conn.organizationId; break; }
    }
    if (!verified) {
      res.status(400).json({ success: false, message: 'Invalid webhook signature' });
      return;
    }
    // M-Pesa callbacks are unsigned: treat the push as advisory and require a
    // verify query (via GET /verify) before we trust settlement.
    const reference = regionalWebhookReference(gateway.id, verified.event);
    if (verified.unsigned || !reference) {
      res.json({ received: true, acknowledged: true, requiresVerification: Boolean(verified.unsigned) });
      return;
    }

    const paid = regionalWebhookPaid(gateway.id, verified.event);
    const payment = await prisma.payment.findFirst({ where: { reference }, include: { order: true } });
    if (payment) {
      const orgId = matchedOrgId || payment.order?.organizationId || null;
      if (paid && !SUCCESS_STATUSES.includes(payment.status)) {
        await prisma.payment.update({ where: { id: payment.id }, data: { status: 'COMPLETED' } });
        await reconcileOrder(payment.orderId);
        if (orgId) await emitEvent({ organizationId: orgId, event: 'payment.completed', data: { id: payment.id, orderId: payment.orderId, reference, gateway: gateway.id } });
      } else if (!paid) {
        await prisma.payment.update({ where: { id: payment.id }, data: { status: 'DECLINED', metadata: { gateway: gateway.id, message: 'Webhook reported a failed payment' } } });
      }
      await createAuditEvent({ organizationId: orgId || payment.order?.organizationId || '', action: 'REGIONAL_WEBHOOK_RECONCILED', resourceType: 'PAYMENT', resourceId: payment.id, newValue: { gateway: gateway.id, paid, reference } });
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[regional-webhook] handler error:', err);
    res.status(500).json({ success: false, message: 'Webhook handler error' });
  }
}

async function reconcileOrder(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { payments: true } });
  if (!order) return;
  const paid = order.payments.filter((p) => SUCCESS_STATUSES.includes(p.status)).reduce((s, p) => s + Number(p.amount), 0);
  if (paid >= Number(order.totalAmount) && order.status !== 'PAID') {
    await prisma.order.update({ where: { id: orderId }, data: { status: 'PAID' } });
  }
}

export default router;
