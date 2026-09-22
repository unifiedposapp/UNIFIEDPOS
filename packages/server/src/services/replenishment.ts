// ─── AGENTIC REPLENISHMENT PLANNER ───────────────────────────────────────────
// The buying agent's job is to answer one question per SKU: "how many units do
// I have to order today, from whom, so this line does not go out of stock
// before the next delivery lands, without tying up cash we do not need?"
//
// That is a deterministic computation over a demand forecast plus a few
// parameters, so it lives here as pure functions:
//
//   demand over the exposure window  = Σ forecast(lead time + review period)
//   safety stock                     = z(service level) · σdemand · √window
//   reorder point                    = windowed demand + safety stock
//   order quantity                   = target stock − (on hand + in transit)
//
// rounded out to the supplier's pack size and minimum, then trimmed to respect
// a cash guardrail by cutting the least urgent lines first. A human still
// approves the plan; the agent only drafts it.
import { round2 } from './moneyMath.js';

export const DEFAULT_SERVICE_LEVEL = 0.95;
export const MIN_QUANTITY = 1;

export interface ReplenishInput {
  productId: string;
  sku?: string | null;
  name: string;
  supplierId?: string | null;
  supplierName?: string | null;
  onHand: number;
  reserved?: number;
  inTransit?: number;
  /** Expected units per day over the planning horizon, oldest first. */
  dailyForecast: number[];
  /** Optional per-day demand dispersion used for safety stock. */
  dailyStdDev?: number | null;
  leadTimeDays: number;
  reviewPeriodDays?: number;
  unitCost: number;
  price?: number | null;
  packSize?: number;
  minOrderQty?: number;
  maxStock?: number | null;
  serviceLevel?: number;
  /** Skip the line entirely (discontinued, seasonal close-out, blocked supplier). */
  exclude?: boolean;
  excludeReason?: string;
}

export interface ReplenishItem {
  productId: string;
  sku: string | null;
  name: string;
  supplierId: string | null;
  supplierName: string | null;
  onHand: number;
  available: number;
  inTransit: number;
  demand: number;
  safetyStock: number;
  reorderPoint: number;
  targetStock: number;
  quantity: number;
  unitCost: number;
  cost: number;
  daysOfCover: number | null;
  urgency: number;
  action: 'ORDER' | 'WATCH' | 'NONE' | 'EXCLUDED';
  reason: string;
}

export interface PlanOptions {
  serviceLevel?: number;
  maxSpend?: number | null;
  excludedSuppliers?: (string | null)[];
  minQuantity?: number;
  /** Cap the number of lines the plan can hold, for a one-truck-per-day operation. */
  maxLines?: number | null;
}

export interface PlanResult {
  items: ReplenishItem[];
  bySupplier: { supplierId: string | null; supplierName: string | null; lines: number; units: number; cost: number }[];
  totals: { lines: number; units: number; cost: number; trimmed: number; trimmedCost: number };
  serviceLevel: number;
}

/**
 * Inverse standard-normal quantile (Acklam's rational approximation), accurate
 * to ~1e-6 in the range a planner uses. Called once per SKU, so the closed form
 * beats shipping a lookup table.
 */
