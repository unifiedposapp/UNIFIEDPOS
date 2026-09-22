// ─── PEER BENCHMARKING UNDER k-ANONYMITY ─────────────────────────────────────
// "Is my 22 % labour cost normal?" is the question that keeps a merchant on a
// platform. Publishing it naively is also the fastest way to leak a competitor's
// numbers: a cohort of three stores in a small town reveals exactly who earns
// what. So three guarantees are enforced here, in order, before any figure is
// returned:
//
//   K-ANONYMITY  a cohort smaller than k never publishes — not even a median.
//   CLIPPING     wild outliers are winsorised to the 5th/95th percentile so one
//                giant store cannot identify itself through the average.
//   NOISE        a Laplace draw sized by the cohort's own spread is added to the
//                published statistics, which is what makes "reconstruct one
//                member" fail while "you are in the bottom quartile" holds.
//
// `rng` is injected, so the noise is reproducible under test and genuinely
// random in production.
import { round2 } from './moneyMath.js';

export const DEFAULT_K = 5;
export const DEFAULT_EPSILON = 1.0;
export const CLIP_LOWER_PERCENTILE = 5;
export const CLIP_UPPER_PERCENTILE = 95;

export interface MetricDefinition {
  key: string;
  label: string;
  unit: 'PERCENT' | 'CURRENCY' | 'RATIO' | 'COUNT';
  higherIsBetter: boolean;
  /** Cohorts smaller than this are never reported for this metric. */
  minCohort?: number;
  description: string;
}

export const BENCHMARK_METRICS: MetricDefinition[] = [
  { key: 'avg_basket', label: 'Average basket', unit: 'CURRENCY', higherIsBetter: true, description: 'Net sales per completed transaction.' },
  { key: 'gross_margin_pct', label: 'Gross margin', unit: 'PERCENT', higherIsBetter: true, description: 'Sales less cost of goods, as a share of sales.' },
  { key: 'labor_cost_pct', label: 'Labour cost', unit: 'PERCENT', higherIsBetter: false, description: 'Wages and on-costs as a share of net sales.' },
  { key: 'shrink_pct', label: 'Shrink', unit: 'PERCENT', higherIsBetter: false, minCohort: 8, description: 'Unexplained inventory loss as a share of sales.' },
  { key: 'discount_rate_pct', label: 'Discounting', unit: 'PERCENT', higherIsBetter: false, description: 'Discount value as a share of gross sales.' },
  { key: 'attachment_rate', label: 'Attachment rate', unit: 'RATIO', higherIsBetter: true, description: 'Units per transaction — cross-sell effectiveness.' },
  { key: 'repeat_visit_rate', label: 'Repeat customers', unit: 'PERCENT', higherIsBetter: true, minCohort: 10, description: 'Share of buyers with more than one visit in the period.' },
  { key: 'online_share_pct', label: 'Digital share', unit: 'PERCENT', higherIsBetter: true, description: 'Sales placed through a non-cashier channel.' },
  { key: 'inventory_turns', label: 'Inventory turns', unit: 'RATIO', higherIsBetter: true, description: 'Cost of goods sold over average inventory value.' },
  { key: 'sales_per_day', label: 'Daily sales', unit: 'CURRENCY', higherIsBetter: true, description: 'Net settled sales per trading day.' },
];

export const BENCHMARK_METRIC_KEYS: string[] = BENCHMARK_METRICS.map((m) => m.key);

export function metricDefinition(key: unknown): MetricDefinition | null {
  return typeof key === 'string' ? BENCHMARK_METRICS.find((m) => m.key === key) || null : null;
}

/** Linear-interpolated percentile over an ascending array. */
export function percentile(sortedAsc: number[], p: number): number {
  const values = (sortedAsc || []).map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (!values.length) return 0;
  if (values.length === 1) return values[0];
  const rank = Math.min(100, Math.max(0, Number(p) || 0)) / 100;
  const pos = (values.length - 1) * rank;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return values[lower];
  return round2(values[lower] + (values[upper] - values[lower]) * (pos - lower));
}

