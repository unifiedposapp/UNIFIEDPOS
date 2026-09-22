// ─── FX / EXCHANGE-RATE LAYER ────────────────────────────────────────────────
// A global business reports in many currencies but consolidates in one. Turning
// 1.00 NGN into 1.00 USD is a *quotation*, not arithmetic, so every number that
// crosses a currency boundary has to carry the rate it used, where that rate
// came from, and how old it is — otherwise a franchise statement or a
// multi-currency P&L is unauditable the moment anyone asks "at what rate?".
//
// This module is pure: it never touches Prisma or the network. Routes load the
// rows (from the CurrencyRate table or a live provider) and hand them in, so the
// rate resolution — direct, inverse, or triangulated through a base currency —
// is unit-testable and reused verbatim by the franchise consolidation engine.
import { round2 } from './moneyMath.js';
import { isValidCurrency } from '../data/currencies.js';

/** One observed exchange rate, in "1 `from` = `rate` `to`" form. */
export interface RateRow {
  from: string;
  to: string;
  rate: number;
  source?: string | null;
  fetchedAt?: Date | string | null;
  effectiveDate?: Date | string | null;
}

export interface ResolvedRate {
  from: string;
  to: string;
  rate: number;
  /** Where the number came from: the row source, or a derived method tag. */
  source: string;
  /** How the number was obtained. */
  method: 'DIRECT' | 'INVERSE' | 'TRIANGULATED';
  /** The freshest effectiveDate contributing to the rate (for staleness). */
  asOf: string | null;
}

export interface ConversionResult extends ResolvedRate {
  amount: number;
  converted: number;
  inverse: number;
  stale: boolean;
  ageDays: number | null;
}

const BASE_CURRENCY = 'USD';

function pairKey(from: string, to: string): string {
  return `${from.toUpperCase()}|${to.toUpperCase()}`;
}

