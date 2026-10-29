/**
 * Backorders / special orders (§12 retail parity).
 *
 * Why this exists: when the shelf is empty the sale either dies or becomes a
 * promise. A promise needs a row — who is owed what, how much of it, since when,
 * and how much deposit they left. Without it the store has a note on a pad and
 * the customer has no record at all.
 *
 * Mounted on the `/orders` base BEFORE `orderRoutes` (paths are all
 * `/backorders…`, so the rest of the order surface falls straight through), and
 * also available at `/api/v1/orders/backorders`.
 *
 * A backorder deliberately does not reserve stock: the unit is not there. On
 * fulfilment the goods physically leave the shelf, so that is when the inventory
 * balance moves — not when the promise was taken.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { round2 } from '../services/moneyMath.js';
import { normalizeQuantity } from '../services/units.js';

const router = Router();

const MANAGERS = requireRole('OWNER', 'ADMIN', 'MANAGER');

const OPEN_STATUSES = ['OPEN', 'PARTIALLY_FULFILLED'] as const;

const createSchema = z.object({
  customerId: z.string().min(1).nullable().optional(),
  productId: z.string().min(1),
  quantity: z.number().positive().max(100_000),
  orderId: z.string().min(1).nullable().optional(),
  locationId: z.string().min(1).nullable().optional(),
  expectedAt: z.string().nullable().optional(),
  depositAmount: z.number().min(0).optional(),
  unitPrice: z.number().min(0).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

// GET /api/orders/backorders?status=&customerId=&productId=
router.get('/backorders', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const where: Record<string, unknown> = { organizationId };

    if (req.query.status) {
      const wanted = String(req.query.status)
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      where.status = wanted.length === 1 ? wanted[0] : { in: wanted };
    } else {
      where.status = { in: [...OPEN_STATUSES] };
    }
    if (req.query.customerId) where.customerId = String(req.query.customerId);
    if (req.query.productId) where.productId = String(req.query.productId);
    if (req.query.overdue === 'true') {
      where.expectedAt = { lt: new Date() };
      where.status = { in: [...OPEN_STATUSES] };
    }

    const rows = await prisma.backorder.findMany({
      where,
      orderBy: [{ expectedAt: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    });

    const customerIds = [...new Set(rows.map((r) => r.customerId).filter((id): id is string => Boolean(id)))];
    const customers = customerIds.length
      ? await prisma.customer.findMany({
          where: { organizationId, id: { in: customerIds } },
          select: { id: true, name: true, email: true, phone: true },
        })
      : [];
    const byId = new Map(customers.map((c) => [c.id, c]));

    res.json({
      success: true,
      data: rows.map((r) => ({
        ...r,
        quantity: Number(r.quantity),
        fulfilledQty: Number(r.fulfilledQty),
        outstandingQty: round2(Number(r.quantity) - Number(r.fulfilledQty)),
        unitPrice: Number(r.unitPrice),
        depositAmount: Number(r.depositAmount),
        customer: r.customerId ? byId.get(r.customerId) ?? null : null,
      })),
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/orders/backorders/summary - the "who are we still owing" board
router.get('/backorders/summary', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const rows = await prisma.backorder.findMany({
      where: { organizationId, status: { in: [...OPEN_STATUSES] } },
      select: { productId: true, productName: true, quantity: true, fulfilledQty: true, expectedAt: true },
    });

    const now = new Date();
    const byProduct = new Map<string, { productId: string; productName: string; outstandingQty: number; promises: number }>();
    let overdue = 0;

    for (const r of rows) {
      const outstanding = Number(r.quantity) - Number(r.fulfilledQty);
      if (outstanding <= 0) continue;
      const entry = byProduct.get(r.productId) ?? {
        productId: r.productId,
        productName: r.productName,
        outstandingQty: 0,
        promises: 0,
      };
      entry.outstandingQty = round2(entry.outstandingQty + outstanding);
      entry.promises += 1;
      byProduct.set(r.productId, entry);
      if (r.expectedAt && r.expectedAt < now) overdue++;
    }

    res.json({
      success: true,
      data: {
        openPromises: rows.length,
        overdue,
        products: [...byProduct.values()].sort((a, b) => b.outstandingQty - a.outstandingQty),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/orders/backorders - take the promise
router.post('/backorders', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = createSchema.parse(req.body);

    const product = await prisma.product.findFirst({
      where: { id: body.productId, organizationId },
      select: { id: true, name: true, price: true, unitOfMeasure: true, isWeighed: true },
    });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    // Same quantity rules as a sale: you cannot promise 0.0004 kg of anything.
    const verdict = normalizeQuantity(body.quantity, product.unitOfMeasure as any, product.isWeighed);
    if (!verdict.ok) {
      return res.status(400).json({ success: false, message: `Invalid quantity (${verdict.reason})` });
    }

    if (body.customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: body.customerId, organizationId }, select: { id: true } });
      if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    if (body.orderId) {
      const order = await prisma.order.findFirst({ where: { id: body.orderId, organizationId }, select: { id: true } });
      if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    }

    let locationId = body.locationId ?? null;
    if (!locationId) {
      const location = await prisma.location.findFirst({ where: { organizationId }, select: { id: true } });
      locationId = location?.id ?? null;
    }

    const created = await prisma.backorder.create({
      data: {
        organizationId,
        locationId,
        orderId: body.orderId ?? null,
        customerId: body.customerId ?? null,
        productId: product.id,
        productName: product.name,
        quantity: verdict.quantity,
        uom: product.unitOfMeasure ?? 'EACH',
        unitPrice: body.unitPrice ?? Number(product.price),
        depositAmount: body.depositAmount ?? 0,
        status: 'OPEN',
        expectedAt: body.expectedAt ? new Date(body.expectedAt) : null,
        notes: body.notes ?? null,
      },
    });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'BACKORDER_CREATED',
      resourceType: 'BACKORDER',
      resourceId: created.id,
      newValue: { productId: product.id, quantity: verdict.quantity, customerId: body.customerId ?? null },
    });

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/orders/backorders/:id
router.get('/backorders/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const row = await prisma.backorder.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!row) return res.status(404).json({ success: false, message: 'Backorder not found' });

    const customer = row.customerId
      ? await prisma.customer.findFirst({
          where: { id: row.customerId, organizationId },
          select: { id: true, name: true, email: true, phone: true },
        })
      : null;

    res.json({
      success: true,
      data: {
        ...row,
        quantity: Number(row.quantity),
        fulfilledQty: Number(row.fulfilledQty),
        outstandingQty: round2(Number(row.quantity) - Number(row.fulfilledQty)),
        unitPrice: Number(row.unitPrice),
        depositAmount: Number(row.depositAmount),
        customer,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * POST /api/orders/backorders/:id/fulfill
 *
 * The unit arrived. Record how much of the promise is now met and move the stock
 * out of the shelf, so the balance reflects goods that actually left the store.
 * Partial fulfilment is normal (a case of 12 arrives against a promise of 20).
 */
