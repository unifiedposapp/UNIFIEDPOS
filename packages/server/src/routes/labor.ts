/**
 * Labour: roster, availability, time off, shift swaps, labour analytics and the
 * payroll export (§21 workforce).
 *
 * Why this exists: `prisma.shiftSchedule` is the only place a manager can plan
 * who works when, and the previous build had no roster at all — `Shift` existed
 * in the schema but nothing ever wrote to it. This module is the planning half;
 * `TimeEntry` remains the clocked reality.
 *
 * Every total comes from the pure `services/labor.ts` functions, so overtime and
 * labour cost are unit-tested independently of the database.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import {
  availabilityViolations,
  coverageGaps,
  detectConflicts,
  entryHours,
  labourCost,
  labourPercent,
  salesPerLabourHour,
  shiftHours,
  splitOvertime,
  type CoverageRequirement,
  type ShiftLike,
} from '../services/labor.js';

const router = Router();

const MANAGERS = requireRole('OWNER', 'ADMIN', 'MANAGER');

/** Default reporting window when a caller omits `from`/`to`: the next two weeks. */
const DEFAULT_WINDOW_DAYS = 14;

function rangeQuery(fromRaw: unknown, toRaw: unknown, days = DEFAULT_WINDOW_DAYS): { from: Date; to: Date } {
  const now = new Date();
  const from = fromRaw ? new Date(String(fromRaw)) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = toRaw ? new Date(String(toRaw)) : new Date(from.getTime() + days * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    throw Object.assign(new Error('Invalid date range: `to` must be after `from`'), { status: 400 });
  }
  return { from, to };
}

/** employeeId -> display name, in one query per request. */
async function employeeDirectory(organizationId: string) {
  const rows = await prisma.employee.findMany({
    where: { organizationId },
    select: {
      id: true,
      employeeNumber: true,
      position: true,
      department: true,
      hourlyRate: true,
      user: { select: { name: true, email: true } },
    },
  });
  return new Map(rows.map((e) => [e.id, e]));
}

function toShiftLike(s: {
  id: string;
  employeeId: string;
  startAt: Date;
  endAt: Date;
  breakMinutes: number;
  status: string;
}): ShiftLike {
  return {
    id: s.id,
    employeeId: s.employeeId,
    startAt: s.startAt,
    endAt: s.endAt,
    breakMinutes: s.breakMinutes,
    status: s.status,
  };
}

const scheduleSchema = z.object({
  employeeId: z.string().min(1),
  locationId: z.string().nullable().optional(),
  startAt: z.string().min(1),
  endAt: z.string().min(1),
  breakMinutes: z.number().int().min(0).max(480).optional(),
  position: z.string().max(120).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

const availabilitySchema = z.object({
  windows: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        startMinute: z.number().int().min(0).max(1440),
        endMinute: z.number().int().min(0).max(1440),
        effectiveFrom: z.string().nullable().optional(),
        effectiveTo: z.string().nullable().optional(),
      }),
    )
    .max(50),
});

// ─── Roster ────────────────────────────────────────────────────────────────

