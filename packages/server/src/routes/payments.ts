import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { requireUnlockedRegister } from '../middleware/registerAccess.js';
import { createAuditEvent } from '../utils/audit.js';
import { emitEvent } from '../services/eventBus.js';
import { isValidCurrency, normalizeCurrency } from '../data/currencies.js';
import {
  normalizePaymentMethod,
  isGatewayMethod,
  PAYMENT_METHOD_CATALOG,
  PAYMENT_METHOD_CATEGORIES,
  PAYMENT_METHOD_STATS,
  methodsByCategory,
  paymentMethodsForCountry,
} from '../data/paymentMethods.js';
import { createCharge, refundCharge, activeProvider, isStripeConfigured } from '../services/paymentProvider.js';
import { evaluateFraud } from '../services/fraud.js';

const router = Router();

// Routing is driven by the global payment-methods catalog (data/paymentMethods.ts):
// `gateway` methods go through the PSP, everything else (cash, store value,
// offline, deferred) stays on the internal ledger. See isGatewayMethod().
const SUCCESS_STATUSES = ['COMPLETED', 'CAPTURED', 'SETTLED', 'RECONCILED'];

const processPaymentSchema = z.object({
  orderId: z.string().uuid(),
  // Validated against the global payment-methods catalog; aliases (CONTACTLESS,
  // BTC…) are accepted and folded to their canonical id in the handler.
  method: z.string().refine((m) => normalizePaymentMethod(m) !== null, {
    message: 'Unknown payment method — see GET /api/payments/methods for the full catalog',
  }),
  amount: z.number().positive(),
  idempotencyKey: z.string().optional(),
  provider: z.string().optional(),
  reference: z.string().optional(),
  // Tokenized payment method id (pm_...) from Stripe Elements — card data never
  // reaches this server. Omit to get a clientSecret for client-side confirmation.
  paymentMethodId: z.string().optional(),
  // false = authorize only (capture later); default captures immediately.
  capture: z.boolean().optional(),
});

const refundPaymentSchema = z.object({
  paymentId: z.string().uuid(),
  amount: z.number().positive(),
  reason: z.string().optional(),
  method: z.string().default('ORIGINAL'),
});

