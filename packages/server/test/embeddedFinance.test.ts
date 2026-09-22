import { describe, it, expect } from 'vitest';
import {
  installmentPayment,
  amortizeSchedule,
  effectiveAnnualRate,
  coefficientOfVariation,
  debtToRevenue,
  paybackDays,
  underwrite,
  applySweep,
  costOfCredit,
  MIN_ACTIVE_MONTHS,
  BASE_RATE_PERCENT,
  TERM_OPTIONS_MONTHS,
  type TradingMetrics,
} from '../src/services/embeddedFinance';

const healthy: TradingMetrics = {
  avgDailyNetSales: 4000,
  salesStdDev: 600,
  activeMonths: 18,
  refundRatePercent: 2,
  chargebackRatePercent: 0.1,
  dormantDayRatio: 0.05,
  existingMonthlyDebt: 0,
  staleSettlementDays: 0,
};

describe('loan maths', () => {
  it('levels the payment and handles a zero-rate facility', () => {
    expect(installmentPayment(12_000, 12, 12)).toBe(1066.19);
    expect(installmentPayment(1000, 0, 10)).toBe(100);
    expect(installmentPayment(0, 10, 6)).toBe(0);
  });

  it('amortises to exactly the principal, cent for cent', () => {
    const rows = amortizeSchedule(10_000, 18.5, 6, new Date('2026-01-31T00:00:00Z'));
    expect(rows).toHaveLength(6);
    expect(rows[rows.length - 1].balance).toBe(0);
    expect(rows.reduce((s, r) => s + r.principal, 0)).toBeCloseTo(10_000, 2);
    // Interest falls as the balance does; the payment does not move.
    expect(rows[0].interest).toBeGreaterThan(rows[4].interest);
    expect(rows.every((r) => r.total > 0)).toBe(true);
  });

  it('turns a nominal rate into the effective one a merchant actually pays', () => {
    expect(effectiveAnnualRate(12, 12)).toBe(12.68);
    expect(effectiveAnnualRate(0)).toBe(0);
  });

  it('reports the cost of credit rather than just the instalment', () => {
    const cost = costOfCredit(5000, 24, 6);
    expect(cost.installment).toBeGreaterThan(0);
    expect(cost.totalInterest).toBeGreaterThan(0);
    expect(cost.costPercent).toBeGreaterThan(0);
    expect(cost.apr).toBeGreaterThan(24 - 0.5); // effective beats nominal when compounded
  });
});

describe('ratios', () => {
  it('treats no sales as infinite volatility rather than zero', () => {
    expect(coefficientOfVariation(0, 10)).toBe(Infinity);
    expect(coefficientOfVariation(100, 10)).toBe(0.1);
  });

  it('has no debt-to-revenue ceiling to hide behind with zero revenue', () => {
    expect(debtToRevenue(500, 10_000)).toBe(0.05);
    expect(debtToRevenue(500, 0)).toBe(Infinity);
  });

  it('only quotes a payback when there is something to sweep', () => {
    expect(paybackDays(1000, 99.9)).toBe(11);
    expect(paybackDays(1000, 0)).toBeNull();
  });
});

