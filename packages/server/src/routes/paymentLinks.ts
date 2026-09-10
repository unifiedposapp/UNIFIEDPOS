// ─── §9 Payment links ────────────────────────────────────────────────────────
// Shareable, tokenised "pay by link" requests. Staff create a link (optionally
// tied to an order/customer); the payer opens the public URL and settles it
// through the same PSP adapter as the terminal (real Stripe when configured,
// else the deterministic simulator). Public routes carry no auth (CSRF-exempt:
// cookieless) and never expose more than the amount/description.

import { Router, Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { emitEvent } from '../services/eventBus.js';
import { appBaseUrl } from '../services/email.js';
import { isValidCurrency, normalizeCurrency } from '../data/currencies.js';
import { createCharge, activeProvider, isStripeConfigured } from '../services/paymentProvider.js';

const router = Router();

const createSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().optional().refine((c) => !c || isValidCurrency(c), 'Currency must be a valid ISO 4217 code'),
  description: z.string().optional(),
  customerId: z.string().optional(),
  orderId: z.string().optional(),
  maxPayments: z.number().int().positive().optional(),
  expiresAt: z.string().optional(),
});

const paySchema = z.object({
  paymentMethodId: z.string().optional(),
  method: z.string().optional(),
});

/** Public checkout URL for a link token (served by the web SPA at /pay/:token). */
function publicUrl(token: string): string {
  return `${appBaseUrl()}/pay/${token}`;
}

function isActive(link: { status: string; expiresAt: Date | null }): boolean {
  return link.status === 'ACTIVE' && (!link.expiresAt || link.expiresAt > new Date());
}

// POST /api/payment-links - create a link
router.post('/', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(createSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { amount, currency, description, customerId, orderId, maxPayments, expiresAt } = req.body;
    const token = crypto.randomBytes(16).toString('hex');
    const link = await prisma.paymentLink.create({
      data: {
        organizationId: orgId,
        token,
        amount,
        currency: normalizeCurrency(currency) || 'USD',
        description,
        customerId,
        orderId,
        maxPayments: maxPayments ?? 1,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        createdBy: req.user!.id,
      },
    });
    await createAuditEvent({ organizationId: orgId, actorId: req.user!.employeeId, action: 'PAYMENT_LINK_CREATED', resourceType: 'PAYMENT_LINK', resourceId: link.id, newValue: { amount, currency: link.currency } });
    res.status(201).json({ success: true, data: { ...link, url: publicUrl(token) } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/payment-links - list
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const links = await prisma.paymentLink.findMany({
      where: { organizationId: req.user!.organizationId! },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: links.map((l) => ({ ...l, url: publicUrl(l.token) })) });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/payment-links/public/:token - PUBLIC: minimal details for the checkout page
router.get('/public/:token', async (req, res: Response) => {
  try {
    const link = await prisma.paymentLink.findUnique({ where: { token: String(req.params.token) } });
    if (!link || !isActive(link)) {
      return res.status(404).json({ success: false, message: 'Payment link not found or inactive' });
    }
    res.json({
      success: true,
      data: {
        amount: Number(link.amount),
        currency: link.currency,
        description: link.description,
        status: link.status,
        provider: activeProvider(),
        simulator: !isStripeConfigured(),
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/payment-links/public/:token/pay - PUBLIC: settle the link
router.post('/public/:token/pay', validateRequest(paySchema), async (req, res: Response) => {
  try {
    const link = await prisma.paymentLink.findUnique({ where: { token: String(req.params.token) } });
    if (!link) return res.status(404).json({ success: false, message: 'Payment link not found' });
    if (link.status !== 'ACTIVE') return res.status(400).json({ success: false, message: `Payment link is ${link.status}` });
    if (link.expiresAt && link.expiresAt <= new Date()) {
      await prisma.paymentLink.update({ where: { id: link.id }, data: { status: 'EXPIRED' } });
      return res.status(400).json({ success: false, message: 'Payment link has expired' });
    }
    if (link.paymentCount >= link.maxPayments) {
      return res.status(400).json({ success: false, message: 'Payment link has already been paid in full' });
    }

    const charge = await createCharge({
      amount: Number(link.amount),
      currency: link.currency,
      paymentMethodId: req.body.paymentMethodId,
      description: link.description || `Payment link ${link.token}`,
      metadata: { paymentLinkId: link.id },
    });
    if (charge.status === 'FAILED') {
      return res.status(402).json({ success: false, message: charge.message || 'Payment declined' });
    }

    const newCount = link.paymentCount + 1;
    const fullyPaid = newCount >= link.maxPayments;
    const updated = await prisma.paymentLink.update({
      where: { id: link.id },
      data: { paymentCount: newCount, status: fullyPaid ? 'PAID' : 'ACTIVE', paidAt: fullyPaid ? new Date() : link.paidAt },
    });

    // When tied to an order, record a Payment so the order ledger stays correct.
    if (link.orderId) {
      await prisma.payment.create({
        data: {
          orderId: link.orderId,
          method: (req.body.method || 'CARD').toUpperCase(),
          amount: link.amount,
          currency: link.currency,
          provider: charge.provider,
          reference: charge.reference,
          status: 'COMPLETED',
        },
      });
    }

    await emitEvent({
      organizationId: link.organizationId,
      event: 'payment_link.paid',
      data: { linkId: link.id, token: link.token, amount: Number(link.amount), currency: link.currency, status: updated.status },
    });

    res.json({ success: true, data: { status: updated.status, paymentCount: updated.paymentCount, charge: { provider: charge.provider, reference: charge.reference } } });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/payment-links/:id/cancel
router.put('/:id/cancel', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const existing = await prisma.paymentLink.findFirst({ where: { id: String(req.params.id), organizationId: orgId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Payment link not found' });
    const updated = await prisma.paymentLink.update({ where: { id: existing.id }, data: { status: 'CANCELLED' } });
    await createAuditEvent({ organizationId: orgId, actorId: req.user!.employeeId, action: 'PAYMENT_LINK_CANCELLED', resourceType: 'PAYMENT_LINK', resourceId: existing.id });
    res.json({ success: true, data: { ...updated, url: publicUrl(updated.token) } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/payment-links/:id (after the literal /public routes)
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const link = await prisma.paymentLink.findFirst({ where: { id: String(req.params.id), organizationId: req.user!.organizationId! } });
    if (!link) return res.status(404).json({ success: false, message: 'Payment link not found' });
    res.json({ success: true, data: { ...link, url: publicUrl(link.token) } });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/payment-links/:id
router.delete('/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const existing = await prisma.paymentLink.findFirst({ where: { id: String(req.params.id), organizationId: orgId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Payment link not found' });
    await prisma.paymentLink.delete({ where: { id: existing.id } });
    await createAuditEvent({ organizationId: orgId, actorId: req.user!.employeeId, action: 'PAYMENT_LINK_DELETED', resourceType: 'PAYMENT_LINK', resourceId: existing.id });
    res.json({ success: true, message: 'Payment link deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
