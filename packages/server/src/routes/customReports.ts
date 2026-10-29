/**
 * Custom report builder (§16 reporting).
 *
 * Why this exists: every report in the product is a fixed SQL query, so the one
 * thing a merchant always asks for — "my own columns, grouped my own way" — could
 * not be answered without a code change. Here the merchant picks from a closed
 * vocabulary of sources and columns; `services/reportBuilder.ts` validates the
 * definition, filters, groups, totals and renders CSV.
 *
 * There is no dynamic SQL anywhere: a source maps to a fixed Prisma query, and a
 * column that the source does not declare is rejected before anything is read.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { entryHours } from '../services/labor.js';
import { REPORT_SOURCES, buildReport, toCsv, validateDefinition, type ReportDefinitionInput } from '../services/reportBuilder.js';

const router = Router();

const MANAGERS = requireRole('OWNER', 'ADMIN', 'MANAGER');

function rangeQuery(fromRaw: unknown, toRaw: unknown, days = 30) {
  const now = new Date();
  const from = fromRaw ? new Date(String(fromRaw)) : new Date(now.getTime() - days * 86_400_000);
  const to = toRaw ? new Date(String(toRaw)) : new Date(now.getTime() + 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    throw Object.assign(new Error('Invalid date range: `to` must be after `from`'), { error: 'Invalid date range' });
  }
  return { from, to };
}

/**
 * One fixed query per source, already shaped to that source's column keys.
 *
 * Rows are capped: a report definition is not a data-export tool, and an
 * unbounded scan of a busy tenancy would take the API down with it.
 */
