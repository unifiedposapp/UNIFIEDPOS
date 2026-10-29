/**
 * Card-present payments (§9 payments, Stripe Terminal).
 *
 * The gap this closes: every charge in the app was tokenised (SAQ-A) — fine for
 * e-commerce, useless for a counter where the guest taps a physical card. This
 * module registers readers, hands payment intents to the device, and — the part
 * restaurants actually need — captures a manual authorisation at a higher amount
 * once the tip is known.
 *
 * Env-gated like the rest of the codebase: with `STRIPE_SECRET_KEY` unset the
 * service returns deterministic simulated results, so the UI and smoke tests work
 * with no Stripe account.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import {
  cancelIntent,
  captureIntent,
  createCardPresentIntent,
  createConnectionToken,
  deleteReader,
  isTerminalConfigured,
  listReaders,
  refundIntent,
  registerReader,
  setReaderLabel,
  terminalProvider,
  validateTipAdjust,
} from '../services/terminal.js';

const router = Router();

const MANAGERS = requireRole('OWNER', 'ADMIN', 'MANAGER');

const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// ─── Provider status ───────────────────────────────────────────────────────

// GET /api/terminal/provider
router.get('/provider', authMiddleware, (_req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    data: {
      configured: isTerminalConfigured(),
      provider: terminalProvider(),
      // Not a secret; the browser needs the key to drive the reader SDK.
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? null,
    },
  });
});

// POST /api/terminal/connection-token - short-lived token for the browser SDK
router.post('/connection-token', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await createConnectionToken();
    if (!result.ok) return res.status(502).json({ success: false, message: result.message, reason: result.reason });
    res.json({ success: true, data: result.data });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Readers ───────────────────────────────────────────────────────────────

// GET /api/terminal/readers?refresh=true
router.get('/readers', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const rows = await prisma.terminalReader.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });

    // `refresh` reconciles against the provider, so a reader that went offline in
    // the field shows as offline rather than "whatever we last stored".
    if (String(req.query.refresh ?? '') === 'true' && isTerminalConfigured()) {
      const live = await listReaders();
      if (live.ok) {
        const byId = new Map(live.data.map((r) => [r.id, r]));
        for (const row of rows) {
          if (!row.stripeReaderId) continue;
          const remote = byId.get(row.stripeReaderId);
          if (!remote) continue;
          await prisma.terminalReader.update({
            where: { id: row.id },
            data: {
              status: remote.status.toUpperCase(),
              serialNumber: remote.serialNumber ?? row.serialNumber,
              ipAddress: remote.ipAddress ?? row.ipAddress,
              lastSeenAt: new Date(),
            },
          });
        }
      }
    }

    const fresh = await prisma.terminalReader.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } });
    res.json({ success: true, data: fresh });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/terminal/readers/register - pair a physical reader with its code
router.post('/readers/register', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = z
      .object({
        label: z.string().min(1).max(120),
        registrationCode: z.string().min(6).max(20),
        locationId: z.string().min(1).nullable().optional(),
        deviceType: z.string().max(40).optional(),
      })
      .parse(req.body);

    if (body.locationId) {
      const location = await prisma.location.findFirst({ where: { id: body.locationId, organizationId }, select: { id: true } });
      if (!location) return res.status(404).json({ success: false, message: 'Location not found' });
    }

    const result = await registerReader({
      registrationCode: body.registrationCode,
      label: body.label,
      locationId: body.locationId ?? null,
    });
    if (!result.ok) {
      return res.status(502).json({ success: false, message: result.message, reason: result.reason });
    }

    const created = await prisma.terminalReader.create({
      data: {
        organizationId,
        locationId: body.locationId ?? null,
        label: body.label,
        provider: terminalProvider(),
        stripeReaderId: result.data.id,
        deviceType: (body.deviceType ?? result.data.deviceType ?? 'CHIPPER_2X').toUpperCase(),
        serialNumber: result.data.serialNumber ?? null,
        status: result.data.status.toUpperCase(),
        metadata: result.data.simulated ? { simulated: true } : undefined,
      },
    });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'TERMINAL_READER_REGISTERED',
      resourceType: 'TERMINAL_READER',
      resourceId: created.id,
      newValue: { label: created.label, deviceType: created.deviceType },
    });

    res.status(201).json({ success: true, data: created, simulated: Boolean(result.data.simulated) });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/terminal/readers/:id
router.put('/readers/:id', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const body = z
      .object({
        label: z.string().min(1).max(120).optional(),
        status: z.enum(['ONLINE', 'OFFLINE', 'UNREGISTERED', 'DISABLED']).optional(),
        locationId: z.string().nullable().optional(),
        deviceType: z.string().max(40).optional(),
      })
      .parse(req.body);

    const reader = await prisma.terminalReader.findFirst({ where: { id, organizationId } });
    if (!reader) return res.status(404).json({ success: false, message: 'Reader not found' });

    // A label is the operator's map of the shop floor; keep the provider in step.
    if (body.label && body.label !== reader.label && reader.stripeReaderId) {
      const synced = await setReaderLabel(reader.stripeReaderId, body.label);
      if (!synced.ok) {
        return res.status(502).json({ success: false, message: synced.message, reason: synced.reason });
      }
    }

    const updated = await prisma.terminalReader.update({
      where: { id },
      data: {
        label: body.label ?? reader.label,
        status: body.status ?? reader.status,
        locationId: body.locationId === undefined ? reader.locationId : body.locationId,
        deviceType: body.deviceType ? body.deviceType.toUpperCase() : reader.deviceType,
      },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/terminal/readers/:id
router.delete('/readers/:id', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const reader = await prisma.terminalReader.findFirst({ where: { id, organizationId } });
    if (!reader) return res.status(404).json({ success: false, message: 'Reader not found' });

    if (reader.stripeReaderId) {
      const removed = await deleteReader(reader.stripeReaderId);
      if (!removed.ok) {
        return res.status(502).json({ success: false, message: removed.message, reason: removed.reason });
      }
    }

    await prisma.terminalReader.delete({ where: { id } });
    res.json({ success: true, data: { id } });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Charges ───────────────────────────────────────────────────────────────

/**
 * POST /api/terminal/charge
 *
 * Creates the payment intent on the reader and records a `Payment` row. With
 * `captureMethod: 'manual'` the money is only held: a bar tab or a restaurant
 * table can then be captured at the tipped total.
 */
