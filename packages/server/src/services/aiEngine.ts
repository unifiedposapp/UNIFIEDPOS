// ─── AI / analytics engine — real statistics, no external ML dependency ──────
// Pure, deterministic functions so they are unit-testable (s14) and side-effect
// free. The DB-facing wrappers live in routes/aiAnalytics.ts. Everything here is
// classic, explainable statistics: least-squares regression for forecasting,
// z-score / IQR for anomaly detection, and RFM quintile scoring for segmentation
// — chosen because they are transparent to merchants and need no training data
// pipeline or model hosting.

/** A single (x, y) observation. */
export interface Point {
  x: number;
  y: number;
}

export interface RegressionResult {
  slope: number;
  intercept: number;
  r2: number;
  count: number;
  predict: (x: number) => number;
}

/**
 * Ordinary least-squares linear regression. Returns slope/intercept plus the
 * coefficient of determination (r²) as a goodness-of-fit signal (0..1). With
 * fewer than 2 points the model degrades to a flat line at the mean.
 */
export function linearRegression(points: Point[]): RegressionResult {
  const n = points.length;
  if (n === 0) {
    return { slope: 0, intercept: 0, r2: 0, count: 0, predict: () => 0 };
  }
  if (n === 1) {
    const y = points[0].y;
    return { slope: 0, intercept: y, r2: 0, count: 1, predict: () => y };
  }

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const meanY = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (const p of points) {
    const pred = slope * p.x + intercept;
    ssTot += (p.y - meanY) ** 2;
    ssRes += (p.y - pred) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));

  return { slope, intercept, r2, count: n, predict: (x: number) => slope * x + intercept };
}

/** Mean of a numeric array (0 for an empty array). */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Population standard deviation (0 for fewer than 2 values). */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export interface Anomaly {
  index: number;
  value: number;
  zScore: number;
  direction: 'HIGH' | 'LOW';
}

/**
 * Z-score anomaly detection. Flags points whose |z| exceeds `threshold`
 * (default 2.5 ≈ p<0.01 on a normal distribution). When the series has zero
 * variance nothing can be an outlier, so an empty list is returned.
 */
export function detectAnomalies(values: number[], threshold = 2.5): Anomaly[] {
  const sd = stdDev(values);
  if (sd === 0) return [];
  const m = mean(values);
  const out: Anomaly[] = [];
  values.forEach((v, index) => {
    const z = (v - m) / sd;
    if (Math.abs(z) >= threshold) {
      out.push({ index, value: v, zScore: Math.round(z * 1000) / 1000, direction: z > 0 ? 'HIGH' : 'LOW' });
    }
  });
  return out;
}

export interface ForecastDay {
  date: string;
  predicted: number;
  lower: number;
  upper: number;
}

export interface ForecastResult {
  horizonDays: number;
  trend: 'UP' | 'DOWN' | 'FLAT';
  slope: number;
  r2: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  baselineAvg: number;
  totalPredicted: number;
  forecast: ForecastDay[];
}

/**
 * Sales forecast combining a least-squares trend with a day-of-week seasonal
 * multiplier and a residual-based confidence band. `dailySeries` is oldest→newest
 * (one revenue/count value per day). The seasonal profile is learned from the
 * history itself (average per weekday ÷ overall average), so it adapts to the
 * merchant instead of hard-coding "weekends are +20%".
 */
export function forecastSeries(dailySeries: { date: string; value: number }[], horizonDays = 7): ForecastResult {
  const n = dailySeries.length;
  if (n === 0) {
    return {
      horizonDays, trend: 'FLAT', slope: 0, r2: 0, confidence: 'LOW', baselineAvg: 0, totalPredicted: 0,
      forecast: Array.from({ length: horizonDays }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() + i + 1);
        const date = d.toISOString().slice(0, 10);
        return { date, predicted: 0, lower: 0, upper: 0 };
      }),
    };
  }

  const points: Point[] = dailySeries.map((d, i) => ({ x: i, y: d.value }));
  const reg = linearRegression(points);
  const values = dailySeries.map((d) => d.value);
  const baselineAvg = mean(values);

  // Residual standard deviation → confidence band width.
  const residuals = points.map((p) => p.y - reg.predict(p.x));
  const residSd = stdDev(residuals);

  // Learn a day-of-week seasonal multiplier from history.
  const byDow: number[][] = [[], [], [], [], [], [], []];
  dailySeries.forEach((d) => {
    const dow = new Date(`${d.date}T00:00:00Z`).getUTCDay();
    byDow[dow].push(d.value);
  });
  const seasonal = byDow.map((arr) => (arr.length > 0 && baselineAvg > 0 ? mean(arr) / baselineAvg : 1));

  const lastDate = new Date(`${dailySeries[n - 1].date}T00:00:00Z`);
  const forecast: ForecastDay[] = [];
  for (let h = 1; h <= horizonDays; h += 1) {
    const x = n - 1 + h; // continue the index axis
    const trendValue = reg.predict(x);
    const d = new Date(lastDate.getTime());
    d.setUTCDate(d.getUTCDate() + h);
    const dow = d.getUTCDay();
    const seasonalValue = baselineAvg * (seasonal[dow] ?? 1);
    // Blend trend and seasonality (60/40) then clamp to non-negative.
    const predicted = Math.max(0, 0.6 * trendValue + 0.4 * seasonalValue);
    // Widen the band with the horizon (simple uncertainty growth).
    const band = 1.28 * residSd * Math.sqrt(h); // ~80% CI
    forecast.push({
      date: d.toISOString().slice(0, 10),
      predicted: Math.round(predicted * 100) / 100,
      lower: Math.round(Math.max(0, predicted - band) * 100) / 100,
      upper: Math.round((predicted + band) * 100) / 100,
    });
  }

  const trend: ForecastResult['trend'] = Math.abs(reg.slope) < baselineAvg * 0.01 ? 'FLAT' : reg.slope > 0 ? 'UP' : 'DOWN';
  // Confidence: more history + better fit ⇒ higher.
  let confidence: ForecastResult['confidence'] = 'LOW';
  if (n >= 14 && reg.r2 >= 0.3) confidence = 'HIGH';
  else if (n >= 7) confidence = 'MEDIUM';

  return {
    horizonDays,
    trend,
    slope: Math.round(reg.slope * 10000) / 10000,
    r2: Math.round(reg.r2 * 1000) / 1000,
    confidence,
    baselineAvg: Math.round(baselineAvg * 100) / 100,
    totalPredicted: Math.round(forecast.reduce((s, f) => s + f.predicted, 0) * 100) / 100,
    forecast,
  };
}

