/**
 * Kitchen operations: stations, routing, firing by course, 86ing, tabs and table
 * merges (§17 restaurant).
 *
 * Why this exists: `KitchenOrder.course` was an integer nobody changed, kitchen
 * tickets had no station, and "86 an item" had no endpoint at all. A KDS without
 * stations cannot split a grill from a bar, and a restaurant that cannot hold the
 * mains until the starters are cleared is not doing table service.
 *
 * Routing decisions come from the pure `services/kds.ts` (modifier wins, then
 * category, then fallback), so a station rule is testable without a database.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { planCourseFire, routeItem, slaStatus, ticketAgeMinutes, type StationLike } from '../services/kds.js';

const router = Router();

const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const MANAGERS = requireRole('OWNER', 'ADMIN', 'MANAGER');

async function loadStations(organizationId: string): Promise<StationLike[]> {
  const rows = await prisma.kitchenStation.findMany({ where: { organizationId, isActive: true } });
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    categoryIds: s.categoryIds,
    targetPrepMinutes: s.targetPrepMinutes,
    isActive: s.isActive,
  }));
}

// ─── Stations ──────────────────────────────────────────────────────────────

const stationSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['GRILL', 'FRY', 'HOT', 'COLD', 'BAR', 'PASS', 'EXPO', 'DESSERT']).default('HOT'),
  categoryIds: z.array(z.string().min(1)).max(100).default([]),
  printerTarget: z.string().max(200).nullable().optional(),
  targetPrepMinutes: z.number().int().min(1).max(240).optional(),
  isActive: z.boolean().optional(),
});

// GET /api/kitchen/stations
router.get('/stations', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const rows = await prisma.kitchenStation.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } });
    res.json({ success: true, data: rows });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/kitchen/stations
router.post('/stations', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = stationSchema.parse(req.body);

    if (body.categoryIds.length > 0) {
      const owned = await prisma.category.count({ where: { id: { in: body.categoryIds }, organizationId } });
      if (owned !== body.categoryIds.length) {
        return res.status(400).json({ success: false, message: 'One or more categories do not belong to this organization' });
      }
    }

    const created = await prisma.kitchenStation.create({
      data: {
        organizationId,
        name: body.name,
        kind: body.kind,
        categoryIds: body.categoryIds,
        printerTarget: body.printerTarget ?? null,
        targetPrepMinutes: body.targetPrepMinutes ?? 10,
        isActive: body.isActive ?? true,
      },
    });

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/kitchen/stations/:id
router.put('/stations/:id', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const body = stationSchema.partial().parse(req.body);

    const existing = await prisma.kitchenStation.findFirst({ where: { id, organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Station not found' });

    const updated = await prisma.kitchenStation.update({
      where: { id },
      data: {
        name: body.name ?? existing.name,
        kind: body.kind ?? existing.kind,
        categoryIds: body.categoryIds ?? existing.categoryIds,
        printerTarget: body.printerTarget === undefined ? existing.printerTarget : body.printerTarget,
        targetPrepMinutes: body.targetPrepMinutes ?? existing.targetPrepMinutes,
        isActive: body.isActive ?? existing.isActive,
      },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/kitchen/stations/:id - deactivate, because tickets reference it
router.delete('/stations/:id', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const existing = await prisma.kitchenStation.findFirst({ where: { id, organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Station not found' });

    await prisma.kitchenStation.update({ where: { id }, data: { isActive: false } });
    res.json({ success: true, data: { id, isActive: false } });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Tickets ───────────────────────────────────────────────────────────────

/**
 * POST /api/kitchen/tickets
 *
 * Build a kitchen ticket from a placed order, routing every line to its station.
 * Re-posting the same order replaces nothing: an existing open ticket for the
 * order is returned instead, so a double tap does not double the food.
 */
