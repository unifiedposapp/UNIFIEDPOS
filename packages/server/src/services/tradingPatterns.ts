// ─── Trading patterns: when the shop is busy, and what is not selling ────────
// Two questions every retailer asks and most report screens dodge:
//   1. "Which hours actually need staff?"  → a day × hour heatmap, bucketed in
//      the store's own timezone so "lunch rush" means lunch where the store is.
//   2. "Which stock is eating my cash?"    → dead-stock detection over the
//      movement history, ranked by the money tied up, not by unit count.
//
// Both are pure functions over already-fetched rows so they can be unit-tested
// without a database, and so the SQL stays a simple read.

/** Monday-first labels, matching the `day` index used in the heatmap grid. */
export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/**
 * Convert an instant into (weekday, hour) as the store experiences it. An
 * unknown timezone degrades to UTC rather than throwing, because a report that
 * opens is worth more than one that is precisely wrong.
 */
export function localDayHour(at: Date | string, timeZone?: string | null): { day: number; hour: number } {
  const date = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(date.getTime())) return { day: 0, hour: 0 };
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = partsFormatter(timeZone && timeZone.trim() ? timeZone.trim() : 'UTC').formatToParts(date);
  } catch {
    parts = partsFormatter('UTC').formatToParts(date);
  }
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const mondayIndex = WEEKDAY_SHORT.indexOf(weekday.slice(0, 3) as (typeof WEEKDAY_SHORT)[number]);
  return { day: mondayIndex >= 0 ? mondayIndex : 0, hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : 0 };
}

export interface HeatCell {
  /** 0 = Monday … 6 = Sunday. */
  day: number;
  /** 0–23, store-local. */
  hour: number;
  orders: number;
  revenue: number;
}

export interface PeakHeatmap {
  timezone: string;
  windowDays: number;
  grid: HeatCell[]; // 7 × 24, always complete so the UI never fills gaps
  byDay: { day: number; name: string; orders: number; revenue: number }[];
  byHour: { hour: number; orders: number; revenue: number }[];
  busiest: HeatCell[];
  quietest: HeatCell[];
  totalOrders: number;
  totalRevenue: number;
  /** Share (0–1) of orders landing in the ten busiest slots — the staffing case. */
  concentration: number;
  peak: { day: number; hour: number; orders: number; revenue: number; name: string } | null;
}

/**
 * Bucket completed orders into a 7 × 24 heatmap.
 * `orders` only needs `createdAt` and a monetary `totalAmount`.
 */
export function buildPeakHeatmap(
  orders: { createdAt: Date | string; totalAmount: number | string }[],
  options: { timezone?: string | null; windowDays?: number } = {},
): PeakHeatmap {
  const timezone = (() => {
    const tz = (options.timezone || 'UTC').trim() || 'UTC';
    try {
      partsFormatter(tz);
      return tz;
    } catch {
      return 'UTC';
    }
  })();
  const grid: HeatCell[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, (_, hour) => ({ day: 0, hour, orders: 0, revenue: 0 })),
  );
  for (let day = 0; day < 7; day++) for (const cell of grid[day]) cell.day = day;

  let totalOrders = 0;
  let totalRevenue = 0;
  for (const order of orders) {
    const { day, hour } = localDayHour(new Date(order.createdAt), timezone);
    const revenue = Number(order.totalAmount || 0);
    grid[day][hour].orders += 1;
    grid[day][hour].revenue += Number.isFinite(revenue) ? revenue : 0;
    totalOrders += 1;
    totalRevenue += Number.isFinite(revenue) ? revenue : 0;
  }

  const flat = grid.flat();
  const byDay = grid.map((row, day) => ({
    day,
    name: WEEKDAY_NAMES[day],
    orders: row.reduce((s, c) => s + c.orders, 0),
    revenue: round2(row.reduce((s, c) => s + c.revenue, 0)),
  }));
  const byHour = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    orders: flat.filter((c) => c.hour === hour).reduce((s, c) => s + c.orders, 0),
    revenue: round2(flat.filter((c) => c.hour === hour).reduce((s, c) => s + c.revenue, 0)),
  }));

  const ranked = [...flat].sort((a, b) => b.orders - a.orders || b.revenue - a.revenue);
  const busiest = ranked.slice(0, 5).filter((c) => c.orders > 0);
  const quietest = [...flat]
    .sort((a, b) => a.orders - b.orders || a.revenue - b.revenue)
    .slice(0, 5)
    .filter((c) => c.orders === 0);
  const top = ranked.slice(0, 10).reduce((s, c) => s + c.orders, 0);

  const peakCell = ranked[0]?.orders > 0 ? ranked[0] : null;
  return {
    timezone,
    windowDays: options.windowDays ?? 90,
    grid: flat,
    byDay,
    byHour,
    busiest,
    quietest,
    totalOrders,
    totalRevenue: round2(totalRevenue),
    concentration: totalOrders ? round2(top / totalOrders) : 0,
    peak: peakCell ? { ...peakCell, name: `${WEEKDAY_NAMES[peakCell.day]} ${String(peakCell.hour).padStart(2, '0')}:00` } : null,
  };
}

// ─── Dead stock ──────────────────────────────────────────────────────────────

