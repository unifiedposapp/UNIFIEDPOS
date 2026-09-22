import { describe, it, expect } from 'vitest';
import {
  WEEKDAY_NAMES,
  localDayHour,
  buildPeakHeatmap,
  detectDeadStock,
  monthsOfCover,
  summarizeDeadStock,
  type StockRow,
} from '../src/services/tradingPatterns';

// 2026-09-21 is a Monday, which makes the day arithmetic below checkable by eye.
const MONDAY_1330_UTC = new Date('2026-09-21T13:30:00Z');

// ─── Timezone-local bucketing ───────────────────────────────────────────────
describe('localDayHour', () => {
  it('reads Monday 13:30 UTC as Monday 13:30 in UTC', () => {
    expect(localDayHour(MONDAY_1330_UTC, 'UTC')).toEqual({ day: 0, hour: 13 });
  });

  it('shifts the same instant to when the store actually feels it', () => {
    // Karachi is UTC+5 year-round: 13:30Z is 18:30 on the shop clock.
    expect(localDayHour(MONDAY_1330_UTC, 'Asia/Karachi')).toEqual({ day: 0, hour: 18 });
    // New York is UTC-4 in September: 13:30Z is 09:30 the same Monday.
    expect(localDayHour(MONDAY_1330_UTC, 'America/New_York')).toEqual({ day: 0, hour: 9 });
  });

  it('crosses the weekday boundary the way the store sees it', () => {
    // 02:00Z Tuesday is 22:00 Monday in New York — a late Tuesday table turn
    // belongs to Monday night for staffing (Monday-first grid: day 0).
    expect(localDayHour(new Date('2026-09-22T02:00:00Z'), 'America/New_York')).toEqual({ day: 0, hour: 22 });
    // In UTC that same instant is already Tuesday (day 1).
    expect(localDayHour(new Date('2026-09-22T02:00:00Z'), 'UTC')).toEqual({ day: 1, hour: 2 });
  });

  it('degrades to UTC on a nonsense zone instead of throwing', () => {
    expect(localDayHour(MONDAY_1330_UTC, 'Mars/Olympus_Mons')).toEqual({ day: 0, hour: 13 });
    expect(localDayHour(MONDAY_1330_UTC, null)).toEqual({ day: 0, hour: 13 });
    expect(localDayHour(new Date('nonsense'), 'UTC')).toEqual({ day: 0, hour: 0 });
  });

  it('accepts an ISO string just as happily as a Date', () => {
    expect(localDayHour(MONDAY_1330_UTC.toISOString(), 'UTC')).toEqual({ day: 0, hour: 13 });
  });
});