router.post('/tickets', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = z
      .object({
        orderId: z.string().min(1),
        course: z.number().int().min(1).max(10).optional(),
        tableId: z.string().min(1).nullable().optional(),
        holdUntil: z.string().nullable().optional(),
      })
      .parse(req.body);

    const order = await prisma.order.findFirst({
      where: { id: body.orderId, organizationId },
      include: { items: true },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Order has no items to send to the kitchen' });
    }

    const existing = await prisma.kitchenOrder.findFirst({
      where: { organizationId, orderId: order.id, status: { in: ['RECEIVED', 'PREPARING', 'READY'] } },
      include: { items: true },
    });
    if (existing) {
      return res.json({ success: true, data: existing, duplicate: true });
    }

    const stations = await loadStations(organizationId);
    const productIds = [...new Set(order.items.map((i) => i.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, organizationId },
      select: { id: true, categoryId: true, name: true },
    });
    const categoryByProduct = new Map(products.map((p) => [p.id, p.categoryId]));

    const stationByProduct = new Map<string, ReturnType<typeof routeItem>>();
    for (const item of order.items) {
      stationByProduct.set(
        item.productId,
        routeItem(
          {
            productId: item.productId,
            productName: item.productName,
            categoryId: categoryByProduct.get(item.productId) ?? null,
            modifiers: null,
          },
          stations,
        ),
      );
    }

    const ticket = await prisma.kitchenOrder.create({
      data: {
        organizationId,
        orderId: order.id,
        tableId: body.tableId ?? order.tableId ?? null,
        course: body.course ?? 1,
        status: 'RECEIVED',
        heldUntil: body.holdUntil ? new Date(body.holdUntil) : null,
        items: {
          create: order.items.map((item) => {
            const route = stationByProduct.get(item.productId)!;
            return {
              productId: item.productId,
              productName: item.productName,
              quantity: Math.max(1, Math.round(Number(item.quantity))),
              modifiers: item.notes ? [{ name: item.notes }] : undefined,
              notes: item.notes,
              status: 'PENDING',
              stationId: route.stationId,
              stationName: route.stationName,
              targetPrepMinutes: route.targetPrepMinutes,
            };
          }),
        },
      },
      include: { items: true },
    });

    // Any table with food on it is occupied, and guests do not need a second tap.
    const tableId = body.tableId ?? order.tableId;
    if (tableId) {
      await prisma.restaurantTable
        .updateMany({ where: { id: tableId, organizationId, status: 'AVAILABLE' }, data: { status: 'OCCUPIED' } })
        .catch(() => undefined);
    }

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'KITCHEN_TICKET_CREATED',
      resourceType: 'KITCHEN_ORDER',
      resourceId: ticket.id,
      newValue: { orderId: order.id, items: ticket.items.length, course: ticket.course },
    });

    res.status(201).json({ success: true, data: ticket });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/kitchen/tickets?status=&stationId=&orderId=
router.get('/tickets', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const where: Record<string, unknown> = { organizationId };
    if (req.query.status) {
      where.status = String(req.query.status).includes(',')
        ? { in: String(req.query.status).split(',').map((s) => s.trim().toUpperCase()) }
        : String(req.query.status).toUpperCase();
    } else {
      where.status = { in: ['RECEIVED', 'PREPARING', 'READY'] };
    }
    if (req.query.orderId) where.orderId = String(req.query.orderId);

    const rows = await prisma.kitchenOrder.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 200,
      include: { items: true },
    });

    const stationFilter = req.query.stationId ? String(req.query.stationId) : null;
    const now = new Date();

    res.json({
      success: true,
      data: rows.map((t) => {
        const items = stationFilter ? t.items.filter((i) => i.stationId === stationFilter) : t.items;
        return {
          ...t,
          items,
          ageMinutes: ticketAgeMinutes(t.createdAt, now),
          // A ticket is late when its oldest unfired line has blown its target.
          sla: items.length
            ? slaStatus(ticketAgeMinutes(t.createdAt, now), Math.min(...items.map((i) => i.targetPrepMinutes ?? 10)))
            : 'ON_TIME',
        };
      }),
    });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * POST /api/kitchen/tickets/:id/fire
 *
 * Release a course to the line. Until it is fired, the items are held — which is
 * how a kitchen keeps mains from hitting the pass while starters are still out.
 */
