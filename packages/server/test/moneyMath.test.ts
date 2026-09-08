import { describe, it, expect } from 'vitest';
import {
  round2,
  computeOrderTotals,
  planGiftCardDeduction,
  planStoreCreditDeduction,
} from '../src/services/moneyMath';

describe('round2', () => {
  it('rounds to two decimals', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(12.3449)).toBe(12.34);
    expect(round2(12.345)).toBe(12.35);
  });

  it('damps float drift on classic sums', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it('coerces non-finite input to 0', () => {
    expect(round2(NaN)).toBe(0);
    expect(round2(Infinity)).toBe(0);
  });
});

describe('computeOrderTotals', () => {
  it('sums line totals with no tax', () => {
    const t = computeOrderTotals(
      [
        { unitPrice: 10, quantity: 2 },
        { unitPrice: 5.5, quantity: 1 },
      ],
      0,
    );
    expect(t).toEqual({ subtotal: 25.5, taxAmount: 0, total: 25.5 });
  });

  it('applies per-line discounts before tax', () => {
    const t = computeOrderTotals([{ unitPrice: 100, quantity: 1, discountAmt: 20 }], 10);
    // subtotal 80, tax 8, total 88
    expect(t).toEqual({ subtotal: 80, taxAmount: 8, total: 88 });
  });

  it('computes tax as a percentage of subtotal and rounds to 2dp', () => {
    const t = computeOrderTotals([{ unitPrice: 33.33, quantity: 3 }], 8.25);
    // subtotal 99.99, tax 8.2491.. -> 8.25, total 108.24
    expect(t.subtotal).toBe(99.99);
    expect(t.taxAmount).toBe(8.25);
    expect(t.total).toBe(108.24);
  });

  it('treats a non-finite tax rate as zero (never NaN into money)', () => {
    const t = computeOrderTotals([{ unitPrice: 10, quantity: 1 }], NaN);
    expect(t).toEqual({ subtotal: 10, taxAmount: 0, total: 10 });
  });

  it('returns zeros for an empty cart', () => {
    expect(computeOrderTotals([], 10)).toEqual({ subtotal: 0, taxAmount: 0, total: 0 });
  });

  it('ignores missing/invalid numeric fields defensively', () => {
    const t = computeOrderTotals([{ unitPrice: 10 } as any, { quantity: 2, unitPrice: 5 } as any], 0);
    // first line: qty 0 -> 0 ; second: 5*2 = 10
    expect(t.subtotal).toBe(10);
  });
});

describe('planGiftCardDeduction', () => {
  it('depletes a card used to exactly zero', () => {
    const r = planGiftCardDeduction(50, 50);
    expect(r).toEqual({ ok: true, newBalance: 0, status: 'DEPLETED' });
  });

  it('leaves a partial balance ACTIVE', () => {
    const r = planGiftCardDeduction(100, 30.5);
    expect(r).toEqual({ ok: true, newBalance: 69.5, status: 'ACTIVE' });
  });

  it('rejects an amount greater than the balance', () => {
    const r = planGiftCardDeduction(20, 20.01);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('INSUFFICIENT_BALANCE');
      expect(r.available).toBe(20);
    }
  });

  it('rejects a negative charge', () => {
    const r = planGiftCardDeduction(20, -5);
    expect(r.ok).toBe(false);
  });

  it('allows a zero charge without changing status', () => {
    const r = planGiftCardDeduction(0, 0);
    expect(r).toEqual({ ok: true, newBalance: 0, status: 'DEPLETED' });
  });
});

describe('planStoreCreditDeduction (FIFO)', () => {
  it('returns NO_CREDIT when there are no balances', () => {
    expect(planStoreCreditDeduction([], 10)).toEqual({ ok: false, reason: 'NO_CREDIT' });
  });

  it('deducts from a single credit partially', () => {
    const r = planStoreCreditDeduction([{ id: 'a', balance: 100 }], 40);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.allocations).toEqual([{ id: 'a', deduct: 40, newBalance: 60, status: 'ACTIVE' }]);
    }
  });

  it('consumes oldest credits first and depletes them', () => {
    // FIFO order already applied by the caller (createdAt asc).
    const r = planStoreCreditDeduction(
      [
        { id: 'old', balance: 25 },
        { id: 'mid', balance: 30 },
        { id: 'new', balance: 50 },
      ],
      60,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.allocations).toEqual([
        { id: 'old', deduct: 25, newBalance: 0, status: 'DEPLETED' },
        { id: 'mid', deduct: 30, newBalance: 0, status: 'DEPLETED' },
        { id: 'new', deduct: 5, newBalance: 45, status: 'ACTIVE' },
      ]);
      // Sum of deductions equals the charge.
      const sum = r.allocations.reduce((s, a) => s + a.deduct, 0);
      expect(round2(sum)).toBe(60);
    }
  });

  it('stops touching later credits once the amount is satisfied', () => {
    const r = planStoreCreditDeduction(
      [
        { id: 'a', balance: 50 },
        { id: 'b', balance: 50 },
      ],
      20,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.allocations).toHaveLength(1);
      expect(r.allocations[0].id).toBe('a');
    }
  });

  it('reports INSUFFICIENT_BALANCE with the total available', () => {
    const r = planStoreCreditDeduction(
      [
        { id: 'a', balance: 10 },
        { id: 'b', balance: 15 },
      ],
      30,
    );
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === 'INSUFFICIENT_BALANCE') {
      expect(r.available).toBe(25);
    }
  });

  it('deducts an exact total across multiple credits to zero', () => {
    const r = planStoreCreditDeduction(
      [
        { id: 'a', balance: 10.5 },
        { id: 'b', balance: 9.5 },
      ],
      20,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.allocations.every((a) => a.status === 'DEPLETED')).toBe(true);
      expect(r.allocations.every((a) => a.newBalance === 0)).toBe(true);
    }
  });
});