// ─── Peak heatmap ───────────────────────────────────────────────────────────
describe('buildPeakHeatmap', () => {
  const orders = [
    { createdAt: MONDAY_1330_UTC, totalAmount: 40, channel: 'IN_STORE' },
    { createdAt: new Date('2026-09-21T13:45:00Z'), totalAmount: 60, channel: 'IN_STORE' },
    { createdAt: new Date('2026-09-26T19:10:00Z'), totalAmount: 25, channel: 'WEBSITE' }, // Saturday evening
  ];

  it('always returns a complete 7 × 24 grid so the UI never fills gaps', () => {
    const map = buildPeakHeatmap(orders, { timezone: 'UTC', windowDays: 30 });
    expect(map.grid).toHaveLength(168);
    expect(map.byDay).toHaveLength(7);
    expect(map.byHour).toHaveLength(24);
    expect(WEEKDAY_NAMES[map.byDay[0].day]).toBe('Monday');
  });

  it('buckets money and counts per slot, in the store timezone', () => {
    const map = buildPeakHeatmap(orders, { timezone: 'UTC' });
    const mondayTea = map.grid.find((c) => c.day === 0 && c.hour === 13)!;
    expect(mondayTea.orders).toBe(2);
    expect(mondayTea.revenue).toBe(100);
    expect(map.peak).toMatchObject({ day: 0, hour: 13, orders: 2 });
    expect(map.peak?.name).toBe('Monday 13:00');
    expect(map.totalOrders).toBe(3);
    expect(map.totalRevenue).toBe(125);
  });

  it('handles Decimal-ish string amounts from the database', () => {
    const map = buildPeakHeatmap([{ createdAt: MONDAY_1330_UTC, totalAmount: '12.34' }], { timezone: 'UTC' });
    expect(map.totalRevenue).toBe(12.34);
  });

  it('ranks the busiest slots and names genuinely empty ones as quiet', () => {
    const map = buildPeakHeatmap(orders, { timezone: 'UTC' });
    expect(map.busiest[0]).toMatchObject({ day: 0, hour: 13 });
    expect(map.busiest.every((c) => c.orders > 0)).toBe(true);
    expect(map.quietest.every((c) => c.orders === 0)).toBe(true);
    expect(map.quietest.length).toBeGreaterThan(0);
  });

  it('reports how concentrated trade is, and survives an empty window', () => {
    const map = buildPeakHeatmap(orders, { timezone: 'UTC' });
    // Three orders, two in one slot: the ten busiest slots hold everything.
    expect(map.concentration).toBe(1);
    const empty = buildPeakHeatmap([], { timezone: 'Europe/Paris' });
    expect(empty.peak).toBeNull();
    expect(empty.concentration).toBe(0);
    expect(empty.busiest).toEqual([]);
    expect(empty.timezone).toBe('Europe/Paris');
  });

  it('falls back to UTC when the stored timezone is junk', () => {
    expect(buildPeakHeatmap(orders, { timezone: 'not/a-zone' }).timezone).toBe('UTC');
  });
});

// ─── Dead stock ─────────────────────────────────────────────────────────────
function row(over: Partial<StockRow> & { productId: string }): StockRow {
  return {
    name: over.productId,
    sku: null,
    type: 'PHYSICAL',
    quantity: 10,
    costPrice: 5,
    price: 10,
    lastSoldAt: null,
    lastTouchedAt: null,
    ...over,
  } as StockRow;
}

const AS_OF = new Date('2026-09-21T12:00:00Z');
const daysAgo = (n: number) => new Date(AS_OF.getTime() - n * 86_400_000);

