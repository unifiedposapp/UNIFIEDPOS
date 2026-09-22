import { describe, it, expect } from 'vitest';
import {
  percentile,
  clipOutliers,
  laplaceDraw,
  buildCohort,
  suppressSmallCells,
  revenueBand,
  cohortKey,
  benchmarkHeadline,
  participationRate,
  metricDefinition,
  BENCHMARK_METRICS,
  BENCHMARK_METRIC_KEYS,
  DEFAULT_K,
  DEFAULT_EPSILON,
  CLIP_LOWER_PERCENTILE,
  CLIP_UPPER_PERCENTILE,
  type CohortResult,
} from '../src/services/benchmark';

/** Ten peers from 1 to 10: clipping pulls the two ends in, leaving 1.45 … 9.55. */
const TEN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** rng() === 0.75 makes the Laplace draw exactly scale · ln 2. */
const rng75 = () => 0.75;

describe('percentiles', () => {
  it('interpolates linearly between neighbours', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([1, 2, 3, 4], 25)).toBe(1.75);
    expect(percentile([1, 2, 3, 4], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4], 100)).toBe(4);
  });

  it('clamps a nonsense rank and ignores junk', () => {
    expect(percentile([1, 2, 3], 150)).toBe(3);
    expect(percentile([1, 2, 3], -10)).toBe(1);
    expect(percentile([1, NaN, 3], 50)).toBe(2);
    expect(percentile([], 50)).toBe(0);
    expect(percentile([7], 5)).toBe(7);
  });
});