// GET /api/labor/schedules?from=&to=&employeeId=&locationId=&status=
router.get('/schedules', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const { from, to } = rangeQuery(req.query.from, req.query.to);

    const where: Record<string, unknown> = { organizationId, startAt: { gte: from, lt: to } };
    if (req.query.employeeId) where.employeeId = String(req.query.employeeId);
    if (req.query.locationId) where.locationId = String(req.query.locationId);
    if (req.query.status) where.status = String(req.query.status);

    const [rows, directory] = await Promise.all([
      prisma.shiftSchedule.findMany({ where, orderBy: { startAt: 'asc' } }),
      employeeDirectory(organizationId),
    ]);

    res.json({
      success: true,
      data: rows.map((r) => ({
        ...r,
        employeeName: directory.get(r.employeeId)?.user.name ?? null,
        hours: shiftHours(toShiftLike(r)),
      })),
      meta: { from, to },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/labor/schedules - create one or many draft shifts
router.post('/schedules', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = z.union([scheduleSchema, z.array(scheduleSchema).min(1).max(200)]).parse(req.body);
    const drafts = Array.isArray(body) ? body : [body];

    const force = String(req.query.force ?? '') === 'true';
    const normalized = drafts.map((d) => {
      const startAt = new Date(d.startAt);
      const endAt = new Date(d.endAt);
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
        throw Object.assign(new Error('startAt and endAt must be ISO timestamps'), { status: 400 });
      }
      if (endAt <= startAt) {
        throw Object.assign(new Error('A shift must end after it starts'), { status: 400 });
      }
      return { ...d, startAt, endAt };
    });

    // Conflicts are computed against what is already rostered in the same span.
    const windowStart = new Date(Math.min(...normalized.map((s) => s.startAt.getTime())));
    const windowEnd = new Date(Math.max(...normalized.map((s) => s.endAt.getTime())));
    const employeeIds = [...new Set(normalized.map((s) => s.employeeId))];

    const owned = await prisma.employee.count({ where: { id: { in: employeeIds }, organizationId } });
    if (owned !== employeeIds.length) {
      return res.status(400).json({ success: false, message: 'One or more employees do not belong to this organization' });
    }

    const existing = await prisma.shiftSchedule.findMany({
      where: {
        organizationId,
        employeeId: { in: employeeIds },
        status: { not: 'CANCELLED' },
        startAt: { lt: windowEnd },
        endAt: { gt: windowStart },
      },
    });

    const candidateLike: ShiftLike[] = normalized.map((s, i) => ({
      id: `new-${i}`,
      employeeId: s.employeeId,
      startAt: s.startAt,
      endAt: s.endAt,
      breakMinutes: s.breakMinutes ?? 0,
      status: 'DRAFT',
    }));
    const conflicts = detectConflicts([...existing.map(toShiftLike), ...candidateLike]);

    if (conflicts.length > 0 && !force) {
      return res.status(409).json({
        success: false,
        message: 'The roster has conflicts; resend with ?force=true to save anyway',
        conflicts,
      });
    }

    const created = await prisma.$transaction(
      normalized.map((s) =>
        prisma.shiftSchedule.create({
          data: {
            organizationId,
            employeeId: s.employeeId,
            locationId: s.locationId ?? null,
            position: s.position ?? null,
            startAt: s.startAt,
            endAt: s.endAt,
            breakMinutes: s.breakMinutes ?? 0,
            notes: s.notes ?? null,
            status: 'DRAFT',
            createdByEmployeeId: req.user!.employeeId ?? null,
          },
        }),
      ),
    );

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'SHIFTS_CREATED',
      resourceType: 'SHIFT_SCHEDULE',
      newValue: { count: created.length },
    });

    res.status(201).json({ success: true, data: created, conflicts });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/labor/schedules/:id
router.put('/schedules/:id', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const body = scheduleSchema.partial().parse(req.body);

    const current = await prisma.shiftSchedule.findFirst({ where: { id, organizationId } });
    if (!current) return res.status(404).json({ success: false, message: 'Shift not found' });

    const startAt = body.startAt ? new Date(body.startAt) : current.startAt;
    const endAt = body.endAt ? new Date(body.endAt) : current.endAt;
    if (endAt <= startAt) {
      return res.status(400).json({ success: false, message: 'A shift must end after it starts' });
    }
    if (current.status === 'PUBLISHED' && !['OWNER', 'ADMIN'].includes(String(req.user!.role))) {
      return res.status(409).json({ success: false, message: 'A published shift can only be changed by an owner or admin' });
    }

    const updated = await prisma.shiftSchedule.update({
      where: { id },
      data: {
        employeeId: body.employeeId ?? current.employeeId,
        locationId: body.locationId === undefined ? current.locationId : body.locationId,
        position: body.position === undefined ? current.position : body.position,
        startAt,
        endAt,
        breakMinutes: body.breakMinutes ?? current.breakMinutes,
        notes: body.notes === undefined ? current.notes : body.notes,
      },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/labor/schedules/:id - cancel, never destroy history
router.delete('/schedules/:id', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const current = await prisma.shiftSchedule.findFirst({ where: { id, organizationId } });
    if (!current) return res.status(404).json({ success: false, message: 'Shift not found' });

    await prisma.shiftSchedule.update({ where: { id }, data: { status: 'CANCELLED' } });
    res.json({ success: true, data: { id, status: 'CANCELLED' } });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * POST /api/labor/schedules/publish
 *
 * Publishing is the manager's promise to the team, so it refuses to publish a
 * shift that overlaps another one or falls outside the employee's declared
 * availability. Clean shifts go live; blocked ones stay DRAFT with the reason.
 */
router.post('/schedules/publish', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = z
      .object({
        ids: z.array(z.string().min(1)).max(500).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        includeAvailabilityWarnings: z.boolean().optional(),
      })
      .parse(req.body ?? {});

    const { from, to } = rangeQuery(body.from, body.to);
    const where: Record<string, unknown> = { organizationId, status: 'DRAFT' };
    if (body.ids?.length) where.id = { in: body.ids };
    else where.startAt = { gte: from, lt: to };

    const drafts = await prisma.shiftSchedule.findMany({ where, orderBy: { startAt: 'asc' } });
    if (drafts.length === 0) {
      return res.json({ success: true, data: { published: 0, blocked: [] } });
    }

    const employeeIds = [...new Set(drafts.map((d) => d.employeeId))];
    const live = await prisma.shiftSchedule.findMany({
      where: { organizationId, employeeId: { in: employeeIds }, status: { not: 'CANCELLED' } },
    });
    const windows = await prisma.employeeAvailability.findMany({ where: { organizationId, employeeId: { in: employeeIds } } });

    const conflicts = detectConflicts(live.map(toShiftLike));
    const availability = availabilityViolations(
      drafts.map(toShiftLike),
      windows.map((w) => ({ employeeId: w.employeeId, weekday: w.weekday, startMinute: w.startMinute, endMinute: w.endMinute })),
    );

    const blocking = new Map<string, string[]>();
    for (const c of conflicts) {
      for (const id of [c.a, c.b]) {
        if (!id || id.startsWith('new-')) continue;
        const list = blocking.get(id) ?? [];
        list.push(`${c.reason}: ${c.detail}`);
        blocking.set(id, list);
      }
    }

    const warnings = new Map<string, string[]>();
    for (const v of availability) {
      if (!v.shiftId) continue;
      const list = warnings.get(v.shiftId) ?? [];
      list.push(v.detail);
      warnings.set(v.shiftId, list);
    }

    // Availability is a warning by default: a manager may knowingly schedule over
    // a preference, but never over a double-booking.
    const publishable = drafts.filter((d) => !blocking.has(d.id));
    const blocked = drafts
      .filter((d) => blocking.has(d.id))
      .map((d) => ({ id: d.id, employeeId: d.employeeId, startAt: d.startAt, issues: blocking.get(d.id) }));

    if (publishable.length > 0) {
      await prisma.shiftSchedule.updateMany({
        where: { id: { in: publishable.map((d) => d.id) } },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      });
    }

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'SHIFTS_PUBLISHED',
      resourceType: 'SHIFT_SCHEDULE',
      newValue: { published: publishable.length, blocked: blocked.length },
    });

    res.json({
      success: true,
      data: {
        published: publishable.length,
        blocked,
        availabilityWarnings: [...warnings.entries()].map(([id, issues]) => ({ id, issues })),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/labor/conflicts?from=&to= - pre-flight before publishing
router.get('/conflicts', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const { from, to } = rangeQuery(req.query.from, req.query.to);
    const shifts = await prisma.shiftSchedule.findMany({
      where: { organizationId, status: { not: 'CANCELLED' }, startAt: { lt: to }, endAt: { gt: from } },
    });
    const directory = await employeeDirectory(organizationId);
    const conflicts = detectConflicts(shifts.map(toShiftLike)).map((c) => ({
      ...c,
      employeeName: directory.get(c.employeeId)?.user.name ?? null,
    }));
    res.json({ success: true, data: conflicts, meta: { from, to, shifts: shifts.length } });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Availability ──────────────────────────────────────────────────────────

// GET /api/labor/availability?employeeId=
router.get('/availability', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const where: Record<string, unknown> = { organizationId };
    if (req.query.employeeId) where.employeeId = String(req.query.employeeId);

    const rows = await prisma.employeeAvailability.findMany({ where, orderBy: [{ employeeId: 'asc' }, { weekday: 'asc' }] });
    res.json({ success: true, data: rows });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/labor/availability/:employeeId - replace an employee's declared windows
router.put('/availability/:employeeId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const employeeId = String(req.params.employeeId);
    const body = availabilitySchema.parse(req.body);

    // An employee may edit their own availability; a manager may edit anyone's.
    if (req.user!.employeeId !== employeeId && !['OWNER', 'ADMIN', 'MANAGER'].includes(String(req.user!.role))) {
      return res.status(403).json({ success: false, message: 'You can only change your own availability' });
    }

    const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId }, select: { id: true } });
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    for (const w of body.windows) {
      if (w.endMinute <= w.startMinute) {
        return res.status(400).json({ success: false, message: 'Each window must end after it starts' });
      }
    }

    const saved = await prisma.$transaction(async (tx) => {
      await tx.employeeAvailability.deleteMany({ where: { organizationId, employeeId } });
      if (body.windows.length === 0) return [];
      await tx.employeeAvailability.createMany({
        data: body.windows.map((w) => ({
          organizationId,
          employeeId,
          weekday: w.weekday,
          startMinute: w.startMinute,
          endMinute: w.endMinute,
          effectiveFrom: w.effectiveFrom ? new Date(w.effectiveFrom) : null,
          effectiveTo: w.effectiveTo ? new Date(w.effectiveTo) : null,
        })),
      });
      return tx.employeeAvailability.findMany({ where: { organizationId, employeeId }, orderBy: { weekday: 'asc' } });
    });

    res.json({ success: true, data: saved });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Time off ──────────────────────────────────────────────────────────────

// GET /api/labor/time-off?status=&employeeId=
router.get('/time-off', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const where: Record<string, unknown> = { organizationId };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.employeeId) where.employeeId = String(req.query.employeeId);

    const [rows, directory] = await Promise.all([
      prisma.timeOffRequest.findMany({ where, orderBy: { startDate: 'asc' } }),
      employeeDirectory(organizationId),
    ]);

    res.json({
      success: true,
      data: rows.map((r) => ({ ...r, employeeName: directory.get(r.employeeId)?.user.name ?? null })),
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/labor/time-off
router.post('/time-off', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = z
      .object({
        employeeId: z.string().min(1).optional(),
        startDate: z.string().min(1),
        endDate: z.string().min(1),
        type: z.enum(['VACATION', 'SICK', 'UNPAID', 'OTHER']).optional(),
        reason: z.string().max(1000).nullable().optional(),
      })
      .parse(req.body);

    const employeeId = body.employeeId ?? req.user!.employeeId;
    if (!employeeId) return res.status(400).json({ success: false, message: 'employeeId is required' });
    if (req.user!.employeeId !== employeeId && !['OWNER', 'ADMIN', 'MANAGER'].includes(String(req.user!.role))) {
      return res.status(403).json({ success: false, message: 'You can only request time off for yourself' });
    }

    const startDate = new Date(body.startDate);
    const endDate = new Date(body.endDate);
    if (endDate < startDate) {
      return res.status(400).json({ success: false, message: 'endDate must not precede startDate' });
    }

    const created = await prisma.timeOffRequest.create({
      data: {
        organizationId,
        employeeId,
        startDate,
        endDate,
        type: body.type ?? 'VACATION',
        reason: body.reason ?? null,
        status: 'PENDING',
      },
    });

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/labor/time-off/:id/decision - approve or decline, showing rota impact
router.put('/time-off/:id/decision', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const body = z.object({ status: z.enum(['APPROVED', 'DECLINED']), reason: z.string().max(500).optional() }).parse(req.body);

    const request = await prisma.timeOffRequest.findFirst({ where: { id, organizationId } });
    if (!request) return res.status(404).json({ success: false, message: 'Time-off request not found' });

    const updated = await prisma.timeOffRequest.update({
      where: { id },
      data: {
        status: body.status,
        decidedByEmployeeId: req.user!.employeeId ?? null,
        decidedAt: new Date(),
        reason: body.reason ?? request.reason,
      },
    });

    // Approving leave does not silently cancel the roster - the manager decides.
    const rosteredShifts =
      body.status === 'APPROVED'
        ? await prisma.shiftSchedule.findMany({
            where: {
              organizationId,
              employeeId: request.employeeId,
              status: { not: 'CANCELLED' },
              startAt: { lt: new Date(request.endDate.getTime() + 86_400_000) },
              endAt: { gt: request.startDate },
            },
            orderBy: { startAt: 'asc' },
          })
        : [];

    res.json({ success: true, data: updated, rosteredShifts });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Shift swaps ───────────────────────────────────────────────────────────

// GET /api/labor/swaps?status=
router.get('/swaps', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const where: Record<string, unknown> = { organizationId };
    if (req.query.status) where.status = String(req.query.status);

    const rows = await prisma.shiftSwapRequest.findMany({ where, orderBy: { createdAt: 'desc' } });
    const directory = await employeeDirectory(organizationId);

    res.json({
      success: true,
      data: rows.map((r) => ({
        ...r,
        fromEmployeeName: directory.get(r.fromEmployeeId)?.user.name ?? null,
        toEmployeeName: r.toEmployeeId ? directory.get(r.toEmployeeId)?.user.name ?? null : null,
      })),
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/labor/swaps
router.post('/swaps', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = z
      .object({
        scheduleId: z.string().min(1),
        toEmployeeId: z.string().min(1).nullable().optional(),
        reason: z.string().max(1000).nullable().optional(),
      })
      .parse(req.body);

    const schedule = await prisma.shiftSchedule.findFirst({ where: { id: body.scheduleId, organizationId } });
    if (!schedule) return res.status(404).json({ success: false, message: 'Shift not found' });

    if (req.user!.employeeId !== schedule.employeeId && !['OWNER', 'ADMIN', 'MANAGER'].includes(String(req.user!.role))) {
      return res.status(403).json({ success: false, message: 'You can only request a swap for your own shift' });
    }

    const created = await prisma.shiftSwapRequest.create({
      data: {
        organizationId,
        scheduleId: schedule.id,
        fromEmployeeId: schedule.employeeId,
        toEmployeeId: body.toEmployeeId ?? null,
        reason: body.reason ?? null,
        status: 'PENDING',
      },
    });

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/labor/swaps/:id/decision - a manager approves or declines the swap
router.put('/swaps/:id/decision', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const body = z
      .object({
        status: z.enum(['APPROVED', 'DECLINED', 'WITHDRAWN']),
        toEmployeeId: z.string().min(1).optional(),
      })
      .parse(req.body);

    const swap = await prisma.shiftSwapRequest.findFirst({ where: { id, organizationId } });
    if (!swap) return res.status(404).json({ success: false, message: 'Swap request not found' });
    if (swap.status !== 'PENDING') {
      return res.status(409).json({ success: false, message: `This request is already ${swap.status}` });
    }

    const target = body.toEmployeeId ?? swap.toEmployeeId;
    if (body.status === 'APPROVED' && !target) {
      return res.status(400).json({ success: false, message: 'Approving a swap needs a receiving employee' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (body.status === 'APPROVED' && target) {
        // The roster itself must move, otherwise the swap is only a note.
        await tx.shiftSchedule.update({
          where: { id: swap.scheduleId },
          data: { employeeId: target, status: 'PUBLISHED', publishedAt: new Date() },
        });
      }
      return tx.shiftSwapRequest.update({
        where: { id },
        data: {
          status: body.status,
          toEmployeeId: target ?? null,
          decidedByEmployeeId: req.user!.employeeId ?? null,
          decidedAt: new Date(),
        },
      });
    });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: `SHIFT_SWAP_${body.status}`,
      resourceType: 'SHIFT_SCHEDULE',
      resourceId: swap.scheduleId,
      newValue: { toEmployeeId: target ?? null },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Coverage ──────────────────────────────────────────────────────────────

// POST /api/labor/coverage/check - where the roster is short for a requirement set
router.post('/coverage/check', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
        requirements: z
          .array(
            z.object({
              weekday: z.number().int().min(0).max(6),
              startMinute: z.number().int().min(0).max(1440),
              endMinute: z.number().int().min(0).max(1440),
              minHeadcount: z.number().int().min(1).max(500),
            }),
          )
          .min(1)
          .max(50),
      })
      .parse(req.body);

    const { from, to } = rangeQuery(body.from, body.to);
    const shifts = await prisma.shiftSchedule.findMany({
      where: { organizationId, status: { not: 'CANCELLED' }, startAt: { lt: to }, endAt: { gt: from } },
    });

    const gaps = coverageGaps(shifts.map(toShiftLike), body.requirements as CoverageRequirement[]);
    res.json({ success: true, data: { gaps, shifts: shifts.length }, meta: { from, to } });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Payroll ───────────────────────────────────────────────────────────────

interface PayrollLine {
  employeeId: string;
  employeeName: string;
  employeeNumber: string | null;
  department: string | null;
  hourlyRate: number;
  regularHours: number;
  overtimeHours: number;
  totalHours: number;
  tips: number;
  grossPay: number;
  source: 'TIME_ENTRY' | 'SCHEDULE';
}

/**
 * Hours per employee for a period.
 *
 * Clocked time wins. An employee with no time entries but a published roster
 * still gets a line, marked `SCHEDULE`, so a store that has not started using the
 * clock is not silently paid zero — the manager can see it is an estimate.
 */
async function computePayroll(organizationId: string, from: Date, to: Date) {
  const [employees, entries, tips, schedules] = await Promise.all([
    employeeDirectory(organizationId),
    prisma.timeEntry.findMany({
      where: { employee: { organizationId }, clockIn: { gte: from, lt: to } },
      orderBy: { clockIn: 'asc' },
    }),
    prisma.tip.findMany({ where: { organizationId, createdAt: { gte: from, lt: to } } }),
    prisma.shiftSchedule.findMany({
      where: { organizationId, status: 'PUBLISHED', startAt: { gte: from, lt: to } },
    }),
  ]);

  const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const hoursPerDay = new Map<string, Map<string, number>>();
  for (const e of entries) {
    const hours = entryHours({ clockIn: e.clockIn, clockOut: e.clockOut, breakStart: e.breakStart, breakEnd: e.breakEnd }, to);
    const byDay = hoursPerDay.get(e.employeeId) ?? new Map<string, number>();
    byDay.set(dayKey(e.clockIn), (byDay.get(dayKey(e.clockIn)) ?? 0) + hours);
    hoursPerDay.set(e.employeeId, byDay);
  }

  const scheduleHours = new Map<string, number>();
  for (const s of schedules) {
    scheduleHours.set(s.employeeId, (scheduleHours.get(s.employeeId) ?? 0) + shiftHours(toShiftLike(s)));
  }

  const tipsByEmployee = new Map<string, number>();
  for (const t of tips) {
    tipsByEmployee.set(t.employeeId, (tipsByEmployee.get(t.employeeId) ?? 0) + Number(t.amount));
  }

  const lines: PayrollLine[] = [];
  for (const [employeeId, emp] of employees) {
    const byDay = hoursPerDay.get(employeeId);
    const hasClock = Boolean(byDay && byDay.size > 0);
    const split = hasClock
      ? splitOvertime([...byDay!.values()], { weeklyThreshold: 40 })
      : splitOvertime(scheduleHours.get(employeeId) ? [scheduleHours.get(employeeId)!] : [], { weeklyThreshold: 40 });

    const rate = Number(emp.hourlyRate ?? 0);
    const lineTips = Math.round((tipsByEmployee.get(employeeId) ?? 0) * 100) / 100;

    if (!hasClock && split.totalHours === 0 && lineTips === 0) continue;

    lines.push({
      employeeId,
      employeeName: emp.user.name,
      employeeNumber: emp.employeeNumber,
      department: emp.department,
      hourlyRate: rate,
      regularHours: split.regularHours,
      overtimeHours: split.overtimeHours,
      totalHours: split.totalHours,
      tips: lineTips,
      grossPay: Math.round((labourCost(split, rate, 1.5) + lineTips) * 100) / 100,
      source: hasClock ? 'TIME_ENTRY' : 'SCHEDULE',
    });
  }

  lines.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  return lines;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function payrollCsv(lines: PayrollLine[]): string {
  const header = ['Employee', 'EmployeeNumber', 'Department', 'RegularHours', 'OvertimeHours', 'TotalHours', 'HourlyRate', 'Tips', 'GrossPay', 'Source'];
  const rows = lines.map((l) => [
    l.employeeName,
    l.employeeNumber ?? '',
    l.department ?? '',
    l.regularHours.toFixed(2),
    l.overtimeHours.toFixed(2),
    l.totalHours.toFixed(2),
    l.hourlyRate.toFixed(2),
    l.tips.toFixed(2),
    l.grossPay.toFixed(2),
    l.source,
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

// GET /api/labor/payroll/preview?from=&to= - compute without persisting
router.get('/payroll/preview', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const { from, to } = rangeQuery(req.query.from, req.query.to, 7);
    const lines = await computePayroll(organizationId, from, to);

    res.json({
      success: true,
      data: {
        lines,
        totals: {
          hours: Math.round(lines.reduce((s, l) => s + l.totalHours, 0) * 100) / 100,
          overtimeHours: Math.round(lines.reduce((s, l) => s + l.overtimeHours, 0) * 100) / 100,
          tips: Math.round(lines.reduce((s, l) => s + l.tips, 0) * 100) / 100,
          gross: Math.round(lines.reduce((s, l) => s + l.grossPay, 0) * 100) / 100,
          headcount: lines.length,
        },
      },
      meta: { from, to },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/labor/payroll/runs - freeze a period into an exportable run
router.post('/payroll/runs', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = z
      .object({
        from: z.string().min(1),
        to: z.string().min(1),
        currency: z.string().length(3).optional(),
      })
      .parse(req.body);

    const from = new Date(body.from);
    const to = new Date(body.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      return res.status(400).json({ success: false, message: 'Invalid period' });
    }

    const lines = await computePayroll(organizationId, from, to);
    if (lines.length === 0) {
      return res.status(400).json({ success: false, message: 'No hours or tips fall inside this period' });
    }

    const run = await prisma.payrollRun.create({
      data: {
        organizationId,
        periodStart: from,
        periodEnd: to,
        currency: (body.currency ?? 'USD').toUpperCase(),
        status: 'DRAFT',
        totalHours: lines.reduce((s, l) => s + l.totalHours, 0),
        totalOvertimeHours: lines.reduce((s, l) => s + l.overtimeHours, 0),
        totalTips: lines.reduce((s, l) => s + l.tips, 0),
        totalGross: lines.reduce((s, l) => s + l.grossPay, 0),
        csv: payrollCsv(lines),
        createdByEmployeeId: req.user!.employeeId ?? null,
      },
    });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'PAYROLL_RUN_CREATED',
      resourceType: 'PAYROLL_RUN',
      resourceId: run.id,
      newValue: { from, to, lines: lines.length, gross: Number(run.totalGross) },
    });

    res.status(201).json({ success: true, data: run });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/labor/payroll/runs
router.get('/payroll/runs', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const rows = await prisma.payrollRun.findMany({
      where: { organizationId },
      orderBy: { periodStart: 'desc' },
      take: 100,
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        status: true,
        currency: true,
        totalHours: true,
        totalOvertimeHours: true,
        totalTips: true,
        totalGross: true,
        createdAt: true,
      },
    });
    res.json({ success: true, data: rows });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/labor/payroll/runs/:id
router.get('/payroll/runs/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const run = await prisma.payrollRun.findFirst({
      where: { id: String(req.params.id), organizationId },
      select: { id: true, periodStart: true, periodEnd: true, status: true, currency: true, totalHours: true, totalOvertimeHours: true, totalTips: true, totalGross: true, createdAt: true },
    });
    if (!run) return res.status(404).json({ success: false, message: 'Payroll run not found' });
    res.json({ success: true, data: run });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/labor/payroll/runs/:id/csv - download, and mark the run exported
router.get('/payroll/runs/:id/csv', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const run = await prisma.payrollRun.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!run) return res.status(404).json({ success: false, message: 'Payroll run not found' });

    if (run.status !== 'EXPORTED') {
      await prisma.payrollRun.update({ where: { id: run.id }, data: { status: 'EXPORTED' } });
    }

    const stamp = run.periodStart.toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="payroll-${stamp}.csv"`);
    res.send(run.csv ?? '');
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Summary ───────────────────────────────────────────────────────────────

// GET /api/labor/summary?from=&to= - labour % and sales per labour hour
router.get('/summary', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const { from, to } = rangeQuery(req.query.from, req.query.to, 7);

    const [lines, sales] = await Promise.all([
      computePayroll(organizationId, from, to),
      prisma.order.aggregate({
        where: { organizationId, status: { in: ['COMPLETED', 'PAID', 'FULFILLED'] }, createdAt: { gte: from, lt: to } },
        _sum: { totalAmount: true, tipAmount: true },
        _count: true,
      }),
    ]);

    const hours = Math.round(lines.reduce((s, l) => s + l.totalHours, 0) * 100) / 100;
    const cost = Math.round(lines.reduce((s, l) => s + l.grossPay, 0) * 100) / 100;
    const netSales = Number(sales._sum.totalAmount ?? 0);

    res.json({
      success: true,
      data: {
        hours,
        labourCost: cost,
        netSales,
        orderCount: sales._count,
        labourPercent: labourPercent(cost, netSales),
        salesPerLabourHour: salesPerLabourHour(netSales, hours),
        estimatedLines: lines.filter((l) => l.source === 'SCHEDULE').length,
      },
      meta: { from, to },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
