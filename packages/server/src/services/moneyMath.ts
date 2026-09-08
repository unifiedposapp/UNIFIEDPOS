/**
 * Pure money-path math for checkout (§10 payments, §34 transactional integrity).
 *
 * Dependency-free (no Prisma, no I/O) so it can be unit-tested deterministically.
 * `orders.ts` calls these to compute order totals and to PLAN stored-value
 * (gift card / store credit) deductions; the route then applies the returned plan
 * with Prisma writes inside its transaction. Keeping the arithmetic here means
 * the numbers that move real money are covered by tests instead of living inline
 * in a 200-line request handler.
 */

/** Round to 2 decimal places, damping binary-float drift (e.g. 0.1 + 0.2). */
export function round2(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export interface OrderLineInput {
  unitPrice: number;
  quantity: number;
  discountAmt?: number;
}

export interface OrderTotals {
  subtotal: number;
  taxAmount: number;
  total: number;
}

/**
 * Compute order subtotal, tax and total. Line total = unitPrice*quantity -
 * discount; tax is a percentage of the subtotal. All results are rounded to 2dp.
 * A non-finite tax rate is treated as 0 (never NaN into the money path).
 */
export function computeOrderTotals(items: OrderLineInput[], taxRatePercent: number): OrderTotals {
  let subtotal = 0;
  for (const it of items || []) {
    const discount = Number(it.discountAmt) || 0;
    const unitPrice = Number(it.unitPrice) || 0;
    const quantity = Number(it.quantity) || 0;
    subtotal += unitPrice * quantity - discount;
  }
  subtotal = round2(subtotal);
  const rate = Number.isFinite(Number(taxRatePercent)) ? Number(taxRatePercent) : 0;
  const taxAmount = round2(subtotal * (rate / 100));
  const total = round2(subtotal + taxAmount);
  return { subtotal, taxAmount, total };
}

export type StoredValueStatus = 'DEPLETED' | 'ACTIVE';

export interface GiftCardDeductionOk {
  ok: true;
  newBalance: number;
  status: StoredValueStatus;
}
export interface GiftCardDeductionFail {
  ok: false;
  reason: 'INSUFFICIENT_BALANCE';
  available: number;
}
export type GiftCardDeductionResult = GiftCardDeductionOk | GiftCardDeductionFail;

/**
 * Plan a single gift-card deduction: given the card's current balance and the
 * amount to charge, return the new balance + status, or an insufficiency result.
 * A card driven to exactly 0 becomes DEPLETED. Pure + deterministic.
 */
export function planGiftCardDeduction(currentBalance: number, amount: number): GiftCardDeductionResult {
  const available = round2(currentBalance);
  const charge = round2(amount);
  if (charge < 0) {
    return { ok: false, reason: 'INSUFFICIENT_BALANCE', available };
  }
  if (available < charge) {
    return { ok: false, reason: 'INSUFFICIENT_BALANCE', available };
  }
  const newBalance = round2(available - charge);
  return { ok: true, newBalance, status: newBalance <= 0 ? 'DEPLETED' : 'ACTIVE' };
}

export interface StoredValueBalance {
  id: string;
  balance: number;
}

export interface DeductionAllocation {
  id: string;
  deduct: number;
  newBalance: number;
  status: StoredValueStatus;
}

export type StoreCreditDeductionResult =
  | { ok: true; allocations: DeductionAllocation[] }
  | { ok: false; reason: 'NO_CREDIT' }
  | { ok: false; reason: 'INSUFFICIENT_BALANCE'; available: number };

/**
 * Plan a FIFO store-credit deduction across one or more credit balances.
 * `credits` MUST be ordered oldest-first (the route orders by createdAt asc);
 * this consumes each balance in turn until `amount` is satisfied. Balances driven
 * to 0 become DEPLETED. Pure + deterministic — no DB access.
 */
export function planStoreCreditDeduction(
  credits: StoredValueBalance[],
  amount: number,
): StoreCreditDeductionResult {
  if (!credits || credits.length === 0) {
    return { ok: false, reason: 'NO_CREDIT' };
  }
  const charge = round2(amount);
  let available = 0;
  for (const c of credits) available += Number(c.balance) || 0;
  available = round2(available);
  if (charge < 0 || available < charge) {
    return { ok: false, reason: 'INSUFFICIENT_BALANCE', available };
  }

  const allocations: DeductionAllocation[] = [];
  let remaining = charge;
  for (const c of credits) {
    if (remaining <= 0) break;
    const bal = round2(c.balance);
    const deduct = round2(Math.min(bal, remaining));
    if (deduct <= 0) continue;
    const newBalance = round2(bal - deduct);
    allocations.push({ id: c.id, deduct, newBalance, status: newBalance <= 0 ? 'DEPLETED' : 'ACTIVE' });
    remaining = round2(remaining - deduct);
  }
  return { ok: true, allocations };
}