function toTime(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Index rows into a fast lookup, keeping the *most recent* effectiveDate for a
 * repeated pair so a stale bulk import never silently shadows a newer quote.
 */
export function buildRateIndex(rows: RateRow[]): Map<string, RateRow> {
  const index = new Map<string, RateRow>();
  for (const row of rows || []) {
    const from = String(row.from || '').toUpperCase();
    const to = String(row.to || '').toUpperCase();
    const rate = Number(row.rate);
    if (!from || !to || !Number.isFinite(rate) || rate <= 0) continue;
    const key = pairKey(from, to);
    const existing = index.get(key);
    const existingTime = toTime(existing?.effectiveDate ?? existing?.fetchedAt) ?? 0;
    const incomingTime = toTime(row.effectiveDate ?? row.fetchedAt) ?? 0;
    if (!existing || incomingTime >= existingTime) index.set(key, { ...row, from, to, rate });
  }
  return index;
}

/**
 * Resolve the rate to move one unit of `from` into `to`. Tries, in order: a
 * direct quote, the inverse of a direct quote, and finally a cross triangulated
 * through the USD base. Returns null when no path exists (the caller decides
 * whether that is an error or a warning).
 */
export function resolveRate(from: string, to: string, rows: RateRow[]): ResolvedRate | null {
  const base = String(from || '').toUpperCase();
  const quote = String(to || '').toUpperCase();
  if (!base || !quote) return null;
  if (base === quote) {
    return { from: base, to: quote, rate: 1, source: 'PARITY', method: 'DIRECT', asOf: null };
  }
  const index = buildRateIndex(rows);
  const freshestAsOf = (...candidates: (RateRow | undefined)[]): string | null => {
    let best: number | null = null;
    for (const c of candidates) {
      const t = toTime(c?.effectiveDate ?? c?.fetchedAt);
      if (t != null && (best == null || t > best)) best = t;
    }
    return best == null ? null : new Date(best).toISOString();
  };

  const direct = index.get(pairKey(base, quote));
  if (direct) return { from: base, to: quote, rate: direct.rate, source: direct.source || 'STORED', method: 'DIRECT', asOf: freshestAsOf(direct) };

  const inverse = index.get(pairKey(quote, base));
  if (inverse) return { from: base, to: quote, rate: 1 / inverse.rate, source: `${inverse.source || 'STORED'} (inverse)`, method: 'INVERSE', asOf: freshestAsOf(inverse) };

  // Cross through the base currency: from->base and base->to, each of which may
  // itself need inverting. This is exactly how a dealing desk prices a minor.
  const fromBaseRow = index.get(pairKey(base, BASE_CURRENCY));
  const baseFromRow = index.get(pairKey(BASE_CURRENCY, base));
  const baseQuoteRow = index.get(pairKey(BASE_CURRENCY, quote));
  const quoteBaseRow = index.get(pairKey(quote, BASE_CURRENCY));
  const legA = fromBaseRow ? fromBaseRow.rate : invertOrNull(baseFromRow);
  const legB = baseQuoteRow ? baseQuoteRow.rate : invertOrNull(quoteBaseRow);
  if (legA && legB) {
    const rate = legA * legB;
    return { from: base, to: quote, rate, source: `CROSS/${BASE_CURRENCY}`, method: 'TRIANGULATED', asOf: freshestAsOf(fromBaseRow, baseFromRow, baseQuoteRow, quoteBaseRow) };
  }
  return null;
}

function invertOrNull(row: RateRow | undefined): number | null {
  return row && Number.isFinite(row.rate) && row.rate > 0 ? 1 / row.rate : null;
}

/**
 * Convert `amount` from one currency to another, tagging the result with the
 * rate, its source and how stale it is against `maxAgeDays` (default 1). A
 * missing rate is an explicit failure rather than a silent 1:1 fallback —
 * guessing a rate is how multi-currency ledgers stop balancing.
 */
export function convert(
  amount: number,
  from: string,
  to: string,
  rows: RateRow[],
  options: { maxAgeDays?: number; now?: Date } = {},
): ConversionResult {
  const value = Number(amount);
  if (!Number.isFinite(value)) throw new Error('convert: amount must be a finite number');
  if (!isValidCurrency(from) || !isValidCurrency(to)) {
    throw new Error(`convert: unknown currency pair ${from}->${to}`);
  }
  const resolved = resolveRate(from, to, rows);
  if (!resolved) throw new Error(`no exchange rate available for ${from}->${to}`);
  const maxAgeDays = options.maxAgeDays ?? 1;
  const now = options.now ? new Date(options.now).getTime() : Date.now();
  let stale = false;
  let ageDays: number | null = null;
  if (resolved.asOf) {
    const t = new Date(resolved.asOf).getTime();
    if (Number.isFinite(t)) {
      ageDays = Math.max(0, Math.round(((now - t) / 86_400_000) * 100) / 100);
      stale = now - t > maxAgeDays * 86_400_000;
    }
  } else {
    stale = true; // no provenance at all is treated as stale
  }
  return {
    ...resolved,
    amount: round2(value),
    converted: round2(value * resolved.rate),
    inverse: resolved.rate > 0 ? round2(1 / resolved.rate) : 0,
    stale,
    ageDays,
  };
}

/**
 * The rate in force on or before `date` for a pair. Rows are the full history;
 * we pick the newest effectiveDate that is not in the future, then apply the
 * usual staleness window against `date` itself.
 */
export function rateForDate(
  from: string,
  to: string,
  rows: RateRow[],
  date: Date | string,
  options: { maxAgeDays?: number } = {},
): ResolvedRate | null {
  const cutoff = new Date(date).getTime();
  if (Number.isNaN(cutoff)) return null;
  const eligible = (rows || []).filter((r) => {
    const t = toTime(r.effectiveDate ?? r.fetchedAt);
    return t == null || t <= cutoff;
  });
  const base = String(from || '').toUpperCase();
  const quote = String(to || '').toUpperCase();
  if (base === quote) return { from: base, to: quote, rate: 1, source: 'PARITY', method: 'DIRECT', asOf: new Date(cutoff).toISOString() };
  // Prefer a same-day or prior direct quote for the exact pair.
  const resolved = resolveRate(from, to, eligible);
  if (resolved) {
    const maxAgeDays = options.maxAgeDays;
    if (maxAgeDays != null && resolved.asOf) {
      const t = new Date(resolved.asOf).getTime();
      if (Number.isFinite(t) && cutoff - t > maxAgeDays * 86_400_000) return null; // too old for this date
    }
  }
  return resolved;
}

/**
 * Static reference rates (all against USD) used as a clearly-labelled fallback
 * when no provider is configured or reachable. These are indicative snapshots,
 * not settlement quotes — the source tag makes that unmistakable downstream.
 */
const STATIC_USD: Record<string, number> = {
  USD: 1, EUR: 0.92, GBP: 0.79, JPY: 156.2, CHF: 0.88, CAD: 1.36, AUD: 1.52,
  CNY: 7.24, HKD: 7.81, SGD: 1.34, SEK: 10.6, NOK: 10.7, DKK: 6.87, NZD: 1.64,
  MXN: 17.1, BRL: 5.05, INR: 83.2, ZAR: 18.6, RUB: 89.5, KRW: 1348, TRY: 32.3,
  NGN: 1480, EGP: 30.9, KES: 152, GHS: 14.9, MAD: 9.9, SAR: 3.75, AED: 3.67,
  PLN: 3.98, THB: 35.9, IDR: 15800, PHP: 56.3, VND: 25300, ARS: 870, CLP: 940,
  COP: 3900, PKR: 278, BDT: 110, LKR: 300, ILS: 3.7, QAR: 3.64, KWD: 0.31,
};

/**
 * Materialise the static table into USD-quoted RateRows. `fetchedAt`/
 * `effectiveDate` default to `now`, so a cold start without a provider still
 * produces a usable (but flagged) rate rather than throwing everywhere.
 */
export function staticRates(now: Date = new Date()): RateRow[] {
  const rows: RateRow[] = [];
  const iso = now.toISOString();
  for (const [code, perUsd] of Object.entries(STATIC_USD)) {
    if (code === 'USD' || !Number.isFinite(perUsd) || perUsd <= 0) continue;
    rows.push({ from: 'USD', to: code, rate: perUsd, source: 'STATIC', fetchedAt: iso, effectiveDate: iso });
    rows.push({ from: code, to: 'USD', rate: 1 / perUsd, source: 'STATIC', fetchedAt: iso, effectiveDate: iso });
  }
  return rows;
}

/**
 * Fetch live rates from an open FX provider (env-gated). Returns null when no
 * provider is configured or the request fails, so the caller falls back to the
 * static table / stored rows without the request path ever hard-failing on a
 * third-party outage. We deliberately depend on nothing but global `fetch`.
 */
export async function fetchLiveRates(base = 'USD'): Promise<RateRow[] | null> {
  const url = process.env.FX_RATES_URL;
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(process.env.FX_RATES_TIMEOUT_MS) || 6000);
    const res = await fetch(url.replace('{base}', encodeURIComponent(base)), { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const body = (await res.json()) as { rates?: Record<string, number>; timestamp?: string; date?: string };
    const rates = body.rates;
    if (!rates || typeof rates !== 'object') return null;
    const stamp = body.timestamp || body.date || new Date().toISOString();
    const rows: RateRow[] = [];
    const source = `PROVIDER:${new URL(url).host}`;
    for (const [code, value] of Object.entries(rates)) {
      const to = String(code).toUpperCase();
      const rate = Number(value);
      if (to === base || !Number.isFinite(rate) || rate <= 0) continue;
      rows.push({ from: base, to, rate, source, fetchedAt: stamp, effectiveDate: stamp });
      rows.push({ from: to, to: base, rate: 1 / rate, source, fetchedAt: stamp, effectiveDate: stamp });
    }
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}

export function fxProviderConfigured(): boolean {
  return Boolean(process.env.FX_RATES_URL);
}