export interface StockRow {
  productId: string;
  name: string;
  sku: string | null;
  type: string;
  quantity: number;
  costPrice: number;
  price: number;
  /** When this product last left the shop on an order; null = never sold. */
  lastSoldAt: Date | string | null;
  /** When it was last received/recounted — the floor for "idle" on new lines. */
  lastTouchedAt?: Date | string | null;
  categoryId?: string | null;
  categoryName?: string | null;
}

export type DeadStockSeverity = 'HEALTHY' | 'SLOW' | 'DEAD' | 'FROZEN';
export type DeadStockAction = 'KEEP' | 'PROMOTE' | 'DISCOUNT' | 'TRANSFER' | 'RETURN_TO_SUPPLIER' | 'WRITE_OFF';

export interface DeadStockItem {
  productId: string;
  name: string;
  sku: string | null;
  categoryName: string | null;
  quantity: number;
  costValue: number;
  retailValue: number;
  lastSoldAt: string | null;
  daysIdle: number;
  severity: DeadStockSeverity;
  suggestedAction: DeadStockAction;
}

/**
 * Classify on-hand stock by how long it has sat. Idle time is measured from the
 * last sale; a line that has never sold is measured from when it last moved
 * (receipt) so fresh intake is not accused of being dead on arrival.
 */
export function detectDeadStock(
  rows: StockRow[],
  options: { asOf?: Date; slowDays?: number; deadDays?: number; frozenDays?: number } = {},
): { items: DeadStockItem[]; summary: ReturnType<typeof summarizeDeadStock>; thresholds: { slowDays: number; deadDays: number; frozenDays: number } } {
  const asOf = options.asOf ?? new Date();
  const slowDays = options.slowDays ?? 30;
  const deadDays = options.deadDays ?? 60;
  const frozenDays = options.frozenDays ?? 120;

  const items: DeadStockItem[] = [];
  for (const row of rows) {
    const quantity = Number(row.quantity || 0);
    if (quantity <= 0) continue; // nothing on the shelf is not tied-up cash
    // Only stock-carrying lines can be dead: a service or gift card has no
    // balance that ages (see shared PRODUCT_TYPES / isStockTracked).
    if (row.type && row.type !== 'PHYSICAL' && row.type !== 'NON_INVENTORY') continue;

    const lastSale = row.lastSoldAt ? new Date(row.lastSoldAt) : null;
    const touched = row.lastTouchedAt ? new Date(row.lastTouchedAt) : null;
    const anchor = lastSale ?? touched ?? null;
    if (!anchor || !Number.isFinite(anchor.getTime())) continue; // no history at all → unknown, not dead
    const daysIdle = Math.floor((asOf.getTime() - anchor.getTime()) / 86_400_000);
    if (daysIdle < slowDays) continue;

    const severity: DeadStockSeverity = daysIdle >= frozenDays ? 'FROZEN' : daysIdle >= deadDays ? 'DEAD' : 'SLOW';
    const costValue = round2(Number(row.costPrice || 0) * quantity);
    items.push({
      productId: row.productId,
      name: row.name,
      sku: row.sku,
      categoryName: row.categoryName ?? null,
      quantity,
      costValue,
      retailValue: round2(Number(row.price || 0) * quantity),
      lastSoldAt: lastSale ? lastSale.toISOString() : null,
      daysIdle,
      severity,
      suggestedAction: suggestAction(severity, costValue),
    });
  }

  items.sort((a, b) => b.costValue - a.costValue || b.daysIdle - a.daysIdle);
  return { items, summary: summarizeDeadStock(items), thresholds: { slowDays, deadDays, frozenDays } };
}

function suggestAction(severity: DeadStockSeverity, costValue: number): DeadStockAction {
  if (severity === 'SLOW') return costValue > 0 ? 'PROMOTE' : 'KEEP';
  if (severity === 'DEAD') return 'DISCOUNT';
  return costValue >= 1000 ? 'WRITE_OFF' : 'TRANSFER';
}

/** Totals a merchant reads first: how much cash is asleep, and how much of stock that is. */
export function summarizeDeadStock(items: DeadStockItem[]) {
  const costTied = round2(items.reduce((s, i) => s + i.costValue, 0));
  const bySeverity = { SLOW: 0, DEAD: 0, FROZEN: 0 } as Record<Exclude<DeadStockSeverity, 'HEALTHY'>, number>;
  for (const item of items) bySeverity[item.severity as Exclude<DeadStockSeverity, 'HEALTHY'>] += 1;
  return {
    skus: items.length,
    units: items.reduce((s, i) => s + i.quantity, 0),
    costTied,
    retailTied: round2(items.reduce((s, i) => s + i.retailValue, 0)),
    bySeverity,
    worst: items[0] ?? null,
  };
}

/** Inventory cover: months of sales at the recent run rate, null when it does not sell. */
export function monthsOfCover(quantity: number, unitsSoldInWindow: number, windowDays: number): number | null {
  if (quantity <= 0) return 0;
  if (unitsSoldInWindow <= 0 || windowDays <= 0) return null;
  const perMonth = (unitsSoldInWindow / windowDays) * 30.44;
  return round2(quantity / perMonth);
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}
