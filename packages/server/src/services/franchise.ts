// ─── FRANCHISE ROYALTIES, TRANSFER PRICING + CONSOLIDATION ───────────────────
// A franchise network is one brand with fifty profit-and-loss statements that
// must not double-count each other. Three maths do all the work, and every one
// of them has to survive a franchisee's audit:
//
//   ROYALTY   the base is agreed revenue, not whatever the till rang: exclusions
//             (VAT, gift-card redemption, tips) come off first, then the model —
//             flat, banded, per-unit or fixed — then the monthly minimum.
//   TRANSFER  stock moving between entities is priced at cost + markup so the
//             sending entity recognises margin and the receiving one carries a
//             real cost, never an internal number.
//   CONSOLIDATE brand-level P&L sums the entities and then eliminates the
//             intercompany sales and the matching cost of goods, because the
//             network did not sell to itself.
import { round2 } from './moneyMath.js';

export type RoyaltyModel = 'PERCENT' | 'TIERED' | 'PER_ITEM' | 'FIXED';

export interface RoyaltyTier {
  /** Upper bound of the band, in the same currency; null = unbounded top band. */
  upTo: number | null;
  percent: number;
}

export interface RoyaltyAgreement {
  royaltyModel: RoyaltyModel;
  royaltyPercent?: number | null;
  tiers?: RoyaltyTier[] | null;
  perItemFee?: number | null;
  fixedMonthly?: number | null;
  minimumMonthly?: number | null;
  marketingFundPercent?: number | null;
  /** Line items that never form the royalty base (VAT, tips, gift-card top-up). */
  exclusions?: string[] | null;
}

export interface RoyaltyPeriod {
  grossSales: number;
  /** Amounts removed before the rate is applied; keys must match `exclusions`. */
  excludedByCategory?: Record<string, number> | null;
  unitsSold?: number | null;
  /** Optional pre-computed base; when absent it is derived from gross - exclusions. */
  taxableBaseOverride?: number | null;
}

export interface RoyaltyResult {
  grossSales: number;
  excluded: { category: string; amount: number }[];
  taxableBase: number;
  unitsSold: number;
  royalty: number;
  marketingFund: number;
  minimumApplied: boolean;
  total: number;
  effectiveRatePercent: number | null;
  calculation: { step: string; detail: string; amount: number }[];
  model: RoyaltyModel;
}

export function normalizeTiers(tiers?: RoyaltyTier[] | null): RoyaltyTier[] {
  const rows = (tiers || [])
    .map((t) => ({ upTo: t?.upTo == null ? null : Math.max(0, Number(t.upTo) || 0), percent: Math.max(0, Number(t?.percent) || 0) }))
    .filter((t) => t.percent >= 0);
  // Ascending by band ceiling, with the open-ended band last.
  return rows.sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
}

/** Banded royalty: 6 % to 250k, 4 % above — each band only taxes its own slice. */
export function tieredRoyalty(base: number, tiers?: RoyaltyTier[] | null): { amount: number; bands: { from: number; to: number; percent: number; royalty: number }[] } {
  const rows = normalizeTiers(tiers);
  const value = Math.max(0, Number(base) || 0);
  if (!rows.length) return { amount: 0, bands: [] };
  const bands: { from: number; to: number; percent: number; royalty: number }[] = [];
  let cursor = 0;
  let total = 0;
  for (const tier of rows) {
    const ceiling = tier.upTo ?? Infinity;
    const slice = Math.max(0, Math.min(value, ceiling) - cursor);
    if (slice > 0) {
      const royalty = round2((slice * tier.percent) / 100);
      total = round2(total + royalty);
      bands.push({ from: round2(cursor), to: ceiling === Infinity ? ceiling : round2(ceiling), percent: tier.percent, royalty });
      cursor = Math.max(cursor, ceiling);
    }
    if (cursor >= value) break;
  }
  // Anything past the last defined band keeps the last band's rate, which is
  // what a franchise agreement means by "and 4 % thereafter".
  if (cursor < value && rows.length) {
    const last = rows[rows.length - 1];
    const slice = round2(value - cursor);
    const royalty = round2((slice * last.percent) / 100);
    total = round2(total + royalty);
    bands.push({ from: round2(cursor), to: Infinity, percent: last.percent, royalty });
  }
  return { amount: total, bands };
}

