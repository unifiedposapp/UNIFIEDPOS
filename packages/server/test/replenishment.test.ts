import { describe, it, expect } from 'vitest';
import {
  zScore,
  stdDev,
  demandOverWindow,
  safetyStock,
  packRound,
  daysOfCover,
  economicOrderQuantity,
  abcClass,
  urgencyScore,
  planItem,
  planReplenishment,
  describePlan,
  DEFAULT_SERVICE_LEVEL,
  type ReplenishInput,
} from '../src/services/replenishment';

const sku = (overrides: Partial<ReplenishInput> & { productId: string }): ReplenishInput => ({
  name: overrides.productId,
  onHand: 0,
  inTransit: 0,
  dailyForecast: [10, 10, 10, 10, 10, 10, 10],
  leadTimeDays: 3,
  reviewPeriodDays: 4,
  unitCost: 5,
  price: 12,
  supplierId: 'sup-1',
  supplierName: 'Wholesale Co',
  ...overrides,
});

describe('statistics', () => {
  it('recovers the familiar z values', () => {
    expect(zScore(0.95)).toBeCloseTo(1.6449, 3);
    expect(zScore(0.5)).toBeCloseTo(0, 5);
    expect(zScore(0.99)).toBeCloseTo(2.3263, 3);
    // Nonsense input falls back to the 95 % default rather than NaN.
    expect(zScore(0)).toBeCloseTo(1.6449, 3);
    expect(zScore(5)).toBeCloseTo(1.6449, 3);
  });

  it('uses the sample standard deviation and needs two points', () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(stdDev([3])).toBe(0);
    expect(stdDev([])).toBe(0);
  });

  it('sums the horizon and repeats the last day when the forecast is short', () => {
    expect(demandOverWindow([1, 2, 3], 3)).toBe(6);
    expect(demandOverWindow([4], 5)).toBe(20);
    expect(demandOverWindow([], 5)).toBe(0);
    expect(demandOverWindow([-5, 10], 2)).toBe(10); // negatives clamp to zero
  });

  it('grows safety stock with service level, spread and window', () => {
    const low = safetyStock(3, 7, 0.9);
    const high = safetyStock(3, 7, 0.99);
    expect(high).toBeGreaterThan(low);
    expect(safetyStock(0, 7)).toBe(0);
    expect(safetyStock(3, 7, DEFAULT_SERVICE_LEVEL)).toBeGreaterThan(0);
  });
});

describe('ordering maths', () => {
  it('rounds up to whole packs and lifts to the supplier minimum', () => {
    expect(packRound(10, 1, 1)).toBe(10);
    expect(packRound(10, 6, 1)).toBe(12);
    expect(packRound(2, 6, 1)).toBe(6);
    expect(packRound(1, 5, 24)).toBe(25);
    expect(packRound(0, 6, 24)).toBe(0); // never invents an order out of nothing
  });

  it('treats zero demand as undefined cover, not infinite', () => {
    expect(daysOfCover(50, 10)).toBe(5);
    expect(daysOfCover(50, 0)).toBeNull();
  });

  it('applies the Wilson formula and refuses to order without demand', () => {
    expect(economicOrderQuantity(10_000, 100, 5, 0.25)).toBe(1265);
    expect(economicOrderQuantity(0, 100, 5)).toBe(0);
    expect(economicOrderQuantity(1000, 0, 5)).toBe(0);
  });

  it('bands ABC by cumulative revenue share', () => {
    expect(abcClass(50)).toBe('A');
    expect(abcClass(80)).toBe('A');
    expect(abcClass(81)).toBe('B');
    expect(abcClass(95)).toBe('B');
    expect(abcClass(96)).toBe('C');
  });

  it('scores urgency from shortfall against the exposure window', () => {
    expect(urgencyScore(0, 7, 5)).toBeGreaterThan(urgencyScore(30, 7, 5));
    expect(urgencyScore(null, 7, 5)).toBeGreaterThan(80); // no cover at all is urgent
    expect(urgencyScore(100, 7, 5)).toBeLessThan(10);
  });
});

