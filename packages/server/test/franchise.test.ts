import { describe, it, expect } from 'vitest';
import {
  normalizeTiers,
  tieredRoyalty,
  royaltyExclusions,
  computeRoyalty,
  transferPrice,
  consolidatePnl,
  periodLabel,
  royaltyAging,
  type RoyaltyAgreement,
  type EntityPnl,
} from '../src/services/franchise';

const DAY = 24 * 60 * 60 * 1000;
const DUE = new Date('2026-01-01T00:00:00Z');

describe('tiered royalty', () => {
  it('sorts bands by ceiling and puts the open-ended one last', () => {
    const rows = normalizeTiers([{ upTo: null, percent: 4 }, { upTo: 250_000, percent: 6 }]);
    expect(rows.map((r) => r.upTo)).toEqual([250_000, null]);
    expect(normalizeTiers([{ upTo: -5, percent: 6 }])[0].upTo).toBe(0);
    expect(normalizeTiers(undefined)).toEqual([]);
  });

  it('taxes each band only on its own slice', () => {
    const result = tieredRoyalty(300_000, [{ upTo: 250_000, percent: 6 }, { upTo: null, percent: 4 }]);
    expect(result.bands).toEqual([
      { from: 0, to: 250_000, percent: 6, royalty: 15_000 },
      { from: 250_000, to: Infinity, percent: 4, royalty: 2000 },
    ]);
    expect(result.amount).toBe(17_000);
  });

  it('inherits the last band rate for "and 4 % thereafter"', () => {
    const result = tieredRoyalty(300, [{ upTo: 100, percent: 10 }, { upTo: 200, percent: 5 }]);
    expect(result.bands).toHaveLength(3);
    expect(result.bands[2]).toEqual({ from: 200, to: Infinity, percent: 5, royalty: 5 });
    expect(result.amount).toBe(20);
  });

  it('is zero without bands, and never negative', () => {
    expect(tieredRoyalty(1000, [])).toEqual({ amount: 0, bands: [] });
    expect(tieredRoyalty(-500, [{ upTo: 100, percent: 6 }]).amount).toBe(0);
  });
});

describe('royalty base', () => {
  it('removes only the agreed exclusion categories, case-insensitively', () => {
    const agreement: RoyaltyAgreement = { royaltyModel: 'PERCENT', royaltyPercent: 5, exclusions: ['vat', 'tips'] };
    const { excluded, taxableBase } = royaltyExclusions(0, agreement, {
      grossSales: 1000,
      excludedByCategory: { VAT: 100, TIPS: 50, GIFTCARDS: 900 },
    });
    expect(excluded).toEqual([{ category: 'VAT', amount: 100 }, { category: 'TIPS', amount: 50 }]);
    expect(taxableBase).toBe(850);
  });

  it('drops empty exclusion lines and honours a pre-agreed base', () => {
    const agreement: RoyaltyAgreement = { royaltyModel: 'PERCENT', royaltyPercent: 5, exclusions: ['VAT', 'TIPS'] };
    const { excluded } = royaltyExclusions(0, agreement, { grossSales: 1000, excludedByCategory: { VAT: 0 } });
    expect(excluded.map((e) => e.category)).toEqual([]);
    const overridden = royaltyExclusions(0, { ...agreement }, { grossSales: 1000, taxableBaseOverride: 500 });
    expect(overridden.taxableBase).toBe(500);
  });

  it('cannot drive the base below zero with oversized exclusions', () => {
    const agreement: RoyaltyAgreement = { royaltyModel: 'PERCENT', royaltyPercent: 5, exclusions: ['VAT'] };
    expect(royaltyExclusions(0, agreement, { grossSales: 100, excludedByCategory: { VAT: 500 } }).taxableBase).toBe(0);
  });
});