/** Winsorise to the 5th/95th percentile so no single member is identifiable. */
export function clipOutliers(values: number[], lowerP = CLIP_LOWER_PERCENTILE, upperP = CLIP_UPPER_PERCENTILE): { values: number[]; clipped: number; floor: number; ceiling: number } {
  const sorted = [...(values || [])].filter((v) => Number.isFinite(Number(v))).map(Number).sort((a, b) => a - b);
  if (sorted.length < 4) return { values: sorted, clipped: 0, floor: sorted[0] ?? 0, ceiling: sorted[sorted.length - 1] ?? 0 };
  const floor = percentile(sorted, lowerP);
  const ceiling = percentile(sorted, upperP);
  let clipped = 0;
  const out = sorted.map((v) => {
    if (v < floor) {
      clipped++;
      return floor;
    }
    if (v > ceiling) {
      clipped++;
      return ceiling;
    }
    return v;
  });
  return { values: out, clipped, floor, ceiling };
}

/**
 * Inverse-CDF Laplace draw; scale is the noise standard-deviation-equivalent.
 * The argument of the log is floored because `rng` is allowed to return exactly
 * 0, which would otherwise send the draw to -Infinity and poison every published
 * statistic built from it.
 */
export function laplaceDraw(scale: number, rng: () => number = Math.random): number {
  const u = rng() - 0.5;
  const b = Math.max(0, Number(scale) || 0);
  if (b === 0) return 0;
  return -b * Math.sign(u) * Math.log(Math.max(Number.MIN_VALUE, 1 - 2 * Math.abs(u)));
}

export interface CohortOptions {
  k?: number;
  epsilon?: number;
  rng?: () => number;
  metricKey?: string;
  /** Skip the noise for a merchant looking at their own cohort only. */
  suppressNoise?: boolean;
}

export interface CohortResult {
  metricKey: string | null;
  publishable: boolean;
  reason: string | null;
  cohortSize: number;
  k: number;
  clipped: number;
  median: number | null;
  p10: number | null;
  p25: number | null;
  p75: number | null;
  p90: number | null;
  /** The noise magnitude actually added, so the figure can be defended. */
  noiseApplied: number;
  range: { min: number; max: number } | null;
  /** Where the asking merchant sits, when their own value is supplied. */
  self?: { value: number; percentile: number; vsMedian: number; verdict: 'AHEAD' | 'BEHIND' | 'IN_LINE' } | null;
}

function emptyResult(metricKey: string | null, k: number, reason: string, cohortSize = 0): CohortResult {
  return {
    metricKey: metricKey || null,
    publishable: false,
    reason,
    cohortSize,
    k,
    clipped: 0,
    median: null,
    p10: null,
    p25: null,
    p75: null,
    p90: null,
    noiseApplied: 0,
    range: null,
    self: null,
  };
}

/**
 * Build one published cohort cell. The asking merchant's own value is excluded
 * from the noise budget they see (they already know it) but kept inside the
 * cohort so small operators are not systematically compared against a peer group
 * they are not part of.
 */
