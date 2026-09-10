import { describe, it, expect } from 'vitest';
import {
  linearRegression,
  mean,
  stdDev,
  detectAnomalies,
  quantile,
  forecastSeries,
  rfmSegment,
  rfmScore,
  segmentSummary,
} from '../src/services/aiEngine';

describe('linearRegression', () => {
  it('fits a perfect line exactly', () => {
    const points = [0, 1, 2, 3, 4].map((x) => ({ x, y: 2 * x + 1 }));
    const r = linearRegression(points);
    expect(r.slope).toBeCloseTo(2, 6);
    expect(r.intercept).toBeCloseTo(1, 6);
    expect(r.r2).toBeCloseTo(1, 6);
    expect(r.count).toBe(5);
    expect(r.predict(10)).toBeCloseTo(21, 6);
  });

  it('degrades to a flat line at the mean for a single point', () => {
    const r = linearRegression([{ x: 3, y: 7 }]);
    expect(r.slope).toBe(0);
    expect(r.intercept).toBe(7);
    expect(r.count).toBe(1);
    expect(r.predict(99)).toBe(7);
  });

  it('returns an empty model for no points', () => {
    const r = linearRegression([]);
    expect(r.count).toBe(0);
    expect(r.slope).toBe(0);
    expect(r.predict(5)).toBe(0);
  });

  it('handles a constant series (zero variance in x)', () => {
    const r = linearRegression([{ x: 2, y: 5 }, { x: 2, y: 9 }]);
    expect(r.slope).toBe(0);
    expect(Number.isFinite(r.intercept)).toBe(true);
  });
});

describe('mean / stdDev', () => {
  it('computes the mean, guarding the empty case', () => {
    expect(mean([])).toBe(0);
    expect(mean([1, 2, 3])).toBe(2);
  });

  it('computes the population standard deviation', () => {
    expect(stdDev([])).toBe(0);
    expect(stdDev([5])).toBe(0); // fewer than 2 values
    // Classic population sd of [2,4,4,4,5,5,7,9] is exactly 2.
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 6);
  });
});

describe('detectAnomalies (z-score)', () => {
  it('flags a clear high outlier', () => {
    const values = [10, 11, 9, 10, 12, 10, 11, 9, 10, 500];
    const out = detectAnomalies(values, 2);
    expect(out.length).toBeGreaterThan(0);
    const spike = out.find((a) => a.value === 500);
    expect(spike).toBeTruthy();
    expect(spike!.direction).toBe('HIGH');
    expect(spike!.index).toBe(9);
  });

  it('flags a low outlier with the LOW direction', () => {
    const values = [100, 101, 99, 100, 102, 98, 100, 101, 99, -400];
    const out = detectAnomalies(values, 2);
    const dip = out.find((a) => a.value === -400);
    expect(dip).toBeTruthy();
    expect(dip!.direction).toBe('LOW');
  });

  it('returns nothing for a zero-variance series', () => {
    expect(detectAnomalies([5, 5, 5, 5, 5])).toEqual([]);
  });

  it('returns nothing when every point is within the threshold', () => {
    expect(detectAnomalies([10, 11, 10, 11, 10, 11], 3)).toEqual([]);
  });
});

describe('quantile (linear interpolation)', () => {
  it('interpolates between ordered values', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 6);
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
  });

  it('guards empty and single-element inputs', () => {
    expect(quantile([], 0.5)).toBe(0);
    expect(quantile([5], 0.9)).toBe(5);
  });
});

describe('forecastSeries', () => {
  // A clean, strongly increasing 14-day series → HIGH confidence, UP trend.
  const rising = Array.from({ length: 14 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
    value: 100 + i * 10,
  }));

  it('returns an empty (flat) forecast for no history', () => {
    const f = forecastSeries([], 7);
    expect(f.trend).toBe('FLAT');
    expect(f.confidence).toBe('LOW');
    expect(f.forecast).toHaveLength(7);
    expect(f.forecast.every((d) => d.predicted === 0)).toBe(true);
  });

  it('detects an upward trend with high confidence on a clean series', () => {
    const f = forecastSeries(rising, 7);
    expect(f.trend).toBe('UP');
    expect(f.confidence).toBe('HIGH');
    expect(f.slope).toBeGreaterThan(0);
    expect(f.forecast).toHaveLength(7);
    expect(f.totalPredicted).toBeGreaterThan(0);
  });

  it('produces ordered, non-negative predictions with a widening band', () => {
    const f = forecastSeries(rising, 10);
    for (const d of f.forecast) {
      expect(d.lower).toBeGreaterThanOrEqual(0);
      expect(d.lower).toBeLessThanOrEqual(d.predicted);
      expect(d.upper).toBeGreaterThanOrEqual(d.predicted);
    }
    // The 80% band widens (or stays equal) as the horizon grows.
    const widths = f.forecast.map((d) => d.upper - d.lower);
    expect(widths[widths.length - 1]).toBeGreaterThanOrEqual(widths[0]);
  });

  it('continues the calendar from the last observed date', () => {
    const f = forecastSeries(rising, 3);
    const last = rising[rising.length - 1].date;
    const expected = new Date(`${last}T00:00:00Z`);
    expected.setUTCDate(expected.getUTCDate() + 1);
    expect(f.forecast[0].date).toBe(expected.toISOString().slice(0, 10));
  });

  it('reports FLAT for a constant series', () => {
    const flat = Array.from({ length: 10 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
      value: 50,
    }));
    expect(forecastSeries(flat, 5).trend).toBe('FLAT');
  });
});

