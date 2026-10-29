/**
 * Tip pooling and tip records (§21 hospitality).
 *
 * Why this exists: the `Tip` model existed but no route ever wrote to it, so
 * "tips are tracked" was true of the schema and false of the product. This module
 * records tips against an employee, and pools them across a shift by hours,
 * sales, role points or equally.
 *
 * The allocation maths lives in `services/tipPooling.ts` (largest-remainder, so
 * the distributed total always equals the pool to the cent). This file is the
 * data plumbing: who worked, how long, how much they rang, and what they earned.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { shiftHours, type ShiftLike } from '../services/labor.js';
import {
  allocateTips,
  tipOutSplit,
  totalTips,
  type PoolMethod,
  type PoolParticipant,
} from '../services/tipPooling.js';

const router = Router();

const MANAGERS = requireRole('OWNER', 'ADMIN', 'MANAGER');

const ruleSchema = z.object({
  name: z.string().min(1).max(160),
  method: z.enum(['EQUAL', 'HOURS', 'SALES', 'POINTS']).default('HOURS'),
  roles: z.array(z.string().min(1)).default([]),
  rolePoints: z.record(z.number()).nullable().optional(),
  includeCashTips: z.boolean().optional(),
  includeCardTips: z.boolean().optional(),
  minHoursPerShift: z.number().min(0).max(24).nullable().optional(),
  isActive: z.boolean().optional(),
});

function periodQuery(fromRaw: unknown, toRaw: unknown) {
  const now = new Date();
  const from = fromRaw
    ? new Date(String(fromRaw))
    : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = toRaw ? new Date(String(toRaw)) : new Date(from.getTime() + 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    throw Object.assign(new Error('Invalid period: `to` must be after `from`'), { status: 400 });
  }
  return { from, to };
}

async function employeeDirectory(organizationId: string) {
  const rows = await prisma.employee.findMany({
    where: { organizationId },
    select: {
      id: true,
      employeeNumber: true,
      position: true,
      hourlyRate: true,
      user: { select: { name: true } },
      role: { select: { name: true } },
      isActive: true,
    },
  });
  return new Map(rows.map((e) => [e.id, e]));
}

/** Hours worked per employee: clocked time first, published roster as fallback. */
async function hoursWorked(organizationId: string, from: Date, to: Date) {
  const [entries, schedules] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { employee: { organizationId }, clockIn: { gte: from, lt: to } },
    }),
    prisma.shiftSchedule.findMany({
      where: { organizationId, status: 'PUBLISHED', startAt: { gte: from, lt: to } },
    }),
  ]);

  const hours = new Map<string, number>();
  for (const s of schedules) {
    const like: ShiftLike = {
      employeeId: s.employeeId,
      startAt: s.startAt,
      endAt: s.endAt,
      breakMinutes: s.breakMinutes,
      status: s.status,
    };
    hours.set(s.employeeId, (hours.get(s.employeeId) ?? 0) + shiftHours(like));
  }

  // Clocked hours override the roster for anyone who actually punched in.
  const clocked = new Map<string, number>();
  const now = to;
  for (const e of entries) {
    const end = e.clockOut ?? now;
    const minutes = Math.max(0, (end.getTime() - e.clockIn.getTime()) / 60000);
    const breakMinutes =
      e.breakStart && e.breakEnd ? Math.max(0, (e.breakEnd.getTime() - e.breakStart.getTime()) / 60000) : 0;
    clocked.set(e.employeeId, (clocked.get(e.employeeId) ?? 0) + Math.max(0, minutes - breakMinutes) / 60);
  }
  for (const [id, h] of clocked) hours.set(id, Math.round(h * 100) / 100);

  return hours;
}

