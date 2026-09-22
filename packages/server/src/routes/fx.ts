// ─── FX / EXCHANGE RATES ─────────────────────────────────────────────────────
// The API behind the currency layer: import and read a tenant's exchange-rate
// table, convert an amount with full provenance (which rate, from where, how
// old), and report what the provider is configured to do. All the arithmetic
// lives in the pure `exchangeRates` service so this route is only Prisma reads
// and writes plus a thin response shape.

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { isValidCurrency, normalizeCurrency, CURRENCY_CATALOG } from '../data/currencies.js';
import {
  convert,
  resolveRate,
  staticRates,
  fetchLiveRates,
  fxProviderConfigured,
  type RateRow,
} from '../services/exchangeRates.js';

const router = Router();

const rateInputSchema = z.object({
  from: z.string().length(3),
  to: z.string().length(3),
  rate: z.number().positive().max(1e12),
  effectiveDate: z.string().datetime({ offset: true }).or(z.string().length(10)).optional(),
  source: z.string().max(60).optional(),
});

// GET /api/fx/rates - the tenant's stored rate table (latest row per pair)
router.get('/rates', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const where: Record<string, unknown> = { organizationId };
    const pair = req.query.pair ? String(req.query.pair) : '';
    if (pair && /^[A-Za-z]{3}[_/-][A-Za-z]{3}$/.test(pair)) {
      const [from, to] = pair.toUpperCase().split(/[_/-]/);
      where.from = from;
      where.to = to;
    }
    const rows = await prisma.currencyRate.findMany({
      where,
      orderBy: { effectiveDate: 'desc' },
      take: Math.min(Number(req.query.limit) || 500, 5000),
    });
    res.json({
      success: true,
      data: {
        rates: rows.map((r) => ({
          id: r.id,
          from: r.from,
          to: r.to,
          rate: Number(r.rate),
          source: r.source,
          fetchedAt: r.fetchedAt,
          effectiveDate: r.effectiveDate,
        })),
        count: rows.length,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/fx/import - bulk upsert rates (a manual import or a provider pull)
const importSchema = z.object({
  rates: z.array(rateInputSchema).min(1).max(5000),
  source: z.string().max(60).optional(),
  fetchLive: z.boolean().optional(),
});

router.post('/import', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(importSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof importSchema>;
    let incoming: RateRow[] = body.rates.map((r) => ({
      from: r.from.toUpperCase(),
      to: r.to.toUpperCase(),
      rate: r.rate,
      source: (r.source || body.source || 'MANUAL').slice(0, 60),
      effectiveDate: r.effectiveDate ? new Date(r.effectiveDate) : new Date(),
    }));

    // A live pull, if requested, is validated before anything is written.
    let providerNote: string | null = null;
    if (body.fetchLive) {
      if (!fxProviderConfigured()) {
        return res.status(400).json({ success: false, message: 'No FX provider configured (set FX_RATES_URL)' });
      }
      const live = await fetchLiveRates();
      if (!live) return res.status(502).json({ success: false, message: 'FX provider unreachable; nothing imported' });
      incoming = [...incoming, ...live];
      providerNote = `${live.length} live quotes`;
    }

    let upserted = 0;
    for (const r of incoming) {
      if (!isValidCurrency(r.from) || !isValidCurrency(r.to) || !(r.rate > 0)) continue;
      const effectiveDate = r.effectiveDate ? new Date(r.effectiveDate) : new Date();
      await prisma.currencyRate.upsert({
        where: { organizationId_from_to_effectiveDate: { organizationId, from: r.from, to: r.to, effectiveDate } },
        create: {
          organizationId,
          from: r.from,
          to: r.to,
          rate: r.rate,
          source: (r.source || 'MANUAL').slice(0, 60),
          fetchedAt: new Date(),
          effectiveDate,
        },
        update: { rate: r.rate, source: (r.source || 'MANUAL').slice(0, 60), fetchedAt: new Date() },
      });
      upserted += 1;
    }
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'FX_RATES_IMPORTED',
      resourceType: 'CURRENCY_RATE',
      newValue: { upserted, provider: providerNote },
    });
    res.status(201).json({ success: true, data: { upserted, provider: providerNote } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/fx/provider - what the FX layer is wired to and what it can price
router.get('/provider', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const count = await prisma.currencyRate.count({ where: { organizationId } });
    const latest = await prisma.currencyRate.findFirst({ where: { organizationId }, orderBy: { fetchedAt: 'desc' }, select: { fetchedAt: true, source: true } });
    const rows = count ? await prisma.currencyRate.findMany({ where: { organizationId }, orderBy: { effectiveDate: 'desc' }, take: 5000 }) : [];
    const rateRows: RateRow[] = rows.map((r) => ({ from: r.from, to: r.to, rate: Number(r.rate), source: r.source, effectiveDate: r.effectiveDate }));
    res.json({
      success: true,
      data: {
        configured: fxProviderConfigured(),
        env: fxProviderConfigured() ? 'FX_RATES_URL' : null,
        storedRates: count,
        lastFetchedAt: latest?.fetchedAt ?? null,
        lastSource: latest?.source ?? null,
        currencies: CURRENCY_CATALOG.length,
        fallback: 'STATIC',
        sample: convert(100, 'USD', 'EUR', rateRows.length ? rateRows : staticRates(), { maxAgeDays: 1 }),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/fx/convert - convert an amount, returning the rate provenance
const convertSchema = z.object({
  amount: z.number().finite(),
  from: z.string(),
  to: z.string(),
  at: z.string().datetime({ offset: true }).or(z.string().length(10)).optional(),
  maxAgeDays: z.number().int().min(0).max(3650).optional(),
});

router.post('/convert', authMiddleware, validateRequest(convertSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof convertSchema>;
    const from = normalizeCurrency(body.from);
    const to = normalizeCurrency(body.to);
    if (!from || !to) return res.status(400).json({ success: false, message: 'from/to must be valid ISO 4217 codes' });
    const rows = await prisma.currencyRate.findMany({ where: { organizationId }, orderBy: { effectiveDate: 'desc' }, take: 5000 });
    const rateRows: RateRow[] = rows.map((r) => ({ from: r.from, to: r.to, rate: Number(r.rate), source: r.source, effectiveDate: r.effectiveDate }));
    const hasStored = rateRows.length > 0;
    const resolved = resolveRate(from, to, hasStored ? rateRows : [...rateRows, ...staticRates()]);
    if (!resolved) {
      return res.status(422).json({ success: false, message: `No rate available for ${from}->${to}; import one first`, data: { from, to } });
    }
    const result = convert(body.amount, from, to, hasStored ? rateRows : staticRates(), { maxAgeDays: body.maxAgeDays ?? 1 });
    res.json({
      success: true,
      data: {
        ...result,
        basis: hasStored ? 'STORED' : 'STATIC',
        asOfIso: body.at ?? result.asOf,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
