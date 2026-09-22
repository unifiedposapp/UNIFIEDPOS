import { describe, it, expect } from 'vitest';
import {
  intervalEnd,
  monthsPerInterval,
  nextRetryAt,
  prorate,
  DUNNING_LADDER_DAYS,
} from '../src/services/subscriptionBilling';

// ─── Subscription billing pure functions (no DB) ────────────────────────────
// Everything that decides *when* a customer is charged and *how much* is pure
// and pinned here; the Prisma side of the engine only orchestrates around it.

describe('intervalEnd', () => {
  it('advances calendar months with month-end clamping', () => {
    expect(intervalEnd(new Date('2026-01-31T00:00:00Z'), 'MONTH').toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(intervalEnd(new Date('2026-03-15T00:00:00Z'), 'MONTH', 3).toISOString()).toBe('2026-06-15T00:00:00.000Z');
  });

  it('handles weeks, quarters and years', () => {
    expect(intervalEnd(new Date('2026-09-21T00:00:00Z'), 'WEEK').toISOString()).toBe('2026-09-28T00:00:00.000Z');
    expect(intervalEnd(new Date('2026-01-31T00:00:00Z'), 'QUARTER').toISOString()).toBe('2026-04-30T00:00:00.000Z');
    expect(intervalEnd(new Date('2024-02-29T00:00:00Z'), 'YEAR').toISOString()).toBe('2025-02-28T00:00:00.000Z');
  });

  it('rejects unknown intervals instead of silently billing nothing', () => {
    expect(() => intervalEnd(new Date(), 'MILLENNIUM' as never)).toThrow(/unknown billing interval/);
  });
});

describe('monthsPerInterval', () => {
  it('normalizes each cadence to a monthly figure', () => {
    expect(monthsPerInterval('MONTH')).toBe(1);
    expect(monthsPerInterval('YEAR')).toBeCloseTo(1 / 12, 6);
    expect(monthsPerInterval('QUARTER')).toBeCloseTo(1 / 3, 6);
    expect(monthsPerInterval('WEEK')).toBeGreaterThan(4);
    expect(monthsPerInterval('DAY')).toBeGreaterThan(30);
  });
});

describe('dunning ladder', () => {
  it('paces retries 1d → 3d → 7d → 14d, then exhausts', () => {
    const t0 = new Date('2026-09-21T12:00:00Z');
    DUNNING_LADDER_DAYS.forEach((days, i) => {
      const { retryAt, exhausted } = nextRetryAt(t0, i + 1);
      expect(exhausted).toBe(false);
      expect(retryAt.getTime() - t0.getTime()).toBe(days * 86_400_000);
    });
    const final = nextRetryAt(t0, DUNNING_LADDER_DAYS.length + 1);
    expect(final.exhausted).toBe(true);
    expect(final.retryAt.getTime() - t0.getTime()).toBe(21 * 86_400_000);
  });
});

describe('prorate', () => {
  it('charges the plan delta for the time remaining in the period', () => {
    // Half a period left on a $10 → $20 upgrade: (20-10) × 0.5 = $5.
    expect(prorate(20, 10, 500, 1000)).toBe(5);
    // Whole period remaining: the full delta.
    expect(prorate(20, 10, 1000, 1000)).toBe(10);
  });

  it('never refunds cash or exceeds the new amount', () => {
    expect(prorate(10, 100, 900, 1000)).toBe(0); // downgrade floors at 0
    expect(prorate(10, 1, 5000, 1000)).toBe(9); // fraction caps at 1 → delta 9
    expect(prorate(10, 5, 0, 0)).toBe(10); // degenerate period → full charge
  });
});