describe('outlier clipping', () => {
  it('winsorises the tails so no member identifies itself by its size', () => {
    const clipped = clipOutliers([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
    expect(clipped.clipped).toBe(2);
    expect(clipped.floor).toBeCloseTo(1.45, 2);
    expect(clipped.values[0]).toBeCloseTo(1.45, 2);
    expect(clipped.values[clipped.values.length - 1]).toBeCloseTo(59.05, 2);
    // The giant store is now indistinguishable from its second-largest peer.
    expect(clipped.values.every((v) => v <= clipped.ceiling)).toBe(true);
  });

  it('leaves a group too small to have meaningful tails alone', () => {
    expect(clipOutliers([3, 1, 2])).toEqual({ values: [1, 2, 3], clipped: 0, floor: 1, ceiling: 3 });
    expect(clipOutliers([]).floor).toBe(0);
  });

  it('drops non-numeric values before ranking', () => {
    const clipped = clipOutliers([4, 1, 3, 2, NaN as never]);
    expect(clipped.values).toHaveLength(4);
    expect(clipped.clipped).toBe(2);
  });

  it('uses the published percentile pair by default', () => {
    expect(CLIP_LOWER_PERCENTILE).toBe(5);
    expect(CLIP_UPPER_PERCENTILE).toBe(95);
  });
});

describe('laplace noise', () => {
  it('is symmetric around the median draw', () => {
    expect(laplaceDraw(2, () => 0.75)).toBeCloseTo(2 * Math.LN2, 8);
    expect(laplaceDraw(2, () => 0.25)).toBeCloseTo(-2 * Math.LN2, 8);
  });

  it('is zero with no budget or a perfectly central draw', () => {
    expect(laplaceDraw(0, rng75)).toBe(0);
    expect(laplaceDraw(-5, rng75)).toBe(0); // negative scale clamps to zero
    expect(laplaceDraw(3, () => 0.5)).toBeCloseTo(0, 10);
  });

  it('stays finite when the RNG returns its lowest possible value', () => {
    // A raw inverse-CDF would compute log(0) here and hand back -Infinity,
    // which would then propagate into every published statistic.
    expect(Number.isFinite(laplaceDraw(1, () => 0))).toBe(true);
    expect(Number.isFinite(laplaceDraw(1, () => 0.9999999))).toBe(true);
  });
});

describe('cohort building', () => {
  it('refuses to publish a cohort smaller than k', () => {
    const result = buildCohort([1, 2, 3], { rng: rng75 });
    expect(result.publishable).toBe(false);
    expect(result.reason).toBe('COHORT_TOO_SMALL');
    expect(result.k).toBe(DEFAULT_K);
    expect(result.cohortSize).toBe(3);
    expect(result.median).toBeNull();
    expect(result.p25).toBeNull();
  });

  it('distinguishes nobody reporting from too few reporting', () => {
    expect(buildCohort([], {}).reason).toBe('NO_DATA');
    expect(buildCohort([], {}).cohortSize).toBe(0);
  });

  it('honours a stricter per-metric floor and advertises it', () => {
    const result = buildCohort(TEN.slice(0, 6), { metricKey: 'shrink_pct', rng: rng75 });
    expect(result.publishable).toBe(false);
    expect(result.k).toBe(8);
    expect(metricDefinition('shrink_pct')?.minCohort).toBe(8);
  });

  it('never lets a caller lower k below two', () => {
    expect(buildCohort([1, 2], { k: 1, rng: rng75 }).publishable).toBe(true);
    expect(buildCohort([1, 2], { k: 0, rng: rng75 }).publishable).toBe(false);
  });

  it('reports the exact statistics when the merchant is looking at themselves', () => {
    const result = buildCohort(TEN, { suppressNoise: true, metricKey: 'avg_basket' });
    expect(result.publishable).toBe(true);
    expect(result.noiseApplied).toBe(0);
    expect(result.clipped).toBe(2);
    expect(result.cohortSize).toBe(10);
    expect(result.median).toBe(5.5);
    expect(result.range).toEqual({ min: 1.45, max: 9.55 });
    expect(result.p25).toBeLessThan(result.median!);
    expect(result.p75).toBeGreaterThan(result.median!);
  });

  it('shifts every published figure by the same recorded noise', () => {
    const clean = buildCohort(TEN, { suppressNoise: true, metricKey: 'avg_basket' });
    const noisy = buildCohort(TEN, { metricKey: 'avg_basket', rng: rng75 });
    // scale = spread / n / epsilon = 8.1 / 10 = 0.81 → noise = 0.81 · ln 2.
    expect(noisy.noiseApplied).toBeCloseTo(0.56, 2);
    expect(noisy.median).toBeCloseTo(clean.median! + noisy.noiseApplied, 2);
    expect(noisy.p90).toBeCloseTo(clean.p90! + noisy.noiseApplied, 2);
  });

  it('publishes more noise for a tighter privacy budget', () => {
    const loose = buildCohort(TEN, { metricKey: 'avg_basket', epsilon: 2, rng: rng75 });
    const tight = buildCohort(TEN, { metricKey: 'avg_basket', epsilon: 0.5, rng: rng75 });
    expect(Math.abs(tight.noiseApplied)).toBeGreaterThan(Math.abs(loose.noiseApplied));
  });

  it('places the merchant against the cohort in the metric\'s own direction', () => {
    const ahead = buildCohort(TEN, { metricKey: 'avg_basket', selfValue: 8, suppressNoise: true });
    expect(ahead.self).toEqual({ value: 8, percentile: 80, vsMedian: 2.5, verdict: 'AHEAD' });
    // The same raw number is a failure on a cost ratio, where lower is better.
    const behind = buildCohort(TEN, { metricKey: 'labor_cost_pct', selfValue: 8, suppressNoise: true });
    expect(behind.self?.verdict).toBe('BEHIND');
  });

  it('calls a gap smaller than the noise in-line rather than inventing a lead', () => {
    const result = buildCohort(TEN, { metricKey: 'avg_basket', selfValue: 5.6, rng: rng75 });
    expect(Math.abs(result.noiseApplied)).toBeGreaterThanOrEqual(Math.abs(result.self!.vsMedian));
    expect(result.self?.verdict).toBe('IN_LINE');
  });

  it('has no self placement when no value was supplied', () => {
    expect(buildCohort(TEN, { rng: rng75 }).self).toBeNull();
    expect(buildCohort(TEN, { selfValue: null, rng: rng75 }).self).toBeNull();
  });

  it('rejects junk input rather than publishing NaN', () => {
    const result = buildCohort([1, 2, 3, 4, 5, NaN as never, Infinity as never], { rng: rng75 });
    expect(result.cohortSize).toBe(5);
    expect(Number.isFinite(result.median!)).toBe(true);
  });
});

describe('grouped tables', () => {
  it('suppresses every cell that cannot clear k', () => {
    const rows = [{ label: 'a', count: 5 }, { label: 'b', count: 4 }, { label: 'c', count: 10 }];
    const { published, suppressed } = suppressSmallCells(rows);
    expect(published.map((r) => r.label)).toEqual(['a', 'c']);
    expect(suppressed.map((r) => r.label)).toEqual(['b']);
    expect(suppressSmallCells(rows, 2).published).toHaveLength(3);
    expect(suppressSmallCells([], DEFAULT_K)).toEqual({ published: [], suppressed: [] });
  });
});

describe('cohort keys', () => {
  it('bands size before comparison, because a kiosk is not a hypermarket', () => {
    expect(revenueBand(0)).toBe('MICRO');
    expect(revenueBand(99_999)).toBe('MICRO');
    expect(revenueBand(100_000)).toBe('SMALL');
    expect(revenueBand(999_999)).toBe('SMALL');
    expect(revenueBand(1_000_000)).toBe('MEDIUM');
    expect(revenueBand(10_000_000)).toBe('LARGE');
    expect(revenueBand(100_000_000)).toBe('ENTERPRISE');
    expect(revenueBand(-1)).toBe('MICRO');
  });

  it('normalises missing market and trade into a real bucket', () => {
    expect(cohortKey('us', 'restaurant', 5_000_000)).toBe('US|RESTAURANT|MEDIUM');
    expect(cohortKey(null, undefined, 10_000)).toBe('WW|RETAIL|MICRO');
  });
});

describe('headline', () => {
  const suppressed = (reason: string | null): CohortResult => ({
    ...buildCohort([], {}),
    reason,
    metricKey: 'avg_basket',
  });

  it('explains a suppression as a privacy outcome, not an error', () => {
    expect(benchmarkHeadline(suppressed('NO_DATA'))).toBe('No Average basket benchmark yet — not enough peers are reporting.');
    expect(benchmarkHeadline(suppressed('COHORT_TOO_SMALL'))).toBe('Not enough comparable stores to publish Average basket safely.');
    expect(benchmarkHeadline({ ...suppressed('NO_DATA'), metricKey: null })).toContain('this metric');
  });

  it('narrates the median, then the merchant\'s own standing', () => {
    const bare = buildCohort(TEN, { metricKey: 'gross_margin_pct', suppressNoise: true });
    expect(benchmarkHeadline(bare)).toBe('Gross margin: peer median 5.5 across 10 stores.');
    const withSelf = buildCohort(TEN, { metricKey: 'gross_margin_pct', selfValue: 8, suppressNoise: true });
    expect(benchmarkHeadline(withSelf)).toBe('Gross margin: you are ahead of the peer median by 2.5 (percentile 80 of 10 stores).');
    const behind = buildCohort(TEN, { metricKey: 'shrink_pct', selfValue: 8, suppressNoise: true });
    expect(benchmarkHeadline(behind)).toContain('behind the peer median');
  });
});

describe('participation', () => {
  it('calls a well-covered cohort representative and a thin one biased', () => {
    expect(participationRate(3, 10)).toEqual({ rate: 30, representative: true });
    expect(participationRate(1, 10)).toEqual({ rate: 10, representative: false });
    expect(participationRate(50, 4).rate).toBe(100); // over-count clamps to the eligible pool
    expect(participationRate(50, 4).representative).toBe(false); // but a 4-store network is still too small
    expect(participationRate(0, 0)).toEqual({ rate: 0, representative: false });
    expect(participationRate(-5, 10).rate).toBe(0);
  });

  it('sets the published defaults where the UI reads them', () => {
    expect(DEFAULT_K).toBe(5);
    expect(DEFAULT_EPSILON).toBe(1);
    expect(BENCHMARK_METRICS).toHaveLength(10);
    expect(BENCHMARK_METRIC_KEYS).toContain('inventory_turns');
    expect(metricDefinition('nope')).toBeNull();
    expect(metricDefinition(undefined)).toBeNull();
  });
});