// GET /api/payments - List payments with filters
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { status, method, orderId, limit = '50' } = req.query;
    const where: any = {
      order: { organizationId: req.user!.organizationId },
    };

    if (status) where.status = String(status);
    if (method) where.method = String(method);
    if (orderId) where.orderId = String(orderId);

    const payments = await prisma.payment.findMany({
      where,
      include: {
        order: { select: { orderNumber: true, totalAmount: true, status: true } },
        refunds: true,
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
    });

    const summary = await prisma.payment.aggregate({
      where,
      _sum: { amount: true },
      _count: true,
    });

    res.json({
      success: true,
      data: {
        items: payments,
        summary: {
          total: Number(summary._sum.amount || 0),
          count: summary._count,
        },
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/payments/refunds - List refunds (must precede /:id to avoid param capture)
router.get('/refunds', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const refunds = await prisma.refund.findMany({
      where: { organizationId: req.user!.organizationId },
      include: {
        order: { select: { orderNumber: true } },
        payment: { select: { method: true, amount: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: refunds });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/payments/config - active PSP config the client needs to collect a
// tokenized payment method (Stripe Elements). The publishable key is public-safe.
router.get('/config', authMiddleware, (_req: AuthRequest, res: Response) => {
  const secret = process.env.STRIPE_SECRET_KEY || '';
  res.json({
    success: true,
    data: {
      provider: activeProvider(),
      simulator: !isStripeConfigured(),
      live: isStripeConfigured() && !secret.startsWith('sk_test_'),
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
    },
  });
});

// GET /api/payments/methods - the full global payment-methods catalog so a
// business can accept every payment type worldwide. Optionally filter by market
// (?country=NG) and/or channel (?channel=IN_STORE|ONLINE); with no country the
// complete catalog (worldwide + every regional method) is returned, grouped by
// category. Mirrors GET /api/settings/currencies and /api/developer/catalog.
router.get('/methods', authMiddleware, (req: AuthRequest, res: Response) => {
  const countryRaw = req.query.country ? String(req.query.country).trim().toUpperCase() : '';
  const channelRaw = String(req.query.channel || '').toUpperCase();
  const channel = channelRaw === 'ONLINE' || channelRaw === 'IN_STORE' ? channelRaw : '';

  let list = countryRaw ? paymentMethodsForCountry(countryRaw) : PAYMENT_METHOD_CATALOG;
  if (channel) list = list.filter((m) => m.channels.includes(channel as 'ONLINE' | 'IN_STORE'));

  res.json({
    success: true,
    data: {
      categories: PAYMENT_METHOD_CATEGORIES,
      groups: methodsByCategory(list),
      methods: list,
      stats: PAYMENT_METHOD_STATS,
      filteredBy: { country: countryRaw || null, channel: channel || null },
    },
  });
});

// ─── Chargebacks / Disputes / Payouts / Settlements (§10) ────
// NOTE: these literal GET routes MUST be registered before GET /:id below.

const chargebackSchema = z.object({
  paymentId: z.string().uuid(),
  amount: z.number().positive(),
  reason: z.string().optional(),
});

const resolveSchema = z.object({
  status: z.enum(['UNDER_REVIEW', 'WON', 'LOST']),
});

const payoutSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().optional()
    .refine((c) => !c || isValidCurrency(c), 'Currency must be a valid ISO 4217 code'),
  paymentId: z.string().uuid().optional(),
  scheduledAt: z.string().optional(),
});

const payoutStatusSchema = z.object({
  status: z.enum(['PROCESSING', 'COMPLETED', 'FAILED']),
});

// GET /api/payments/chargebacks
router.get('/chargebacks', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const chargebacks = await prisma.chargeback.findMany({
      where: { organizationId: req.user!.organizationId! },
      orderBy: { filedAt: 'desc' },
    });
    res.json({ success: true, data: chargebacks });
  } catch (error) { handleError(error, res); }
});

// POST /api/payments/chargebacks
router.post('/chargebacks', authMiddleware, validateRequest(chargebackSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { paymentId, amount, reason } = req.body;
    const chargeback = await prisma.chargeback.create({
      data: { organizationId: orgId, paymentId, amount, reason, status: 'OPEN' },
    });
    await emitEvent({ organizationId: orgId, event: 'chargeback.created', data: { id: chargeback.id, paymentId, amount, reason } });
    await createAuditEvent({ organizationId: orgId, actorId: req.user!.employeeId, action: 'CHARGEBACK_CREATED', resourceType: 'PAYMENT', resourceId: paymentId, newValue: { amount, reason } });
    res.status(201).json({ success: true, data: chargeback });
  } catch (error) { handleError(error, res); }
});

// PUT /api/payments/chargebacks/:id/resolve
router.put('/chargebacks/:id/resolve', authMiddleware, validateRequest(resolveSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const existing = await prisma.chargeback.findFirst({ where: { id: String(req.params.id), organizationId: orgId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Chargeback not found' });
    const updated = await prisma.chargeback.update({
      where: { id: existing.id },
      data: { status: req.body.status, resolvedAt: req.body.status === 'UNDER_REVIEW' ? null : new Date() },
    });
    res.json({ success: true, data: updated });
  } catch (error) { handleError(error, res); }
});

// GET /api/payments/disputes
router.get('/disputes', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const disputes = await prisma.dispute.findMany({
      where: { organizationId: req.user!.organizationId! },
      orderBy: { filedAt: 'desc' },
    });
    res.json({ success: true, data: disputes });
  } catch (error) { handleError(error, res); }
});

// POST /api/payments/disputes
router.post('/disputes', authMiddleware, validateRequest(chargebackSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { paymentId, amount, reason } = req.body;
    const dispute = await prisma.dispute.create({
      data: { organizationId: orgId, paymentId, amount, reason, status: 'OPEN' },
    });
    await emitEvent({ organizationId: orgId, event: 'dispute.created', data: { id: dispute.id, paymentId, amount, reason } });
    await createAuditEvent({ organizationId: orgId, actorId: req.user!.employeeId, action: 'DISPUTE_CREATED', resourceType: 'PAYMENT', resourceId: paymentId, newValue: { amount, reason } });
    res.status(201).json({ success: true, data: dispute });
  } catch (error) { handleError(error, res); }
});

// PUT /api/payments/disputes/:id/resolve
router.put('/disputes/:id/resolve', authMiddleware, validateRequest(resolveSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const existing = await prisma.dispute.findFirst({ where: { id: String(req.params.id), organizationId: orgId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Dispute not found' });
    const updated = await prisma.dispute.update({
      where: { id: existing.id },
      data: { status: req.body.status, resolvedAt: req.body.status === 'UNDER_REVIEW' ? null : new Date() },
    });
    res.json({ success: true, data: updated });
  } catch (error) { handleError(error, res); }
});

// GET /api/payments/payouts
router.get('/payouts', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const payouts = await prisma.payout.findMany({
      where: { organizationId: req.user!.organizationId! },
      include: { payment: { select: { id: true, method: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: payouts });
  } catch (error) { handleError(error, res); }
});

// POST /api/payments/payouts
router.post('/payouts', authMiddleware, validateRequest(payoutSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { amount, currency, paymentId, scheduledAt } = req.body;
    const payout = await prisma.payout.create({
      data: {
        organizationId: orgId, amount, currency: normalizeCurrency(currency) || 'USD',
        paymentId: paymentId ?? undefined,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        status: 'PENDING',
      },
    });
    res.status(201).json({ success: true, data: payout });
  } catch (error) { handleError(error, res); }
});

// PUT /api/payments/payouts/:id/status
router.put('/payouts/:id/status', authMiddleware, validateRequest(payoutStatusSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const existing = await prisma.payout.findFirst({ where: { id: String(req.params.id), organizationId: orgId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Payout not found' });
    const updated = await prisma.payout.update({
      where: { id: existing.id },
      data: { status: req.body.status, completedAt: req.body.status === 'COMPLETED' ? new Date() : existing.completedAt },
    });
    res.json({ success: true, data: updated });
  } catch (error) { handleError(error, res); }
});

// GET /api/payments/settlements
router.get('/settlements', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const settlements = await prisma.settlement.findMany({
      where: { organizationId: req.user!.organizationId! },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: settlements });
  } catch (error) { handleError(error, res); }
});

// GET /api/payments/:id
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: String(req.params.id) },
      include: {
        order: { select: { orderNumber: true, totalAmount: true, status: true } },
        refunds: true,
        payouts: true,
      },
    });

    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    res.json({ success: true, data: payment });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/payments/process - Process a payment with idempotency
router.post('/process', authMiddleware, requireUnlockedRegister, validateRequest(processPaymentSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { orderId, amount, idempotencyKey, provider, reference, paymentMethodId, capture } = req.body;
    // Fold aliases + upper-case to the canonical catalog id before storing.
    const method = normalizePaymentMethod(req.body.method) || String(req.body.method).toUpperCase();
    const orgId = req.user!.organizationId!;

    // Idempotency check
    if (idempotencyKey) {
      const existing = await prisma.payment.findUnique({ where: { idempotencyKey } });
      if (existing) {
        return res.json({ success: true, data: existing, idempotent: true });
      }
    }

    // Validate order
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: true },
    });

    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // Check if total payments already cover the order (only successful ones count)
    const totalPaid = order.payments
      .filter(p => SUCCESS_STATUSES.includes(p.status))
      .reduce((sum, p) => sum + Number(p.amount), 0);

    if (totalPaid + amount > Number(order.totalAmount)) {
      return res.status(400).json({ success: false, message: 'Payment exceeds order total' });
    }

    // §37 Fraud detection — score the attempt before authorising. BLOCK stops the
    // charge (the FraudAlert is already persisted by evaluateFraud); REVIEW
    // proceeds but the response is flagged for manual follow-up.
    const fraud = await evaluateFraud({
      organizationId: orgId,
      amount,
      currency: order.currency || 'USD',
      method,
      customerId: order.customerId,
      orderId,
    });
    if (fraud.action === 'BLOCK') {
      await createAuditEvent({ organizationId: orgId, actorId: req.user!.employeeId, action: 'PAYMENT_BLOCKED_FRAUD', resourceType: 'ORDER', resourceId: orderId, newValue: { amount, method, score: fraud.score, rules: fraud.rules.map((r) => r.rule) } });
      return res.status(403).json({ success: false, message: 'Payment blocked by fraud detection', fraud: { score: fraud.score, level: fraud.level, action: fraud.action, rules: fraud.rules } });
    }

    const currency = order.currency || 'USD';
    const isCardLike = isGatewayMethod(method);

    // Route card-like methods through the PSP (real Stripe when configured, else
    // the simulator). Non-card methods stay on the internal ledger.
    let status = 'COMPLETED';
    let providerName = provider;
    let processorRef = reference;
    let authorizationId: string | undefined;
    let metadata: any;
    let clientSecret: string | undefined;

    if (isCardLike) {
      const charge = await createCharge({
        amount,
        currency,
        paymentMethodId,
        idempotencyKey,
        capture,
        description: `Order ${order.orderNumber}`,
        metadata: { orderId, orderNumber: order.orderNumber },
      });
      providerName = charge.provider;
      processorRef = charge.reference || processorRef;
      authorizationId = charge.authorizationId;
      clientSecret = charge.clientSecret;

      if (charge.status === 'FAILED') {
        const declined = await prisma.payment.create({
          data: {
            orderId, method, amount, currency,
            provider: providerName, reference: processorRef,
            idempotencyKey, status: 'DECLINED',
            metadata: { declineCode: charge.declineCode, message: charge.message },
          },
        });
        await createAuditEvent({ organizationId: orgId, actorId: req.user!.employeeId, action: 'PAYMENT_DECLINED', resourceType: 'PAYMENT', resourceId: declined.id, newValue: { orderId, amount, method, declineCode: charge.declineCode } });
        return res.status(402).json({ success: false, message: charge.message || 'Payment declined', data: declined });
      }

      status = (charge.status === 'SUCCEEDED' || charge.status === 'SIMULATED') ? 'COMPLETED' : 'AUTHORIZED';
      if (clientSecret) metadata = { clientSecret };
    }

    // Create payment
    const payment = await prisma.payment.create({
      data: {
        orderId,
        method,
        amount,
        currency,
        provider: providerName,
        reference: processorRef,
        authorizationId,
        idempotencyKey,
        status,
        metadata,
      },
    });

    // Check if order is now fully paid (only captured/settled funds count).
    const updatedPayments = await prisma.payment.findMany({
      where: { orderId, status: { in: SUCCESS_STATUSES } },
    });
    const newTotalPaid = updatedPayments.reduce((sum, p) => sum + Number(p.amount), 0);

    if (newTotalPaid >= Number(order.totalAmount)) {
      await prisma.order.update({
        where: { id: orderId },
        data: { status: 'PAID' },
      });
    }

    // Emit payment event
    await emitEvent({
      organizationId: orgId,
      event: status === 'COMPLETED' ? 'payment.completed' : 'payment.authorized',
      data: { id: payment.id, orderId, amount, method },
    });

    // Audit
    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: 'PAYMENT_CREATED',
      resourceType: 'PAYMENT',
      resourceId: payment.id,
      newValue: { orderId, amount, method },
    });

    res.status(201).json({ success: true, data: payment, requiresAction: status === 'AUTHORIZED', clientSecret, fraud: { score: fraud.score, level: fraud.level, action: fraud.action, review: fraud.action === 'REVIEW' } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/payments/:id/void - Void a payment
router.post('/:id/void', authMiddleware, requireUnlockedRegister, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const payment = await prisma.payment.findUnique({ where: { id: String(req.params.id) } });

    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    if (['VOIDED', 'REFUNDED', 'SETTLED', 'RECONCILED'].includes(payment.status)) {
      return res.status(400).json({ success: false, message: `Cannot void payment in ${payment.status} status` });
    }

    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'VOIDED' },
    });

    await emitEvent({
      organizationId: orgId,
      event: 'payment.voided',
      data: { id: payment.id, orderId: payment.orderId, amount: Number(payment.amount) },
    });

    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: 'PAYMENT_VOIDED',
      resourceType: 'PAYMENT',
      resourceId: payment.id,
      newValue: { amount: Number(payment.amount), method: payment.method },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/payments/refund - Process a refund
