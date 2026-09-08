// ─── Stripe webhook handler ───────────────────────────────────────────────
// Receives asynchronous payment lifecycle events from Stripe (payment success /
// failure, disputes). MUST be mounted with a RAW body parser (before the global
// express.json) so the HMAC signature can be verified against the exact bytes.
//
// Events are idempotent-ish: we look the local Payment up by its processor
// reference (the PaymentIntent id) and reconcile its status, then emit internal
// events so the rest of the system (orders, notifications) reacts.

import { Request, Response } from 'express';
import { prisma } from '../db/client.js';
import { verifyStripeWebhook } from '../services/paymentProvider.js';
import { emitEvent } from '../services/eventBus.js';
import { createAuditEvent } from '../utils/audit.js';

const SUCCESS_STATUSES = ['COMPLETED', 'CAPTURED', 'SETTLED', 'RECONCILED'];

export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  let event: any;
  try {
    event = verifyStripeWebhook((req as any).body, req.headers['stripe-signature'] as string | undefined);
  } catch {
    event = null;
  }

  if (!event) {
    // Always 400 on a bad signature so Stripe retries and alerts the operator.
    res.status(400).json({ success: false, message: 'Invalid webhook signature' });
    return;
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
      case 'payment_intent.processing': {
        const pi = event.data?.object;
        const payment = await prisma.payment.findFirst({ where: { reference: pi?.id }, include: { order: true } });
        if (payment && payment.status !== 'COMPLETED') {
          await prisma.payment.update({ where: { id: payment.id }, data: { status: 'COMPLETED' } });
          await reconcileOrder(payment.orderId);
          if (payment.order?.organizationId) {
            await emitEvent({ organizationId: payment.order.organizationId, event: 'payment.completed', data: { id: payment.id, orderId: payment.orderId, reference: pi?.id } });
          }
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data?.object;
        const payment = await prisma.payment.findFirst({ where: { reference: pi?.id } });
        if (payment) {
          await prisma.payment.update({
            where: { id: payment.id },
            data: { status: 'DECLINED', metadata: { declineCode: pi?.last_payment_error?.decline_code, message: pi?.last_payment_error?.message } },
          });
        }
        break;
      }

      case 'charge.dispute.created': {
        const dispute = event.data?.object;
        const piId = dispute?.payment_intent;
        const payment = piId
          ? await prisma.payment.findFirst({ where: { reference: piId }, include: { order: true } })
          : null;
        const orgId = payment?.order?.organizationId;
        if (payment && orgId) {
          await prisma.chargeback.create({
            data: {
              organizationId: orgId,
              paymentId: payment.id,
              amount: Number((dispute.amount ?? 0) / 100) || Number(payment.amount),
              reason: dispute.reason || 'DISPUTE',
              status: 'OPEN',
            },
          });
          await prisma.payment.update({ where: { id: payment.id }, data: { status: 'DISPUTED' } });
          await emitEvent({ organizationId: orgId, event: 'chargeback.created', data: { paymentId: payment.id, reference: piId } });
          await createAuditEvent({ organizationId: orgId, action: 'CHARGEBACK_CREATED', resourceType: 'PAYMENT', resourceId: payment.id, newValue: { source: 'stripe-webhook', reference: dispute.id } });
        }
        break;
      }

      default:
        // Unhandled event type — acknowledge so Stripe stops retrying.
        break;
    }

    res.json({ received: true });
  } catch (err) {
    // 500 makes Stripe retry the delivery later.
    console.error('[stripe-webhook] handler error:', err);
    res.status(500).json({ success: false, message: 'Webhook handler error' });
  }
}

// Mark the order PAID once captured funds cover its total.
async function reconcileOrder(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { payments: true } });
  if (!order) return;
  const paid = order.payments.filter((p) => SUCCESS_STATUSES.includes(p.status)).reduce((s, p) => s + Number(p.amount), 0);
  if (paid >= Number(order.totalAmount) && order.status !== 'PAID') {
    await prisma.order.update({ where: { id: orderId }, data: { status: 'PAID' } });
  }
}