describe('computeRoyalty', () => {
  it('charges a flat percent plus the marketing fund', () => {
    const result = computeRoyalty({ royaltyModel: 'PERCENT', royaltyPercent: 5, marketingFundPercent: 2 }, { grossSales: 1000 });
    expect(result.taxableBase).toBe(1000);
    expect(result.royalty).toBe(50);
    expect(result.marketingFund).toBe(20);
    expect(result.total).toBe(70);
    expect(result.effectiveRatePercent).toBe(5);
    expect(result.calculation.map((c) => c.step)).toEqual(['gross-sales', 'royalty', 'marketing-fund']);
  });

  it('lifts a small royalty to the monthly minimum and says so', () => {
    const result = computeRoyalty({ royaltyModel: 'PERCENT', royaltyPercent: 1, minimumMonthly: 25 }, { grossSales: 1000 });
    expect(result.royalty).toBe(25);
    expect(result.minimumApplied).toBe(true);
    expect(result.calculation.some((c) => c.step === 'minimum')).toBe(true);
  });

  it('never applies the minimum on top of a fixed fee', () => {
    const result = computeRoyalty({ royaltyModel: 'FIXED', fixedMonthly: 500, minimumMonthly: 900 }, { grossSales: 10 });
    expect(result.royalty).toBe(500);
    expect(result.minimumApplied).toBe(false);
  });

  it('charges per unit on truncated counts', () => {
    const result = computeRoyalty({ royaltyModel: 'PER_ITEM', perItemFee: 0.5 }, { grossSales: 1000, unitsSold: 150.9 });
    expect(result.unitsSold).toBe(150);
    expect(result.royalty).toBe(75);
    expect(result.calculation.find((c) => c.step === 'royalty')?.detail).toContain('150 units');
  });

  it('walks the bands for a tiered agreement, exclusions first', () => {
    const result = computeRoyalty(
      {
        royaltyModel: 'TIERED',
        tiers: [{ upTo: 250_000, percent: 6 }, { upTo: null, percent: 4 }],
        exclusions: ['VAT'],
      },
      { grossSales: 300_000, excludedByCategory: { VAT: 50_000 } }
    );
    expect(result.taxableBase).toBe(250_000);
    expect(result.royalty).toBe(15_000);
    expect(result.effectiveRatePercent).toBe(5);
    const steps = result.calculation.map((c) => c.step);
    expect(steps).toEqual(['gross-sales', 'exclusion', 'taxable-base', 'tier']);
    // Six percent on the whole 250k base, so only one band is reported.
    expect(result.calculation.filter((c) => c.step === 'tier')).toHaveLength(1);
  });

  it('reports the effective rate against gross, not the base', () => {
    const result = computeRoyalty({ royaltyModel: 'PERCENT', royaltyPercent: 10, exclusions: ['VAT'] }, { grossSales: 1000, excludedByCategory: { VAT: 200 } });
    expect(result.royalty).toBe(80);
    expect(result.effectiveRatePercent).toBe(8);
  });

  it('has no rate to quote on a dead period', () => {
    const result = computeRoyalty({ royaltyModel: 'PERCENT', royaltyPercent: 5 }, { grossSales: 0 });
    expect(result.effectiveRatePercent).toBeNull();
    expect(result.royalty).toBe(0);
  });

  it('falls back to the fixed-fee branch for an unknown model', () => {
    const result = computeRoyalty({ royaltyModel: 'SLIDING' as never, fixedMonthly: 300 }, { grossSales: 1000 });
    expect(result.royalty).toBe(300);
    expect(result.model).toBe('SLIDING');
  });
});

describe('transfer pricing', () => {
  it('marks up cost and keeps freight out of the margin', () => {
    expect(transferPrice(10, 20, 0, 5)).toEqual({ unitPrice: 12, total: 60, margin: 10 });
    const withFreight = transferPrice(10, 20, 8, 5);
    expect(withFreight.total).toBe(68);
    expect(withFreight.unitPrice).toBe(13.6);
    expect(withFreight.margin).toBe(10);
  });

  it('treats a nonsense quantity as one unit and never a negative cost', () => {
    expect(transferPrice(10, 20, 0, 0).total).toBe(12);
    expect(transferPrice(-5, 20).margin).toBe(0);
    expect(transferPrice(10, -50).unitPrice).toBe(10);
  });
});