router.post('/refund', authMiddleware, requireUnlockedRegister, validateRequest(refundPaymentSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { paymentId, amount, reason, method } = req.body;
    const orgId = req.user!.organizationId!;

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: true, refunds: true },
    });

    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });

    const totalRefunded = payment.refunds.reduce((sum, r) => sum + Number(r.amount), 0);
    if (totalRefunded + amount > Number(payment.amount)) {
      return res.status(400).json({ success: false, message: 'Refund exceeds payment amount' });
    }

    // If this payment was captured through a gateway, refund it there first so
    // the money actually moves back to the customer before we record it.
    const isCardLike = isGatewayMethod(payment.method);
    let gatewayRef: string | undefined;
    if (isCardLike && payment.reference) {
      const gw = await refundCharge({
        reference: payment.reference,
        amount,
        currency: payment.currency || 'USD',
        reason,
        idempotencyKey: `${paymentId}:${totalRefunded}:${amount}`,
      });
      if (gw.status === 'FAILED') {
        return res.status(502).json({ success: false, message: gw.message || 'Gateway refund failed' });
      }
      gatewayRef = gw.reference;
    }

    // Record the refund, flip payment + order status, and post the accounting
    // entry atomically. The gateway refund above already moved the money; these
    // are the internal records of that movement, so the books can never show a
    // refund without its matching ledger entry (§34 transactional integrity).
    // The transaction client is named `prisma` to shadow the module import.
    const refund = await prisma.$transaction(async (prisma) => {
      const created = await prisma.refund.create({
        data: {
          organizationId: orgId,
          orderId: payment.orderId,
          paymentId,
          customerId: payment.order.customerId,
          amount,
          reason,
          method,
          status: 'PROCESSED',
          processedAt: new Date(),
          processedBy: req.user!.employeeId,
        },
      });

      // Update payment status
      const newTotalRefunded = totalRefunded + amount;
      const newPaymentStatus = newTotalRefunded >= Number(payment.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      await prisma.payment.update({
        where: { id: paymentId },
        data: { status: newPaymentStatus },
      });

      // Update order status (sees this transaction's own payment update)
      const orderPayments = await prisma.payment.findMany({ where: { orderId: payment.orderId } });
      const allRefunded = orderPayments.every(p => ['REFUNDED', 'VOIDED', 'FAILED', 'DECLINED'].includes(p.status));
      await prisma.order.update({
        where: { id: payment.orderId },
        data: { status: allRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
      });

      // Create accounting entry for refund
      await prisma.accountingEntry.create({
        data: {
          organizationId: orgId,
          type: 'REFUND',
          referenceType: 'REFUND',
          referenceId: created.id,
          amount: -amount,
          description: `Refund: ${reason || 'No reason'}`,
          status: 'POSTED',
        },
      });

      return created;
    }, { timeout: 15000, maxWait: 5000 });

    // Emit event
    await emitEvent({
      organizationId: orgId,
      event: 'refund.created',
      data: { id: refund.id, orderId: payment.orderId, amount, reason },
    });

    // Audit
    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: 'REFUND_CREATED',
      resourceType: 'PAYMENT',
      resourceId: paymentId,
      newValue: { refundId: refund.id, amount, reason, gatewayRef },
    });

    res.status(201).json({ success: true, data: refund });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/payments/:id/settle - Mark payment as settled
router.put('/:id/settle', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const payment = await prisma.payment.findUnique({ where: { id: String(req.params.id) } });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    if (!['COMPLETED', 'CAPTURED'].includes(payment.status)) {
      return res.status(400).json({ success: false, message: 'Payment must be COMPLETED or CAPTURED to settle' });
    }

    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'SETTLED' },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/payments/:id/reconcile - Mark payment as reconciled
router.put('/:id/reconcile', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const payment = await prisma.payment.findUnique({ where: { id: String(req.params.id) } });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    if (payment.status !== 'SETTLED') {
      return res.status(400).json({ success: false, message: 'Payment must be SETTLED to reconcile' });
    }

    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'RECONCILED' },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