router.post('/tickets/:id/fire', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const body = z.object({ course: z.number().int().min(1).max(10).optional() }).parse(req.body ?? {});

    const ticket = await prisma.kitchenOrder.findFirst({ where: { id, organizationId }, include: { items: true } });
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });
    if (['SERVED', 'CANCELLED'].includes(ticket.status)) {
      return res.status(409).json({ success: false, message: `Ticket is ${ticket.status}` });
    }

    const course = body.course ?? ticket.course;
    // The ticket's own course is the per-item course: one ticket, one course, so a
    // fire is the manager's decision about when that course leaves the pass.
    const plan = planCourseFire(
      ticket.items.map((i) => ({
        id: i.id,
        itemId: i.id,
        course: ticket.course,
        productId: i.productId,
        status: i.status,
      })),
      course,
    );
    const ids = plan.filter((p) => p.fire).map((p) => p.itemId);

    if (ids.length === 0) {
      return res.json({ success: true, data: ticket, fired: 0, message: 'Nothing left to fire for this course' });
    }

    await prisma.kitchenOrderItem.updateMany({ where: { id: { in: ids } }, data: { status: 'PREPARING', startedAt: new Date() } });
    const updated = await prisma.kitchenOrder.update({
      where: { id },
      data: { status: ticket.status === 'RECEIVED' ? 'PREPARING' : ticket.status, firedAt: new Date(), firedCourse: course, heldUntil: null },
      include: { items: true },
    });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'KITCHEN_COURSE_FIRED',
      resourceType: 'KITCHEN_ORDER',
      resourceId: id,
      newValue: { course, items: ids.length },
    });

    res.json({ success: true, data: updated, fired: ids.length, plan });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/kitchen/tickets/:id/advance - RECEIVED -> PREPARING -> READY -> SERVED