router.post('/backorders/:id/fulfill', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const body = z
      .object({ quantity: z.number().positive().optional(), notes: z.string().max(500).optional() })
      .parse(req.body ?? {});

    const row = await prisma.backorder.findFirst({ where: { id, organizationId } });
    if (!row) return res.status(404).json({ success: false, message: 'Backorder not found' });
    if (!OPEN_STATUSES.includes(row.status as (typeof OPEN_STATUSES)[number])) {
      return res.status(409).json({ success: false, message: `A ${row.status} backorder cannot be fulfilled` });
    }

    const outstanding = round2(Number(row.quantity) - Number(row.fulfilledQty));
    const qty = round2(body.quantity ?? outstanding);
    if (qty > outstanding + 1e-9) {
      return res.status(400).json({ success: false, message: `Only ${outstanding} unit(s) remain on this promise` });
    }

    const fulfilledQty = round2(Number(row.fulfilledQty) + qty);
    const status = fulfilledQty >= Number(row.quantity) - 1e-9 ? 'FULFILLED' : 'PARTIALLY_FULFILLED';

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.backorder.update({
        where: { id },
        data: { fulfilledQty, status, notes: body.notes ?? row.notes },
      });

      // Stock leaves the shelf now, not when the promise was taken.
      if (row.locationId) {
        const balance = await tx.inventoryBalance.findUnique({
          where: { productId_locationId: { productId: row.productId, locationId: row.locationId } },
          select: { id: true, quantity: true },
        });
        if (balance) {
          await tx.inventoryBalance.update({
            where: { id: balance.id },
            data: { quantity: round2(Math.max(0, Number(balance.quantity) - qty)) },
          });
          await tx.inventoryMovement.create({
            data: {
              balanceId: balance.id,
              type: 'SALE',
              quantity: -qty,
              reference: `BACKORDER-${row.id.slice(0, 8)}`,
              notes: 'Backorder fulfilled',
              performedBy: req.user!.employeeId ?? null,
            },
          });
        }
      }
      return next;
    });

    res.json({
      success: true,
      data: {
        ...updated,
        quantity: Number(updated.quantity),
        fulfilledQty: Number(updated.fulfilledQty),
        outstandingQty: round2(Number(updated.quantity) - Number(updated.fulfilledQty)),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/orders/backorders/:id/notify - the goods are in, tell the customer
router.post('/backorders/:id/notify', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const row = await prisma.backorder.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!row) return res.status(404).json({ success: false, message: 'Backorder not found' });

    const updated = await prisma.backorder.update({ where: { id: row.id }, data: { notifiedAt: new Date() } });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/orders/backorders/:id/cancel
router.post('/backorders/:id/cancel', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = z.object({ notes: z.string().max(500).optional() }).parse(req.body ?? {});

    const row = await prisma.backorder.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!row) return res.status(404).json({ success: false, message: 'Backorder not found' });
    if (row.status === 'FULFILLED') {
      return res.status(409).json({ success: false, message: 'A fulfilled backorder cannot be cancelled' });
    }

    const updated = await prisma.backorder.update({
      where: { id: row.id },
      data: { status: 'CANCELLED', notes: body.notes ?? row.notes },
    });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'BACKORDER_CANCELLED',
      resourceType: 'BACKORDER',
      resourceId: row.id,
      newValue: { fulfilledQty: Number(row.fulfilledQty) },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
