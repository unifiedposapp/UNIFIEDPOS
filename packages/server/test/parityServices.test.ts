/**
 * Unit tests for the pure services added for competitor parity.
 *
 * These modules decide money and stock: a weighed line's price, a tip pool's
 * last cent, what a promotion may take off, what a plate costs, whether an
 * age-restricted sale may complete, which station cooks an item, and what a
 * report totals. They are pure by design, so every rule here is asserted
 * without a database in sight.
 */

import { describe, it, expect } from 'vitest';

import {
  normalizeQuantity,
  convertQty,
  lineTotal,
  formatQuantity,
  gtinCheckDigitValid,
  decodeScaleBarcode,
  weighedPrice,
} from '../src/services/units';
import { allocateTips, weightFor, tipsByEmployee, totalTips, tipOutSplit } from '../src/services/tipPooling';
import { isActive, evaluatePromotion, allocateDiscount, planPromotions } from '../src/services/promotions';
import {
  rollupRecipeCost,
  explodeRecipe,
  foodCostPct,
  classifyFoodCost,
  margin,
  type RecipeInput,
} from '../src/services/recipes';
import { ageFromBirthDate, requiredMinAge, evaluateAgeGate, ageGateMessage } from '../src/services/ageGate';
import {
  routeItem,
  groupByStation,
  planCourseFire,
  slaStatus,
  ticketAgeMinutes,
  averageTicketMinutes,
} from '../src/services/kds';
import {
  entryHours,
  hoursByDay,
  shiftHours,
  splitOvertime,
  labourCost,
  detectConflicts,
  availabilityViolations,
  coverageGaps,
  labourPercent,
  salesPerLabourHour,
} from '../src/services/labor';
import { validateDefinition, buildReport, toCsv } from '../src/services/reportBuilder';

// ─────────────────────────────────────────────────────────────────────────────
// Units of measure, weighted selling and scale barcodes
// ─────────────────────────────────────────────────────────────────────────────

describe('units: quantity normalisation', () => {
  it('accepts integers for each-sold products only', () => {
    expect(normalizeQuantity(3, 'EACH')).toEqual({ ok: true, quantity: 3 });
    expect(normalizeQuantity(3.5, 'EACH')).toEqual({ ok: false, reason: 'INTEGER_ONLY' });
  });

  it('accepts fractional quantities for weighed units', () => {
    expect(normalizeQuantity(0.375, 'KG')).toEqual({ ok: true, quantity: 0.375 });
    expect(normalizeQuantity('2.5', 'L')).toEqual({ ok: true, quantity: 2.5 });
  });

  it('rejects sub-gram scale noise beyond three decimals', () => {
    // 0.3751 kg is 375.1 g. Stored precision is 3dp, so the fourth digit is a
    // weighing fault rather than a legitimate sale.
    expect(normalizeQuantity(0.3751, 'KG')).toEqual({ ok: false, reason: 'TOO_MANY_DECIMALS' });
  });

  it('treats the weighed flag as permission for fractional amounts', () => {
    expect(normalizeQuantity(1.4, 'EACH', true)).toEqual({ ok: true, quantity: 1.4 });
  });

  it('rejects non-positive, negligible and oversized quantities', () => {
    expect(normalizeQuantity(0, 'KG')).toEqual({ ok: false, reason: 'NOT_POSITIVE' });
    expect(normalizeQuantity(-2, 'KG')).toEqual({ ok: false, reason: 'NOT_POSITIVE' });
    expect(normalizeQuantity(Number.NaN, 'KG')).toEqual({ ok: false, reason: 'NOT_POSITIVE' });
    expect(normalizeQuantity(0.0001, 'KG')).toEqual({ ok: false, reason: 'NOT_POSITIVE' });
    expect(normalizeQuantity(1_000_001, 'KG')).toEqual({ ok: false, reason: 'TOO_LARGE' });
  });
});

describe('units: conversion and money', () => {
  it('converts within a metric dimension only', () => {
    expect(convertQty(1.5, 'KG', 'G')).toBe(1500);
    expect(convertQty(750, 'G', 'KG')).toBe(0.75);
    expect(convertQty(0.5, 'L', 'ML')).toBe(500);
    expect(convertQty(2, 'KG', 'KG')).toBe(2);
    expect(convertQty(1, 'KG', 'L')).toBeNull();
  });

  it('prices a weighed line to the cent', () => {
    expect(lineTotal(4.99, 0.375)).toBe(1.87);
    expect(weighedPrice(4.99, 0.375)).toBe(1.87);
    expect(lineTotal(19.99, 0.25)).toBe(5);
    expect(lineTotal(10, 2, 5)).toBe(15);
  });

  it('formats receipt quantities per unit family', () => {
    expect(formatQuantity(0.375, 'KG')).toBe('0.375 kg');
    expect(formatQuantity(1.5, 'KG')).toBe('1.5 kg');
    expect(formatQuantity(3, 'EACH')).toBe('3 ea');
    expect(formatQuantity(2, 'PACK')).toBe('2 pack');
  });
});