/** Net sales rung by each employee inside the period. */
async function salesByEmployee(organizationId: string, from: Date, to: Date) {
  const grouped = await prisma.order.groupBy({
    by: ['employeeId'],
    where: {
      organizationId,
      employeeId: { not: null },
      status: { in: ['PAID', 'COMPLETED', 'FULFILLED'] },
      createdAt: { gte: from, lt: to },
    },
    _sum: { totalAmount: true },
  });

  const sales = new Map<string, number>();
  for (const g of grouped) {
    if (!g.employeeId) continue;
    sales.set(g.employeeId, Number(g._sum.totalAmount ?? 0));
  }
  return sales;
}

// ─── Pool rules ────────────────────────────────────────────────────────────

// GET /api/tips/rules
router.get('/rules', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const rows = await prisma.tipPoolRule.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } });
    res.json({ success: true, data: rows });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/tips/rules
router.post('/rules', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = ruleSchema.parse(req.body);

    const created = await prisma.tipPoolRule.create({
      data: {
        organizationId,
        name: body.name,
        method: body.method,
        roles: body.roles,
        rolePoints: body.rolePoints ?? undefined,
        includeCashTips: body.includeCashTips ?? true,
        includeCardTips: body.includeCardTips ?? true,
        minHoursPerShift: body.minHoursPerShift ?? null,
        isActive: body.isActive ?? true,
      },
    });

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/tips/rules/:id
router.put('/rules/:id', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const body = ruleSchema.partial().parse(req.body);

    const existing = await prisma.tipPoolRule.findFirst({ where: { id, organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Tip pool rule not found' });

    const updated = await prisma.tipPoolRule.update({
      where: { id },
      data: {
        name: body.name ?? existing.name,
        method: body.method ?? existing.method,
        roles: body.roles ?? existing.roles,
        rolePoints: body.rolePoints === undefined ? undefined : body.rolePoints ?? undefined,
        includeCashTips: body.includeCashTips ?? existing.includeCashTips,
        includeCardTips: body.includeCardTips ?? existing.includeCardTips,
        minHoursPerShift: body.minHoursPerShift === undefined ? existing.minHoursPerShift : body.minHoursPerShift,
        isActive: body.isActive ?? existing.isActive,
      },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/tips/rules/:id - deactivate, because distributions reference it
router.delete('/rules/:id', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const existing = await prisma.tipPoolRule.findFirst({ where: { id, organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Tip pool rule not found' });

    await prisma.tipPoolRule.update({ where: { id }, data: { isActive: false } });
    res.json({ success: true, data: { id, isActive: false } });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Pooling ───────────────────────────────────────────────────────────────

/**
 * POST /api/tips/compute
 *
 * Works out each participant's share and, with `persist`, writes the result to
 * `tip_distributions` so payroll can read a frozen number instead of recomputing.
 */
router.post('/compute', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = z
      .object({
        ruleId: z.string().min(1).nullable().optional(),
        method: z.enum(['EQUAL', 'HOURS', 'SALES', 'POINTS']).optional(),
        periodStart: z.string().min(1),
        periodEnd: z.string().min(1),
        poolAmount: z.number().min(0).optional(),
        employeeIds: z.array(z.string().min(1)).max(500).optional(),
        persist: z.boolean().optional(),
      })
      .parse(req.body);

    const from = new Date(body.periodStart);
    const to = new Date(body.periodEnd);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      return res.status(400).json({ success: false, message: 'Invalid period' });
    }

    const rule = body.ruleId
      ? await prisma.tipPoolRule.findFirst({ where: { id: body.ruleId, organizationId } })
      : await prisma.tipPoolRule.findFirst({ where: { organizationId, isActive: true }, orderBy: { createdAt: 'asc' } });

    const method = (body.method ?? rule?.method ?? 'HOURS') as PoolMethod;
    const includeCash = rule?.includeCashTips ?? true;
    const includeCard = rule?.includeCardTips ?? true;
    const rolePoints = (rule?.rolePoints as Record<string, number> | null) ?? null;
    const minHoursPerShift = rule?.minHoursPerShift === null || rule?.minHoursPerShift === undefined
      ? undefined
      : Number(rule.minHoursPerShift);
    const allowedRoles = (rule?.roles ?? []).map((r) => r.toUpperCase());

    const [directory, hours, sales, tipRows] = await Promise.all([
      employeeDirectory(organizationId),
      hoursWorked(organizationId, from, to),
      salesByEmployee(organizationId, from, to),
      prisma.tip.findMany({ where: { organizationId, createdAt: { gte: from, lt: to } } }),
    ]);

    const cashPool = totalTips(tipRows.map((t) => ({ employeeId: t.employeeId, amount: Number(t.amount), type: t.type })), {
      includeCash,
      includeCard,
    });
    // `totalTips` already applies the cash/card filter, so this is the pool the
    // rule implies unless the caller names an explicit figure.
    const pool = body.poolAmount !== undefined ? Math.round(body.poolAmount * 100) / 100 : cashPool;

    const tipsPerEmployee = new Map<string, number>();
    for (const t of tipRows) {
      const type = String(t.type).toUpperCase();
      if (type === 'CASH' && !includeCash) continue;
      if (type === 'CARD' && !includeCard) continue;
      tipsPerEmployee.set(t.employeeId, (tipsPerEmployee.get(t.employeeId) ?? 0) + Number(t.amount));
    }

    const filterIds = body.employeeIds ? new Set(body.employeeIds) : null;
    const participants: (PoolParticipant & { role: string })[] = [];
    for (const [employeeId] of directory) {
      const emp = directory.get(employeeId)!;
      if (!emp.isActive) continue;
      if (filterIds && !filterIds.has(employeeId)) continue;
      const role = String(emp.role?.name ?? emp.position ?? '').toUpperCase();
      if (allowedRoles.length > 0 && !allowedRoles.includes(role)) continue;

      const h = hours.get(employeeId) ?? 0;
      const s = sales.get(employeeId) ?? 0;
      if (h === 0 && s === 0 && !tipsPerEmployee.has(employeeId)) continue;

      participants.push({ employeeId, hours: h, sales: s, role, name: emp.user.name });
    }

    const allocation = allocateTips(pool, participants, method, { rolePoints, minHoursPerShift });
    // `ok` is the discriminant of the union; testing for the key itself always
    // succeeds and would leave the error branch unreachable.
    if (!allocation.ok) {
      return res.status(400).json({
        success: false,
        message:
          allocation.reason === 'NO_POOL'
            ? 'There is no tip pool to distribute for this period'
            : allocation.reason === 'NO_PARTICIPANTS'
              ? 'No eligible employees worked this period'
              : 'No participant carries a weight for this method (check role points or hours)',
        reason: allocation.reason,
      });
    }

    const lines = allocation.allocations.map((a) => ({
      employeeId: a.employeeId,
      employeeName: a.name ?? directory.get(a.employeeId)?.user.name ?? null,
      hours: hours.get(a.employeeId) ?? 0,
      sales: Math.round((sales.get(a.employeeId) ?? 0) * 100) / 100,
      weight: a.weight,
      share: a.share,
      sharePct: a.sharePct,
      tipsRecorded: Math.round((tipsPerEmployee.get(a.employeeId) ?? 0) * 100) / 100,
    }));

    if (body.persist) {
      await prisma.$transaction(async (tx) => {
        await tx.tipDistribution.deleteMany({
          where: { organizationId, periodStart: from, periodEnd: to, ruleId: rule?.id ?? null },
        });
        await tx.tipDistribution.createMany({
          data: lines.map((l) => ({
            organizationId,
            ruleId: rule?.id ?? null,
            periodStart: from,
            periodEnd: to,
            employeeId: l.employeeId,
            method,
            hours: l.hours,
            points: l.weight,
            sales: l.sales,
            tips: l.share,
          })),
        });
      });
    }

    res.json({
      success: true,
      data: {
        method,
        pool,
        distributed: allocation.distributed,
        roundingDrift: allocation.roundingDrift,
        ruleId: rule?.id ?? null,
        persisted: Boolean(body.persist),
        lines,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/tips/distributions?from=&to=
router.get('/distributions', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const { from, to } = periodQuery(req.query.from, req.query.to);

    const rows = await prisma.tipDistribution.findMany({
      where: { organizationId, periodStart: { gte: from, lt: to } },
      orderBy: [{ periodStart: 'asc' }, { employeeId: 'asc' }],
    });
    const directory = await employeeDirectory(organizationId);

    res.json({
      success: true,
      data: rows.map((r) => ({
        ...r,
        employeeName: directory.get(r.employeeId)?.user.name ?? null,
      })),
      meta: { from, to, total: Math.round(rows.reduce((s, r) => s + Number(r.tips), 0) * 100) / 100 },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/tips/tip-out - split a pool into service and support shares
router.post('/tip-out', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const body = z
      .object({ pool: z.number().min(0), tipOutPct: z.number().min(0).max(100) })
      .parse(req.body);

    res.json({ success: true, data: tipOutSplit(body.pool, body.tipOutPct) });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Recording tips ────────────────────────────────────────────────────────

// POST /api/tips - record a tip against an employee
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = z
      .object({
        employeeId: z.string().min(1),
        orderId: z.string().min(1).nullable().optional(),
        amount: z.number().positive(),
        type: z.enum(['CASH', 'CARD', 'DECLARED']).optional(),
      })
      .parse(req.body);

    const employee = await prisma.employee.findFirst({
      where: { id: body.employeeId, organizationId },
      select: { id: true },
    });
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    const created = await prisma.tip.create({
      data: {
        organizationId,
        employeeId: body.employeeId,
        orderId: body.orderId ?? null,
        amount: body.amount,
        type: body.type ?? 'CASH',
      },
    });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'TIP_RECORDED',
      resourceType: 'TIP',
      resourceId: created.id,
      newValue: { employeeId: created.employeeId, amount: Number(created.amount), type: created.type },
    });

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/tips?from=&to=&employeeId=
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const { from, to } = periodQuery(req.query.from, req.query.to);

    const where: Record<string, unknown> = { organizationId, createdAt: { gte: from, lt: to } };
    if (req.query.employeeId) where.employeeId = String(req.query.employeeId);

    const rows = await prisma.tip.findMany({ where, orderBy: { createdAt: 'desc' }, take: 500 });
    const directory = await employeeDirectory(organizationId);

    res.json({
      success: true,
      data: rows.map((r) => ({ ...r, employeeName: directory.get(r.employeeId)?.user.name ?? null })),
      meta: { from, to },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/tips/summary?from=&to=
router.get('/summary', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const { from, to } = periodQuery(req.query.from, req.query.to);

    const rows = await prisma.tip.findMany({ where: { organizationId, createdAt: { gte: from, lt: to } } });
    const directory = await employeeDirectory(organizationId);

    const byType: Record<string, number> = {};
    const byEmployee = new Map<string, { employeeId: string; employeeName: string | null; total: number; count: number }>();

    for (const t of rows) {
      const amount = Number(t.amount);
      const type = String(t.type).toUpperCase();
      byType[type] = Math.round(((byType[type] ?? 0) + amount) * 100) / 100;

      const entry = byEmployee.get(t.employeeId) ?? {
        employeeId: t.employeeId,
        employeeName: directory.get(t.employeeId)?.user.name ?? null,
        total: 0,
        count: 0,
      };
      entry.total = Math.round((entry.total + amount) * 100) / 100;
      entry.count += 1;
      byEmployee.set(t.employeeId, entry);
    }

    res.json({
      success: true,
      data: {
        total: Math.round(rows.reduce((s, t) => s + Number(t.amount), 0) * 100) / 100,
        count: rows.length,
        byType,
        byEmployee: [...byEmployee.values()].sort((a, b) => b.total - a.total),
      },
      meta: { from, to },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
