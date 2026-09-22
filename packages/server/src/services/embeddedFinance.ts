// ─── EMBEDDED FINANCE: UNDERWRITING + AMORTISATION ───────────────────────────
// The one asset a POS has that a bank does not is the daily truth of a till.
// Working-capital credit underwritten from settlement history is therefore both
// cheaper to price and faster to decide than a term-loan application — provided
// the arithmetic is honest about volatility, refunds and existing debt.
//
// Every number below is a pure function of its inputs so a decision can be
// replayed, audited and argued about with the merchant looking at the same page.
import { round2 } from './moneyMath.js';

export const MIN_ACTIVE_MONTHS = 3;
export const MAX_SALES_MULTIPLE = 0.6; // never lend more than ~18 days of gross sales
export const BASE_RATE_PERCENT = 9.5;
export const RISK_BANDS = [
  { band: 'A', minScore: 780, premiumPercent: 0, maxMultiple: 0.60 },
  { band: 'B', minScore: 680, premiumPercent: 2.5, maxMultiple: 0.50 },
  { band: 'C', minScore: 560, premiumPercent: 6.0, maxMultiple: 0.35 },
  { band: 'D', minScore: 420, premiumPercent: 12.0, maxMultiple: 0.22 },
  { band: 'E', minScore: 0, premiumPercent: 20.0, maxMultiple: 0.10 },
] as const;

export const TERM_OPTIONS_MONTHS = [3, 6, 9, 12] as const;

export interface TradingMetrics {
  /** Net settled sales per trading day over the look-back window. */
  avgDailyNetSales: number;
  /** Dispersion of the same series — volatility is the whole risk model here. */
  salesStdDev?: number | null;
  activeMonths: number;
  refundRatePercent?: number;
  chargebackRatePercent?: number;
  /** Share of days with zero settled sales in the window (closure / seasonality). */
  dormantDayRatio?: number;
  /** Existing monthly debt service across every facility, in the same currency. */
  existingMonthlyDebt?: number;
  /** Worst gap between settlements — a stall here is a liquidity event. */
  staleSettlementDays?: number;
  currency?: string;
}

export interface UnderwritingFactor {
  key: string;
  label: string;
  points: number;
  detail: string;
}

export interface UnderwritingDecision {
  score: number;
  band: string;
  qualifies: boolean;
  /** Machine codes: TOO_NEW, VOLATILE, HIGH_REFUNDS, CHARGEBACKS, DEBT_SERVICE, STALE_DATA */
  declineReasons: string[];
  factors: UnderwritingFactor[];
  annualRevenueProxy: number;
  suggestedLimit: number;
  ratePercent: number;
  sweepPercent: number;
  terms: { months: number; installment: number; totalInterest: number; totalRepayable: number }[];
  /** 0-1: how much of the model this merchant's data actually populated. */
  confidence: number;
}

function bandFor(score: number): (typeof RISK_BANDS)[number] {
  return RISK_BANDS.find((b) => score >= b.minScore) || RISK_BANDS[RISK_BANDS.length - 1];
}

export function coefficientOfVariation(mean: number, stdDev: number): number {
  const m = Number(mean) || 0;
  if (m <= 0) return Infinity;
  return Math.abs(Number(stdDev) || 0) / m;
}

/** French (flat-instalment) amortisation: identical payment each period. */
export function installmentPayment(principal: number, annualRatePercent: number, months: number): number {
  const p = Math.max(0, Number(principal) || 0);
  const n = Math.max(1, Math.trunc(Number(months) || 1));
  const r = (Math.max(0, Number(annualRatePercent) || 0) / 100) / 12;
  if (r === 0) return round2(p / n);
  return round2((p * r) / (1 - Math.pow(1 + r, -n)));
}

/**
 * Full repayment schedule. The last period absorbs the rounding residue so the
 * schedule sums to exactly the principal — an unallocated cent is how ledger
 * disputes start.
 */