router.post('/charge', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = z
      .object({
        orderId: z.string().min(1),
        amount: z.number().positive().optional(),
        currency: z.string().length(3).optional(),
        readerId: z.string().min(1).nullable().optional(),
        captureMethod: z.enum(['automatic', 'manual']).optional(),
        tipAmount: z.number().min(0).optional(),
      })
      .parse(req.body);

    const order = await prisma.order.findFirst({
      where: { id: body.orderId, organizationId },
      include: { payments: true },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (['PAID', 'COMPLETED', 'CANCELLED', 'REFUNDED'].includes(order.status)) {
      return res.status(409).json({ success: false, message: `Order is already ${order.status}` });
    }

    const paid = order.payments
      .filter((p) => ['COMPLETED', 'CAPTURED', 'SETTLED', 'RECONCILED'].includes(p.status))
      .reduce((s, p) => s + Number(p.amount), 0);

    const due = money(Number(order.totalAmount) - paid);
    const amount = body.amount ?? due;
    if (amount <= 0) {
      return res.status(400).json({ success: false, message: 'There is nothing left to charge on this order' });
    }
    if (amount > due + 0.001) {
      return res.status(400).json({ success: false, message: `Amount exceeds the outstanding balance of ${due.toFixed(2)}` });
    }

    let readerRow: { id: string; stripeReaderId: string | null; label: string } | null = null;
    if (body.readerId) {
      const found = await prisma.terminalReader.findFirst({
        where: { id: body.readerId, organizationId },
        select: { id: true, stripeReaderId: true, label: true, status: true },
      });
      if (!found) return res.status(404).json({ success: false, message: 'Reader not found' });
      if (found.status === 'DISABLED') {
        return res.status(409).json({ success: false, message: 'That reader is disabled' });
      }
      readerRow = found;
    }

    const captureMethod = body.captureMethod ?? 'automatic';
    const intent = await createCardPresentIntent({
      amount,
      currency: body.currency ?? order.currency,
      captureMethod,
      readerId: readerRow?.stripeReaderId ?? null,
      description: `Order ${order.orderNumber}`,
      metadata: { orderId: order.id, organizationId },
    });
    if (!intent.ok) {
      return res.status(502).json({ success: false, message: intent.message, reason: intent.reason });
    }

    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        method: 'CARD',
        provider: 'stripe_terminal',
        amount,
        currency: String(order.currency ?? 'USD').toUpperCase(),
        // Manual capture is an authorisation, not money yet — say so honestly.
        status: captureMethod === 'manual' ? 'AUTHORIZED' : 'COMPLETED',
        reference: intent.data.id,
        authorizationId: intent.data.id,
        captureMethod,
        terminalReaderId: readerRow?.id ?? null,
        tipAmount: body.tipAmount ?? 0,
        metadata: {
          simulated: Boolean(intent.data.simulated),
          readerLabel: readerRow?.label ?? null,
          clientSecretPresent: Boolean(intent.data.clientSecret),
        },
      },
    });

    if (captureMethod === 'automatic') {
      const alreadyPaid = money(paid + amount);
      const settled = alreadyPaid >= money(Number(order.totalAmount)) - 0.001;
      await prisma.order.update({
        where: { id: order.id },
        data: settled ? { status: 'PAID', completedAt: new Date() } : {},
      });
    }

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'TERMINAL_CHARGE',
      resourceType: 'PAYMENT',
      resourceId: payment.id,
      newValue: { orderId: order.id, amount, captureMethod, readerId: readerRow?.id ?? null },
    });

    res.status(201).json({
      success: true,
      data: {
        payment,
        intent: intent.data,
        reader: readerRow ? { id: readerRow.id, label: readerRow.label } : null,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

/** Load one payment scoped to the caller's tenant. */
async function loadPayment(organizationId: string, paymentId: string) {
  return prisma.payment.findFirst({
    where: { id: paymentId, order: { organizationId } },
    include: { order: { select: { id: true, orderNumber: true, tipAmount: true, totalAmount: true, currency: true } } },
  });
}

// GET /api/terminal/payments/pending - authorisations awaiting capture
router.get('/payments/pending', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const rows = await prisma.payment.findMany({
      where: { order: { organizationId }, status: 'AUTHORIZED', provider: 'stripe_terminal' },
      orderBy: { createdAt: 'asc' },
      include: { order: { select: { orderNumber: true, tableId: true, isTab: true } } },
    });
    res.json({ success: true, data: rows });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * POST /api/terminal/payments/:paymentId/capture
 *
 * The tip-adjust path. The authorisation was for the food; the guest writes a
 * tip, and the capture asks for the larger amount. The 20% ceiling is enforced
 * here rather than discovered as an acquirer decline.
 */
router.post('/payments/:paymentId/capture', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const paymentId = String(req.params.paymentId);
    const body = z.object({ tipAmount: z.number().min(0).optional(), amount: z.number().positive().optional() }).parse(req.body ?? {});

    const payment = await loadPayment(organizationId, paymentId);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    if (payment.status !== 'AUTHORIZED') {
      return res.status(409).json({ success: false, message: `Payment is ${payment.status}, not awaiting capture` });
    }
    if (!payment.reference) {
      return res.status(409).json({ success: false, message: 'Payment has no processor reference to capture' });
    }

    const authorised = Number(payment.amount);
    const tip = body.tipAmount ?? Number(payment.tipAmount ?? 0);
    const total = body.amount ?? money(authorised + tip);

    const verdict = validateTipAdjust(authorised, total);
    if (!verdict.ok) {
      return res.status(400).json({
        success: false,
        message:
          verdict.reason === 'TIP_ADJUST_BELOW_AUTHORISED'
            ? 'The capture amount cannot be below the authorised amount'
            : 'A card-present capture may not exceed the authorisation by more than 20%',
        reason: verdict.reason,
      });
    }

    const captured = await captureIntent(payment.reference, total);
    if (!captured.ok) {
      return res.status(502).json({ success: false, message: captured.message, reason: captured.reason });
    }

    const adjustedTip = money(total - authorised);
    const [updated] = await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: {
          amount: total,
          tipAmount: adjustedTip,
          status: 'COMPLETED',
          metadata: { ...(payment.metadata as Record<string, unknown> | null ?? {}), capturedAt: new Date().toISOString() },
        },
      }),
      prisma.order.update({
        where: { id: payment.order.id },
        data: {
          tipAmount: money(Number(payment.order.tipAmount) + adjustedTip),
          totalAmount: money(Number(payment.order.totalAmount) + adjustedTip),
          status: 'PAID',
          completedAt: new Date(),
        },
      }),
    ]);

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'TERMINAL_CAPTURE',
      resourceType: 'PAYMENT',
      resourceId: payment.id,
      previousValue: { authorised, tip: Number(payment.tipAmount ?? 0) },
      newValue: { captured: total, tip: adjustedTip },
    });

    res.json({ success: true, data: { payment: updated, captured: captured.data, tip: adjustedTip } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/terminal/payments/:paymentId/cancel - release the hold
router.post('/payments/:paymentId/cancel', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const payment = await loadPayment(organizationId, String(req.params.paymentId));
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    if (!['AUTHORIZED', 'FAILED'].includes(payment.status)) {
      return res.status(409).json({ success: false, message: `Payment is ${payment.status} and cannot be cancelled` });
    }

    if (payment.reference) {
      const cancelled = await cancelIntent(payment.reference);
      if (!cancelled.ok) {
        return res.status(502).json({ success: false, message: cancelled.message, reason: cancelled.reason });
      }
    }

    const updated = await prisma.payment.update({ where: { id: payment.id }, data: { status: 'VOIDED' } });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'TERMINAL_CANCEL',
      resourceType: 'PAYMENT',
      resourceId: payment.id,
      newValue: { reference: payment.reference },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/terminal/payments/:paymentId/refund
router.post('/payments/:paymentId/refund', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = z.object({ amount: z.number().positive().optional(), reason: z.string().max(500).optional() }).parse(req.body ?? {});

    const payment = await loadPayment(organizationId, String(req.params.paymentId));
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    if (!['COMPLETED', 'CAPTURED', 'SETTLED', 'RECONCILED', 'PARTIALLY_REFUNDED'].includes(payment.status)) {
      return res.status(409).json({ success: false, message: `Payment is ${payment.status} and cannot be refunded` });
    }
    if (!payment.reference) {
      return res.status(409).json({ success: false, message: 'Payment has no processor reference to refund' });
    }

    const settled = Number(payment.amount);
    const already = Number((payment.metadata as Record<string, unknown> | null)?.refundedAmount ?? 0);
    const amount = body.amount ?? money(settled - already);
    if (amount > settled - already + 0.001) {
      return res.status(400).json({ success: false, message: `Only ${money(settled - already).toFixed(2)} remains refundable` });
    }

    const refund = await refundIntent(payment.reference, amount);
    if (!refund.ok) {
      return res.status(502).json({ success: false, message: refund.message, reason: refund.reason });
    }

    const refundedTotal = money(already + amount);
    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: refundedTotal >= settled - 0.001 ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
        metadata: {
          ...(payment.metadata as Record<string, unknown> | null ?? {}),
          refundedAmount: refundedTotal,
          lastRefundId: refund.data.id,
          lastRefundReason: body.reason ?? null,
        },
      },
    });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'TERMINAL_REFUND',
      resourceType: 'PAYMENT',
      resourceId: payment.id,
      newValue: { amount, refundedTotal, reason: body.reason ?? null },
    });

    res.json({ success: true, data: { payment: updated, refund: refund.data, refundedTotal } });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