describe('units: scale barcodes', () => {
  it('validates GTIN check digits', () => {
    expect(gtinCheckDigitValid('2212340150002')).toBe(true); // EAN-13
    expect(gtinCheckDigitValid('036000291452')).toBe(true); // UPC-A
    expect(gtinCheckDigitValid('2212340150003')).toBe(false);
    expect(gtinCheckDigitValid('2212340150002x')).toBe(false);
  });

  it('decodes a weight barcode to kilograms', () => {
    expect(decodeScaleBarcode('2212340150002', 'WEIGHT')).toEqual({
      plu: '21234',
      weightKg: 1.5,
      mode: 'WEIGHT',
    });
  });

  it('decodes a price barcode to currency', () => {
    expect(decodeScaleBarcode('2212340150002', 'PRICE')).toEqual({
      plu: '21234',
      price: 15,
      mode: 'PRICE',
    });
  });

  it('refuses anything that is not a store-assigned scale code', () => {
    expect(decodeScaleBarcode('036000291452')).toBeNull(); // 12 digits, not a scale code
    expect(decodeScaleBarcode('1212340150002')).toBeNull(); // no leading 2
    expect(decodeScaleBarcode('2212340150003')).toBeNull(); // bad check digit
    expect(decodeScaleBarcode('2212340000000')).toBeNull(); // valid check digit, zero value
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tip pooling
// ─────────────────────────────────────────────────────────────────────────────

describe('tip pooling', () => {
  it('splits evenly with the largest remainder so nothing is lost', () => {
    const r = allocateTips(
      100,
      [{ employeeId: 'a', name: 'Ana' }, { employeeId: 'b' }, { employeeId: 'c' }],
      'EQUAL',
    );
    if (!r.ok) throw new Error(`unexpected ${r.reason}`);
    expect(r.allocations.map((a) => a.share)).toEqual([33.34, 33.33, 33.33]);
    expect(r.distributed).toBe(100);
    expect(r.roundingDrift).toBe(0);
  });

  it('weights by hours, so a double shift earns double the share', () => {
    const r = allocateTips(20, [{ employeeId: 'a', hours: 8 }, { employeeId: 'b', hours: 2 }], 'HOURS');
    if (!r.ok) throw new Error(`unexpected ${r.reason}`);
    expect(r.allocations.map((a) => a.share)).toEqual([16, 4]);
    expect(r.allocations.map((a) => a.sharePct)).toEqual([80, 20]);
  });

  it('gives the leftover cent to the participant with the larger remainder', () => {
    const r = allocateTips(
      20,
      [{ employeeId: 'server', role: 'SERVER' }, { employeeId: 'busser', role: 'BUSSER' }],
      'POINTS',
      { rolePoints: { SERVER: 2, BUSSER: 1 } },
    );
    if (!r.ok) throw new Error(`unexpected ${r.reason}`);
    expect(r.allocations.find((a) => a.employeeId === 'server')?.share).toBe(13.33);
    expect(r.allocations.find((a) => a.employeeId === 'busser')?.share).toBe(6.67);
    expect(r.distributed).toBe(20);
  });

  it('drops participants below the minimum shift length', () => {
    const r = allocateTips(
      10,
      [{ employeeId: 'long', hours: 6 }, { employeeId: 'short', hours: 1 }],
      'HOURS',
      { minHoursPerShift: 3 },
    );
    if (!r.ok) throw new Error(`unexpected ${r.reason}`);
    expect(r.allocations).toHaveLength(1);
    expect(r.allocations[0].share).toBe(10);
  });

  it('fails loudly instead of inventing a split', () => {
    expect(allocateTips(0, [{ employeeId: 'a' }], 'EQUAL')).toEqual({ ok: false, reason: 'NO_POOL' });
    expect(allocateTips(50, [], 'EQUAL')).toEqual({ ok: false, reason: 'NO_PARTICIPANTS' });
    expect(allocateTips(50, [{ employeeId: 'a', hours: 0 }], 'HOURS')).toEqual({
      ok: false,
      reason: 'NO_WEIGHTS',
    });
    expect(allocateTips(50, [{ employeeId: 'a', role: 'SERVER' }], 'POINTS')).toEqual({
      ok: false,
      reason: 'NO_WEIGHTS',
    });
  });

  it('weights each method from its own input', () => {
    expect(weightFor({ employeeId: 'a' }, 'EQUAL')).toBe(1);
    expect(weightFor({ employeeId: 'a', hours: 3.756 }, 'HOURS')).toBe(3.76);
    expect(weightFor({ employeeId: 'a', sales: 1234.567 }, 'SALES')).toBe(1234.57);
    expect(weightFor({ employeeId: 'a', role: 'BAR' }, 'POINTS', { BAR: 1.5 })).toBe(1.5);
    expect(weightFor({ employeeId: 'a', role: 'BAR' }, 'POINTS', null)).toBe(0);
  });

  it('separates cash from card when asked', () => {
    const tips = [
      { employeeId: 'a', amount: 5, type: 'CASH' },
      { employeeId: 'a', amount: '2.50', type: 'CARD' },
      { employeeId: 'b', amount: 0, type: 'CARD' },
    ];
    expect(tipsByEmployee(tips)).toEqual({ a: 7.5 });
    expect(tipsByEmployee(tips, { includeCash: false })).toEqual({ a: 2.5 });
    expect(totalTips(tips, { includeCard: false })).toBe(5);
  });

  it('clamps a mis-keyed tip-out percentage', () => {
    expect(tipOutSplit(100, 20)).toEqual({ serviceShare: 80, supportShare: 20 });
    expect(tipOutSplit(100, 150)).toEqual({ serviceShare: 0, supportShare: 100 });
    expect(tipOutSplit(87.5, 12.5)).toEqual({ serviceShare: 76.56, supportShare: 10.94 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Promotions
// ─────────────────────────────────────────────────────────────────────────────

// Wednesday 4 June 2025, 23:30 — late enough to exercise a wrapping daypart.
const NOW = new Date(2025, 5, 4, 23, 30);
const ctx = { now: NOW, channel: 'POS' };

describe('promotion eligibility', () => {
  it('honours date, weekday and channel windows', () => {
    const base = { id: 'p', name: 'Promo', type: 'PERCENTAGE', value: 10 };
    expect(isActive(base, ctx)).toBe(true);
    expect(isActive({ ...base, isActive: false }, ctx)).toBe(false);
    expect(isActive({ ...base, daysOfWeek: [4] }, ctx)).toBe(false);
    expect(isActive({ ...base, daysOfWeek: [3] }, ctx)).toBe(true);
    expect(isActive({ ...base, startDate: '2025-07-01' }, ctx)).toBe(false);
    expect(isActive({ ...base, endDate: '2025-05-01' }, ctx)).toBe(false);
    expect(isActive({ ...base, channels: ['ONLINE'] }, ctx)).toBe(false);
    expect(isActive({ ...base, channels: ['POS'] }, ctx)).toBe(true);
  });

  it('treats an end minute before the start as a window past midnight', () => {
    const happyHour = {
      id: 'hh',
      name: 'Happy hour',
      type: 'DAYPART',
      value: 20,
      startMinute: 22 * 60,
      endMinute: 2 * 60,
    };
    expect(isActive(happyHour, { now: new Date(2025, 5, 4, 23, 30) })).toBe(true);
    expect(isActive(happyHour, { now: new Date(2025, 5, 4, 1, 0) })).toBe(true);
    expect(isActive(happyHour, { now: new Date(2025, 5, 4, 12, 0) })).toBe(false);
  });
});

describe('promotion maths', () => {
  const lines = [
    { productId: 'p1', quantity: 2, unitPrice: 10 },
    { productId: 'p2', quantity: 1, unitPrice: 5 },
  ];

  it('takes a percentage off only the eligible value', () => {
    const r = evaluatePromotion(
      { id: 'p', name: 'Ten off', type: 'PERCENTAGE', value: 10, applicableProducts: ['p1'] },
      lines,
    );
    expect(r?.discount).toBe(2);
    expect(r?.detail).toBe('10% off 1 line(s)');
  });

  it('never discounts more than the basket or the configured cap', () => {
    expect(evaluatePromotion({ id: 'p', name: 'F', type: 'FIXED', value: 100 }, lines)?.discount).toBe(25);
    expect(
      evaluatePromotion({ id: 'p', name: 'F', type: 'PERCENTAGE', value: 50, maxDiscount: '5' }, lines)?.discount,
    ).toBe(5);
    expect(
      evaluatePromotion({ id: 'p', name: 'F', type: 'PERCENTAGE', value: 10, minPurchase: 30 }, lines),
    ).toBeNull();
  });

  it('gives the cheapest units away on buy-one-get-one', () => {
    const fourEach = [{ productId: 'p1', quantity: 4, unitPrice: 10 }];
    expect(
      evaluatePromotion({ id: 'b', name: 'BOGO', type: 'BOGO', value: 0, rule: { buyQty: 1, getQty: 1 } }, fourEach)
        ?.discount,
    ).toBe(20);
  });

  it('gives the cheapest unit away across a mix-and-match group', () => {
    const mixed = [
      { productId: 'a', quantity: 1, unitPrice: 10 },
      { productId: 'b', quantity: 1, unitPrice: 10 },
      { productId: 'c', quantity: 1, unitPrice: 5 },
    ];
    expect(
      evaluatePromotion({ id: 'm', name: 'MM', type: 'MIX_AND_MATCH', value: 0, rule: { buyQty: 2, getQty: 1 } }, mixed)
        ?.discount,
    ).toBe(5);
    // Only two units: no complete group, so no discount.
    expect(
      evaluatePromotion(
        { id: 'm', name: 'MM', type: 'MIX_AND_MATCH', value: 0, rule: { buyQty: 2, getQty: 1 } },
        [{ productId: 'a', quantity: 2, unitPrice: 10 }],
      ),
    ).toBeNull();
  });

  it('applies the highest quantity tier the cart reaches', () => {
    const r = evaluatePromotion(
      {
        id: 'q',
        name: 'Q',
        type: 'QTY_BREAK',
        value: 0,
        rule: { tiers: [{ minQty: 10, percent: 20 }, { minQty: 5, percent: 10 }] },
      },
      [{ productId: 'p1', quantity: 6, unitPrice: 10 }],
    );
    expect(r?.discount).toBe(6);
    expect(r?.detail).toBe('10% at 5+ units');
  });

  it('requires the whole declared group before honouring a bundle price', () => {
    const bundle = {
      id: 'b',
      name: 'B',
      type: 'BUNDLE',
      value: 0,
      rule: { bundlePrice: 20, groupProductIds: ['p1', 'p2'] },
    };
    expect(evaluatePromotion(bundle, lines)?.discount).toBe(5);
    expect(evaluatePromotion(bundle, [{ productId: 'p1', quantity: 1, unitPrice: 10 }])).toBeNull();
  });
});

describe('discount allocation', () => {
  it('splits proportionally to line value', () => {
    expect(
      allocateDiscount(10, [{ productId: 'a', amount: 30 }, { productId: 'b', amount: 70 }]),
    ).toEqual({ a: 3, b: 7 });
  });

  it('hands residual cents out so the parts sum to the whole', () => {
    const out = allocateDiscount(10, [
      { productId: 'a', amount: 10 },
      { productId: 'b', amount: 10 },
      { productId: 'c', amount: 10 },
    ]);
    expect(out).toEqual({ a: 3.34, b: 3.33, c: 3.33 });
    expect(Object.values(out).reduce((s, v) => s + v, 0)).toBeCloseTo(10, 2);
  });

  it('never allocates more than a line is worth', () => {
    const out = allocateDiscount(2, [
      { productId: 'a', amount: 4.69 },
      { productId: 'b', amount: 0.01 },
    ]);
    expect(out.a).toBeLessThanOrEqual(4.69);
    expect(out.b).toBeLessThanOrEqual(0.01);
    expect(Object.values(out).reduce((s, v) => s + v, 0)).toBeCloseTo(2, 2);
  });

  it('is a no-op without a discount or a target value', () => {
    expect(allocateDiscount(0, [{ productId: 'a', amount: 10 }])).toEqual({});
    expect(allocateDiscount(5, [])).toEqual({});
    expect(allocateDiscount(5, [{ productId: 'a', amount: 0 }])).toEqual({});
  });
});

describe('promotion planning', () => {
  const cart = [{ productId: 'p1', quantity: 1, unitPrice: 100 }];

  it('applies in priority order and stops at a non-stackable winner', () => {
    const plan = planPromotions(
      [
        { id: 'b', name: 'Smaller', type: 'FIXED', value: 3, priority: 1, stackable: true },
        { id: 'a', name: 'Bigger', type: 'PERCENTAGE', value: 10, priority: 10, stackable: false },
      ],
      cart,
      ctx,
    );
    expect(plan.applied.map((a) => a.id)).toEqual(['a']);
    expect(plan.totalDiscount).toBe(10);
    expect(plan.perLine).toEqual({ p1: 10 });
  });

  it('accumulates stackable promotions', () => {
    const plan = planPromotions(
      [
        { id: 'a', name: 'A', type: 'PERCENTAGE', value: 10, stackable: true },
        { id: 'b', name: 'B', type: 'FIXED', value: 3, stackable: true },
      ],
      cart,
      ctx,
    );
    expect(plan.totalDiscount).toBe(13);
    expect(plan.perLine.p1).toBe(13);
  });

  it('clamps a fixed discount to the basket and stops once it is free', () => {
    const plan = planPromotions(
      [
        { id: 'a', name: 'Big', type: 'FIXED', value: 100, priority: 2, stackable: true },
        { id: 'b', name: 'Also', type: 'FIXED', value: 5, priority: 1, stackable: true },
      ],
      [{ productId: 'p1', quantity: 1, unitPrice: 10 }],
      ctx,
    );
    expect(plan.totalDiscount).toBe(10);
    expect(plan.applied).toHaveLength(1);
  });

  it('ignores inactive, manual and future promotions', () => {
    const plan = planPromotions(
      [
        { id: 'a', name: 'Off', type: 'FIXED', value: 5, isActive: false },
        { id: 'b', name: 'Manual', type: 'FIXED', value: 5, autoApply: false },
        { id: 'c', name: 'Later', type: 'FIXED', value: 5, startDate: '2025-07-01' },
      ],
      cart,
      ctx,
    );
    expect(plan).toEqual({ applied: [], totalDiscount: 0, perLine: {} });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Recipes, costing and depletion
// ─────────────────────────────────────────────────────────────────────────────

const components = new Map([
  ['patty', { id: 'patty', name: 'Beef patty', cost: 2, unit: 'EACH' }],
  ['bun', { id: 'bun', name: 'Brioche bun', cost: 0.5, unit: 'EACH' }],
]);

describe('recipe costing', () => {
  it('sums components into a plate cost', () => {
    const res = rollupRecipeCost(
      {
        productId: 'burger',
        yieldQty: 1,
        lines: [
          { componentProductId: 'patty', quantity: 1 },
          { componentProductId: 'bun', quantity: 1 },
        ],
      },
      components,
    );
    if (!res.ok) throw new Error(res.reason);
    expect(res.batchCost).toBe(2.5);
    expect(res.unitCost).toBe(2.5);
    expect(res.lines.map((l) => l.name)).toEqual(['Beef patty', 'Brioche bun']);
  });

  it('uplifts quantity for waste before costing', () => {
    const res = rollupRecipeCost(
      { productId: 'burger', lines: [{ componentProductId: 'patty', quantity: 1, wastePct: 10 }] },
      components,
    );
    if (!res.ok) throw new Error(res.reason);
    // One patty at 2.00 with 10% trim loss has to buy 1.1 patties.
    expect(res.batchCost).toBe(2.2);
    expect(res.lines[0].wastePct).toBe(10);
  });

  it('divides the batch cost by the yield', () => {
    const res = rollupRecipeCost(
      { productId: 'batch', yieldQty: 4, lines: [{ componentProductId: 'patty', quantity: 8 }] },
      components,
    );
    if (!res.ok) throw new Error(res.reason);
    expect(res.batchCost).toBe(16);
    expect(res.unitCost).toBe(4);
  });

  it('prefers a sub-recipe cost over the catalog cost', () => {
    const subs = new Map<string, RecipeInput>([
      [
        'sauce',
        { productId: 'sauce', yieldQty: 5, lines: [{ componentProductId: 'tomato', quantity: 1, unit: 'KG' }] },
      ],
    ]);
    const res = rollupRecipeCost(
      { productId: 'pasta', lines: [{ componentProductId: 'sauce', quantity: 0.2, unit: 'KG' }] },
      new Map([
        ['tomato', { id: 'tomato', name: 'Tomato', cost: 4, unit: 'KG' }],
        // A stale catalog price that must not win over the in-house recipe.
        ['sauce', { id: 'sauce', name: 'Catalog sauce', cost: 99, unit: 'KG' }],
      ]),
      subs,
    );
    if (!res.ok) throw new Error(res.reason);
    expect(res.lines[0].composed).toBe(true);
    expect(res.batchCost).toBe(0.16);
  });

  it('reports structural problems instead of pricing them', () => {
    expect(rollupRecipeCost({ productId: 'x', lines: [] }, components)).toEqual({
      ok: false,
      reason: 'NO_LINES',
    });
    expect(
      rollupRecipeCost({ productId: 'x', lines: [{ componentProductId: 'ghost', quantity: 1 }] }, components),
    ).toEqual({ ok: false, reason: 'UNKNOWN_COMPONENT', componentProductId: 'ghost' });
  });

  it('detects a self-referencing bill of materials', () => {
    const subs = new Map<string, RecipeInput>([
      ['main', { productId: 'main', lines: [{ componentProductId: 'sauce', quantity: 1 }] }],
      ['sauce', { productId: 'sauce', lines: [{ componentProductId: 'main', quantity: 1 }] }],
    ]);
    const res = rollupRecipeCost(subs.get('main')!, new Map(), subs);
    if (res.ok) throw new Error('expected a cycle to be detected');
    expect(res.reason).toBe('CYCLE');
  });

  it('caps sub-recipe nesting depth', () => {
    const chain = new Map<string, RecipeInput>();
    for (let i = 0; i < 8; i++) {
      chain.set(`r${i}`, {
        productId: `r${i}`,
        lines: [{ componentProductId: `r${i + 1}`, quantity: 1 }],
      });
    }
    const res = rollupRecipeCost(chain.get('r0')!, new Map(), chain);
    if (res.ok) throw new Error('expected the depth cap to trip');
    expect(res.reason).toBe('DEPTH_EXCEEDED');
  });
});

describe('depletion planning', () => {
  it('scales by sold quantity over yield', () => {
    const plan = explodeRecipe(
      { productId: 'stew', yieldQty: 10, lines: [{ componentProductId: 'beef', quantity: 1, unit: 'KG' }] },
      3,
    );
    expect(plan).toEqual([{ componentProductId: 'beef', quantity: 0.3, unit: 'KG' }]);
  });

  it('includes waste in the draw', () => {
    const plan = explodeRecipe(
      {
        productId: 'stew',
        yieldQty: 10,
        lines: [{ componentProductId: 'beef', quantity: 1, unit: 'KG', wastePct: 10 }],
      },
      3,
    );
    expect(plan[0].quantity).toBe(0.33);
  });

  it('merges repeat draws of the same ingredient in the same unit', () => {
    const plan = explodeRecipe(
      {
        productId: 'burger',
        lines: [
          { componentProductId: 'patty', quantity: 1, unit: 'EACH' },
          { componentProductId: 'patty', quantity: 1, unit: 'EACH' },
        ],
      },
      1,
    );
    expect(plan).toEqual([{ componentProductId: 'patty', quantity: 2, unit: 'EACH' }]);
  });

  it('keeps the same ingredient in different units as separate draws', () => {
    // 100 G and 0.02 KG of butter are both real draws; collapsing them by
    // product id alone would silently under-deplete the balance.
    const plan = explodeRecipe(
      {
        productId: 'cake',
        lines: [
          { componentProductId: 'butter', quantity: 100, unit: 'G' },
          { componentProductId: 'butter', quantity: 0.02, unit: 'KG' },
        ],
      },
      1,
    );
    expect(plan).toHaveLength(2);
    expect(plan.map((p) => p.unit).sort()).toEqual(['G', 'KG']);
  });

  it('drops zero-quantity lines', () => {
    expect(
      explodeRecipe({ productId: 'x', lines: [{ componentProductId: 'nothing', quantity: 0 }] }, 1),
    ).toEqual([]);
  });
});

describe('recipe margin reporting', () => {
  it('expresses food cost as a share of price and bands it', () => {
    expect(foodCostPct(2.5, 10)).toBe(25);
    expect(foodCostPct(2.5, 0)).toBeNull();
    expect(classifyFoodCost(25)).toBe('HEALTHY');
    expect(classifyFoodCost(38)).toBe('WATCH');
    expect(classifyFoodCost(41)).toBe('HIGH');
    expect(classifyFoodCost(null)).toBe('WATCH');
  });

  it('reports margin per unit', () => {
    expect(margin(2.5, 10)).toEqual({ amount: 7.5, pct: 75 });
    expect(margin(2.5, 0)).toEqual({ amount: -2.5, pct: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Age-restricted sales
// ─────────────────────────────────────────────────────────────────────────────

describe('age-restricted sales', () => {
  const policy = { enabled: true, defaultMinAge: 18, requireId: false };
  const wine = [{ productId: 'wine', name: 'Wine', ageRestricted: true, minAge: 18 }];
  const today = new Date(2025, 5, 4);

  it('computes age on the birthday, not before it', () => {
    expect(ageFromBirthDate(new Date(2007, 5, 4), today)).toBe(18);
    expect(ageFromBirthDate(new Date(2007, 5, 5), today)).toBe(17);
    expect(ageFromBirthDate(new Date(2030, 0, 1), today)).toBeNull();
    expect(ageFromBirthDate('not a date', today)).toBeNull();
  });

  it('takes the strictest minimum age in the basket', () => {
    expect(requiredMinAge([{ productId: 'milk' }])).toBeNull();
    expect(requiredMinAge([{ productId: 'beer', ageRestricted: true }])).toBe(18);
    expect(
      requiredMinAge([
        { productId: 'beer', ageRestricted: true, minAge: 18 },
        { productId: 'spirits', ageRestricted: true, minAge: 21 },
      ]),
    ).toBe(21);
  });

  it('asks for verification before anything has been presented', () => {
    expect(evaluateAgeGate(policy, wine)).toEqual({
      required: true,
      satisfied: false,
      minAge: 18,
      reason: 'NOT_VERIFIED',
    });
  });

  it('passes an adult and refuses a minor', () => {
    expect(evaluateAgeGate(policy, wine, { birthDate: new Date(1990, 0, 1) }, today)).toEqual({
      required: true,
      satisfied: true,
      minAge: 18,
      reason: 'VERIFIED',
    });
    expect(evaluateAgeGate(policy, wine, { birthDate: new Date(2010, 0, 1) }, today)).toEqual({
      required: true,
      satisfied: false,
      minAge: 18,
      reason: 'UNDERAGE',
    });
  });

  it('demands a document when the policy requires one', () => {
    const strict = { ...policy, requireId: true };
    expect(evaluateAgeGate(strict, wine, { birthDate: new Date(1990, 0, 1) }, today)).toEqual({
      required: true,
      satisfied: false,
      minAge: 18,
      reason: 'ID_REQUIRED',
    });
    expect(
      evaluateAgeGate(strict, wine, { birthDate: new Date(1990, 0, 1), documentType: 'PASSPORT' }, today).reason,
    ).toBe('VERIFIED');
  });

  it('honours a supervisor override and short-circuits a disabled policy', () => {
    expect(evaluateAgeGate(policy, wine, { method: 'SUPERVISOR_OVERRIDE' }, today)).toEqual({
      required: true,
      satisfied: true,
      minAge: 18,
      reason: 'OVERRIDE',
    });
    expect(evaluateAgeGate({ ...policy, enabled: false }, wine, null, today)).toEqual({
      required: false,
      satisfied: true,
      minAge: null,
      reason: 'POLICY_DISABLED',
    });
    expect(evaluateAgeGate(policy, [{ productId: 'milk' }], null, today)).toEqual({
      required: false,
      satisfied: true,
      minAge: null,
      reason: 'NO_RESTRICTED_ITEMS',
    });
  });

  it('gives the cashier a refusal reason', () => {
    expect(ageGateMessage({ required: true, satisfied: false, minAge: 21, reason: 'UNDERAGE' })).toBe(
      'Customer is under 21. Sale refused.',
    );
    expect(ageGateMessage({ required: true, satisfied: false, minAge: 18, reason: 'ID_REQUIRED' })).toBe(
      'ID document required for this 18+ item.',
    );
    expect(ageGateMessage({ required: true, satisfied: true, minAge: 18, reason: 'VERIFIED' })).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Kitchen routing and pacing
// ─────────────────────────────────────────────────────────────────────────────

describe('kitchen routing', () => {
  const stations = [
    { id: 'grill', name: 'Grill', kind: 'GRILL', categoryIds: ['mains'], targetPrepMinutes: 12 },
    { id: 'cold', name: 'Cold', kind: 'COLD', categoryIds: ['salads'], targetPrepMinutes: 5 },
    { id: 'bar', name: 'Bar', kind: 'BAR', targetPrepMinutes: 4 },
  ];

  it('routes by menu category', () => {
    expect(routeItem({ productId: 'steak', categoryId: 'mains' }, stations)).toEqual({
      stationId: 'grill',
      stationName: 'Grill',
      targetPrepMinutes: 12,
      matchedBy: 'CATEGORY',
    });
  });

  it('lets a modifier outrank the menu category', () => {
    const r = routeItem(
      { productId: 'espresso', categoryId: 'mains', modifiers: [{ name: 'BAR service' }] },
      stations,
    );
    expect(r.stationId).toBe('bar');
    expect(r.matchedBy).toBe('MODIFIER');
  });

  it('falls back to the first open station for an unmapped category', () => {
    const r = routeItem({ productId: 'mystery', categoryId: 'unmapped' }, stations);
    expect(r.stationId).toBe('grill');
    expect(r.matchedBy).toBe('FALLBACK');
  });

  it('reports no route when no station is open', () => {
    expect(routeItem({ productId: 'x' }, [{ id: 's', name: 'S', isActive: false }])).toEqual({
      stationId: null,
      stationName: null,
      targetPrepMinutes: 10,
      matchedBy: 'NONE',
    });
  });

  it('groups a ticket by station, preserving item order', () => {
    const grouped = groupByStation(
      [
        { id: '1', productId: 'steak', categoryId: 'mains' },
        { id: '2', productId: 'salad', categoryId: 'salads' },
        { id: '3', productId: 'ribs', categoryId: 'mains' },
      ],
      stations,
    );
    expect(Object.keys(grouped)).toEqual(['Grill', 'Cold']);
    expect(grouped.Grill.map((i) => i.id)).toEqual(['1', '3']);
  });
});

describe('course firing', () => {
  const items = [
    { id: 'a1', productId: 'soup', course: 1, status: 'PENDING' },
    { id: 'm1', productId: 'steak', course: 2, status: 'PENDING' },
    { id: 'd1', productId: 'cake', course: 3, status: 'PENDING' },
    { id: 'a2', productId: 'bread', course: 1, status: 'FIRED' },
  ];

  it('fires the whole ticket when no course is named', () => {
    expect(planCourseFire(items).filter((i) => i.fire).map((i) => i.itemId)).toEqual(['a1', 'm1', 'd1']);
  });

  it('fires one course and never re-fires a sent item', () => {
    expect(planCourseFire(items, 2)).toEqual([
      { itemId: 'a1', course: 1, fire: false },
      { itemId: 'm1', course: 2, fire: true },
      { itemId: 'd1', course: 3, fire: false },
      { itemId: 'a2', course: 1, fire: false },
    ]);
  });

  it('defaults a missing course to the first course', () => {
    expect(planCourseFire([{ id: 'x', productId: 'p', status: 'PENDING' }], 1)).toEqual([
      { itemId: 'x', course: 1, fire: true },
    ]);
  });
});

describe('kitchen service levels', () => {
  it('warns before a ticket is late, not after', () => {
    expect(slaStatus(5, 10)).toBe('ON_TIME');
    expect(slaStatus(8, 10)).toBe('AT_RISK');
    expect(slaStatus(10, 10)).toBe('AT_RISK');
    expect(slaStatus(11, 10)).toBe('LATE');
  });

  it('ages a ticket in whole minutes, never negatively', () => {
    const now = new Date(2025, 5, 4, 12, 0, 0);
    expect(ticketAgeMinutes(new Date(2025, 5, 4, 11, 40), now)).toBe(20);
    expect(ticketAgeMinutes(new Date(2025, 5, 4, 12, 30), now)).toBe(0);
    expect(ticketAgeMinutes('nonsense', now)).toBe(0);
  });

  it('averages only tickets that were actually served', () => {
    const tickets = [
      { createdAt: new Date(2025, 5, 4, 12, 0), readyAt: new Date(2025, 5, 4, 12, 10) },
      { createdAt: new Date(2025, 5, 4, 12, 0), readyAt: new Date(2025, 5, 4, 12, 20) },
      { createdAt: new Date(2025, 5, 4, 12, 0), readyAt: null },
    ];
    expect(averageTicketMinutes(tickets)).toBe(15);
    expect(averageTicketMinutes([])).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Labour: hours, overtime, rosters
// ─────────────────────────────────────────────────────────────────────────────

describe('worked hours', () => {
  it('deducts breaks from a completed shift', () => {
    expect(
      entryHours({
        clockIn: new Date(2025, 5, 4, 9, 0),
        clockOut: new Date(2025, 5, 4, 17, 0),
        breakStart: new Date(2025, 5, 4, 12, 0),
        breakEnd: new Date(2025, 5, 4, 12, 30),
      }),
    ).toBe(7.5);
  });

  it('measures a live shift against the clock', () => {
    expect(entryHours({ clockIn: new Date(2025, 5, 4, 9, 0) }, new Date(2025, 5, 4, 12, 0))).toBe(3);
  });

  it('returns zero for an unparseable clock-in', () => {
    expect(entryHours({ clockIn: 'not a timestamp' })).toBe(0);
  });

  it('groups hours by local calendar day', () => {
    const byDay = hoursByDay([
      { clockIn: new Date(2025, 5, 4, 9, 0), clockOut: new Date(2025, 5, 4, 13, 0) },
      { clockIn: new Date(2025, 5, 4, 14, 0), clockOut: new Date(2025, 5, 4, 18, 0) },
      { clockIn: new Date(2025, 5, 5, 9, 0), clockOut: new Date(2025, 5, 5, 12, 0) },
    ]);
    expect(byDay).toEqual({ '2025-06-04': 8, '2025-06-05': 3 });
  });

  it('prices rostered shifts after unpaid breaks', () => {
    expect(
      shiftHours({
        employeeId: 'e',
        startAt: new Date(2025, 5, 4, 9, 0),
        endAt: new Date(2025, 5, 4, 17, 0),
        breakMinutes: 30,
      }),
    ).toBe(7.5);
    expect(
      shiftHours({
        employeeId: 'e',
        startAt: new Date(2025, 5, 4, 17, 0),
        endAt: new Date(2025, 5, 4, 9, 0),
      }),
    ).toBe(0);
  });
});

describe('overtime', () => {
  it('tops a week up to the weekly threshold', () => {
    expect(splitOvertime([8, 8, 8, 8, 8, 2])).toEqual({
      regularHours: 40,
      overtimeHours: 2,
      totalHours: 42,
    });
  });

  it('applies the daily threshold first, then the weekly one', () => {
    expect(splitOvertime([10, 8, 6], { dailyThreshold: 8 })).toEqual({
      regularHours: 22,
      overtimeHours: 2,
      totalHours: 24,
    });
    // Five 10-hour days are 10 daily OT hours and 40 regular, not 50 and 10.
    expect(splitOvertime([10, 10, 10, 10, 10], { dailyThreshold: 8 })).toEqual({
      regularHours: 40,
      overtimeHours: 10,
      totalHours: 50,
    });
  });

  it('costs overtime at the multiplier', () => {
    expect(labourCost({ regularHours: 40, overtimeHours: 10, totalHours: 50 }, 20)).toBe(1100);
    expect(labourCost({ regularHours: 4, overtimeHours: 0, totalHours: 4 }, 15, 2)).toBe(60);
  });
});

describe('roster conflicts', () => {
  const day = (d: number, h: number, m = 0) => new Date(2025, 5, d, h, m);

  it('finds a double-booked employee', () => {
    const conflicts = detectConflicts([
      { id: 's1', employeeId: 'e1', startAt: day(4, 9), endAt: day(4, 13) },
      { id: 's2', employeeId: 'e1', startAt: day(4, 12), endAt: day(4, 16) },
    ]);
    expect(conflicts.map((c) => c.reason)).toEqual(['OVERLAP']);
  });

  it('flags a short turnaround between shifts', () => {
    const conflicts = detectConflicts([
      { id: 's1', employeeId: 'e1', startAt: day(4, 9), endAt: day(4, 17) },
      { id: 's2', employeeId: 'e1', startAt: day(5, 2), endAt: day(5, 6) },
    ]);
    expect(conflicts.map((c) => c.reason)).toEqual(['INSUFFICIENT_REST']);
    expect(conflicts[0].detail).toContain('9h rest');
  });

  it('flags implausible and inverted shifts', () => {
    expect(
      detectConflicts([{ id: 's1', employeeId: 'e1', startAt: day(4, 6), endAt: day(4, 23) }]).map(
        (c) => c.reason,
      ),
    ).toEqual(['TOO_LONG']);
    expect(
      detectConflicts([{ id: 's1', employeeId: 'e1', startAt: day(4, 17), endAt: day(4, 9) }]).map(
        (c) => c.reason,
      ),
    ).toEqual(['PAST_END']);
  });

  it('ignores cancelled shifts and does not cross employees', () => {
    expect(
      detectConflicts([
        { id: 's1', employeeId: 'e1', startAt: day(4, 9), endAt: day(4, 17), status: 'CANCELLED' },
        { id: 's2', employeeId: 'e1', startAt: day(4, 10), endAt: day(4, 12) },
        { id: 's3', employeeId: 'e2', startAt: day(4, 9), endAt: day(4, 17) },
      ]),
    ).toEqual([]);
  });

  it('accepts a turnaround above the configured minimum rest', () => {
    expect(
      detectConflicts(
        [
          { id: 's1', employeeId: 'e1', startAt: day(4, 9), endAt: day(4, 13) },
          { id: 's2', employeeId: 'e1', startAt: day(4, 18), endAt: day(4, 22) },
        ],
        { minRestHours: 4 },
      ),
    ).toEqual([]);
  });
});

describe('availability and coverage', () => {
  const window = { employeeId: 'e1', weekday: 3, startMinute: 9 * 60, endMinute: 17 * 60 };

  it('accepts a shift inside declared availability', () => {
    const shifts = [
      { id: 's1', employeeId: 'e1', startAt: new Date(2025, 5, 4, 10, 0), endAt: new Date(2025, 5, 4, 14, 0) },
    ];
    expect(availabilityViolations(shifts, [window])).toEqual([]);
  });

  it('flags a shift outside declared availability', () => {
    const shifts = [
      { id: 's1', employeeId: 'e1', startAt: new Date(2025, 5, 4, 18, 0), endAt: new Date(2025, 5, 4, 20, 0) },
    ];
    const violations = availabilityViolations(shifts, [window]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ employeeId: 'e1', shiftId: 's1', weekday: 3 });
  });

  it('leaves employees without declarations unrestricted', () => {
    const shifts = [
      { id: 's1', employeeId: 'e2', startAt: new Date(2025, 5, 4, 22, 0), endAt: new Date(2025, 5, 4, 23, 0) },
    ];
    expect(availabilityViolations(shifts, [window])).toEqual([]);
    expect(availabilityViolations(shifts, [])).toEqual([]);
  });

  it('counts distinct employees toward a coverage requirement', () => {
    const shifts = [
      { id: 's1', employeeId: 'e1', startAt: new Date(2025, 5, 4, 9, 0), endAt: new Date(2025, 5, 4, 17, 0) },
      { id: 's2', employeeId: 'e2', startAt: new Date(2025, 5, 4, 10, 0), endAt: new Date(2025, 5, 4, 14, 0) },
      // A second shift by the same person must not fake headcount.
      { id: 's3', employeeId: 'e2', startAt: new Date(2025, 5, 4, 15, 0), endAt: new Date(2025, 5, 4, 18, 0) },
      {
        id: 's4',
        employeeId: 'e3',
        startAt: new Date(2025, 5, 4, 9, 0),
        endAt: new Date(2025, 5, 4, 17, 0),
        status: 'CANCELLED',
      },
    ];
    expect(
      coverageGaps(shifts, [{ weekday: 3, startMinute: 9 * 60, endMinute: 17 * 60, minHeadcount: 3 }]),
    ).toEqual([{ weekday: 3, startMinute: 540, endMinute: 1020, required: 3, scheduled: 2, shortBy: 1 }]);
    expect(
      coverageGaps(shifts, [{ weekday: 3, startMinute: 9 * 60, endMinute: 17 * 60, minHeadcount: 2 }]),
    ).toEqual([]);
  });

  it('reports labour as a share of sales', () => {
    expect(labourPercent(500, 5000)).toBe(10);
    expect(labourPercent(500, 0)).toBeNull();
    expect(salesPerLabourHour(5000, 200)).toBe(25);
    expect(salesPerLabourHour(5000, 0)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Custom report builder
// ─────────────────────────────────────────────────────────────────────────────

const salesRows = [
  {
    orderNumber: 'A-1',
    channel: 'POS',
    status: 'PAID',
    currency: 'USD',
    subtotal: 90,
    discountAmount: 0,
    taxAmount: 10,
    tipAmount: 5,
    totalAmount: 100,
    createdAt: new Date(2025, 5, 4),
  },
  {
    orderNumber: 'A-2',
    channel: 'POS',
    status: 'PAID',
    currency: 'USD',
    subtotal: 36,
    discountAmount: 0,
    taxAmount: 4,
    tipAmount: 0,
    totalAmount: 40,
    createdAt: new Date(2025, 5, 4),
  },
  {
    orderNumber: 'A-3',
    channel: 'ONLINE',
    status: 'PAID',
    currency: 'USD',
    subtotal: 54,
    discountAmount: 0,
    taxAmount: 6,
    tipAmount: 0,
    totalAmount: 60,
    createdAt: new Date(2025, 5, 5),
  },
];

describe('report definition validation', () => {
  it('accepts a definition built from declared columns only', () => {
    expect(validateDefinition({ source: 'SALES', columns: ['orderNumber', 'totalAmount'] })).toEqual({
      ok: true,
      errors: [],
    });
    expect(
      validateDefinition({
        source: 'sales',
        columns: ['totalAmount'],
        groupBy: 'channel',
        sortBy: 'totalAmount',
        sortDir: 'asc',
      }),
    ).toEqual({ ok: true, errors: [] });
  });

  it('rejects sources it does not know', () => {
    expect(validateDefinition({ source: 'USERS', columns: ['password'] })).toEqual({
      ok: false,
      errors: ['Unknown source "USERS"'],
    });
  });

  it('rejects undeclared columns and bad sorting', () => {
    const r = validateDefinition({ source: 'SALES', columns: ['orderNumber', 'password'], sortDir: 'sideways' });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('Unknown column "password" for SALES');
    expect(r.errors).toContain('sortDir must be asc or desc');
  });

  it('requires at least one column', () => {
    expect(validateDefinition({ source: 'SALES', columns: [] }).errors).toContain(
      'At least one column is required',
    );
  });

  it('rejects a filter on a column the source does not expose', () => {
    expect(
      validateDefinition({ source: 'SALES', columns: ['totalAmount'], filters: { eq: { password: 'x' } } })
        .errors,
    ).toContain('Unknown filter column "password"');
  });

  it('accepts a filter set on declared columns', () => {
    // Regression: the validator used to walk the operator names as if they were
    // columns, so every filtered report was refused with `Unknown filter column
    // "eq"` before it ever ran.
    expect(
      validateDefinition({
        source: 'SALES',
        columns: ['totalAmount'],
        filters: { gte: { totalAmount: 50 }, in: { channel: ['POS'] } },
      }),
    ).toEqual({ ok: true, errors: [] });
  });

  it('rejects an operator the builder cannot apply', () => {
    expect(
      validateDefinition({ source: 'SALES', columns: ['totalAmount'], filters: { like: { orderNumber: 'A' } } })
        .errors,
    ).toContain('Unknown filter operator "like"');
  });
});

describe('report execution', () => {
  it('filters, totals and reports the match count', () => {
    const result = buildReport(
      { source: 'SALES', columns: ['orderNumber', 'totalAmount'], filters: { gte: { totalAmount: 50 } } },
      salesRows,
    );
    expect(result.matchedRows).toBe(2);
    expect(result.rows.map((r) => r.orderNumber)).toEqual(['A-1', 'A-3']);
    expect(result.totals).toEqual({ totalAmount: 160 });
    expect(result.truncated).toBe(false);
  });

  it('sorts on the requested column and direction', () => {
    const result = buildReport(
      { source: 'SALES', columns: ['orderNumber', 'totalAmount'], sortBy: 'totalAmount', sortDir: 'asc' },
      salesRows,
    );
    expect(result.rows.map((r) => r.orderNumber)).toEqual(['A-2', 'A-3', 'A-1']);
  });

  it('truncates at the limit but keeps the true match count', () => {
    const result = buildReport({ source: 'SALES', columns: ['orderNumber'] }, salesRows, { limit: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.matchedRows).toBe(3);
  });

  it('groups and sums per group', () => {
    const result = buildReport(
      { source: 'SALES', columns: ['channel', 'totalAmount'], groupBy: 'channel' },
      salesRows,
    );
    expect(result.rows).toEqual([
      { channel: 'POS', count: 2, totalAmount: 140 },
      { channel: 'ONLINE', count: 1, totalAmount: 60 },
    ]);
    expect(result.columns.map((c) => c.key)).toEqual(['channel', 'count', 'totalAmount']);
    expect(result.totals.totalAmount).toBe(200);
  });

  it('is empty for a source that does not exist', () => {
    expect(buildReport({ source: 'NOPE', columns: ['x'] }, salesRows)).toEqual({
      columns: [],
      rows: [],
      totals: {},
      matchedRows: 0,
      truncated: false,
    });
  });
});

describe('CSV rendering', () => {
  const columns = [
    { key: 'name', label: 'Name', type: 'string' as const },
    { key: 'note', label: 'Note', type: 'string' as const },
  ];

  it('quotes commas, quotes and newlines per RFC 4180', () => {
    const csv = toCsv(columns, [
      { name: 'Widget, large', note: 'He said "hi"' },
      { name: 'Plain', note: null },
      { name: 'Multi', note: 'line one\nline two' },
    ]);
    expect(csv).toBe(
      'Name,Note\r\n' +
        '"Widget, large","He said ""hi"""\r\n' +
        'Plain,\r\n' +
        'Multi,"line one\nline two"',
    );
  });

  it('writes a header even with no rows', () => {
    expect(toCsv(columns, [])).toBe('Name,Note');
  });
});