export function royaltyExclusions(
  grossSales: number,
  agreement: RoyaltyAgreement,
  period: RoyaltyPeriod
): { excluded: { category: string; amount: number }[]; taxableBase: number } {
  const gross = Math.max(0, Number(period.grossSales ?? grossSales) || 0);
  const byCategory = period.excludedByCategory || {};
  const wanted = (agreement.exclusions || []).map((c) => String(c).toUpperCase());
  const excluded = wanted.map((category) => ({ category, amount: round2(Math.max(0, Number(byCategory[category]) || 0)) }));
  const totalExcluded = round2(excluded.reduce((s, e) => s + e.amount, 0));
  // The base is never negative: a period whose exclusions exceed its sales (a
  // heavy gift-card redemption month, say) earns no royalty, but it must not
  // create a credit the franchisor then has to pay out.
  const base = period.taxableBaseOverride != null ? Math.max(0, Number(period.taxableBaseOverride)) : Math.max(0, round2(gross - totalExcluded));
  return { excluded: excluded.filter((e) => e.amount > 0), taxableBase: round2(base) };
}

/**
 * One period's royalty. The `calculation` array is the whole point: it is the
 * receipt a franchisee can check line by line instead of arguing from a total.
 */
export function computeRoyalty(agreement: RoyaltyAgreement, period: RoyaltyPeriod): RoyaltyResult {
  const model: RoyaltyModel = String(agreement.royaltyModel || 'PERCENT').toUpperCase() as RoyaltyModel;
  const { excluded, taxableBase } = royaltyExclusions(0, agreement, period);
  const gross = round2(Math.max(0, Number(period.grossSales) || 0));
  const units = Math.max(0, Math.trunc(Number(period.unitsSold) || 0));
  const calculation: RoyaltyResult['calculation'] = [{ step: 'gross-sales', detail: 'reported settled sales for the period', amount: gross }];

  if (excluded.length) {
    for (const e of excluded) calculation.push({ step: 'exclusion', detail: e.category, amount: -e.amount });
    calculation.push({ step: 'taxable-base', detail: 'gross less agreed exclusions', amount: taxableBase });
  }

  let royalty = 0;
  if (model === 'PERCENT') {
    royalty = round2((taxableBase * (Math.max(0, Number(agreement.royaltyPercent) || 0))) / 100);
    calculation.push({ step: 'royalty', detail: `${agreement.royaltyPercent ?? 0}% of base`, amount: royalty });
  } else if (model === 'TIERED') {
    const tiered = tieredRoyalty(taxableBase, agreement.tiers);
    royalty = tiered.amount;
    for (const band of tiered.bands) {
      calculation.push({ step: 'tier', detail: `${band.percent}% from ${band.from} to ${band.to === Infinity ? '∞' : band.to}`, amount: band.royalty });
    }
  } else if (model === 'PER_ITEM') {
    royalty = round2(units * (Math.max(0, Number(agreement.perItemFee) || 0)));
    calculation.push({ step: 'royalty', detail: `${units} units at ${agreement.perItemFee ?? 0} each`, amount: royalty });
  } else {
    royalty = round2(Math.max(0, Number(agreement.fixedMonthly) || 0));
    calculation.push({ step: 'royalty', detail: 'fixed monthly fee', amount: royalty });
  }

  const minimum = round2(Math.max(0, Number(agreement.minimumMonthly) || 0));
  let minimumApplied = false;
  if (model !== 'FIXED' && minimum > royalty) {
    royalty = minimum;
    minimumApplied = true;
    calculation.push({ step: 'minimum', detail: `monthly minimum raised the royalty to ${minimum}`, amount: royalty });
  }

  const marketingFund = round2((taxableBase * (Math.max(0, Number(agreement.marketingFundPercent) || 0))) / 100);
  if (marketingFund > 0) calculation.push({ step: 'marketing-fund', detail: `${agreement.marketingFundPercent}% of base`, amount: marketingFund });

  return {
    grossSales: gross,
    excluded,
    taxableBase,
    unitsSold: units,
    royalty,
    marketingFund,
    minimumApplied,
    total: round2(royalty + marketingFund),
    effectiveRatePercent: gross > 0 ? round2((royalty / gross) * 100) : null,
    calculation,
    model,
  };
}

/** Cost-plus price for stock moving between two entities of the same network. */
export function transferPrice(cost: number, markupPercent: number, freight = 0, quantity = 1): { unitPrice: number; total: number; margin: number } {
  const qty = Math.max(1, Math.trunc(Number(quantity) || 1));
  const unitCost = Math.max(0, Number(cost) || 0);
  const markup = Math.max(0, Number(markupPercent) || 0);
  const shipping = Math.max(0, Number(freight) || 0);
  const withMargin = round2((unitCost * (1 + markup / 100)) * qty);
  const total = round2(withMargin + shipping);
  return { unitPrice: qty > 0 ? round2(total / qty) : total, total, margin: round2(withMargin - unitCost * qty) };
}

