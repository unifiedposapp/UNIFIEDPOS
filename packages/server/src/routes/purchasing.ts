// ─── Purchasing: real purchase orders, receiving and supplier dispatch ──────
// Historically this module stored a PO as a lone accounting entry, which meant
// the order had no lines, could not be sent to anyone, and receiving it invented
// stock out of thin air. Meanwhile the replenishment agent was already writing
// genuine PurchaseOrder rows that no screen showed. Both now speak to the same
// `purchase_orders` table: a PO has a supplier, lines, a destination location,
// a lifecycle (DRAFT → SENT → PARTIAL → RECEIVED / CANCELLED) and a ledger entry
// only when goods actually arrive.

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError, HttpError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { emitEvent } from '../services/eventBus.js';
import { sendEmail, isEmailConfigured } from '../services/email.js';
import { round2 } from '../services/moneyMath.js';

const router = Router();

const poItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive().max(1_000_000),
  unitCost: z.number().min(0),
});

const createPoSchema = z.object({
  supplierId: z.string().min(1),
  locationId: z.string().optional().nullable(),
  expectedDate: z.string().optional().nullable(),
  notes: z.string().max(2000).optional(),
  items: z.array(poItemSchema).min(1).max(500),
});

const receiveSchema = z.object({
  locationId: z.string().optional(),
  items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive() })).optional(),
});

/** PO plus resolved supplier/lines, in the shape the UI renders. */
async function hydrate(organizationId: string, pos: any[]) {
  if (!pos.length) return [];
  const productIds = [...new Set(pos.flatMap((p: any) => (p.items || []).map((i: any) => i.productId)))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, organizationId },
    select: { id: true, name: true, sku: true },
  });
  const names = new Map(products.map((p) => [p.id, p]));
  return pos.map((po: any) => ({
    ...po,
    totalAmount: Number(po.totalAmount),
    currency: po.currency,
    items: (po.items || []).map((i: any) => ({
      ...i,
      quantity: i.quantity,
      unitCost: Number(i.unitCost),
      receivedQty: i.receivedQty,
      lineTotal: round2(Number(i.unitCost) * i.quantity),
      productName: names.get(i.productId)?.name || 'Unknown product',
      sku: names.get(i.productId)?.sku || null,
    })),
  }));
}

async function loadOwnedPo(organizationId: string, id: string) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, organizationId },
    include: { items: true },
  });
  if (!po) throw new HttpError(404, 'Purchase order not found');
  return po;
}

async function defaultLocation(organizationId: string): Promise<string | null> {
  const loc = await prisma.location.findFirst({ where: { organizationId, isActive: true }, orderBy: { createdAt: 'asc' } });
  return loc?.id || null;
}

// ─── Listing ─────────────────────────────────────────────────────────────────

