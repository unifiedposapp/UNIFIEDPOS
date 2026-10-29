/**
 * Service verticals: appointments, work orders and rentals (§17).
 *
 * Why this exists: the vertical packs advertise salons, repair shops and rental
 * counters, but the schema had no appointment, work order or rental table — so
 * those verticals were copy on a page. This module is the missing half.
 *
 * The three share one idea: a piece of work is booked against a customer and an
 * employee, then priced from lines. Nothing here trusts a client-supplied total.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';

const router = Router();

const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const MANAGERS = requireRole('OWNER', 'ADMIN', 'MANAGER');

function reference(prefix: string): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function rangeQuery(fromRaw: unknown, toRaw: unknown, days = 7) {
  const now = new Date();
  const from = fromRaw ? new Date(String(fromRaw)) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = toRaw ? new Date(String(toRaw)) : new Date(from.getTime() + days * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    throw Object.assign(new Error('Invalid date range: `to` must be after `from`'), { status: 400 });
  }
  return { from, to };
}

/** Every foreign key a caller supplies must belong to their own tenant. */
async function assertOwned(
  organizationId: string,
  refs: { customerId?: string | null; employeeId?: string | null; locationId?: string | null; productId?: string | null },
) {
  const checks: Promise<unknown>[] = [];
  if (refs.customerId) {
    checks.push(
      prisma.customer.findFirst({ where: { id: refs.customerId, organizationId }, select: { id: true } }).then((r) => {
        if (!r) throw Object.assign(new Error('Customer not found'), { status: 404 });
      }),
    );
  }
  if (refs.employeeId) {
    checks.push(
      prisma.employee.findFirst({ where: { id: refs.employeeId, organizationId }, select: { id: true } }).then((r) => {
        if (!r) throw Object.assign(new Error('Employee not found'), { status: 404 });
      }),
    );
  }
  if (refs.locationId) {
    checks.push(
      prisma.location.findFirst({ where: { id: refs.locationId, organizationId }, select: { id: true } }).then((r) => {
        if (!r) throw Object.assign(new Error('Location not found'), { status: 404 });
      }),
    );
  }
  if (refs.productId) {
    checks.push(
      prisma.product.findFirst({ where: { id: refs.productId, organizationId }, select: { id: true } }).then((r) => {
        if (!r) throw Object.assign(new Error('Product not found'), { status: 404 });
      }),
    );
  }
  await Promise.all(checks);
}

// ═══════════════════════════════════════════════════════════════════════════
// Appointments
// ═══════════════════════════════════════════════════════════════════════════