describe('detectDeadStock', () => {
  it('ignores anything that is not sitting on the shelf', () => {
    const { items } = detectDeadStock(
      [
        row({ productId: 'sold-recently', lastSoldAt: daysAgo(5) }),
        row({ productId: 'zero-qty', quantity: 0, lastSoldAt: daysAgo(400) }),
        row({ productId: 'service', type: 'SERVICE', lastSoldAt: daysAgo(400) }),
        row({ productId: 'giftcard', type: 'GIFT_CARD', lastSoldAt: daysAgo(400) }),
        row({ productId: 'no-history-at-all' }),
      ],
      { asOf: AS_OF }
    );
    expect(items).toEqual([]);
  });

  it('grades by how long the line has actually been idle', () => {
    const { items, thresholds } = detectDeadStock(
      [
        row({ productId: 'slow', lastSoldAt: daysAgo(35), quantity: 4, costPrice: 10 }),
        row({ productId: 'dead', lastSoldAt: daysAgo(75), quantity: 4, costPrice: 10 }),
        row({ productId: 'frozen', lastSoldAt: daysAgo(300), quantity: 4, costPrice: 10 }),
      ],
      { asOf: AS_OF }
    );
    expect(thresholds).toEqual({ slowDays: 30, deadDays: 60, frozenDays: 120 });
    // Equal cash tied up, so the tie-break puts the longest-sleeping line first.
    expect(items.map((i) => [i.productId, i.daysIdle, i.severity])).toEqual([
      ['frozen', 300, 'FROZEN'],
      ['dead', 75, 'DEAD'],
      ['slow', 35, 'SLOW'],
    ]);
    expect(items.map((i) => i.suggestedAction)).toEqual(['TRANSFER', 'DISCOUNT', 'PROMOTE']);
  });

  it('measures a never-sold line from when it last moved, not from forever', () => {
    const { items } = detectDeadStock(
      [
        row({ productId: 'fresh-intake', lastSoldAt: null, lastTouchedAt: daysAgo(10) }),
        row({ productId: 'unsold-old', lastSoldAt: null, lastTouchedAt: daysAgo(200) }),
      ],
      { asOf: AS_OF }
    );
    expect(items).toHaveLength(1);
    expect(items[0].productId).toBe('unsold-old');
    expect(items[0].lastSoldAt).toBeNull();
    expect(items[0].suggestedAction).toBe('TRANSFER'); // frozen but cheap
  });

  it('respects custom thresholds', () => {
    const { items } = detectDeadStock([row({ productId: 'x', lastSoldAt: daysAgo(45) })], {
      asOf: AS_OF,
      slowDays: 60,
      deadDays: 90,
      frozenDays: 180,
    });
    expect(items).toHaveLength(0);
  });

  it('ranks by cash tied up so the biggest problem is first', () => {
    const { items } = detectDeadStock(
      [
        row({ productId: 'cheap', quantity: 100, costPrice: 0.5, lastSoldAt: daysAgo(90) }),
        row({ productId: 'pricey', quantity: 10, costPrice: 50, lastSoldAt: daysAgo(90) }),
      ],
      { asOf: AS_OF }
    );
    expect(items[0].productId).toBe('pricey');
    expect(items[0].costValue).toBe(500);
    expect(items[0].retailValue).toBe(100);
    expect(items[0].suggestedAction).toBe('DISCOUNT'); // dead: discount it out
  });

  it('recommends writing off a frozen line that ties up real money', () => {
    const { items } = detectDeadStock([row({ productId: 'big', quantity: 20, costPrice: 250, lastSoldAt: daysAgo(400) })], { asOf: AS_OF });
    expect(items[0].severity).toBe('FROZEN');
    expect(items[0].suggestedAction).toBe('WRITE_OFF');
  });

  it('honours ISO strings for the timestamps the API hands back', () => {
    const { items } = detectDeadStock(
      [row({ productId: 'iso', lastSoldAt: daysAgo(70).toISOString(), quantity: 2, costPrice: 3 })],
      { asOf: AS_OF }
    );
    expect(items[0].daysIdle).toBe(70);
    expect(items[0].lastSoldAt).toBe(daysAgo(70).toISOString());
  });
});

describe('summarizeDeadStock', () => {
  it('totals cash, units and severity mix', () => {
    const { items } = detectDeadStock(
      [
        row({ productId: 'a', quantity: 2, costPrice: 100, price: 150, lastSoldAt: daysAgo(40) }),
        row({ productId: 'b', quantity: 3, costPrice: 10, price: 25, lastSoldAt: daysAgo(400) }),
      ],
      { asOf: AS_OF }
    );
    const summary = summarizeDeadStock(items);
    expect(summary.skus).toBe(2);
    expect(summary.units).toBe(5);
    expect(summary.costTied).toBe(230);
    expect(summary.retailTied).toBe(375);
    expect(summary.bySeverity).toEqual({ SLOW: 1, DEAD: 0, FROZEN: 1 });
    expect(summary.worst?.productId).toBe('a');
  });

  it('is safe on nothing', () => {
    expect(summarizeDeadStock([])).toMatchObject({ skus: 0, units: 0, costTied: 0, worst: null });
  });
});

describe('monthsOfCover', () => {
  it('converts recent sales velocity into months of stock', () => {
    // 30 units over 30 days is one month of demand; 100 on hand is ~3.3 months.
    expect(monthsOfCover(100, 30, 30)).toBe(3.29);
    // A month of cover measured against a 30.44-day month comes out just under 1.
    expect(monthsOfCover(30, 30, 30)).toBe(0.99);
  });

  it('says "unknown" rather than infinity when the line does not sell', () => {
    expect(monthsOfCover(50, 0, 90)).toBeNull();
    expect(monthsOfCover(0, 10, 90)).toBe(0);
    expect(monthsOfCover(10, 5, 0)).toBeNull();
  });
});