// ─── RFM segmentation ────────────────────────────────────────────────────────

export interface RfmInput {
  customerId: string;
  name?: string | null;
  recencyDays: number; // days since last purchase (lower is better)
  frequency: number; // number of orders
  monetary: number; // total spend
}

export interface RfmScore {
  customerId: string;
  name?: string | null;
  recencyDays: number;
  frequency: number;
  monetary: number;
  r: number; // 1..5
  f: number; // 1..5
  m: number; // 1..5
  rfm: number; // r*100 + f*10 + m
  segment: string;
}

/**
 * Score a value into quintiles 1..5. `higherIsBetter=false` inverts the scale
 * (used for recency, where fewer days since last visit is better). Ties get the
 * same score via a simple threshold ladder derived from sorted quantiles.
 */
function quintile(sortedAsc: number[], value: number, higherIsBetter: boolean): number {
  if (sortedAsc.length === 0) return 3;
  const q = [0.2, 0.4, 0.6, 0.8].map((p) => quantile(sortedAsc, p));
  let score = 1;
  for (let i = 0; i < q.length; i += 1) if (value > q[i]) score = i + 2;
  return higherIsBetter ? score : 6 - score;
}

/** Linear-interpolation quantile of a sorted (ascending) array. */
export function quantile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

const SEGMENT_RULES: { name: string; test: (s: { r: number; f: number; m: number }) => boolean }[] = [
  { name: 'CHAMPIONS', test: (s) => s.r >= 4 && s.f >= 4 && s.m >= 4 },
  { name: 'LOYAL', test: (s) => s.f >= 4 && s.m >= 3 },
  { name: 'POTENTIAL_LOYALIST', test: (s) => s.r >= 4 && s.f >= 2 },
  { name: 'NEW_CUSTOMERS', test: (s) => s.r >= 4 && s.f <= 2 },
  { name: 'AT_RISK', test: (s) => s.r <= 2 && s.f >= 3 && s.m >= 3 },
  { name: 'CANNOT_LOSE', test: (s) => s.r <= 2 && s.f >= 4 && s.m >= 4 },
  { name: 'HIBERNATING', test: (s) => s.r <= 2 && s.f <= 2 },
  { name: 'LOST', test: (s) => s.r <= 1 && s.f <= 1 },
];

/** Assign a named marketing segment from an RFM score triple. */
export function rfmSegment(r: number, f: number, m: number): string {
  for (const rule of SEGMENT_RULES) if (rule.test({ r, f, m })) return rule.name;
  return 'NEEDS_ATTENTION';
}

/** Score a customer list into RFM segments (pure — the caller loads the data). */
export function rfmScore(customers: RfmInput[]): RfmScore[] {
  const recencies = customers.map((c) => c.recencyDays).sort((a, b) => a - b);
  const frequencies = customers.map((c) => c.frequency).sort((a, b) => a - b);
  const monetaries = customers.map((c) => c.monetary).sort((a, b) => a - b);

  const scored = customers.map((c) => {
    const r = quintile(recencies, c.recencyDays, false);
    const f = quintile(frequencies, c.frequency, true);
    const m = quintile(monetaries, c.monetary, true);
    return {
      customerId: c.customerId,
      name: c.name ?? null,
      recencyDays: c.recencyDays,
      frequency: c.frequency,
      monetary: Math.round(c.monetary * 100) / 100,
      r, f, m,
      rfm: r * 100 + f * 10 + m,
      segment: rfmSegment(r, f, m),
    } as RfmScore;
  });

  return scored.sort((a, b) => b.rfm - a.rfm);
}

/** Aggregate a scored list into per-segment counts + revenue for the UI. */
export function segmentSummary(scored: RfmScore[]): { segment: string; customers: number; revenue: number }[] {
  const map = new Map<string, { customers: number; revenue: number }>();
  for (const s of scored) {
    const e = map.get(s.segment) || { customers: 0, revenue: 0 };
    e.customers += 1;
    e.revenue += s.monetary;
    map.set(s.segment, e);
  }
  return [...map.entries()]
    .map(([segment, v]) => ({ segment, customers: v.customers, revenue: Math.round(v.revenue * 100) / 100 }))
    .sort((a, b) => b.customers - a.customers);
}