router.post('/tickets/:id/advance', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);

    const ticket = await prisma.kitchenOrder.findFirst({ where: { id, organizationId }, include: { items: true } });
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });
    if (ticket.status === 'SERVED' || ticket.status === 'CANCELLED') {
      return res.status(409).json({ success: false, message: `Ticket is already ${ticket.status}` });
    }

    const next =
      ticket.status === 'RECEIVED' ? 'PREPARING' : ticket.status === 'PREPARING' ? 'READY' : 'SERVED';
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      if (next === 'READY') {
        await tx.kitchenOrderItem.updateMany({
          where: { kitchenOrderId: id, status: { in: ['PENDING', 'PREPARING'] } },
          data: { status: 'READY', readyAt: now, startedAt: undefined },
        });
      }
      if (next === 'SERVED') {
        await tx.kitchenOrderItem.updateMany({ where: { kitchenOrderId: id, status: { not: 'CANCELLED' } }, data: { status: 'READY' } });
      }
      return tx.kitchenOrder.update({
        where: { id },
        data: {
          status: next,
          readyAt: next === 'READY' ? now : ticket.readyAt,
          servedAt: next === 'SERVED' ? now : ticket.servedAt,
        },
        include: { items: true },
      });
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/kitchen/items/:itemId - start or ready one line
router.put('/items/:itemId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = z.object({ status: z.enum(['PENDING', 'PREPARING', 'READY', 'CANCELLED']) }).parse(req.body);

    const item = await prisma.kitchenOrderItem.findFirst({
      where: { id: String(req.params.itemId), kitchenOrder: { organizationId } },
    });
    if (!item) return res.status(404).json({ success: false, message: 'Ticket line not found' });

    const now = new Date();
    const updated = await prisma.kitchenOrderItem.update({
      where: { id: item.id },
      data: {
        status: body.status,
        startedAt: body.status === 'PREPARING' ? item.startedAt ?? now : item.startedAt,
        readyAt: body.status === 'READY' ? now : null,
      },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/kitchen/stations/:id/queue - what this station owes, with SLA
router.get('/stations/:id/queue', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const stationId = String(req.params.id);

    const items = await prisma.kitchenOrderItem.findMany({
      where: {
        stationId,
        status: { in: ['PENDING', 'PREPARING'] },
        kitchenOrder: { organizationId, status: { in: ['RECEIVED', 'PREPARING', 'READY'] } },
      },
      include: { kitchenOrder: { select: { id: true, orderId: true, tableId: true, course: true, createdAt: true, priority: true } } },
      orderBy: { kitchenOrder: { createdAt: 'asc' } },
      take: 300,
    });

    const now = new Date();
    res.json({
      success: true,
      data: items.map((i) => {
        const age = ticketAgeMinutes(i.kitchenOrder.createdAt, now);
        return { ...i, ageMinutes: age, sla: slaStatus(age, i.targetPrepMinutes ?? 10) };
      }),
    });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── 86 an item ────────────────────────────────────────────────────────────

/**
 * POST /api/kitchen/menu/:productId/86
 *
 * The 86 board. Availability is per menu placement (`MenuCategoryItem`), not the
 * product itself: an item running out for lunch must not delete it from the
 * catalog, its history or its reports.
 */
router.post('/menu/:productId/86', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const productId = String(req.params.productId);
    const body = z.object({ available: z.boolean(), reason: z.string().max(300).optional() }).parse(req.body);

    const product = await prisma.product.findFirst({ where: { id: productId, organizationId }, select: { id: true, name: true } });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    const result = await prisma.menuCategoryItem.updateMany({
      where: { productId, category: { organizationId } },
      data: { isAvailable: body.available },
    });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: body.available ? 'MENU_ITEM_AVAILABLE' : 'MENU_ITEM_86',
      resourceType: 'PRODUCT',
      resourceId: productId,
      newValue: { available: body.available, reason: body.reason ?? null, placements: result.count },
    });

    res.json({
      success: true,
      data: { productId, productName: product.name, available: body.available, placementsUpdated: result.count },
      message:
        result.count === 0
          ? 'This product is not on any menu, so nothing changed'
          : `${product.name} is ${body.available ? 'available again' : '86ed'}`,
    });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Tabs ──────────────────────────────────────────────────────────────────

function tabNumber(): string {
  const d = new Date();
  const stamp = `${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `TAB-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

// POST /api/kitchen/tabs - open a running tab against a table
router.post('/tabs', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = z
      .object({
        tableId: z.string().min(1).nullable().optional(),
        customerId: z.string().min(1).nullable().optional(),
        registerId: z.string().min(1).nullable().optional(),
        notes: z.string().max(500).nullable().optional(),
      })
      .parse(req.body ?? {});

    if (body.tableId) {
      const table = await prisma.restaurantTable.findFirst({ where: { id: body.tableId, organizationId }, select: { id: true } });
      if (!table) return res.status(404).json({ success: false, message: 'Table not found' });

      const open = await prisma.order.findFirst({ where: { organizationId, tableId: body.tableId, isTab: true, tabClosedAt: null } });
      if (open) {
        return res.status(409).json({ success: false, message: 'That table already has an open tab', orderId: open.id });
      }
    }

    const created = await prisma.order.create({
      data: {
        organizationId,
        orderNumber: tabNumber(),
        channel: 'IN_STORE',
        status: 'DRAFT',
        isTab: true,
        tableId: body.tableId ?? null,
        customerId: body.customerId ?? null,
        registerId: body.registerId ?? null,
        employeeId: req.user!.employeeId ?? null,
        fulfillmentType: 'DINE_IN',
        notes: body.notes ?? null,
      },
    });

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/kitchen/tabs - every running tab
router.get('/tabs', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const rows = await prisma.order.findMany({
      where: { organizationId, isTab: true, tabClosedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { items: true, payments: true },
    });

    res.json({
      success: true,
      data: rows.map((o) => ({
        ...o,
        paid: money(o.payments.filter((p) => ['COMPLETED', 'CAPTURED', 'SETTLED', 'RECONCILED'].includes(p.status)).reduce((s, p) => s + Number(p.amount), 0)),
        outstanding: money(Number(o.totalAmount) - o.payments.filter((p) => ['COMPLETED', 'CAPTURED', 'SETTLED', 'RECONCILED'].includes(p.status)).reduce((s, p) => s + Number(p.amount), 0)),
      })),
    });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * POST /api/kitchen/tabs/:orderId/close
 *
 * A tab closes only when the money is in. `force` exists for a manager writing
 * off a comped bar tab — it is never the default.
 */
router.post('/tabs/:orderId/close', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const orderId = String(req.params.orderId);
    const force = String(req.query.force ?? '') === 'true';

    const order = await prisma.order.findFirst({ where: { id: orderId, organizationId, isTab: true }, include: { payments: true } });
    if (!order) return res.status(404).json({ success: false, message: 'Open tab not found' });
    if (order.tabClosedAt) return res.status(409).json({ success: false, message: 'This tab is already closed' });

    const paid = order.payments
      .filter((p) => ['COMPLETED', 'CAPTURED', 'SETTLED', 'RECONCILED'].includes(p.status))
      .reduce((s, p) => s + Number(p.amount), 0);
    const outstanding = money(Number(order.totalAmount) - paid);

    if (outstanding > 0.009 && !force) {
      return res.status(409).json({ success: false, message: `Tab still has ${outstanding.toFixed(2)} outstanding`, outstanding });
    }
    if (outstanding > 0.009 && !['OWNER', 'ADMIN', 'MANAGER'].includes(String(req.user!.role))) {
      return res.status(403).json({ success: false, message: 'Only a manager can close a tab with a balance' });
    }

    const closed = await prisma.order.update({
      where: { id: order.id },
      data: {
        isTab: false,
        tabClosedAt: new Date(),
        status: outstanding > 0.009 ? 'COMPLETED' : 'PAID',
        completedAt: new Date(),
      },
    });

    if (order.tableId) {
      await prisma.restaurantTable.updateMany({
        where: { id: order.tableId, organizationId },
        data: { status: 'DIRTY' },
      });
    }

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'TAB_CLOSED',
      resourceType: 'ORDER',
      resourceId: order.id,
      newValue: { paid: money(paid), outstanding, forced: outstanding > 0.009 },
    });

    res.json({ success: true, data: closed, outstanding });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Table moves ───────────────────────────────────────────────────────────

/** Recompute an order's money columns from its items. */
async function recalcOrder(orderId: string) {
  const items = await prisma.orderItem.findMany({ where: { orderId }, select: { totalAmount: true, discountAmt: true, taxAmt: true } });
  const subtotal = money(items.reduce((s, i) => s + Number(i.totalAmount) + Number(i.discountAmt) - Number(i.taxAmt), 0));
  const discountAmount = money(items.reduce((s, i) => s + Number(i.discountAmt), 0));
  const taxAmount = money(items.reduce((s, i) => s + Number(i.taxAmt), 0));

  return prisma.order.update({
    where: { id: orderId },
    data: { subtotal, discountAmount, taxAmount, totalAmount: money(subtotal - discountAmount + taxAmount) },
  });
}

// POST /api/kitchen/tables/:tableId/merge - combine two tables onto one bill
router.post('/tables/:tableId/merge', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const targetTableId = String(req.params.tableId);
    const body = z.object({ sourceTableId: z.string().min(1) }).parse(req.body);

    if (body.sourceTableId === targetTableId) {
      return res.status(400).json({ success: false, message: 'Cannot merge a table into itself' });
    }

    const [targetTable, sourceTable] = await Promise.all([
      prisma.restaurantTable.findFirst({ where: { id: targetTableId, organizationId } }),
      prisma.restaurantTable.findFirst({ where: { id: body.sourceTableId, organizationId } }),
    ]);
    if (!targetTable || !sourceTable) return res.status(404).json({ success: false, message: 'Table not found' });

    const [targetOrder, sourceOrder] = await Promise.all([
      prisma.order.findFirst({ where: { organizationId, tableId: targetTableId, tabClosedAt: null, status: { notIn: ['CANCELLED', 'REFUNDED'] } }, include: { items: true } }),
      prisma.order.findFirst({ where: { organizationId, tableId: body.sourceTableId, tabClosedAt: null, status: { notIn: ['CANCELLED', 'REFUNDED'] } }, include: { items: true } }),
    ]);

    if (!sourceOrder) {
      return res.status(409).json({ success: false, message: 'The source table has no open bill to merge' });
    }

    // No target bill yet: the merge is simply "this table is now that table".
    if (!targetOrder) {
      const moved = await prisma.order.update({ where: { id: sourceOrder.id }, data: { tableId: targetTableId } });
      await prisma.restaurantTable.updateMany({ where: { id: body.sourceTableId, organizationId }, data: { status: 'AVAILABLE' } });
      return res.json({ success: true, data: moved, merged: sourceOrder.items.length, mode: 'MOVED' });
    }

    // Both tables have a bill: move the lines, then void the now-empty one. The
    // items are re-parented rather than copied so stock and reports stay singular.
    const merged = await prisma.$transaction(async (tx) => {
      await tx.orderItem.updateMany({ where: { orderId: sourceOrder.id }, data: { orderId: targetOrder.id } });
      await tx.kitchenOrder.updateMany({ where: { orderId: sourceOrder.id }, data: { tableId: targetTableId } });
      await tx.order.update({
        where: { id: sourceOrder.id },
        data: { status: 'CANCELLED', isTab: false, tabClosedAt: new Date(), notes: `Merged into ${targetOrder.orderNumber}` },
      });
      await tx.restaurantTable.updateMany({ where: { id: body.sourceTableId, organizationId }, data: { status: 'AVAILABLE' } });
      return tx.order.findUnique({ where: { id: targetOrder.id }, include: { items: true } });
    });

    const recalculated = await recalcOrder(targetOrder.id);

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'TABLES_MERGED',
      resourceType: 'ORDER',
      resourceId: targetOrder.id,
      newValue: { from: body.sourceTableId, into: targetTableId, items: sourceOrder.items.length },
    });

    res.json({ success: true, data: recalculated, merged: sourceOrder.items.length, mode: 'COMBINED', snapshot: merged });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/kitchen/tables/:tableId/transfer - move a bill to another table
router.post('/tables/:tableId/transfer', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const fromTableId = String(req.params.tableId);
    const body = z.object({ tableId: z.string().min(1) }).parse(req.body);

    const [from, to] = await Promise.all([
      prisma.restaurantTable.findFirst({ where: { id: fromTableId, organizationId } }),
      prisma.restaurantTable.findFirst({ where: { id: body.tableId, organizationId } }),
    ]);
    if (!from || !to) return res.status(404).json({ success: false, message: 'Table not found' });

    const order = await prisma.order.findFirst({
      where: { organizationId, tableId: fromTableId, tabClosedAt: null, status: { notIn: ['CANCELLED', 'REFUNDED'] } },
    });
    if (!order) return res.status(409).json({ success: false, message: 'The table has no open bill to transfer' });

    const occupied = await prisma.order.findFirst({
      where: { organizationId, tableId: body.tableId, tabClosedAt: null, status: { notIn: ['CANCELLED', 'REFUNDED'] } },
    });
    if (occupied) return res.status(409).json({ success: false, message: 'The destination table already has a bill; merge instead' });

    const moved = await prisma.$transaction(async (tx) => {
      await tx.kitchenOrder.updateMany({ where: { orderId: order.id }, data: { tableId: body.tableId } });
      await tx.restaurantTable.updateMany({ where: { id: fromTableId, organizationId }, data: { status: 'AVAILABLE' } });
      await tx.restaurantTable.updateMany({ where: { id: body.tableId, organizationId }, data: { status: 'OCCUPIED' } });
      return tx.order.update({ where: { id: order.id }, data: { tableId: body.tableId } });
    });

    res.json({ success: true, data: moved });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