export function zScore(p: number): number {
  const prob = Number(p);
  if (!Number.isFinite(prob) || prob <= 0 || prob >= 1) return 1.6449; // default 95 %
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425, pu = 1 - pl;
  let q: number, r: number;
  if (prob < pl) {
    q = Math.sqrt(-2 * Math.log(prob));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (prob > pu) {
    q = Math.sqrt(-2 * Math.log(1 - prob));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = prob - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function stdDev(values: number[]): number {
  const nums = (values || []).map((v) => Number(v) || 0);
  if (nums.length < 2) return 0;
  const mean = nums.reduce((s, v) => s + v, 0) / nums.length;
  const variance = nums.reduce((s, v) => s + (v - mean) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

/** Sum of the first `days` of the forecast, repeating the last value if the horizon is shorter. */
export function demandOverWindow(dailyForecast: number[], days: number): number {
  const series = (dailyForecast || []).map((v) => Math.max(0, Number(v) || 0));
  const window = Math.max(1, Math.trunc(Number(days) || 1));
  if (!series.length) return 0;
  let total = 0;
  for (let i = 0; i < window; i++) total += series[i] ?? series[series.length - 1];
  return round2(total);
}

export function safetyStock(demandStdDev: number, windowDays: number, serviceLevel = DEFAULT_SERVICE_LEVEL): number {
  const sigma = Math.max(0, Number(demandStdDev) || 0);
  const days = Math.max(1, Number(windowDays) || 1);
  return Math.ceil(zScore(serviceLevel) * sigma * Math.sqrt(days));
}

/** Pack size + supplier minimum, applied last so the maths above stays clean. */
export function packRound(quantity: number, packSize = 1, minOrderQty = MIN_QUANTITY): number {
  const pack = Math.max(1, Math.trunc(Number(packSize) || 1));
  const min = Math.max(0, Math.trunc(Number(minOrderQty) || 0));
  let qty = Math.max(0, Math.trunc(Number(quantity) || 0));
  if (qty > 0) qty = Math.ceil(qty / pack) * pack;
  if (qty > 0 && qty < min) qty = Math.ceil(min / pack) * pack;
  return qty;
}

export function daysOfCover(onHand: number, avgDailyDemand: number): number | null {
  const avg = Number(avgDailyDemand) || 0;
  if (avg <= 0) return null; // no demand: coverage is undefined, not infinite
  return round2(Math.max(0, Number(onHand) || 0) / avg);
}

/**
 * Wilson square-root formula. Only worth using when ordering is expensive
 * relative to holding; the planner reports it as a suggestion, never overrides
 * the service-level maths with it.
 */
export function economicOrderQuantity(annualDemand: number, orderCost: number, unitCost: number, holdingRate = 0.25): number {
  const d = Math.max(0, Number(annualDemand) || 0);
  const s = Math.max(0, Number(orderCost) || 0);
  const h = Math.max(0.0001, (Number(unitCost) || 0) * (Number(holdingRate) || 0.25));
  if (d <= 0 || s <= 0) return 0;
  return Math.ceil(Math.sqrt((2 * d * s) / h));
}

/** A/B/C banding over a cumulative revenue share: A holds the first 80 % of
 *  revenue, B the next 15 %, C is the long tail that should not consume cash. */
export function abcClass(cumulativePercent: number): 'A' | 'B' | 'C' {
  const c = Number(cumulativePercent) || 0;
  if (c <= 80) return 'A';
  if (c <= 95) return 'B';
  return 'C';
}

/**
 * Stockout risk in 0-100. Days of cover left against lead time drives it, with
 * a margin for A-class lines because a stockout there costs more.
 */
export function urgencyScore(cover: number | null, exposureDays: number, unitCost: number, annualValue = 0): number {
  const days = cover === null ? 0 : Number(cover);
  const exposure = Math.max(1, Number(exposureDays) || 1);
  const shortfall = Math.max(0, (exposure - days) / exposure); // 0 = plenty, 1 = already late
  const valueWeight = Math.min(0.2, (Number(annualValue) || 0) / 1_000_000) + Math.min(0.1, (Number(unitCost) || 0) / 1000);
  return Math.round(Math.min(100, shortfall * 90 + valueWeight * 100));
}

/** Evaluate one SKU. Pure: no clock, no database. */
export function planItem(input: ReplenishInput, options: PlanOptions = {}): ReplenishItem {
  const serviceLevel = clampPercent(options.serviceLevel ?? input.serviceLevel ?? DEFAULT_SERVICE_LEVEL);
  const base = {
    productId: input.productId,
    sku: input.sku ?? null,
    name: input.name,
    supplierId: input.supplierId ?? null,
    supplierName: input.supplierName ?? null,
    onHand: Math.trunc(Number(input.onHand) || 0),
    inTransit: Math.trunc(Number(input.inTransit) || 0),
    unitCost: round2(Number(input.unitCost) || 0),
  };

  if (input.exclude || (options.excludedSuppliers || []).includes(base.supplierId ?? null)) {
    return { ...base, available: base.onHand, demand: 0, safetyStock: 0, reorderPoint: 0, targetStock: 0, quantity: 0, cost: 0, daysOfCover: null, urgency: 0, action: 'EXCLUDED', reason: input.excludeReason || 'supplier excluded by guardrail' };
  }

  const lead = Math.max(0, Math.trunc(Number(input.leadTimeDays) || 0));
  const review = Math.max(1, Math.trunc(Number(input.reviewPeriodDays) || 1));
  const exposureDays = Math.max(1, lead + review);

  const demand = demandOverWindow(input.dailyForecast, exposureDays);
  const sigma = input.dailyStdDev != null ? Math.max(0, Number(input.dailyStdDev) || 0) : stdDev(input.dailyForecast);
  const safety = safetyStock(sigma, exposureDays, serviceLevel);
  const reorderPoint = round2(demand + safety);
  const avgDaily = demand / exposureDays;
  const target = round2(Math.max(reorderPoint, demand + safety));
  const available = base.onHand - Math.trunc(Number(input.reserved) || 0) + base.inTransit;

  const cover = daysOfCover(available, avgDaily);
  const urgency = urgencyScore(cover, exposureDays, base.unitCost, avgDaily * 365 * (Number(input.price) || base.unitCost));

  if (available > reorderPoint) {
    return { ...base, available, demand, safetyStock: safety, reorderPoint, targetStock: target, quantity: 0, cost: 0, daysOfCover: cover, urgency, action: 'NONE', reason: `cover ${cover ?? '∞'}d above the ${exposureDays}d exposure window` };
  }

  let raw = Math.ceil(target - available);
  // An A-class line with almost no cover should buy the whole horizon, not the
  // bare difference, because the next review is weeks away.
  if (urgency >= 70) raw = Math.max(raw, Math.ceil(demand - available + safety));
  if (input.maxStock != null && input.maxStock > 0) raw = Math.min(raw, Math.max(0, Math.trunc(input.maxStock) - available));

  const minQty = Math.max(options.minQuantity ?? MIN_QUANTITY, Number(input.minOrderQty) || 0);
  const quantity = packRound(raw, input.packSize || 1, minQty);

  if (quantity <= 0) {
    return { ...base, available, demand, safetyStock: safety, reorderPoint, targetStock: target, quantity: 0, cost: 0, daysOfCover: cover, urgency, action: 'WATCH', reason: 'below reorder point but the gap is smaller than one pack' };
  }

  return {
    ...base,
    available,
    demand,
    safetyStock: safety,
    reorderPoint,
    targetStock: target,
    quantity,
    cost: round2(quantity * base.unitCost),
    daysOfCover: cover,
    urgency,
    action: 'ORDER',
    reason: `below reorder point (${available} available vs ${reorderPoint}) for a ${exposureDays}d window`,
  };
}

function clampPercent(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SERVICE_LEVEL;
  if (n > 1) return Math.min(0.999, n / 100);
  return Math.min(0.999, n);
}

/**
 * Full plan: evaluate every SKU, order the lines by urgency, then trim the
 * cheapest-to-defer tail until the spend fits the cash guardrail.
 */
export function planReplenishment(inputs: ReplenishInput[], options: PlanOptions = {}): PlanResult {
  const items = (inputs || []).map((i) => planItem(i, options)).filter((i) => i.action === 'ORDER');
  items.sort((a, b) => b.urgency - a.urgency || b.cost - a.cost);

  const maxSpend = options.maxSpend != null && Number(options.maxSpend) > 0 ? Number(options.maxSpend) : null;
  const maxLines = options.maxLines != null && Number(options.maxLines) > 0 ? Math.trunc(Number(options.maxLines)) : null;

  const kept: ReplenishItem[] = [];
  let spend = 0;
  let trimmed = 0;
  let trimmedCost = 0;
  for (const item of items) {
    const overSpend = maxSpend != null && spend + item.cost > maxSpend;
    const overLines = maxLines != null && kept.length >= maxLines;
    if (overSpend || overLines) {
      trimmed++;
      trimmedCost = round2(trimmedCost + item.cost);
      continue;
    }
    kept.push(item);
    spend = round2(spend + item.cost);
  }

  const bySupplierMap = new Map<string, { supplierId: string | null; supplierName: string | null; lines: number; units: number; cost: number }>();
  for (const item of kept) {
    const key = item.supplierId || '__unassigned__';
    let row = bySupplierMap.get(key);
    if (!row) {
      row = { supplierId: item.supplierId, supplierName: item.supplierName, lines: 0, units: 0, cost: 0 };
      bySupplierMap.set(key, row);
    }
    row.lines++;
    row.units += item.quantity;
    row.cost = round2(row.cost + item.cost);
  }

  return {
    items: kept,
    bySupplier: [...bySupplierMap.values()].sort((a, b) => b.cost - a.cost),
    totals: {
      lines: kept.length,
      units: kept.reduce((s, i) => s + i.quantity, 0),
      cost: spend,
      trimmed,
      trimmedCost,
    },
    serviceLevel: options.serviceLevel != null ? clampPercent(options.serviceLevel) : DEFAULT_SERVICE_LEVEL,
  };
}

/** Human one-liner the UI and the audit trail both show for a run. */
export function describePlan(plan: PlanResult): string {
  const parts = [`${plan.totals.lines} lines`, `${plan.totals.units} units`, `${plan.totals.cost.toFixed(2)} spend`];
  if (plan.totals.trimmed) parts.push(`${plan.totals.trimmed} deferred (guardrail)`);
  return parts.join(' · ');
}
