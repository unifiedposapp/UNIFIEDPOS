// ─── AI analytics depth (§ forecasting / anomaly / RFM) ──────────────────────
// Mounted at /api/ai AFTER the core ai router (fall-through). These endpoints do
// the real statistics: least-squares forecasting with learned seasonality,
// z-score anomaly detection, and RFM customer segmentation — all backed by the
// pure functions in services/aiEngine.ts (unit-tested). An optional LLM summary
// (services/llm.ts) augments answers only when an API key is configured.

import { Router, Response } from 'express';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { forecastSeries, detectAnomalies, rfmScore, segmentSummary, mean, stdDev } from '../services/aiEngine.js';
import { completeChat, isLlmConfigured } from '../services/llm.js';

const router = Router();

const SUCCESS = ['PAID', 'COMPLETED'];
const DAY = 24 * 60 * 60 * 1000;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Build a dense oldest→newest daily series (missing days = 0) over `days`. */
async function buildDailySeries(orgId: string, days: number, metric: 'revenue' | 'orders'): Promise<{ date: string; value: number }[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setTime(start.getTime() - (days - 1) * DAY);

  const orders = await prisma.order.findMany({
    where: { organizationId: orgId, status: { in: SUCCESS }, createdAt: { gte: start } },
    select: { createdAt: true, totalAmount: true },
  });

  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start.getTime() + i * DAY);
    buckets.set(dayKey(d), 0);
  }
  for (const o of orders) {
    const k = dayKey(o.createdAt);
    if (!buckets.has(k)) continue;
    buckets.set(k, metric === 'revenue' ? (buckets.get(k) || 0) + Number(o.totalAmount) : (buckets.get(k) || 0) + 1);
  }
  return [...buckets.entries()].map(([date, value]) => ({ date, value: Math.round(value * 100) / 100 }));
}

// GET /api/ai/forecast?days=90&horizon=7&metric=revenue
router.get('/forecast', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const historyDays = Math.min(365, Math.max(14, Number(req.query.days) || 60));
    const horizon = Math.min(90, Math.max(1, Number(req.query.horizon) || 7));
    const metric = req.query.metric === 'orders' ? 'orders' : 'revenue';

    const series = await buildDailySeries(orgId, historyDays, metric);
    const result = forecastSeries(series, horizon);
    res.json({ success: true, data: { metric, historyDays, ...result, series } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/ai/anomalies?days=60&metric=revenue&threshold=2.5
router.get('/anomalies', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const days = Math.min(365, Math.max(7, Number(req.query.days) || 60));
    const threshold = Number(req.query.threshold) > 0 ? Number(req.query.threshold) : 2.5;
    const metric = req.query.metric === 'orders' ? 'orders' : 'revenue';

    const series = await buildDailySeries(orgId, days, metric);
    const values = series.map((s) => s.value);
    const anomalies = detectAnomalies(values, threshold).map((a) => ({ ...a, date: series[a.index].date }));
    res.json({
      success: true,
      data: {
        metric,
        days,
        threshold,
        stats: { mean: Math.round(mean(values) * 100) / 100, stdDev: Math.round(stdDev(values) * 100) / 100, count: values.length },
        anomalies,
        series,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/ai/segments?limit=500 — RFM customer segmentation
router.get('/segments', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const limit = Math.min(5000, Math.max(10, Number(req.query.limit) || 500));
    const now = Date.now();

    const customers = await prisma.customer.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, totalSpent: true, totalOrders: true, lastVisitAt: true, createdAt: true },
      take: limit,
      orderBy: { totalSpent: 'desc' },
    });

    const inputs = customers.map((c) => {
      const last = c.lastVisitAt || c.createdAt;
      const recencyDays = last ? Math.max(0, Math.round((now - new Date(last).getTime()) / DAY)) : 999;
      return { customerId: c.id, name: c.name, recencyDays, frequency: c.totalOrders || 0, monetary: Number(c.totalSpent || 0) };
    });

    const scored = rfmScore(inputs);
    res.json({
      success: true,
      data: {
        count: scored.length,
        summary: segmentSummary(scored),
        customers: scored,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/ai/copilot-summary — optional LLM augmentation of a metrics snapshot.
// Body: { metrics: any }. Returns { provider: 'llm'|'none', text }.
router.post('/copilot-summary', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!isLlmConfigured()) {
      return res.json({ success: true, data: { provider: 'none', text: null, note: 'LLM not configured — set LLM_API_KEY to enable AI-written summaries.' } });
    }
    const orgId = req.user!.organizationId!;
    const series = await buildDailySeries(orgId, 30, 'revenue');
    const fc = forecastSeries(series, 7);
    const anomalies = detectAnomalies(series.map((s) => s.value));
    const context = req.body?.metrics ? JSON.stringify(req.body.metrics) : JSON.stringify({ last30: series.slice(-14), forecast: fc, anomalies });

    const result = await completeChat([
      { role: 'system', content: 'You are a concise retail analytics assistant for a point-of-sale system. Give the merchant 2-4 actionable sentences based only on the provided data. No preamble.' },
      { role: 'user', content: `Summarize performance and the single most important action to take. Data: ${context}` },
    ]);

    if (!result) {
      return res.json({ success: true, data: { provider: 'none', text: null, note: 'LLM request failed — using the deterministic engine.' } });
    }
    res.json({ success: true, data: { provider: 'llm', model: result.model, text: result.text } });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