export interface EntityPnl {
  entityCode: string;
  entityName?: string | null;
  revenue: number;
  costOfGoods: number;
  labour: number;
  operatingExpenses: number;
  /** Sales this entity made to another entity in the same network. */
  intercompanyRevenue?: number | null;
  /** What the buying entity recorded as COGS for those same goods. */
  intercompanyCost?: number | null;
  currency?: string | null;
}

export interface ConsolidatedPnl {
  entities: { entityCode: string; revenue: number; grossProfit: number; ebitda: number; marginPercent: number | null }[];
  totals: { revenue: number; costOfGoods: number; grossProfit: number; labour: number; operatingExpenses: number; ebitda: number; marginPercent: number | null };
  eliminations: { intercompanyRevenue: number; intercompanyCost: number; unrealisedProfit: number };
  royaltiesDue: number;
  topContributor: string | null;
}

/**
 * Sum the entities, then remove the network selling to itself. `unrealisedProfit`
 * is the markup still sitting in the buying entity's stock, which the franchisor
 * recognises only when it reaches a customer.
 */
export function consolidatePnl(entities: EntityPnl[], options: { royaltyPercentForEliminations?: number } = {}): ConsolidatedPnl {
  const rows = (entities || []).map((e) => {
    const revenue = round2(Math.max(0, Number(e.revenue) || 0));
    const cogs = round2(Math.max(0, Number(e.costOfGoods) || 0));
    const labour = round2(Math.max(0, Number(e.labour) || 0));
    const opex = round2(Math.max(0, Number(e.operatingExpenses) || 0));
    const icRevenue = round2(Math.max(0, Number(e.intercompanyRevenue) || 0));
    const icCost = round2(Math.max(0, Number(e.intercompanyCost) || 0));
    const gross = round2(revenue - cogs);
    return {
      entityCode: e.entityCode,
      entityName: e.entityName ?? null,
      revenue,
      cogs,
      labour,
      opex,
      icRevenue,
      icCost,
      grossProfit: gross,
      ebitda: round2(gross - labour - opex),
      currency: e.currency ?? null,
    };
  });

  const elimRevenue = round2(rows.reduce((s, r) => s + r.icRevenue, 0));
  const elimCost = round2(rows.reduce((s, r) => s + r.icCost, 0));
  const unrealisedProfit = round2(Math.max(0, elimRevenue - elimCost));

  const totalRevenue = round2(Math.max(0, rows.reduce((s, r) => s + r.revenue, 0) - elimRevenue));
  const totalCogs = round2(Math.max(0, rows.reduce((s, r) => s + r.cogs, 0) - elimCost));
  const totalLabour = round2(rows.reduce((s, r) => s + r.labour, 0));
  const totalOpex = round2(rows.reduce((s, r) => s + r.opex, 0));
  const gross = round2(totalRevenue - totalCogs);
  const ebitda = round2(gross - totalLabour - totalOpex);

  const sorted = [...rows].sort((a, b) => b.ebitda - a.ebitda);
  return {
    entities: rows.map((r) => ({
      entityCode: r.entityCode,
      revenue: r.revenue,
      grossProfit: r.grossProfit,
      ebitda: r.ebitda,
      marginPercent: r.revenue > 0 ? round2((r.ebitda / r.revenue) * 100) : null,
    })),
    totals: {
      revenue: totalRevenue,
      costOfGoods: totalCogs,
      grossProfit: gross,
      labour: totalLabour,
      operatingExpenses: totalOpex,
      ebitda,
      marginPercent: totalRevenue > 0 ? round2((ebitda / totalRevenue) * 100) : null,
    },
    eliminations: { intercompanyRevenue: elimRevenue, intercompanyCost: elimCost, unrealisedProfit },
    royaltiesDue: round2(unrealisedProfit * (Math.max(0, Number(options.royaltyPercentForEliminations) || 0) / 100)),
    topContributor: sorted[0]?.entityCode ?? null,
  };
}

/** ISO month label the accrual is stored under (2026-09). */
export function periodLabel(start: Date): string {
  const at = new Date(start);
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Ageing of what a franchisee owes but has not paid. */
export function royaltyAging(dueDate: Date, now: Date = new Date()): { days: number; bucket: 'CURRENT' | 'D1_30' | 'D31_60' | 'D61_90' | 'OVER_90' } {
  const days = Math.floor((now.getTime() - new Date(dueDate).getTime()) / (24 * 60 * 60 * 1000));
  const bucket = days <= 0 ? 'CURRENT' : days <= 30 ? 'D1_30' : days <= 60 ? 'D31_60' : days <= 90 ? 'D61_90' : 'OVER_90';
  return { days: Math.max(0, days), bucket };
}
