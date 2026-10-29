/**
 * Quotes / estimates (§17 B2B selling).
 *
 * A quote is the pre-sale a trade customer asks for: priced, dated, expiring, and
 * convertible into a real order without re-typing the basket. Totals are computed
 * from the lines server-side and never trusted from the client.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';

const router = Router();

const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** QUO-YYYYMMDD-XXXXXX; the suffix makes collisions practically impossible. */
function newQuoteNumber(): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `QUO-${stamp}-${suffix}`;
}

const lineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive(),
  uom: z.string().max(12).optional(),
  unitPrice: z.number().min(0).optional(),
  discountAmt: z.number().min(0).optional(),
  taxAmt: z.number().min(0).optional(),
});

const quoteSchema = z.object({
  customerId: z.string().min(1).nullable().optional(),
  validUntil: z.string().nullable().optional(),
  currency: z.string().length(3).optional(),
  notes: z.string().max(4000).nullable().optional(),
  lines: z.array(lineSchema).min(1).max(200),
});

/** Resolve and price the lines, rejecting products from another tenant. */
async function priceLines(organizationId: string, lines: z.infer<typeof lineSchema>[]) {
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, organizationId },
    select: { id: true, name: true, price: true, unitOfMeasure: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const unknown = productIds.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    throw Object.assign(new Error(`Unknown product(s): ${unknown.join(', ')}`), { status: 400 });
  }

  const priced = lines.map((l) => {
    const product = byId.get(l.productId)!;
    const quantity = Number(l.quantity);
    const unitPrice = money(l.unitPrice ?? Number(product.price));
    const gross = quantity * unitPrice;
    const discountAmt = money(l.discountAmt ?? 0);
    const taxAmt = money(l.taxAmt ?? 0);
    return {
      productId: l.productId,
      productName: product.name,
      quantity,
      uom: (l.uom ?? product.unitOfMeasure ?? 'EACH').toUpperCase(),
      unitPrice,
      discountAmt,
      taxAmt,
      totalAmount: money(gross - discountAmt + taxAmt),
    };
  });

  const subtotal = money(priced.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const discountAmount = money(priced.reduce((s, l) => s + l.discountAmt, 0));
  const taxAmount = money(priced.reduce((s, l) => s + l.taxAmt, 0));

  return {
    lines: priced,
    subtotal,
    discountAmount,
    taxAmount,
    totalAmount: money(subtotal - discountAmount + taxAmount),
  };
}