// GET /api/purchasing/orders?status=&supplierId=
router.get('/orders', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { status, supplierId } = req.query as Record<string, string>;
    const where: any = { organizationId: orgId };
    if (status) where.status = status;
    if (supplierId) where.supplierId = supplierId;
    const [pos, suppliers] = await Promise.all([
      prisma.purchaseOrder.findMany({ where, include: { items: true }, orderBy: { createdAt: 'desc' }, take: 200 }),
      prisma.supplier.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, email: true } }),
    ]);
    const smap = new Map(suppliers.map((s) => [s.id, s]));
    const hydrated = await hydrate(orgId, pos.map((p: any) => ({ ...p, currency: undefined })));
    res.json({
      success: true,
      data: hydrated.map((p: any) => ({ ...p, supplierName: smap.get(p.supplierId)?.name || 'Unknown supplier', supplierEmail: smap.get(p.supplierId)?.email || null })),
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/purchasing/summary - open commitments and month-to-date spend
router.get('/summary', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const [drafts, sent, receivedMonth, receivedAgg, suppliers] = await Promise.all([
      prisma.purchaseOrder.count({ where: { organizationId: orgId, status: 'DRAFT' } }),
      prisma.purchaseOrder.count({ where: { organizationId: orgId, status: { in: ['SENT', 'PARTIAL'] } } }),
      prisma.purchaseOrder.findMany({ where: { organizationId: orgId, status: 'RECEIVED', receivedDate: { gte: monthStart } }, select: { totalAmount: true } }),
      prisma.purchaseOrder.aggregate({ where: { organizationId: orgId, status: 'RECEIVED', orderDate: { gte: monthStart } }, _sum: { totalAmount: true } }),
      prisma.supplier.count({ where: { organizationId: orgId, isActive: true } }),
    ]);
    res.json({
      success: true,
      data: {
        draftOrders: drafts,
        awaitingDelivery: sent,
        receivedThisMonth: receivedMonth.length,
        spendThisMonth: round2(Number(receivedAgg._sum.totalAmount || 0)),
        activeSuppliers: suppliers,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/purchasing/orders/:id
router.get('/orders/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const po = await loadOwnedPo(orgId, String(req.params.id));
    const supplier = await prisma.supplier.findUnique({ where: { id: po.supplierId }, select: { name: true, email: true, phone: true } });
    const [full] = await hydrate(orgId, [po]);
    res.json({ success: true, data: { ...full, supplier } });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Create ──────────────────────────────────────────────────────────────────

// POST /api/purchasing/orders
router.post('/orders', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(createPoSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof createPoSchema>;

    const supplier = await prisma.supplier.findFirst({ where: { id: body.supplierId, organizationId: orgId } });
    if (!supplier) throw new HttpError(400, 'Unknown supplier for this organization');

    // Lines are validated against the tenant's own catalog, and the cost is
    // taken from the request but never trusted beyond a sane number.
    const productIds = [...new Set(body.items.map((i) => i.productId))];
    const products = await prisma.product.findMany({ where: { id: { in: productIds }, organizationId: orgId }, select: { id: true, name: true } });
    const valid = new Set(products.map((p) => p.id));
    const rejected = productIds.filter((id) => !valid.has(id));
    if (rejected.length) throw new HttpError(400, `Products not in your catalog: ${rejected.join(', ')}`);

    // Merge duplicate lines so receiving maths stays honest.
    const merged = new Map<string, { quantity: number; unitCost: number }>();
    for (const item of body.items) {
      const cur = merged.get(item.productId) || { quantity: 0, unitCost: item.unitCost };
      cur.quantity += item.quantity;
      merged.set(item.productId, cur);
    }
    const items = [...merged.entries()].map(([productId, v]) => ({ productId, quantity: v.quantity, unitCost: v.unitCost }));
    const totalAmount = round2(items.reduce((s, i) => s + i.quantity * i.unitCost, 0));

    const locationId = body.locationId || (await defaultLocation(orgId));
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { currency: true } });

    const po = await prisma.purchaseOrder.create({
      data: {
        organizationId: orgId,
        supplierId: supplier.id,
        locationId,
        status: 'DRAFT',
        totalAmount,
        expectedDate: body.expectedDate ? new Date(body.expectedDate) : new Date(Date.now() + 7 * 86400_000),
        notes: body.notes || `Created by ${req.user!.email || 'staff'}`,
        items: { create: items },
      },
      include: { items: true },
    });

    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: 'PURCHASE_ORDER_CREATED',
      resourceType: 'PURCHASE_ORDER',
      resourceId: po.id,
      newValue: { supplier: supplier.name, lines: items.length, totalAmount, currency: org?.currency || 'USD' },
    });

    const [full] = await hydrate(orgId, [po]);
    res.status(201).json({ success: true, data: { ...full, supplierName: supplier.name } });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/purchasing/orders/:id - edit a draft (lines replaced wholesale)
router.put('/orders/:id', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(createPoSchema.partial()), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const po = await loadOwnedPo(orgId, String(req.params.id));
    if (po.status !== 'DRAFT') throw new HttpError(409, `A ${po.status.toLowerCase()} order can no longer be edited`);
    const body = req.body as Partial<z.infer<typeof createPoSchema>>;

    if (body.supplierId) {
      const supplier = await prisma.supplier.findFirst({ where: { id: body.supplierId, organizationId: orgId } });
      if (!supplier) throw new HttpError(400, 'Unknown supplier for this organization');
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (body.items?.length) {
        const ids = [...new Set(body.items.map((i) => i.productId))];
        const found = await tx.product.findMany({ where: { id: { in: ids }, organizationId: orgId }, select: { id: true } });
        if (found.length !== ids.length) throw new HttpError(400, 'One or more products are not in your catalog');
        await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: po.id } });
        const items = body.items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitCost: i.unitCost }));
        await tx.purchaseOrderItem.createMany({ data: items.map((i) => ({ ...i, purchaseOrderId: po.id })) });
      }
      const totalItems = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id }, select: { quantity: true, unitCost: true } });
      return tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          ...(body.supplierId ? { supplierId: body.supplierId } : {}),
          ...(body.locationId !== undefined ? { locationId: body.locationId || null } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.expectedDate !== undefined ? { expectedDate: body.expectedDate ? new Date(body.expectedDate) : null } : {}),
          totalAmount: round2(totalItems.reduce((s, i) => s + i.quantity * Number(i.unitCost), 0)),
        },
        include: { items: true },
      });
    });

    const [full] = await hydrate(orgId, [updated]);
    res.json({ success: true, data: full });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/purchasing/orders/:id - only an untouched draft can be thrown away