async function loadRows(
  organizationId: string,
  source: string,
  range: { from: Date; to: Date },
  limit: number,
): Promise<Record<string, unknown>[]> {
  switch (source) {
    case 'SALES': {
      const rows = await prisma.order.findMany({
        where: { organizationId, status: { in: ['PAID', 'COMPLETED', 'FULFILLED', 'PROCESSING'] }, createdAt: { gte: range.from, lt: range.to } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return rows.map((o) => ({
        orderNumber: o.orderNumber,
        channel: o.channel,
        status: o.status,
        currency: o.currency,
        subtotal: Number(o.subtotal),
        discountAmount: Number(o.discountAmount),
        taxAmount: Number(o.taxAmount),
        tipAmount: Number(o.tipAmount),
        totalAmount: Number(o.totalAmount),
        createdAt: o.createdAt.toISOString(),
      }));
    }
    case 'ORDERS': {
      const rows = await prisma.orderItem.findMany({
        where: { order: { organizationId, createdAt: { gte: range.from, lt: range.to } } },
        take: limit,
        include: { order: { select: { orderNumber: true } } },
      });
      return rows.map((i) => ({
        orderNumber: i.order.orderNumber,
        productName: i.productName,
        quantity: Number(i.quantity),
        uom: i.uom,
        unitPrice: Number(i.unitPrice),
        discountAmt: Number(i.discountAmt),
        totalAmount: Number(i.totalAmount),
      }));
    }
    case 'PRODUCTS': {
      const rows = await prisma.product.findMany({ where: { organizationId }, orderBy: { name: 'asc' }, take: limit });
      return rows.map((p) => ({
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        unitOfMeasure: p.unitOfMeasure,
        price: Number(p.price),
        costPrice: Number(p.costPrice),
        isActive: p.isActive,
      }));
    }
    case 'INVENTORY': {
      const rows = await prisma.inventoryBalance.findMany({
        where: { product: { organizationId } },
        take: limit,
        include: { product: { select: { name: true } }, location: { select: { name: true } } },
      });
      return rows.map((b) => ({
        productName: b.product.name,
        locationName: b.location.name,
        quantity: Number(b.quantity),
        reorderPoint: Number(b.reorderPoint),
      }));
    }
    case 'PAYMENTS': {
      const rows = await prisma.payment.findMany({
        where: { order: { organizationId }, createdAt: { gte: range.from, lt: range.to } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return rows.map((p) => ({
        method: p.method,
        status: p.status,
        provider: p.provider,
        amount: Number(p.amount),
        tipAmount: Number(p.tipAmount),
        createdAt: p.createdAt.toISOString(),
      }));
    }
    case 'LABOR': {
      const rows = await prisma.timeEntry.findMany({
        where: { employee: { organizationId }, clockIn: { gte: range.from, lt: range.to } },
        orderBy: { clockIn: 'desc' },
        take: limit,
        include: { employee: { select: { user: { select: { name: true } } } } },
      });
      const now = new Date();
      return rows.map((t) => ({
        employeeName: t.employee.user.name,
        hours: entryHours(
          { clockIn: t.clockIn, clockOut: t.clockOut, breakStart: t.breakStart, breakEnd: t.breakEnd },
          now,
        ),
        date: t.clockIn.toISOString(),
      }));
    }
    case 'TIPS': {
      const rows = await prisma.tip.findMany({
        where: { organizationId, createdAt: { gte: range.from, lt: range.to } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { employee: { select: { user: { select: { name: true } } } } },
      });
      return rows.map((t) => ({
        employeeName: t.employee.user.name,
        amount: Number(t.amount),
        type: t.type,
        createdAt: t.createdAt.toISOString(),
      }));
    }
    case 'CUSTOMERS': {
      const rows = await prisma.customer.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { profiles: { select: { lifetimePoints: true } } },
      });
      return rows.map((c) => ({
        name: c.name,
        email: c.email,
        totalSpent: Number(c.totalSpent),
        // Prefer the tier-bearing lifetime total; fall back to the running balance.
        lifetimePoints: c.profiles[0]?.lifetimePoints ?? c.loyaltyPoints,
        createdAt: c.createdAt.toISOString(),
      }));
    }
    case 'LOYALTY': {
      const rows = await prisma.loyaltyTransaction.findMany({
        where: { organizationId, createdAt: { gte: range.from, lt: range.to } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { customer: { select: { name: true } } },
      });
      return rows.map((t) => ({
        customerName: t.customer.name,
        points: t.points,
        reason: t.reason,
        createdAt: t.createdAt.toISOString(),
      }));
    }
    default:
      return [];
  }
}

const runSchema = z.object({
  source: z.string().min(1),
  columns: z.array(z.string().min(1)).min(1).max(40),
  filters: z.record(z.unknown()).nullable().optional(),
  groupBy: z.string().nullable().optional(),
  sortBy: z.string().nullable().optional(),
  sortDir: z.enum(['asc', 'desc']).nullable().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().min(1).max(20000).optional(),
  format: z.enum(['json', 'csv']).optional(),
});

async function execute(organizationId: string, input: z.infer<typeof runSchema>, requestedBy?: string | null) {
  const source = input.source.toUpperCase();
  const def: ReportDefinitionInput = {
    source,
    columns: input.columns,
    filters: (input.filters ?? null) as Record<string, unknown> | null,
    groupBy: input.groupBy ?? null,
    sortBy: input.sortBy ?? null,
    sortDir: (input.sortDir ?? 'desc') as 'asc' | 'desc',
  };

  const validation = validateDefinition(def);
  if (!validation.ok) {
    return { ok: false as const, status: 400, errors: validation.errors };
  }

  const range = rangeQuery(input.from, input.to);
  const started = Date.now();
  const rows = await loadRows(organizationId, source, range, Math.min(input.limit ?? 5000, 20000));
  const result = buildReport(def, rows, { limit: input.limit ?? 5000 });
  const durationMs = Date.now() - started;

  await prisma.reportRun.create({
    data: {
      organizationId,
      name: `${REPORT_SOURCES[source].label} (ad hoc)`,
      rowCount: result.rows.length,
      durationMs,
      status: 'OK',
      requestedByEmployeeId: requestedBy ?? null,
    },
  });

  return { ok: true as const, result, range, durationMs };
}

// GET /api/reports/sources - the vocabulary, with column metadata
router.get('/sources', authMiddleware, (_req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    data: Object.entries(REPORT_SOURCES).map(([key, def]) => ({ source: key, label: def.label, columns: def.columns })),
  });
});

// POST /api/reports/run - ad-hoc report
router.post('/run', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = runSchema.parse(req.body);

    const outcome = await execute(organizationId, body, req.user!.employeeId ?? null);
    if (!outcome.ok) {
      return res.status(outcome.status).json({ success: false, message: 'Invalid report definition', errors: outcome.errors });
    }

    if (body.format === 'csv') {
      const csv = toCsv(outcome.result.columns, outcome.result.rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="report-${body.source.toLowerCase()}.csv"`);
      res.send(csv);
      return;
    }

    res.json({
      success: true,
      data: {
        columns: outcome.result.columns,
        rows: outcome.result.rows,
        totals: outcome.result.totals,
        matchedRows: outcome.result.matchedRows,
        truncated: outcome.result.truncated,
        durationMs: outcome.durationMs,
      },
      meta: outcome.range,
    });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Saved definitions ─────────────────────────────────────────────────────

const definitionSchema = z.object({
  name: z.string().min(1).max(160),
  source: z.string().min(1),
  columns: z.array(z.string().min(1)).min(1).max(40),
  filters: z.record(z.unknown()).nullable().optional(),
  groupBy: z.string().nullable().optional(),
  sortBy: z.string().nullable().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  scheduleCron: z.string().max(120).nullable().optional(),
  recipients: z.array(z.string().email()).max(20).optional(),
  isActive: z.boolean().optional(),
});

// GET /api/reports/definitions
router.get('/definitions', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const rows = await prisma.reportDefinition.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } });
    res.json({ success: true, data: rows });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/reports/definitions
router.post('/definitions', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = definitionSchema.parse(req.body);

    // A saved definition is validated on the way in, so a scheduled report can
    // never fail silently at 07:00 on a Monday.
    const validation = validateDefinition({
      source: body.source,
      columns: body.columns,
      filters: (body.filters ?? null) as Record<string, unknown> | null,
      groupBy: body.groupBy ?? null,
      sortBy: body.sortBy ?? null,
      sortDir: body.sortDir ?? 'desc',
    });
    if (!validation.ok) {
      return res.status(400).json({ success: false, message: 'Invalid report definition', errors: validation.errors });
    }

    const created = await prisma.reportDefinition.create({
      data: {
        organizationId,
        name: body.name,
        source: body.source.toUpperCase(),
        columns: body.columns,
        filters: (body.filters ?? undefined) as any,
        groupBy: body.groupBy ?? null,
        sortBy: body.sortBy ?? null,
        sortDir: body.sortDir ?? 'desc',
        scheduleCron: body.scheduleCron ?? null,
        recipients: body.recipients ?? [],
        isActive: body.isActive ?? true,
      },
    });

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/reports/definitions/:id
router.put('/definitions/:id', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const body = definitionSchema.partial().parse(req.body);

    const existing = await prisma.reportDefinition.findFirst({ where: { id, organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Report definition not found' });

    const merged = {
      source: body.source ?? existing.source,
      columns: body.columns ?? existing.columns,
      filters: (body.filters === undefined ? existing.filters : body.filters) as Record<string, unknown> | null,
      groupBy: body.groupBy === undefined ? existing.groupBy : body.groupBy,
      sortBy: body.sortBy === undefined ? existing.sortBy : body.sortBy,
      sortDir: body.sortDir ?? existing.sortDir,
    };

    const validation = validateDefinition(merged);
    if (!validation.ok) {
      return res.status(400).json({ success: false, message: 'Invalid report definition', errors: validation.errors });
    }

    const updated = await prisma.reportDefinition.update({
      where: { id },
      data: {
        name: body.name ?? existing.name,
        source: merged.source.toUpperCase(),
        columns: merged.columns,
        filters: (merged.filters ?? undefined) as any,
        groupBy: merged.groupBy,
        sortBy: merged.sortBy,
        sortDir: merged.sortDir,
        scheduleCron: body.scheduleCron === undefined ? existing.scheduleCron : body.scheduleCron,
        recipients: body.recipients ?? existing.recipients,
        isActive: body.isActive ?? existing.isActive,
      },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/reports/definitions/:id
router.delete('/definitions/:id', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const existing = await prisma.reportDefinition.findFirst({ where: { id, organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Report definition not found' });

    await prisma.reportDefinition.delete({ where: { id } });
    res.json({ success: true, data: { id } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/reports/definitions/:id/run
router.post('/definitions/:id/run', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const body = z
      .object({ from: z.string().optional(), to: z.string().optional(), format: z.enum(['json', 'csv']).optional(), limit: z.number().int().min(1).max(20000).optional() })
      .parse(req.body ?? {});

    const definition = await prisma.reportDefinition.findFirst({ where: { id, organizationId } });
    if (!definition) return res.status(404).json({ success: false, message: 'Report definition not found' });

    const outcome = await execute(
      organizationId,
      {
        source: definition.source,
        columns: definition.columns,
        filters: (definition.filters ?? null) as Record<string, unknown> | null,
        groupBy: definition.groupBy,
        sortBy: definition.sortBy,
        sortDir: definition.sortDir === 'asc' ? 'asc' : 'desc',
        from: body.from,
        to: body.to,
        limit: body.limit,
      },
      req.user!.employeeId ?? null,
    );

    if (!outcome.ok) {
      return res.status(outcome.status).json({ success: false, message: 'Invalid stored definition', errors: outcome.errors });
    }

    await prisma.reportDefinition.update({ where: { id }, data: { lastRunAt: new Date() } });

    if (body.format === 'csv') {
      const csv = toCsv(outcome.result.columns, outcome.result.rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${definition.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.csv"`);
      res.send(csv);
      return;
    }

    res.json({
      success: true,
      data: {
        definition: { id: definition.id, name: definition.name },
        columns: outcome.result.columns,
        rows: outcome.result.rows,
        totals: outcome.result.totals,
        matchedRows: outcome.result.matchedRows,
        truncated: outcome.result.truncated,
        durationMs: outcome.durationMs,
      },
      meta: outcome.range,
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/reports/runs - recent executions
router.get('/runs', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const rows = await prisma.reportRun.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 100 });
    res.json({ success: true, data: rows });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