describe('planItem', () => {
  it('orders the gap to target when below the reorder point', () => {
    const item = planItem(sku({ productId: 'P1', onHand: 5 }));
    expect(item.action).toBe('ORDER');
    expect(item.quantity).toBeGreaterThan(0);
    expect(item.cost).toBeCloseTo(item.quantity * 5, 2);
    expect(item.reorderPoint).toBeGreaterThan(0);
    expect(item.reason).toContain('below reorder point');
  });

  it('leaves well-covered stock alone', () => {
    const item = planItem(sku({ productId: 'P2', onHand: 500 }));
    expect(item.action).toBe('NONE');
    expect(item.quantity).toBe(0);
    expect(item.reason).toContain('above the');
  });

  it('watches a line whose gap is smaller than one pack', () => {
    // Demand 70 over the window, on hand just below the reorder point.
    const item = planItem(
      sku({ productId: 'P3', onHand: 74, dailyForecast: [10, 10, 10, 10, 10, 10, 10], packSize: 50, minOrderQty: 0, dailyStdDev: 0 })
    );
    expect(['WATCH', 'NONE']).toContain(item.action);
  });

  it('honours in-transit stock and reserved units', () => {
    const withoutTransit = planItem(sku({ productId: 'P4', onHand: 5 }));
    const withTransit = planItem(sku({ productId: 'P4', onHand: 5, inTransit: 200 }));
    expect(withTransit.action).toBe('NONE');
    expect(withoutTransit.action).toBe('ORDER');
    const reserved = planItem(sku({ productId: 'P5', onHand: 500, reserved: 495 }));
    expect(reserved.available).toBe(5);
  });

  it('respects the stock ceiling', () => {
    const capped = planItem(sku({ productId: 'P6', onHand: 0, maxStock: 20 }));
    expect(capped.quantity).toBeLessThanOrEqual(20);
  });

  it('excludes discontinued and blocked lines without touching the maths', () => {
    expect(planItem(sku({ productId: 'P7', exclude: true, excludeReason: 'discontinued' })).action).toBe('EXCLUDED');
    expect(planItem(sku({ productId: 'P8' }), { excludedSuppliers: ['sup-1'] }).reason).toContain('guardrail');
  });
});

describe('planReplenishment', () => {
  const inputs = [
    sku({ productId: 'A', onHand: 0, unitCost: 10, name: 'High value, zero cover' }),
    sku({ productId: 'B', onHand: 2, unitCost: 2, name: 'Cheap and nearly out' }),
    sku({ productId: 'C', onHand: 400, unitCost: 5, name: 'Plenty' }),
    sku({ productId: 'D', onHand: 1, unitCost: 1, supplierId: 'sup-block', name: 'Blocked supplier' }),
  ];

  it('keeps only orderable lines and totals them', () => {
    const plan = planReplenishment(inputs);
    expect(plan.items.map((i) => i.productId).sort()).toEqual(['A', 'B', 'D']);
    expect(plan.totals.lines).toBe(3);
    expect(plan.totals.cost).toBeCloseTo(plan.items.reduce((s, i) => s + i.cost, 0), 2);
    expect(plan.serviceLevel).toBe(DEFAULT_SERVICE_LEVEL);
  });

  it('cuts the least urgent tail to fit the cash guardrail', () => {
    const plan = planReplenishment(inputs, { maxSpend: 1 });
    expect(plan.totals.trimmed).toBeGreaterThan(0);
    expect(plan.totals.cost).toBeLessThanOrEqual(1);
    expect(describePlan(plan)).toContain('deferred');
  });

  it('caps the number of lines for a one-truck operation', () => {
    const plan = planReplenishment(inputs, { maxLines: 1 });
    expect(plan.items.length).toBe(1);
    expect(plan.totals.trimmed).toBe(2);
  });

  it('groups what survives by supplier without losing money', () => {
    const plan = planReplenishment(inputs);
    const row = plan.bySupplier.find((s) => s.supplierId === 'sup-1');
    expect(row?.lines).toBeGreaterThan(0);
    expect(plan.bySupplier.reduce((s, r) => s + r.units, 0)).toBe(plan.totals.units);
    expect(plan.bySupplier.reduce((s, r) => s + r.cost, 0)).toBeCloseTo(plan.totals.cost, 2);
  });

  it('describes an empty plan without dividing by anything', () => {
    expect(describePlan(planReplenishment([]))).toContain('0 lines');
  });
});