export function amortizeSchedule(
  principal: number,
  annualRatePercent: number,
  months: number,
  startDate: Date
): { period: number; dueDate: Date; principal: number; interest: number; total: number; balance: number }[] {
  const p0 = Math.max(0, Number(principal) || 0);
  const n = Math.max(1, Math.trunc(Number(months) || 1));
  const rate = Math.max(0, Number(annualRatePercent) || 0) / 100;
  const monthlyRate = rate / 12;
  const payment = installmentPayment(p0, annualRatePercent, n);
  const start = new Date(startDate);

  let balance = p0;
  const rows: { period: number; dueDate: Date; principal: number; interest: number; total: number; balance: number }[] = [];
  for (let period = 1; period <= n; period++) {
    const interest = round2(balance * monthlyRate);
    let principalPart = round2(payment - interest);
    if (period === n) principalPart = round2(balance); // final sweep of rounding drift
    if (principalPart > balance) principalPart = round2(balance);
    balance = round2(balance - principalPart);
    const dueDate = new Date(start);
    dueDate.setMonth(dueDate.getMonth() + period);
    rows.push({ period, dueDate, principal: principalPart, interest, total: round2(principalPart + interest), balance });
  }
  return rows;
}

/** APY from a nominal annual rate compounded N times per year. */
export function effectiveAnnualRate(annualPercent: number, periodsPerYear = 12): number {
  const r = (Number(annualPercent) || 0) / 100;
  const m = Math.max(1, Math.trunc(Number(periodsPerYear) || 1));
  return round2((Math.pow(1 + r / m, m) - 1) * 100);
}

export function debtToRevenue(outstanding: number, annualRevenue: number): number {
  const rev = Number(annualRevenue) || 0;
  if (rev <= 0) return Infinity;
  return round2((Number(outstanding) || 0) / rev);
}

/** Days of swept sales needed to repay the facility in full. */
export function paybackDays(limit: number, dailySweepAmount: number): number | null {
  const perDay = Number(dailySweepAmount) || 0;
  if (perDay <= 0) return null;
  return Math.ceil((Number(limit) || 0) / perDay);
}

/**
 * Score 300-850 out of six factors. Deliberately additive and reported per
 * factor: "your refund rate cost you 40 points" is actionable, a black-box
 * score is not.
 */