describe('rfmSegment', () => {
  it('maps score triples to the reachable named segments', () => {
    expect(rfmSegment(5, 5, 5)).toBe('CHAMPIONS');
    expect(rfmSegment(4, 2, 2)).toBe('POTENTIAL_LOYALIST');
    expect(rfmSegment(5, 1, 3)).toBe('NEW_CUSTOMERS');
    expect(rfmSegment(2, 3, 3)).toBe('AT_RISK');
    expect(rfmSegment(1, 2, 1)).toBe('HIBERNATING');
    expect(rfmSegment(3, 3, 3)).toBe('NEEDS_ATTENTION');
  });
});

describe('rfmScore', () => {
  const customers = [
    { customerId: 'c1', name: 'Ana', recencyDays: 2, frequency: 20, monetary: 4000 },
    { customerId: 'c2', name: 'Bo', recencyDays: 40, frequency: 8, monetary: 900 },
    { customerId: 'c3', name: 'Cy', recencyDays: 120, frequency: 1, monetary: 30 },
    { customerId: 'c4', name: 'Di', recencyDays: 10, frequency: 12, monetary: 1500 },
    { customerId: 'c5', name: 'El', recencyDays: 60, frequency: 4, monetary: 400 },
  ];

  it('scores every dimension into 1..5 and derives rfm + segment', () => {
    const scored = rfmScore(customers);
    expect(scored).toHaveLength(5);
    for (const s of scored) {
      expect(s.r).toBeGreaterThanOrEqual(1);
      expect(s.r).toBeLessThanOrEqual(5);
      expect(s.f).toBeGreaterThanOrEqual(1);
      expect(s.f).toBeLessThanOrEqual(5);
      expect(s.m).toBeGreaterThanOrEqual(1);
      expect(s.m).toBeLessThanOrEqual(5);
      expect(s.rfm).toBe(s.r * 100 + s.f * 10 + s.m);
      expect(typeof s.segment).toBe('string');
    }
  });

  it('ranks the most-recent, most-frequent, highest-spender first', () => {
    const scored = rfmScore(customers);
    expect(scored[0].customerId).toBe('c1');
    // Recency is inverted: the customer seen most recently gets the top R.
    expect(scored[0].r).toBe(5);
    // Sorted strictly by descending composite rfm.
    for (let i = 1; i < scored.length; i += 1) {
      expect(scored[i - 1].rfm).toBeGreaterThanOrEqual(scored[i].rfm);
    }
  });

  it('handles an empty customer list', () => {
    expect(rfmScore([])).toEqual([]);
  });
});

describe('segmentSummary', () => {
  it('aggregates counts and revenue per segment, sorted by size', () => {
    const scored = rfmScore([
      { customerId: 'a', recencyDays: 1, frequency: 30, monetary: 5000 },
      { customerId: 'b', recencyDays: 2, frequency: 25, monetary: 4500 },
      { customerId: 'c', recencyDays: 200, frequency: 1, monetary: 10 },
    ]);
    const summary = segmentSummary(scored);
    const totalCustomers = summary.reduce((s, x) => s + x.customers, 0);
    expect(totalCustomers).toBe(3);
    // Sorted by descending customer count.
    for (let i = 1; i < summary.length; i += 1) {
      expect(summary[i - 1].customers).toBeGreaterThanOrEqual(summary[i].customers);
    }
    // Revenue is rounded to 2dp.
    for (const row of summary) {
      expect(Number.isInteger(row.revenue * 100)).toBe(true);
    }
  });

  it('returns an empty summary for no scores', () => {
    expect(segmentSummary([])).toEqual([]);
  });
});