// GET /api/quotes?status=&customerId=
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;

    // Expiry is a fact about the clock, not a button someone remembers to press.
    await prisma.quote.updateMany({
      where: { organizationId, status: { in: ['DRAFT', 'SENT'] }, validUntil: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });

    const where: Record<string, unknown> = { organizationId };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.customerId) where.customerId = String(req.query.customerId);

    const rows = await prisma.quote.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { lines: { select: { id: true } } },
    });

    res.json({
      success: true,
      data: rows.map(({ lines, ...q }) => ({ ...q, lineCount: lines.length })),
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/quotes/:id
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const quote = await prisma.quote.findFirst({
      where: { id: String(req.params.id), organizationId },
      include: { lines: true },
    });
    if (!quote) return res.status(404).json({ success: false, message: 'Quote not found' });

    const customer = quote.customerId
      ? await prisma.customer.findFirst({
          where: { id: quote.customerId, organizationId },
          select: { id: true, name: true, email: true, phone: true, address: true },
        })
      : null;

    res.json({ success: true, data: { ...quote, customer } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/quotes
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = quoteSchema.parse(req.body);

    if (body.customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: body.customerId, organizationId }, select: { id: true } });
      if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const priced = await priceLines(organizationId, body.lines);

    const created = await prisma.quote.create({
      data: {
        organizationId,
        quoteNumber: newQuoteNumber(),
        customerId: body.customerId ?? null,
        employeeId: req.user!.employeeId ?? null,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
        status: 'DRAFT',
        currency: (body.currency ?? 'USD').toUpperCase(),
        notes: body.notes ?? null,
        subtotal: priced.subtotal,
        discountAmount: priced.discountAmount,
        taxAmount: priced.taxAmount,
        totalAmount: priced.totalAmount,
        lines: { create: priced.lines },
      },
      include: { lines: true },
    });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'QUOTE_CREATED',
      resourceType: 'QUOTE',
      resourceId: created.id,
      newValue: { quoteNumber: created.quoteNumber, total: Number(created.totalAmount) },
    });

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/quotes/:id - edit a quote that has not been accepted
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const body = quoteSchema.partial().parse(req.body);

    const existing = await prisma.quote.findFirst({ where: { id, organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Quote not found' });
    if (['ACCEPTED', 'CONVERTED', 'EXPIRED'].includes(existing.status) && !body.lines) {
      return res.status(409).json({ success: false, message: `Quote is ${existing.status} and can no longer be edited` });
    }

    const priced = body.lines ? await priceLines(organizationId, body.lines) : null;
    if (body.customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: body.customerId, organizationId }, select: { id: true } });
      if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (priced) {
        await tx.quoteLine.deleteMany({ where: { quoteId: id } });
        await tx.quoteLine.createMany({ data: priced.lines.map((l) => ({ ...l, quoteId: id })) });
      }
      return tx.quote.update({
        where: { id },
        data: {
          customerId: body.customerId === undefined ? existing.customerId : body.customerId,
          validUntil: body.validUntil === undefined ? existing.validUntil : body.validUntil ? new Date(body.validUntil) : null,
          currency: body.currency ? body.currency.toUpperCase() : existing.currency,
          notes: body.notes === undefined ? existing.notes : body.notes,
          ...(priced
            ? {
                subtotal: priced.subtotal,
                discountAmount: priced.discountAmount,
                taxAmount: priced.taxAmount,
                totalAmount: priced.totalAmount,
              }
            : {}),
        },
        include: { lines: true },
      });
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/quotes/:id - only a draft can be withdrawn
router.delete('/:id', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const existing = await prisma.quote.findFirst({ where: { id, organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Quote not found' });
    if (existing.status !== 'DRAFT') {
      return res.status(409).json({ success: false, message: 'Only a draft quote can be deleted; decline it instead' });
    }

    await prisma.quote.delete({ where: { id } });
    res.json({ success: true, data: { id } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/quotes/:id/status - send / accept / decline
router.post('/:id/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const body = z.object({ status: z.enum(['SENT', 'ACCEPTED', 'DECLINED']) }).parse(req.body);

    const existing = await prisma.quote.findFirst({ where: { id, organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Quote not found' });
    if (existing.status === 'CONVERTED') {
      return res.status(409).json({ success: false, message: 'This quote has already become an order' });
    }
    if (existing.status === 'EXPIRED' && body.status !== 'DECLINED') {
      return res.status(409).json({ success: false, message: 'This quote has expired; extend validUntil first' });
    }

    const updated = await prisma.quote.update({ where: { id }, data: { status: body.status } });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: `QUOTE_${body.status}`,
      resourceType: 'QUOTE',
      resourceId: id,
      previousValue: { status: existing.status },
      newValue: { status: body.status },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * POST /api/quotes/:id/convert
 *
 * Turn an accepted quote into a DRAFT order. The order starts as a draft so a
 * cashier still chooses the payment method; converting twice is refused.
 */
router.post('/:id/convert', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);

    const quote = await prisma.quote.findFirst({ where: { id, organizationId }, include: { lines: true } });
    if (!quote) return res.status(404).json({ success: false, message: 'Quote not found' });
    if (quote.convertedOrderId) {
      return res.status(409).json({ success: false, message: 'Quote already converted', orderId: quote.convertedOrderId });
    }
    if (!['ACCEPTED', 'SENT', 'DRAFT'].includes(quote.status)) {
      return res.status(409).json({ success: false, message: `A ${quote.status} quote cannot become an order` });
    }
    if (quote.lines.length === 0) {
      return res.status(400).json({ success: false, message: 'Quote has no lines' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          organizationId,
          orderNumber: `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
          channel: 'IN_STORE',
          status: 'DRAFT',
          currency: quote.currency,
          subtotal: quote.subtotal,
          discountAmount: quote.discountAmount,
          taxAmount: quote.taxAmount,
          totalAmount: quote.totalAmount,
          customerId: quote.customerId,
          employeeId: quote.employeeId,
          notes: `Created from quote ${quote.quoteNumber}`,
          items: {
            create: quote.lines.map((l) => ({
              productId: l.productId,
              productName: l.productName,
              quantity: l.quantity,
              uom: l.uom,
              unitPrice: l.unitPrice,
              discountAmt: l.discountAmt,
              taxAmt: l.taxAmt,
              totalAmount: l.totalAmount,
            })),
          },
        },
        select: { id: true, orderNumber: true },
      });

      const updated = await tx.quote.update({
        where: { id: quote.id },
        data: { status: 'CONVERTED', convertedOrderId: order.id },
      });

      return { order, quote: updated };
    });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'QUOTE_CONVERTED',
      resourceType: 'QUOTE',
      resourceId: quote.id,
      newValue: { orderId: result.order.id, orderNumber: result.order.orderNumber },
    });

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