export function underwrite(metrics: TradingMetrics): UnderwritingDecision {
  const avg = Math.max(0, Number(metrics.avgDailyNetSales) || 0);
  const sigma = Math.max(0, Number(metrics.salesStdDev) || 0);
  const months = Math.max(0, Number(metrics.activeMonths) || 0);
  const refunds = Math.max(0, Number(metrics.refundRatePercent) || 0);
  const chargebacks = Math.max(0, Number(metrics.chargebackRatePercent) || 0);
  const dormant = Math.min(1, Math.max(0, Number(metrics.dormantDayRatio) || 0));
  const existingDebt = Math.max(0, Number(metrics.existingMonthlyDebt) || 0);
  const stale = Math.max(0, Number(metrics.staleSettlementDays) || 0);

  const factors: UnderwritingFactor[] = [];
  let score = 300;

  const historyPoints = Math.min(140, Math.round((months / 12) * 140));
  score += historyPoints;
  factors.push({ key: 'HISTORY', label: 'Trading history', points: historyPoints, detail: `${months} month${months === 1 ? '' : 's'} of settled sales` });

  const cv = coefficientOfVariation(avg, sigma);
  const stabilityPoints = Number.isFinite(cv) ? Math.max(0, Math.min(180, Math.round(180 - cv * 220))) : 0;
  score += stabilityPoints;
  factors.push({ key: 'STABILITY', label: 'Sales stability', points: stabilityPoints, detail: Number.isFinite(cv) ? `daily variation of ${round2(cv * 100)}%` : 'no sales recorded' });

  const refundPoints = Math.max(0, 120 - Math.round(refunds * 24) - Math.round(chargebacks * 60));
  score += refundPoints;
  factors.push({ key: 'DISPUTES', label: 'Refunds & chargebacks', points: refundPoints, detail: `${refunds}% refunded, ${chargebacks}% charged back` });

  const utilisationPoints = Math.max(0, Math.round(100 * (1 - dormant)));
  score += utilisationPoints;
  factors.push({ key: 'TRADING_DAYS', label: 'Trading continuity', points: utilisationPoints, detail: `${Math.round(dormant * 100)}% dormant days` });

  const monthlyRevenue = avg * 30;
  const coverage = monthlyRevenue > 0 ? monthlyRevenue / Math.max(1, existingDebt + monthlyRevenue * 0.05) : 0;
  const capacityPoints = Math.max(0, Math.min(80, Math.round(coverage * 60)));
  score += capacityPoints;
  factors.push({ key: 'CAPACITY', label: 'Repayment capacity', points: capacityPoints, detail: existingDebt > 0 ? `${round2(coverage)}× monthly revenue over ${existingDebt.toFixed(2)} debt service` : 'no other facilities' });

  const freshnessPoints = stale <= 3 ? 30 : stale <= 7 ? 15 : 0;
  score += freshnessPoints;
  factors.push({ key: 'FRESHNESS', label: 'Data recency', points: freshnessPoints, detail: stale ? `last settlement ${stale} day(s) ago` : 'settled today' });

  score = Math.max(300, Math.min(850, Math.round(score)));
  const band = bandFor(score);

  const declineReasons: string[] = [];
  if (months < MIN_ACTIVE_MONTHS) declineReasons.push('TOO_NEW');
  if (avg <= 0) declineReasons.push('NO_SALES');
  if (Number.isFinite(cv) && cv > 1.2) declineReasons.push('VOLATILE');
  if (refunds > 12) declineReasons.push('HIGH_REFUNDS');
  if (chargebacks > 1) declineReasons.push('CHARGEBACKS');
  if (existingDebt > monthlyRevenue * 0.35) declineReasons.push('DEBT_SERVICE');
  if (stale > 14) declineReasons.push('STALE_DATA');

  const annualRevenueProxy = round2(avg * 365);
  const suggestedLimit = declineReasons.length ? 0 : round2(Math.min(monthlyRevenue * band.maxMultiple * 2, annualRevenueProxy * 0.08));
  const ratePercent = round2(BASE_RATE_PERCENT + band.premiumPercent);
  // Sweep so the facility clears inside its own term: 1/months of sales, floored
  // at 1% and capped at 15% so a till is never emptied.
  const sweepPercent = Math.max(1, Math.min(15, round2(100 / TERM_OPTIONS_MONTHS[1])));

  const terms = TERM_OPTIONS_MONTHS.map((m) => {
    const installment = installmentPayment(suggestedLimit, ratePercent, m);
    const totalRepayable = round2(installment * m);
    return { months: m, installment, totalInterest: round2(totalRepayable - suggestedLimit), totalRepayable };
  });

  const supplied = [avg > 0, sigma > 0, months > 0, metrics.refundRatePercent != null, metrics.chargebackRatePercent != null, metrics.staleSettlementDays != null].filter(Boolean).length;

  return {
    score,
    band: band.band,
    qualifies: declineReasons.length === 0 && suggestedLimit > 0,
    declineReasons,
    factors,
    annualRevenueProxy,
    suggestedLimit,
    ratePercent,
    sweepPercent,
    terms,
    confidence: round2(supplied / 6),
  };
}

/**
 * Allocate cash across a schedule in due-date order (oldest debt first, never
 * overpay past payoff). Returns the new schedule plus what was left unapplied.
 */
export function applySweep<T extends { period: number; total: number; paidAmount: number }>(
  schedule: T[],
  sweptAmount: number
): { schedule: (T & { paidAmount: number; status: string })[]; leftover: number; applied: number } {
  let left = Math.max(0, round2(Number(sweptAmount) || 0));
  const out = (schedule || []).map((row) => {
    const total = Number(row.total) || 0;
    const already = Number(row.paidAmount) || 0;
    const stillOwed = round2(Math.max(0, total - already));
    const take = Math.min(stillOwed, left);
    left = round2(left - take);
    const paidAmount = round2(already + take);
    // Status is judged against the row's own total, never against what was
    // outstanding at the start: a row part-paid before the sweep must not be
    // marked settled by a payment that only happens to reach that old figure.
    const status = paidAmount >= total && total > 0 ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'DUE';
    return { ...row, paidAmount, status };
  });
  const applied = round2(Math.max(0, (Number(sweptAmount) || 0) - left));
  return { schedule: out, leftover: left, applied };
}

/** What a merchant should be shown: the cost of the money, not just the payment. */
export function costOfCredit(principal: number, annualRatePercent: number, months: number): { installment: number; totalInterest: number; costPercent: number; apr: number } {
  const installment = installmentPayment(principal, annualRatePercent, months);
  const totalRepayable = round2(installment * months);
  const totalInterest = round2(totalRepayable - principal);
  return {
    installment,
    totalInterest,
    costPercent: principal > 0 ? round2((totalInterest / principal) * 100) : 0,
    apr: effectiveAnnualRate(annualRatePercent, months > 0 ? 12 : 1),
  };
}