describe('consolidation', () => {
  const entities: EntityPnl[] = [
    { entityCode: 'HQ', revenue: 1000, costOfGoods: 400, labour: 100, operatingExpenses: 50, intercompanyRevenue: 200 },
    { entityCode: 'STORE', revenue: 800, costOfGoods: 500, labour: 150, operatingExpenses: 60, intercompanyCost: 160 },
  ];

  it('eliminates the network selling to itself', () => {
    const pnl = consolidatePnl(entities);
    expect(pnl.eliminations).toEqual({ intercompanyRevenue: 200, intercompanyCost: 160, unrealisedProfit: 40 });
    expect(pnl.totals.revenue).toBe(1600);
    expect(pnl.totals.costOfGoods).toBe(740);
    expect(pnl.totals.grossProfit).toBe(860);
    expect(pnl.totals.ebitda).toBe(500);
    expect(pnl.totals.marginPercent).toBe(31.25);
  });

  it('keeps each entity on its own numbers and ranks contributors', () => {
    const pnl = consolidatePnl(entities);
    expect(pnl.topContributor).toBe('HQ');
    const hq = pnl.entities.find((e) => e.entityCode === 'HQ');
    expect(hq?.ebitda).toBe(450);
    expect(hq?.marginPercent).toBe(45);
    // The eliminated margin is recognised by the franchisor only on external sales.
    expect(consolidatePnl(entities, { royaltyPercentForEliminations: 5 }).royaltiesDue).toBe(2);
  });

  it('never reports profit the buying entity has not realised', () => {
    const reversed = consolidatePnl([
      { entityCode: 'A', revenue: 500, costOfGoods: 100, labour: 0, operatingExpenses: 0, intercompanyRevenue: 100, intercompanyCost: 250 },
    ]);
    expect(reversed.eliminations.unrealisedProfit).toBe(0);
  });

  it('survives an empty network and a zero-revenue entity', () => {
    const empty = consolidatePnl([]);
    expect(empty.totals.marginPercent).toBeNull();
    expect(empty.topContributor).toBeNull();
    expect(empty.totals.revenue).toBe(0);
    expect(consolidatePnl([{ entityCode: 'X', revenue: 0, costOfGoods: 0, labour: 0, operatingExpenses: 0 }]).entities[0].marginPercent).toBeNull();
  });
});

describe('periods and ageing', () => {
  it('labels the accrual month in UTC', () => {
    expect(periodLabel(new Date('2026-09-15T23:00:00Z'))).toBe('2026-09');
    expect(periodLabel(new Date(Date.UTC(2026, 0, 1)))).toBe('2026-01');
    expect(periodLabel(new Date(Date.UTC(2026, 11, 31)))).toBe('2026-12');
  });

  it('buckets a debt by how overdue it is', () => {
    expect(royaltyAging(DUE, DUE).bucket).toBe('CURRENT');
    expect(royaltyAging(DUE, new Date(DUE.getTime() - 5 * DAY))).toEqual({ days: 0, bucket: 'CURRENT' });
    expect(royaltyAging(DUE, new Date(DUE.getTime() + 5 * DAY)).bucket).toBe('D1_30');
    expect(royaltyAging(DUE, new Date(DUE.getTime() + 31 * DAY)).bucket).toBe('D31_60');
    expect(royaltyAging(DUE, new Date(DUE.getTime() + 61 * DAY)).bucket).toBe('D61_90');
    expect(royaltyAging(DUE, new Date(DUE.getTime() + 91 * DAY))).toEqual({ days: 91, bucket: 'OVER_90' });
  });
});