describe('underwriting', () => {
  it('approves a stable, established till and explains why', () => {
    const decision = underwrite(healthy);
    expect(decision.qualifies).toBe(true);
    expect(decision.declineReasons).toEqual([]);
    expect(decision.suggestedLimit).toBeGreaterThan(0);
    expect(decision.score).toBeGreaterThanOrEqual(300);
    expect(decision.score).toBeLessThanOrEqual(850);
    expect(decision.factors.map((f) => f.key)).toEqual(['HISTORY', 'STABILITY', 'DISPUTES', 'TRADING_DAYS', 'CAPACITY', 'FRESHNESS']);
    expect(decision.factors.reduce((s, f) => s + f.points, 0)).toBeGreaterThan(0);
    expect(decision.confidence).toBe(1);
    expect(decision.ratePercent).toBeGreaterThanOrEqual(BASE_RATE_PERCENT);
  });

  it('prices risk: a shakier book gets a worse band and a higher rate', () => {
    const good = underwrite(healthy);
    const shaky = underwrite({ ...healthy, salesStdDev: 3600, refundRatePercent: 4, chargebackRatePercent: 0.4 });
    expect(shaky.score).toBeLessThan(good.score);
    expect(shaky.ratePercent).toBeGreaterThanOrEqual(good.ratePercent);
  });

  it('declines a business that has not traded long enough', () => {
    const decision = underwrite({ ...healthy, activeMonths: MIN_ACTIVE_MONTHS - 1 });
    expect(decision.qualifies).toBe(false);
    expect(decision.declineReasons).toContain('TOO_NEW');
    expect(decision.suggestedLimit).toBe(0);
  });

  it('declines volatility, refunds, chargebacks, debt service and stale data', () => {
    expect(underwrite({ ...healthy, salesStdDev: 9999 }).declineReasons).toContain('VOLATILE');
    expect(underwrite({ ...healthy, refundRatePercent: 20 }).declineReasons).toContain('HIGH_REFUNDS');
    expect(underwrite({ ...healthy, chargebackRatePercent: 5 }).declineReasons).toContain('CHARGEBACKS');
    expect(underwrite({ ...healthy, existingMonthlyDebt: 90_000 }).declineReasons).toContain('DEBT_SERVICE');
    expect(underwrite({ ...healthy, staleSettlementDays: 30 }).declineReasons).toContain('STALE_DATA');
    expect(underwrite({ ...healthy, avgDailyNetSales: 0 }).declineReasons).toContain('NO_SALES');
  });

  it('offers a term sheet for every advertised term', () => {
    const decision = underwrite(healthy);
    expect(decision.terms.map((t) => t.months)).toEqual([...TERM_OPTIONS_MONTHS]);
    for (const term of decision.terms) {
      expect(term.totalRepayable).toBeGreaterThanOrEqual(decision.suggestedLimit);
      expect(term.totalInterest).toBeCloseTo(term.totalRepayable - decision.suggestedLimit, 2);
    }
    // A longer term is more interest but a smaller payment.
    const shortest = decision.terms[0];
    const longest = decision.terms[decision.terms.length - 1];
    expect(longest.totalInterest).toBeGreaterThan(shortest.totalInterest);
    expect(longest.installment).toBeLessThan(shortest.installment);
  });

  it('never proposes a sweep that empties a till', () => {
    expect(underwrite(healthy).sweepPercent).toBeLessThanOrEqual(15);
    expect(underwrite(healthy).sweepPercent).toBeGreaterThanOrEqual(1);
  });
});

describe('daily sweep allocation', () => {
  const schedule = [
    { period: 1, total: 1000, paidAmount: 0 },
    { period: 2, total: 1000, paidAmount: 400 },
    { period: 3, total: 1000, paidAmount: 0 },
  ];

  it('pays the oldest debt first and never overpays past payoff', () => {
    const result = applySweep(schedule, 1200);
    expect(result.applied).toBe(1200);
    expect(result.leftover).toBe(0);
    expect(result.schedule[0].paidAmount).toBe(1000);
    expect(result.schedule[1].paidAmount).toBe(600);
    expect(result.schedule[0].status).toBe('PAID');
    expect(result.schedule[1].status).toBe('PARTIAL');
    expect(result.schedule[2].paidAmount).toBe(0);
  });

  it('reports what it could not apply', () => {
    const result = applySweep(schedule, 5000);
    expect(result.applied).toBe(2600);
    expect(result.leftover).toBe(2400);
    expect(result.schedule.every((r) => r.status !== 'DUE')).toBe(true);
  });

  it('leaves an empty schedule alone', () => {
    expect(applySweep([], 500)).toEqual({ schedule: [], leftover: 500, applied: 0 });
    expect(applySweep(schedule, 0).applied).toBe(0);
  });
});