export function buildCohort(values: number[], options: CohortOptions & { selfValue?: number | null } = {}): CohortResult {
  const k = Math.max(2, Math.trunc(Number(options.k) || DEFAULT_K));
  const epsilon = Math.max(0.05, Number(options.epsilon) || DEFAULT_EPSILON);
  const metric = metricDefinition(options.metricKey);
  const minCohort = Math.max(k, Math.trunc(Number(metric?.minCohort) || 0));

  const clean = (values || []).map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (clean.length < minCohort) {
    return emptyResult(options.metricKey ?? null, minCohort, clean.length ? 'COHORT_TOO_SMALL' : 'NO_DATA', clean.length);
  }

  const { values: clippedValues, clipped } = clipOutliers(clean);
  const sorted = clippedValues.sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  // Sensitivity of a median under the Laplace mechanism, from the clipped spread.
  const scale = Math.max(0.0001, (max - min) / sorted.length / epsilon);
  const noise = options.suppressNoise ? 0 : round2(laplaceDraw(scale, options.rng));

  const shift = (v: number) => round2(v + noise);
  const result: CohortResult = {
    metricKey: options.metricKey ?? null,
    publishable: true,
    reason: null,
    cohortSize: sorted.length,
    k: minCohort,
    clipped,
    median: shift(percentile(sorted, 50)),
    p10: shift(percentile(sorted, 10)),
    p25: shift(percentile(sorted, 25)),
    p75: shift(percentile(sorted, 75)),
    p90: shift(percentile(sorted, 90)),
    noiseApplied: noise,
    range: { min: round2(min), max: round2(max) },
    self: null,
  };

  if (options.selfValue != null && Number.isFinite(Number(options.selfValue))) {
    const selfValue = Number(options.selfValue);
    const rank = sorted.filter((v) => v <= selfValue).length / sorted.length;
    const percentileValue = round2(rank * 100);
    const vsMedian = round2(selfValue - (result.median ?? 0));
    const better = metric?.higherIsBetter ?? true;
    const verdict = Math.abs(result.noiseApplied) >= Math.abs(vsMedian) ? 'IN_LINE' : better === vsMedian > 0 ? 'AHEAD' : 'BEHIND';
    result.self = { value: round2(selfValue), percentile: percentileValue, vsMedian, verdict };
  }

  return result;
}

/** Suppress any cell of a grouped table that cannot clear k. */
export function suppressSmallCells<T extends { count: number }>(rows: T[], k = DEFAULT_K): { published: T[]; suppressed: T[] } {
  const published: T[] = [];
  const suppressed: T[] = [];
  for (const row of rows || []) (Number(row?.count) >= k ? published : suppressed).push(row);
  return { published, suppressed };
}

/**
 * Composite key for a cohort: same market, same trade, same size band. Size
 * banding matters — comparing a kiosk to a hypermarket is not a benchmark.
 */
export function revenueBand(annualRevenue: number): 'MICRO' | 'SMALL' | 'MEDIUM' | 'LARGE' | 'ENTERPRISE' {
  const value = Math.max(0, Number(annualRevenue) || 0);
  if (value < 100_000) return 'MICRO';
  if (value < 1_000_000) return 'SMALL';
  if (value < 10_000_000) return 'MEDIUM';
  if (value < 100_000_000) return 'LARGE';
  return 'ENTERPRISE';
}

export function cohortKey(countryCode: string | null | undefined, industry: string | null | undefined, annualRevenue: number): string {
  return [String(countryCode || 'WW').toUpperCase(), String(industry || 'RETAIL').toUpperCase(), revenueBand(annualRevenue)].join('|');
}

/** One-line narrative the dashboard shows instead of a bare number. */
export function benchmarkHeadline(result: CohortResult, metricKey?: string | null): string {
  const metric = metricDefinition(metricKey || result.metricKey);
  const label = metric?.label || result.metricKey || 'this metric';
  if (!result.publishable) {
    return result.reason === 'NO_DATA' ? `No ${label} benchmark yet — not enough peers are reporting.` : `Not enough comparable stores to publish ${label} safely.`;
  }
  if (!result.self) return `${label}: peer median ${result.median} across ${result.cohortSize} stores.`;
  const direction = result.self.verdict === 'AHEAD' ? 'ahead of' : result.self.verdict === 'BEHIND' ? 'behind' : 'level with';
  return `${label}: you are ${direction} the peer median by ${Math.abs(result.self.vsMedian)} (percentile ${result.self.percentile} of ${result.cohortSize} stores).`;
}

/**
 * How much of the network is contributing, which decides whether the benchmark
 * is worth showing at all. A 60 % participation rate is a real signal; 4 % is
 * survivor bias.
 */
export function participationRate(reporting: number, eligible: number): { rate: number; representative: boolean } {
  const total = Math.max(0, Math.trunc(Number(eligible) || 0));
  const count = Math.min(total, Math.max(0, Math.trunc(Number(reporting) || 0)));
  const rate = total > 0 ? round2((count / total) * 100) : 0;
  return { rate, representative: total >= DEFAULT_K && rate >= 25 };
}