router.delete('/orders/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const po = await loadOwnedPo(orgId, String(req.params.id));
    if (po.status !== 'DRAFT') throw new HttpError(409, 'Only a draft order can be deleted; cancel it instead');
    await prisma.purchaseOrder.delete({ where: { id: po.id } });
    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: 'PURCHASE_ORDER_DELETED',
      resourceType: 'PURCHASE_ORDER',
      resourceId: po.id,
      previousValue: { status: po.status, totalAmount: Number(po.totalAmount) },
    });
    res.json({ success: true, data: { id: po.id, deleted: true } });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Lifecycle ───────────────────────────────────────────────────────────────

// POST /api/purchasing/orders/:id/send - commit to the supplier
router.post('/orders/:id/send', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const po = await loadOwnedPo(orgId, String(req.params.id));
    if (po.status !== 'DRAFT') throw new HttpError(409, `This order is already ${po.status}`);
    if (!po.items.length) throw new HttpError(400, 'The order has no lines to send');

    const [full] = await hydrate(orgId, [po]);
    const supplier = await prisma.supplier.findFirst({ where: { id: po.supplierId, organizationId: orgId } });
    const store = await prisma.storeSettings.findUnique({ where: { organizationId: orgId }, select: { storeName: true, currency: true } });

    const updated = await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { status: 'SENT' },
      include: { items: true },
    });

    // Email the order lines to the supplier. When no mail provider is wired the
    // status still advances: the record is the commitment, the email is a copy.
    let emailed = false;
    if (supplier?.email && isEmailConfigured()) {
      const lines = full.items.map((i: any) => `${i.quantity} x ${i.productName} @ ${Number(i.unitCost).toFixed(2)} = ${i.lineTotal.toFixed(2)}`).join('\n');
      const result = await sendEmail({
        to: supplier.email,
        subject: `Purchase order ${po.id.slice(0, 8)} from ${store?.storeName || 'our store'}`,
        text: `Please supply the following goods.\n\nOrder ${po.id}\nExpected: ${po.expectedDate ? new Date(po.expectedDate).toDateString() : 'as soon as available'}\nCurrency: ${store?.currency || 'USD'}\n\n${lines}\n\nTotal: ${Number(updated.totalAmount).toFixed(2)}\n\nDeliver to our store and quote the order number on the invoice.`,
      }).catch(() => ({ delivered: false }));
      emailed = Boolean(result.delivered);
    }

    await emitEvent({
      organizationId: orgId,
      event: 'purchase_order.sent',
      data: { purchaseOrderId: po.id, supplier: supplier?.name || null, totalAmount: Number(updated.totalAmount), emailed },
      metadata: { source: 'purchasing' },
    });
    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: 'PURCHASE_ORDER_SENT',
      resourceType: 'PURCHASE_ORDER',
      resourceId: po.id,
      newValue: { status: 'SENT', supplier: supplier?.name || null, emailed, lines: po.items.length },
    });

    res.json({ success: true, data: { id: po.id, status: 'SENT', emailed, supplierEmail: supplier?.email || null } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/purchasing/orders/:id/receive - goods arrived, stock goes up
router.post('/orders/:id/receive', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(receiveSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const po = await loadOwnedPo(orgId, String(req.params.id));
    if (!['SENT', 'PARTIAL', 'DRAFT'].includes(po.status)) throw new HttpError(409, `A ${po.status.toLowerCase()} order cannot be received`);

    const locationId = req.body.locationId || po.locationId || (await defaultLocation(orgId));
    if (!locationId) throw new HttpError(400, 'No location to receive into');

    const wanted = new Map<string, number>();
    if (req.body.items?.length) {
      for (const i of req.body.items) wanted.set(i.productId, i.quantity);
    }
    const performedBy = req.user!.employeeId || null;
    let receivedLines = 0;
    let fullyReceived = true;

    const summary = await prisma.$transaction(async (tx) => {
      const movements: string[] = [];
      for (const line of po.items) {
        const outstanding = line.quantity - line.receivedQty;
        if (outstanding <= 0) continue;
        const qty = wanted.has(line.productId) ? Math.min(wanted.get(line.productId)!, outstanding) : outstanding;
        if (qty <= 0) { fullyReceived = false; continue; }

        let balance = await tx.inventoryBalance.findUnique({ where: { productId_locationId: { productId: line.productId, locationId } } });
        if (!balance) {
          balance = await tx.inventoryBalance.create({ data: { productId: line.productId, locationId, quantity: 0, reorderPoint: 0 } });
        }
        await tx.inventoryBalance.update({ where: { id: balance.id }, data: { quantity: { increment: qty } } });
        const movement = await tx.inventoryMovement.create({
          data: { balanceId: balance.id, type: 'PURCHASE', quantity: qty, reference: po.id, performedBy, notes: `Received PO ${po.id.slice(0, 8)}` },
        });
        await tx.purchaseOrderItem.update({ where: { id: line.id }, data: { receivedQty: { increment: qty } } });
        movements.push(movement.id);
        receivedLines++;
        if (line.receivedQty + qty < line.quantity) fullyReceived = false;
      }
      if (!movements.length) throw new HttpError(400, 'Nothing left to receive on this order');

      // The ledger sees the cost when the goods land, not when the paper is drawn.
      const org = await tx.organization.findUnique({ where: { id: orgId }, select: { currency: true } });
      const entry = await tx.accountingEntry.create({
        data: {
          organizationId: orgId,
          type: 'EXPENSE',
          referenceType: 'PURCHASE_ORDER',
          referenceId: po.id,
          amount: Number(po.totalAmount),
          currency: org?.currency || 'USD',
          description: `Purchase order received - ${po.items.length} lines`,
          status: 'POSTED',
          postedAt: new Date(),
        },
      });
      const updated = await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: fullyReceived ? 'RECEIVED' : 'PARTIAL', receivedDate: new Date() },
        include: { items: true },
      });
      return { updated, entryId: entry.id };
    });

    await emitEvent({
      organizationId: orgId,
      event: 'purchase_order.received',
      data: { purchaseOrderId: po.id, lines: receivedLines, status: summary.updated.status, locationId },
      metadata: { source: 'purchasing' },
    });
    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: 'PURCHASE_ORDER_RECEIVED',
      resourceType: 'PURCHASE_ORDER',
      resourceId: po.id,
      newValue: { status: summary.updated.status, receivedLines, entryId: summary.entryId },
    });

    const [full] = await hydrate(orgId, [summary.updated]);
    res.json({
      success: true,
      data: { order: full, receivedLines, accountingEntryId: summary.entryId, locationId, status: summary.updated.status },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/purchasing/orders/:id/cancel - stop an order that will not arrive
router.post('/orders/:id/cancel', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(z.object({ reason: z.string().max(500).optional() })), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const po = await loadOwnedPo(orgId, String(req.params.id));
    if (po.status === 'RECEIVED') throw new HttpError(409, 'A received order cannot be cancelled; post a credit instead');
    const updated = await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { status: 'CANCELLED', notes: [po.notes, req.body.reason ? `Cancelled: ${req.body.reason}` : 'Cancelled'].filter(Boolean).join(' | ') },
    });
    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: 'PURCHASE_ORDER_CANCELLED',
      resourceType: 'PURCHASE_ORDER',
      resourceId: po.id,
      previousValue: { status: po.status },
      newValue: { reason: req.body.reason || null },
    });
    res.json({ success: true, data: { id: updated.id, status: updated.status } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/purchasing/suppliers/:id/orders - one supplier's book of orders
router.get('/suppliers/:id/orders', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const supplier = await prisma.supplier.findFirst({ where: { id: String(req.params.id), organizationId: orgId } });
    if (!supplier) throw new HttpError(404, 'Supplier not found');
    const pos = await prisma.purchaseOrder.findMany({
      where: { organizationId: orgId, supplierId: supplier.id },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const agg = await prisma.purchaseOrder.aggregate({ where: { organizationId: orgId, supplierId: supplier.id, status: 'RECEIVED' }, _sum: { totalAmount: true }, _count: { _all: true } });
    const [full] = await hydrate(orgId, pos);
    res.json({
      success: true,
      data: {
        supplier,
        orders: full,
        totals: { receivedOrders: agg._count._all, lifetimeSpend: round2(Number(agg._sum.totalAmount || 0)) },
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
