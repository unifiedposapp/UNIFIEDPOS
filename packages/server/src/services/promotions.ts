/**
 * Promotion engine (§19 marketing).
 *
 * The original Promotion model could only express "X% off these products".
 * This engine adds the four mechanics every competitor ships — mix & match,
 * quantity breaks, daypart/happy-hour windows and buy-X-get-Y — plus automatic
 * application at the register (a coupon is no longer required to get the deal).
 *
 * Two invariants matter and are unit-tested:
 *   1. A line is never discounted below zero, and the sum of per-line
 *      allocations always equals the reported total discount to the cent.
 *   2. Evaluation is deterministic: same cart + same clock ⇒ same discounts, in
 *      a fixed priority order, so a replayed order produces identical totals.
 *
 * Pure: no Prisma, no I/O. The route loads active promotions and calls `plan`.
 */

export function round2(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export type PromotionType =
  | 'PERCENTAGE'
  | 'FIXED'
  | 'BOGO'
  | 'BUNDLE'
  | 'MIX_AND_MATCH'
  | 'QTY_BREAK'
  | 'DAYPART';

export interface QtyTier {
  minQty: number;
  /** Percentage off the tier's eligible lines. */
  percent: number;
}

export interface PromotionRule {
  buyQty?: number;
  getQty?: number;
  groupProductIds?: string[];
  groupCategoryIds?: string[];
  tiers?: QtyTier[];
  /** For BUNDLE: the combined price to charge; the difference becomes the discount. */
  bundlePrice?: number;
}

export interface PromotionLike {
  id: string;
  name: string;
  type: string;
  value: number | string;
  rule?: PromotionRule | null;
  minPurchase?: number | string | null;
  maxDiscount?: number | string | null;
  applicableProducts?: string[];
  autoApply?: boolean;
  priority?: number;
  stackable?: boolean;
  daysOfWeek?: number[];
  startMinute?: number | null;
  endMinute?: number | null;
  channels?: string[];
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  isActive?: boolean;
}

export interface CartLineLike {
  productId: string;
  categoryId?: string | null;
  quantity: number | string;
  unitPrice: number | string;
}

export interface PromotionContext {
  now: Date;
  channel?: string;
}

export interface AppliedPromotion {
  id: string;
  name: string;
  type: string;
  discount: number;
  /** How the discount was earned, for the receipt/audit trail. */
  detail: string;
}

export interface PromotionPlan {
  applied: AppliedPromotion[];
  totalDiscount: number;
  /** productId → discount amount, to be written onto OrderItem.discountAmt. */
  perLine: Record<string, number>;
}

function lineTotalOf(line: CartLineLike): number {
  return round2((Number(line.unitPrice) || 0) * (Number(line.quantity) || 0));
}

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** Window check: an end before the start means the window wraps past midnight. */
function inDaypart(startMinute: number | null | undefined, endMinute: number | null | undefined, now: Date): boolean {
  if (startMinute === null || startMinute === undefined) return true;
  if (endMinute === null || endMinute === undefined) return true;
  const m = minutesOfDay(now);
  return startMinute <= endMinute ? m >= startMinute && m < endMinute : m >= startMinute || m < endMinute;
}

/** Whether the promotion may fire right now (dates, weekday, daypart, channel). */
export function isActive(p: PromotionLike, ctx: PromotionContext): boolean {
  if (p.isActive === false) return false;

  const now = ctx.now.getTime();
  if (p.startDate) {
    const s = new Date(p.startDate).getTime();
    if (Number.isFinite(s) && now < s) return false;
  }
  if (p.endDate) {
    const e = new Date(p.endDate).getTime();
    if (Number.isFinite(e) && now > e) return false;
  }

  if (Array.isArray(p.daysOfWeek) && p.daysOfWeek.length > 0 && !p.daysOfWeek.includes(ctx.now.getDay())) {
    return false;
  }
  if (!inDaypart(p.startMinute, p.endMinute, ctx.now)) return false;

  if (ctx.channel && Array.isArray(p.channels) && p.channels.length > 0) {
    if (!p.channels.includes(ctx.channel)) return false;
  }
  return true;
}

/** Lines the promotion may touch: explicit product list, else rule groups. */
export function eligibleLines(p: PromotionLike, lines: CartLineLike[]): CartLineLike[] {
  const products = new Set<string>([
    ...(p.applicableProducts ?? []),
    ...(p.rule?.groupProductIds ?? []),
  ]);
  const categories = new Set<string>(p.rule?.groupCategoryIds ?? []);

  if (products.size === 0 && categories.size === 0) return [...lines];
  return lines.filter(
    (l) => products.has(l.productId) || (l.categoryId ? categories.has(l.categoryId) : false),
  );
}

/**
 * Discount amount for one promotion against a cart, or null when it does not
 * apply. Never returns more than the eligible lines' value or `maxDiscount`.
 */
export function evaluatePromotion(p: PromotionLike, lines: CartLineLike[], _ctx?: PromotionContext): AppliedPromotion | null {
  const cartTotal = round2(lines.reduce((s, l) => s + lineTotalOf(l), 0));
  const minPurchase = Number(p.minPurchase) || 0;
  if (cartTotal < minPurchase) return null;

  const eligible = eligibleLines(p, lines);
  if (eligible.length === 0) return null;
  const eligibleTotal = round2(eligible.reduce((s, l) => s + lineTotalOf(l), 0));
  const eligibleQty = eligible.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  const value = Number(p.value) || 0;
  const cap = p.maxDiscount === null || p.maxDiscount === undefined ? Infinity : Number(p.maxDiscount);

  let discount = 0;
  let detail = '';

  switch (String(p.type).toUpperCase() as PromotionType) {
    case 'PERCENTAGE':
    case 'DAYPART': {
      discount = eligibleTotal * (value / 100);
      detail = `${value}% off ${eligible.length} line(s)`;
      break;
    }
    case 'FIXED': {
      discount = value;
      detail = `${value} off the basket`;
      break;
    }
    case 'BOGO':
    case 'MIX_AND_MATCH': {
      const buyQty = Math.max(1, Number(p.rule?.buyQty) || 1);
      const getQty = Math.max(1, Number(p.rule?.getQty) || 1);
      // Expand eligible lines into unit prices so "cheapest free" is exact.
      const units: number[] = [];
      for (const l of eligible) {
        const qty = Math.floor(Number(l.quantity) || 0);
        for (let i = 0; i < qty; i++) units.push(Number(l.unitPrice) || 0);
      }
      units.sort((a, b) => a - b);
      const groups = Math.floor(units.length / (buyQty + getQty));
      const freeCount = groups * getQty;
      for (let i = 0; i < freeCount && i < units.length; i++) discount += units[i];
      detail = freeCount > 0 ? `Buy ${buyQty} get ${getQty}: ${freeCount} free unit(s)` : '';
      if (freeCount === 0) return null;
      break;
    }
    case 'BUNDLE': {
      const bundlePrice = Number(p.rule?.bundlePrice ?? p.value) || 0;
      if (eligible.length === 0) return null;
      // Only fires when the whole declared group is in the cart.
      const declared = new Set(p.rule?.groupProductIds ?? p.applicableProducts ?? []);
      if (declared.size > 0) {
        const inCart = new Set(eligible.map((l) => l.productId));
        for (const id of declared) if (!inCart.has(id)) return null;
      }
      discount = eligibleTotal - bundlePrice;
      detail = `Bundle at ${bundlePrice}`;
      break;
    }
    case 'QTY_BREAK': {
      const tiers = (p.rule?.tiers ?? []).slice().sort((a, b) => Number(b.minQty) - Number(a.minQty));
      const tier = tiers.find((t) => eligibleQty >= Number(t.minQty));
      if (!tier) return null;
      discount = eligibleTotal * ((Number(tier.percent) || 0) / 100);
      detail = `${tier.percent}% at ${tier.minQty}+ units`;
      break;
    }
    default:
      return null;
  }

  discount = Math.min(round2(discount), eligibleTotal, cap);
  if (discount <= 0) return null;
  return { id: p.id, name: p.name, type: String(p.type).toUpperCase(), discount, detail };
}

/**
 * Allocate a promotion's discount across the lines it touches, proportional to
 * line value, with the leftover cents handed to the largest fractional parts so
 * the parts add up exactly. A weighed line worth 4.69 never eats a 0.02 residual
 * it cannot carry.
 */
export function allocateDiscount(discount: number, targets: { productId: string; amount: number }[]): Record<string, number> {
  const total = round2(discount);
  const out: Record<string, number> = {};
  if (total <= 0 || targets.length === 0) return out;

  const base = targets.reduce((s, t) => s + Math.max(0, Number(t.amount) || 0), 0);
  if (base <= 0) return out;

  const raw = targets.map((t) => ({
    productId: t.productId,
    exact: (Math.max(0, Number(t.amount) || 0) / base) * total,
    cap: Math.max(0, Number(t.amount) || 0),
  }));

  let allocated = 0;
  for (const r of raw) {
    const cents = Math.floor(r.exact * 100 + 1e-9);
    out[r.productId] = round2(cents / 100);
    allocated = round2(allocated + cents / 100);
  }

  let remainder = Math.round((total - allocated) * 100);
  if (remainder > 0) {
    // Hand the cents to the largest fractional remainder, ties by input order.
    const order = raw
      .map((r, i) => ({ i, frac: r.exact * 100 - Math.floor(r.exact * 100 + 1e-9), cap: r.cap, productId: r.productId }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i);

    for (const entry of order) {
      if (remainder <= 0) break;
      const current = out[entry.productId] ?? 0;
      if (current + 0.01 <= entry.cap) {
        out[entry.productId] = round2(current + 0.01);
        remainder -= 1;
      }
    }
  }
  return out;
}

/**
 * Run every auto-apply promotion over a cart.
 *
 * Order: priority desc, then discount desc. A non-stackable promotion closes the
 * basket — once it wins, nothing smaller is piled on top of it (that is what
 * "not stackable" means to a merchant). Stackable ones accumulate until the
 * basket is free.
 */
export function planPromotions(promotions: PromotionLike[], lines: CartLineLike[], ctx: PromotionContext): PromotionPlan {
  const active = promotions
    .filter((p) => p.autoApply !== false && isActive(p, ctx))
    .map((p) => ({ p, result: evaluatePromotion(p, lines, ctx) }))
    .filter((x): x is { p: PromotionLike; result: AppliedPromotion } => Boolean(x.result))
    .sort((a, b) => (Number(b.p.priority) || 0) - (Number(a.p.priority) || 0) || b.result.discount - a.result.discount);

  const applied: AppliedPromotion[] = [];
  const perLine: Record<string, number> = {};
  let budget = round2(lines.reduce((s, l) => s + lineTotalOf(l), 0));

  for (const { p, result } of active) {
    if (budget <= 0) break;
    const discount = Math.min(result.discount, budget);
    if (discount <= 0) continue;

    const targets = eligibleLines(p, lines).map((l) => ({ productId: l.productId, amount: lineTotalOf(l) }));
    const allocation = allocateDiscount(discount, targets);
    for (const [productId, amount] of Object.entries(allocation)) {
      perLine[productId] = round2((perLine[productId] ?? 0) + amount);
    }

    applied.push({ ...result, discount: round2(discount) });
    budget = round2(budget - discount);

    if (!p.stackable) break;
  }

  const totalDiscount = round2(applied.reduce((s, a) => s + a.discount, 0));
  return { applied, totalDiscount, perLine };
}