const appointmentSchema = z.object({
  title: z.string().min(1).max(200),
  startAt: z.string().min(1),
  endAt: z.string().min(1),
  customerId: z.string().min(1).nullable().optional(),
  employeeId: z.string().min(1).nullable().optional(),
  locationId: z.string().min(1).nullable().optional(),
  serviceProductId: z.string().min(1).nullable().optional(),
  depositPaymentId: z.string().min(1).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

/** Reject a double-booking: one employee cannot be in two places at once. */
async function appointmentClash(organizationId: string, employeeId: string, startAt: Date, endAt: Date, ignoreId?: string) {
  const clash = await prisma.appointment.findFirst({
    where: {
      organizationId,
      employeeId,
      ...(ignoreId ? { id: { not: ignoreId } } : {}),
      status: { notIn: ['CANCELLED', 'NO_SHOW', 'COMPLETED'] },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { id: true, title: true, startAt: true, endAt: true },
  });
  return clash;
}

// GET /api/service/appointments/slots?employeeId=&date=&durationMinutes= - free slots
router.get('/appointments/slots', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = z
      .object({
        employeeId: z.string().min(1),
        date: z.string().min(1),
        durationMinutes: z.coerce.number().int().min(5).max(600).default(30),
        stepMinutes: z.coerce.number().int().min(5).max(120).default(15),
        dayStartMinute: z.coerce.number().int().min(0).max(1440).default(540),
        dayEndMinute: z.coerce.number().int().min(0).max(1440).default(1080),
      })
      .parse(req.query);

    const day = new Date(body.date);
    if (Number.isNaN(day.getTime())) return res.status(400).json({ success: false, message: 'Invalid date' });

    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, body.dayStartMinute);
    const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, body.dayEndMinute);

    const booked = await prisma.appointment.findMany({
      where: {
        organizationId,
        employeeId: body.employeeId,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        startAt: { lt: dayEnd },
        endAt: { gt: dayStart },
      },
      select: { startAt: true, endAt: true },
    });

    const slots: { startAt: string; endAt: string }[] = [];
    for (let t = dayStart.getTime(); t + body.durationMinutes * 60_000 <= dayEnd.getTime(); t += body.stepMinutes * 60_000) {
      const slotStart = t;
      const slotEnd = t + body.durationMinutes * 60_000;
      const free = !booked.some((b) => slotStart < b.endAt.getTime() && slotEnd > b.startAt.getTime());
      if (free) slots.push({ startAt: new Date(slotStart).toISOString(), endAt: new Date(slotEnd).toISOString() });
    }

    res.json({ success: true, data: { date: body.date, employeeId: body.employeeId, durationMinutes: body.durationMinutes, slots } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/service/appointments?from=&to=&employeeId=&status=
router.get('/appointments', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const { from, to } = rangeQuery(req.query.from, req.query.to);

    const where: Record<string, unknown> = { organizationId, startAt: { gte: from, lt: to } };
    if (req.query.employeeId) where.employeeId = String(req.query.employeeId);
    if (req.query.customerId) where.customerId = String(req.query.customerId);
    if (req.query.status) where.status = String(req.query.status);

    const rows = await prisma.appointment.findMany({ where, orderBy: { startAt: 'asc' }, take: 500 });
    res.json({ success: true, data: rows, meta: { from, to } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/service/appointments
router.post('/appointments', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = appointmentSchema.parse(req.body);

    const startAt = new Date(body.startAt);
    const endAt = new Date(body.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
      return res.status(400).json({ success: false, message: 'An appointment must end after it starts' });
    }

    await assertOwned(organizationId, {
      customerId: body.customerId ?? null,
      employeeId: body.employeeId ?? null,
      locationId: body.locationId ?? null,
      productId: body.serviceProductId ?? null,
    });

    const force = String(req.query.force ?? '') === 'true';
    if (body.employeeId) {
      const clash = await appointmentClash(organizationId, body.employeeId, startAt, endAt);
      if (clash && !force) {
        return res.status(409).json({ success: false, message: 'That employee is already booked at this time', clash });
      }
    }

    const created = await prisma.appointment.create({
      data: {
        organizationId,
        title: body.title,
        startAt,
        endAt,
        customerId: body.customerId ?? null,
        employeeId: body.employeeId ?? null,
        locationId: body.locationId ?? null,
        serviceProductId: body.serviceProductId ?? null,
        depositPaymentId: body.depositPaymentId ?? null,
        notes: body.notes ?? null,
        status: 'BOOKED',
      },
    });

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/service/appointments/:id
router.put('/appointments/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const body = appointmentSchema.partial().parse(req.body);

    const existing = await prisma.appointment.findFirst({ where: { id, organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Appointment not found' });

    await assertOwned(organizationId, {
      customerId: body.customerId ?? null,
      employeeId: body.employeeId ?? null,
      locationId: body.locationId ?? null,
      productId: body.serviceProductId ?? null,
    });

    const startAt = body.startAt ? new Date(body.startAt) : existing.startAt;
    const endAt = body.endAt ? new Date(body.endAt) : existing.endAt;
    const employeeId = body.employeeId === undefined ? existing.employeeId : body.employeeId;
    if (endAt <= startAt) {
      return res.status(400).json({ success: false, message: 'An appointment must end after it starts' });
    }

    if (employeeId) {
      const clash = await appointmentClash(organizationId, employeeId, startAt, endAt, id);
      if (clash && String(req.query.force ?? '') !== 'true') {
        return res.status(409).json({ success: false, message: 'That employee is already booked at this time', clash });
      }
    }

    const updated = await prisma.appointment.update({
      where: { id },
      data: {
        title: body.title ?? existing.title,
        startAt,
        endAt,
        customerId: body.customerId === undefined ? existing.customerId : body.customerId,
        employeeId,
        locationId: body.locationId === undefined ? existing.locationId : body.locationId,
        serviceProductId: body.serviceProductId === undefined ? existing.serviceProductId : body.serviceProductId,
        notes: body.notes === undefined ? existing.notes : body.notes,
      },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/service/appointments/:id/status
router.post('/appointments/:id/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const body = z
      .object({ status: z.enum(['BOOKED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']) })
      .parse(req.body);

    const existing = await prisma.appointment.findFirst({ where: { id, organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Appointment not found' });

    const updated = await prisma.appointment.update({ where: { id }, data: { status: body.status } });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: `APPOINTMENT_${body.status}`,
      resourceType: 'APPOINTMENT',
      resourceId: id,
      previousValue: { status: existing.status },
      newValue: { status: body.status },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/service/appointments/:id
router.delete('/appointments/:id', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const existing = await prisma.appointment.findFirst({ where: { id, organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Appointment not found' });
    await prisma.appointment.delete({ where: { id } });
    res.json({ success: true, data: { id } });
  } catch (error) {
    handleError(error, res);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Work orders
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Recompute the three money columns from the lines.
 *
 * Every mutation calls this rather than incrementing totals, so a deleted part
 * can never leave a stale figure behind.
 */
async function recalcWorkOrder(workOrderId: string) {
  const lines = await prisma.workOrderLine.findMany({ where: { workOrderId }, select: { kind: true, totalAmount: true } });
  const laborTotal = money(lines.filter((l) => String(l.kind).toUpperCase() === 'LABOR').reduce((s, l) => s + Number(l.totalAmount), 0));
  const partsTotal = money(lines.filter((l) => String(l.kind).toUpperCase() !== 'LABOR').reduce((s, l) => s + Number(l.totalAmount), 0));

  return prisma.workOrder.update({
    where: { id: workOrderId },
    data: { laborTotal, partsTotal, totalAmount: money(laborTotal + partsTotal) },
    include: { lines: true },
  });
}

// GET /api/service/work-orders?status=&customerId=
router.get('/work-orders', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const where: Record<string, unknown> = { organizationId };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.customerId) where.customerId = String(req.query.customerId);
    if (req.query.assignedEmployeeId) where.assignedEmployeeId = String(req.query.assignedEmployeeId);

    const rows = await prisma.workOrder.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    res.json({ success: true, data: rows });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/service/work-orders
router.post('/work-orders', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = z
      .object({
        customerId: z.string().min(1).nullable().optional(),
        locationId: z.string().min(1).nullable().optional(),
        assignedEmployeeId: z.string().min(1).nullable().optional(),
        type: z.enum(['REPAIR', 'SERVICE', 'INSTALL']).optional(),
        deviceLabel: z.string().max(200).nullable().optional(),
        problem: z.string().max(4000).nullable().optional(),
        warrantyUntil: z.string().nullable().optional(),
        notes: z.string().max(4000).nullable().optional(),
      })
      .parse(req.body ?? {});

    await assertOwned(organizationId, {
      customerId: body.customerId ?? null,
      employeeId: body.assignedEmployeeId ?? null,
      locationId: body.locationId ?? null,
    });

    const created = await prisma.workOrder.create({
      data: {
        organizationId,
        number: reference('WO'),
        customerId: body.customerId ?? null,
        locationId: body.locationId ?? null,
        assignedEmployeeId: body.assignedEmployeeId ?? null,
        type: body.type ?? 'REPAIR',
        deviceLabel: body.deviceLabel ?? null,
        problem: body.problem ?? null,
        warrantyUntil: body.warrantyUntil ? new Date(body.warrantyUntil) : null,
        notes: body.notes ?? null,
        status: 'OPEN',
      },
    });

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/service/work-orders/:id
router.get('/work-orders/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const order = await prisma.workOrder.findFirst({
      where: { id: String(req.params.id), organizationId },
      include: { lines: true },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Work order not found' });
    res.json({ success: true, data: order });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/service/work-orders/:id
router.put('/work-orders/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const body = z
      .object({
        assignedEmployeeId: z.string().min(1).nullable().optional(),
        diagnosis: z.string().max(4000).nullable().optional(),
        notes: z.string().max(4000).nullable().optional(),
        deviceLabel: z.string().max(200).nullable().optional(),
        warrantyUntil: z.string().nullable().optional(),
      })
      .parse(req.body ?? {});

    const existing = await prisma.workOrder.findFirst({ where: { id, organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Work order not found' });

    if (body.assignedEmployeeId) {
      await assertOwned(organizationId, { employeeId: body.assignedEmployeeId });
    }

    const updated = await prisma.workOrder.update({
      where: { id },
      data: {
        assignedEmployeeId: body.assignedEmployeeId === undefined ? existing.assignedEmployeeId : body.assignedEmployeeId,
        diagnosis: body.diagnosis === undefined ? existing.diagnosis : body.diagnosis,
        notes: body.notes === undefined ? existing.notes : body.notes,
        deviceLabel: body.deviceLabel === undefined ? existing.deviceLabel : body.deviceLabel,
        warrantyUntil: body.warrantyUntil === undefined ? existing.warrantyUntil : body.warrantyUntil ? new Date(body.warrantyUntil) : null,
      },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/service/work-orders/:id/lines
router.post('/work-orders/:id/lines', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const body = z
      .object({
        kind: z.enum(['LABOR', 'PART', 'FEE']).default('LABOR'),
        productId: z.string().min(1).nullable().optional(),
        description: z.string().min(1).max(400),
        quantity: z.number().positive(),
        unitPrice: z.number().min(0).optional(),
      })
      .parse(req.body);

    const workOrder = await prisma.workOrder.findFirst({ where: { id, organizationId } });
    if (!workOrder) return res.status(404).json({ success: false, message: 'Work order not found' });
    if (['COMPLETED', 'CANCELLED'].includes(workOrder.status)) {
      return res.status(409).json({ success: false, message: `Work order is ${workOrder.status}` });
    }

    let unitPrice = body.unitPrice;
    if (body.productId) {
      const product = await prisma.product.findFirst({ where: { id: body.productId, organizationId }, select: { price: true } });
      if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
      unitPrice = unitPrice ?? Number(product.price);
    }
    if (unitPrice === undefined) {
      return res.status(400).json({ success: false, message: 'unitPrice is required when no product is linked' });
    }

    await prisma.workOrderLine.create({
      data: {
        workOrderId: id,
        kind: body.kind,
        productId: body.productId ?? null,
        description: body.description,
        quantity: body.quantity,
        unitPrice: money(unitPrice),
        totalAmount: money(body.quantity * unitPrice),
      },
    });

    const updated = await recalcWorkOrder(id);
    res.status(201).json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/service/work-orders/:id/lines/:lineId
router.delete('/work-orders/:id/lines/:lineId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const workOrder = await prisma.workOrder.findFirst({ where: { id, organizationId } });
    if (!workOrder) return res.status(404).json({ success: false, message: 'Work order not found' });

    const line = await prisma.workOrderLine.findFirst({ where: { id: String(req.params.lineId), workOrderId: id } });
    if (!line) return res.status(404).json({ success: false, message: 'Line not found' });

    await prisma.workOrderLine.delete({ where: { id: line.id } });
    const updated = await recalcWorkOrder(id);
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/service/work-orders/:id/status
router.post('/work-orders/:id/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const body = z
      .object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_PARTS', 'READY', 'COMPLETED', 'CANCELLED']) })
      .parse(req.body);

    const existing = await prisma.workOrder.findFirst({ where: { id, organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Work order not found' });

    const updated = await prisma.workOrder.update({
      where: { id },
      data: { status: body.status, completedAt: body.status === 'COMPLETED' ? new Date() : existing.completedAt },
      include: { lines: true },
    });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: `WORK_ORDER_${body.status}`,
      resourceType: 'WORK_ORDER',
      resourceId: id,
      previousValue: { status: existing.status },
      newValue: { status: body.status },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Rentals
// ═══════════════════════════════════════════════════════════════════════════

const rentalLineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive(),
  rateUnit: z.enum(['HOUR', 'DAY', 'WEEK']).default('DAY'),
  rate: z.number().min(0).optional(),
});

// GET /api/service/rentals/overdue - out past their due date
router.get('/rentals/overdue', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const rows = await prisma.rentalAgreement.findMany({
      where: { organizationId, status: { in: ['OUT', 'PARTIALLY_RETURNED', 'OVERDUE'] }, dueAt: { lt: new Date() } },
      orderBy: { dueAt: 'asc' },
      include: { lines: true },
    });

    const withDays = rows.map((r) => ({
      ...r,
      daysOverdue: Math.max(0, Math.ceil((Date.now() - r.dueAt.getTime()) / 86_400_000)),
    }));

    res.json({ success: true, data: withDays });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/service/rentals?status=&customerId=
router.get('/rentals', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const where: Record<string, unknown> = { organizationId };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.customerId) where.customerId = String(req.query.customerId);

    const rows = await prisma.rentalAgreement.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200, include: { lines: true } });
    res.json({ success: true, data: rows });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/service/rentals
router.post('/rentals', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = z
      .object({
        customerId: z.string().min(1).nullable().optional(),
        locationId: z.string().min(1).nullable().optional(),
        startAt: z.string().min(1),
        dueAt: z.string().min(1),
        currency: z.string().length(3).optional(),
        depositAmount: z.number().min(0).optional(),
        notes: z.string().max(4000).nullable().optional(),
        lines: z.array(rentalLineSchema).min(1).max(100),
      })
      .parse(req.body);

    const startAt = new Date(body.startAt);
    const dueAt = new Date(body.dueAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(dueAt.getTime()) || dueAt <= startAt) {
      return res.status(400).json({ success: false, message: 'A rental must be due after it starts' });
    }

    await assertOwned(organizationId, { customerId: body.customerId ?? null, locationId: body.locationId ?? null });

    const productIds = [...new Set(body.lines.map((l) => l.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, organizationId },
      select: { id: true, name: true, price: true },
    });
    if (products.length !== productIds.length) {
      return res.status(400).json({ success: false, message: 'One or more rental products do not belong to this organization' });
    }
    const byId = new Map(products.map((p) => [p.id, p]));

    const lines = body.lines.map((l) => ({
      productId: l.productId,
      productName: byId.get(l.productId)!.name,
      quantity: l.quantity,
      rateUnit: l.rateUnit,
      // Default to the product's sale price as a day rate when none is given.
      rate: money(l.rate ?? Number(byId.get(l.productId)!.price)),
      returnedQty: 0,
    }));
    const rateAmount = money(lines.reduce((s, l) => s + l.rate * l.quantity, 0));

    const created = await prisma.rentalAgreement.create({
      data: {
        organizationId,
        number: reference('RNT'),
        customerId: body.customerId ?? null,
        locationId: body.locationId ?? null,
        status: 'RESERVED',
        startAt,
        dueAt,
        currency: (body.currency ?? 'USD').toUpperCase(),
        depositAmount: money(body.depositAmount ?? 0),
        rateAmount,
        lateFeeAmount: 0,
        totalAmount: rateAmount,
        notes: body.notes ?? null,
        lines: { create: lines },
      },
      include: { lines: true },
    });

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/service/rentals/:id
router.get('/rentals/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const agreement = await prisma.rentalAgreement.findFirst({
      where: { id: String(req.params.id), organizationId },
      include: { lines: true },
    });
    if (!agreement) return res.status(404).json({ success: false, message: 'Rental not found' });

    const outstanding = agreement.lines
      .map((l) => ({ ...l, remaining: Math.max(0, Number(l.quantity) - Number(l.returnedQty)) }))
      .filter((l) => l.remaining > 0);

    res.json({ success: true, data: { ...agreement, outstanding } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/service/rentals/:id/out - hand the goods over
router.post('/rentals/:id/out', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const existing = await prisma.rentalAgreement.findFirst({ where: { id, organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Rental not found' });
    if (existing.status !== 'RESERVED') {
      return res.status(409).json({ success: false, message: `Rental is ${existing.status}, not reserved` });
    }

    const updated = await prisma.rentalAgreement.update({ where: { id }, data: { status: 'OUT' } });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * POST /api/service/rentals/:id/return
 *
 * Partial returns are normal (three chairs back, one still out), so each line
 * carries its own returned quantity and condition, and the agreement only closes
 * when nothing remains outstanding. Late fees are computed from `lateFeePerDay`,
 * which the caller supplies — the policy lives with the merchant, not the code.
 */
router.post('/rentals/:id/return', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const body = z
      .object({
        lateFeePerDay: z.number().min(0).optional(),
        lines: z
          .array(
            z.object({
              lineId: z.string().min(1),
              returnedQty: z.number().min(0),
              condition: z.enum(['OK', 'DAMAGED', 'LOST']).optional(),
            }),
          )
          .min(1)
          .max(100),
      })
      .parse(req.body);

    const agreement = await prisma.rentalAgreement.findFirst({ where: { id, organizationId }, include: { lines: true } });
    if (!agreement) return res.status(404).json({ success: false, message: 'Rental not found' });
    if (['RETURNED', 'CANCELLED'].includes(agreement.status)) {
      return res.status(409).json({ success: false, message: `Rental is already ${agreement.status}` });
    }

    const byId = new Map(agreement.lines.map((l) => [l.id, l]));
    for (const l of body.lines) {
      if (!byId.has(l.lineId)) {
        return res.status(400).json({ success: false, message: `Line ${l.lineId} does not belong to this rental` });
      }
      const line = byId.get(l.lineId)!;
      const already = Number(line.returnedQty);
      if (already + l.returnedQty > Number(line.quantity) + 0.001) {
        return res.status(400).json({ success: false, message: `Returning more than was rented on line ${l.lineId}` });
      }
    }

    const daysLate = Math.max(0, Math.ceil((Date.now() - agreement.dueAt.getTime()) / 86_400_000));
    const lateFeeAmount = money(daysLate * (body.lateFeePerDay ?? 0));

    const updated = await prisma.$transaction(async (tx) => {
      for (const l of body.lines) {
        const line = byId.get(l.lineId)!;
        if (l.returnedQty <= 0) continue;
        await tx.rentalLine.update({
          where: { id: l.lineId },
          data: {
            returnedQty: money(Number(line.returnedQty) + l.returnedQty),
            condition: l.condition ?? line.condition ?? 'OK',
          },
        });
      }

      const after = await tx.rentalLine.findMany({ where: { agreementId: id } });
      const fullyReturned = after.every((l) => Number(l.returnedQty) >= Number(l.quantity) - 0.001);
      const anyReturned = after.some((l) => Number(l.returnedQty) > 0);

      return tx.rentalAgreement.update({
        where: { id },
        data: {
          status: fullyReturned ? 'RETURNED' : anyReturned ? (daysLate > 0 ? 'OVERDUE' : 'PARTIALLY_RETURNED') : agreement.status,
          returnedAt: fullyReturned ? new Date() : agreement.returnedAt,
          lateFeeAmount,
          totalAmount: money(Number(agreement.rateAmount) + lateFeeAmount),
        },
        include: { lines: true },
      });
    });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'RENTAL_RETURNED',
      resourceType: 'RENTAL_AGREEMENT',
      resourceId: id,
      newValue: { status: updated.status, daysLate, lateFeeAmount },
    });

    res.json({ success: true, data: updated, daysLate, lateFeeAmount });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/service/rentals/:id/cancel
router.post('/rentals/:id/cancel', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const existing = await prisma.rentalAgreement.findFirst({ where: { id, organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Rental not found' });
    if (existing.status === 'OUT' || existing.status === 'PARTIALLY_RETURNED') {
      return res.status(409).json({ success: false, message: 'Goods are out; process a return instead of cancelling' });
    }

    const updated = await prisma.rentalAgreement.update({ where: { id }, data: { status: 'CANCELLED' } });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
