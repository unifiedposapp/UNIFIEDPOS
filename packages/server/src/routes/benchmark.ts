// ─── Peer benchmarking: compare yourself, never expose yourself ──────────────
// Merchants act on "your discount rate is worse than your peers", so the number
// has to be safe to publish. Three rules do that: a cohort smaller than k is
// never released, outliers are clipped to the 5th/95th percentile so no member
// defines the edge, and Laplace noise scaled to sensitivity/epsilon is added to
// each statistic. The merchant's own exact value is the one number that is never
// noised, because they already know it.

import { Router, Response } from 'express';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import {
  BENCHMARK_METRICS,
  BENCHMARK_METRIC_KEYS,
  DEFAULT_EPSILON,
  DEFAULT_K,
  metricDefinition,
  benchmarkHeadline,
  participationRate,
  cohortKey,
} from '../services/benchmark.js';
import { buildCohortForOrg, bandFor, extractOrgMetrics } from '../services/globalTasks.js';

const router = Router();

function windowDays(req: AuthRequest): number {
  return Math.min(365, Math.max(7, Number(req.query.windowDays) || 90));
}

// GET /api/benchmark/metrics - the published question set
router.get('/metrics', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    res.json({
      success: true,
      data: {
        metrics: BENCHMARK_METRICS,
        keys: BENCHMARK_METRIC_KEYS,
        privacy: { minCohort: DEFAULT_K, epsilon: DEFAULT_EPSILON, clipping: '5th/95th percentile' },
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/benchmark - one metric, this tenant against its noised cohort
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const metricKey = String(req.query.metric || 'avg_basket');
    const definition = metricDefinition(metricKey);
    if (!definition) return res.status(400).json({ success: false, message: `Unknown metric "${metricKey}"`, data: { available: BENCHMARK_METRIC_KEYS } });
    const days = windowDays(req);
    const { cell, selfValue, participation } = await buildCohortForOrg(organizationId, metricKey, days);
    const k = Math.max(DEFAULT_K, definition.minCohort || 0);
    const publishable = cell.cohort.publishable && cell.size >= k;
    res.json({
      success: true,
      data: {
        metric: definition,
        windowDays: days,
        self: selfValue,
        cohort: publishable ? cell.cohort : null,
        headline: publishable ? benchmarkHeadline(cell.cohort, metricKey) : 'Not enough comparable businesses yet to publish a safe benchmark.',
        // Deliberately reported even when suppressed, so a merchant understands
        // why the chart is empty instead of assuming the feature is broken.
        privacy: { cohortSize: cell.size, minimumRequired: k, publishable, epsilon: DEFAULT_EPSILON, noiseApplied: cell.cohort.noiseApplied, clipped: cell.cohort.clipped },
        participation: { ...participation, ...participationRate(participation.reporting, participation.eligible) },
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/benchmark/all - every metric at once, for the ranking page
router.get('/all', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const days = windowDays(req);
    const rows: Record<string, unknown>[] = [];
    for (const definition of BENCHMARK_METRICS) {
      const { cell, selfValue } = await buildCohortForOrg(organizationId, definition.key, days);
      const k = Math.max(DEFAULT_K, definition.minCohort || 0);
      const publishable = cell.cohort.publishable && cell.size >= k;
      rows.push({
        metricKey: definition.key,
        label: definition.label,
        unit: definition.unit,
        higherIsBetter: definition.higherIsBetter,
        self: selfValue,
        median: publishable ? cell.cohort.median : null,
        p25: publishable ? cell.cohort.p25 : null,
        p75: publishable ? cell.cohort.p75 : null,
        percentile: publishable ? cell.cohort.self?.percentile ?? null : null,
        cohortSize: publishable ? cell.size : null,
        publishable,
        headline: publishable ? benchmarkHeadline(cell.cohort, definition.key) : 'Cohort too small to publish',
      });
    }
    const published = rows.filter((r) => r.publishable).length;
    res.json({ success: true, data: { metrics: rows, published, total: rows.length, windowDays: days, worstToFirst: rows.filter((r) => r.publishable).sort((a, b) => Number(a.percentile || 0) - Number(b.percentile || 0)).slice(0, 3) } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/benchmark/profile - how this tenant is grouped, shown for transparency
router.get('/profile', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const days = windowDays(req);
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const metrics = await extractOrgMetrics(organizationId, from, to);
    res.json({
      success: true,
      data: {
        countryCode: metrics.countryCode,
        industry: metrics.industry,
        annualRevenueProxy: metrics.annualRevenue,
        band: bandFor(metrics.annualRevenue),
        cohortKey: cohortKey(metrics.countryCode, metrics.industry, metrics.annualRevenue),
        values: metrics.values,
        windowDays: days,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/benchmark/snapshots - the last computed cells, cached for cheap dashboards
router.get('/snapshots', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const snapshots = await prisma.benchmarkSnapshot.findMany({ where: { organizationId }, orderBy: { generatedAt: 'desc' }, take: 60 });
    res.json({
      success: true,
      data: {
        snapshots: snapshots.map((s) => ({
          ...s,
          median: s.median == null ? null : Number(s.median),
          p10: s.p10 == null ? null : Number(s.p10),
          p25: s.p25 == null ? null : Number(s.p25),
          p75: s.p75 == null ? null : Number(s.p75),
          p90: s.p90 == null ? null : Number(s.p90),
          noiseApplied: Number(s.noiseApplied),
        })),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/benchmark/cohort/:metric - the shape of the market, no individual values
router.get('/cohort/:metric', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const definition = metricDefinition(req.params.metric);
    if (!definition) return res.status(400).json({ success: false, message: 'Unknown metric' });
    const { cell } = await buildCohortForOrg(organizationId, definition.key, windowDays(req));
    const k = Math.max(DEFAULT_K, definition.minCohort || 0);
    if (!(cell.cohort.publishable && cell.size >= k)) {
      return res.status(200).json({ success: true, data: { publishable: false, cohortSize: cell.size, minimumRequired: k, message: 'Suppressed to protect members' } });
    }
    // Only the published quantiles are returned - a shape built from numbers that
    // already carry noise, so the curve cannot be walked back to any one member.
    res.json({
      success: true,
      data: {
        metric: definition,
        cohortSize: cell.cohort.cohortSize,
        shape: { p10: cell.cohort.p10, p25: cell.cohort.p25, median: cell.cohort.median, p75: cell.cohort.p75, p90: cell.cohort.p90 },
        range: cell.cohort.range,
        verdict: cell.cohort.self?.verdict ?? null,
        noiseApplied: cell.cohort.noiseApplied,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
