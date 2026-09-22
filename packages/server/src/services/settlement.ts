// ─── SETTLEMENT RECONCILIATION ───────────────────────────────────────────────
// An acquirer's settlement statement is the only document that says "yes, that
// money is really in your bank, minus these fees". Comparing it line by line to
// the payments we recorded is what surfaces a silent shortfall, a double post
// or a fee the merchant agreement never authorised.
//
// Pure module: rows come in as plain objects, a verdict comes out. Nothing here
// touches the database, so the matching rules are exhaustively unit-tested.
import { round2 } from './moneyMath.js';

export interface ProviderLine {
  externalReference?: string | null;
  amount: number;
  fee?: number | null;
  valueDate?: string | Date | null;
  /** Optional provider-side payment id, matched against Payment.providerRef. */
  providerRef?: string | null;
}

export interface InternalPayment {
  id: string;
  externalReference?: string | null;
  providerRef?: string | null;
  amount: number;
  fee?: number | null;
  orderId?: string | null;
  status?: string | null;
}

export type LineStatus =
  | 'MATCHED'
  | 'AMOUNT_MISMATCH'
  | 'FEE_MISMATCH'
  | 'UNMATCHED_PROVIDER'
  | 'DUPLICATE';

export interface LineVerdict {
  externalReference: string | null;
  status: LineStatus;
  amount: number;
  fee: number;
  paymentId: string | null;
  orderId: string | null;
  /** provider amount minus ours; non-zero only on a mismatch. */
  delta: number;
  note?: string;
}

export interface ReconciliationSummary {
  lineCount: number;
  matched: number;
  amountMismatch: number;
  feeMismatch: number;
  unmatchedProvider: number;
  duplicates: number;
  /** Payments we recorded that the provider never settled. */
  unmatchedInternal: number;
  gross: number;
  fees: number;
  expectedNet: number;
  matchedNet: number;
  variance: number;
  status: 'RECONCILED' | 'DISCREPANCY';
  lines: LineVerdict[];
  unmatchedInternalIds: string[];
}

export interface ReconcileOptions {
  /** Absolute currency tolerance before two amounts count as equal. */
  tolerance?: number;
  /** Absolute tolerance on the fee line. */
  feeTolerance?: number;
}

/** Keys are compared case-insensitively with punctuation stripped: refs differ per bank. */
export function normalizeReference(ref: unknown): string | null {
  const raw = String(ref ?? '').trim().toUpperCase().replace(/[\s\-_.\/]+/g, '');
  return raw || null;
}

function indexBy<T extends { id?: string; externalReference?: string | null; providerRef?: string | null }>(
  rows: T[],
  pick: (row: T) => string | null | undefined
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = normalizeReference(pick(row));
    if (!key) continue;
    const bucket = map.get(key);
    if (bucket) bucket.push(row);
    else map.set(key, [row]);
  }
  return map;
}

/**
 * Match a provider statement against our payment records.
 *
 * Lookup order for each provider line: externalReference, then providerRef. The
 * first internal row still unclaimed for that key wins, which keeps a repeated
 * reference (two partial captures of one invoice) from collapsing onto a single
 * payment — the second occurrence is reported as DUPLICATE instead.
 */
export function reconcileBatch(
  providerLines: ProviderLine[],
  internalPayments: InternalPayment[],
  options: ReconcileOptions = {}
): ReconciliationSummary {
  const tolerance = Number.isFinite(Number(options.tolerance)) ? Math.abs(Number(options.tolerance)) : 0.01;
  const feeTolerance = Number.isFinite(Number(options.feeTolerance)) ? Math.abs(Number(options.feeTolerance)) : tolerance;

  const byExternal = indexBy(internalPayments, (p) => p.externalReference);
  const byProviderRef = indexBy(internalPayments, (p) => p.providerRef);
  const claimed = new Set<string>();

  const lines: LineVerdict[] = [];
  const counters = { matched: 0, amountMismatch: 0, feeMismatch: 0, unmatchedProvider: 0, duplicates: 0 };

  for (const raw of providerLines || []) {
    const amount = round2(Number(raw?.amount) || 0);
    const fee = round2(Number(raw?.fee) || 0);
    const ext = normalizeReference(raw?.externalReference);
    const pref = normalizeReference(raw?.providerRef);

    const candidates =
      (ext && (byExternal.get(ext) || []).find((p) => !claimed.has(p.id))) ||
      (pref && (byProviderRef.get(pref) || []).find((p) => !claimed.has(p.id))) ||
      null;

    if (!candidates) {
      const repeated = Boolean((ext && (byExternal.get(ext) || []).length) || (pref && (byProviderRef.get(pref) || []).length));
      if (repeated) {
        counters.duplicates++;
        lines.push({ externalReference: raw?.externalReference ?? null, status: 'DUPLICATE', amount, fee, paymentId: null, orderId: null, delta: 0, note: 'reference already settled in this batch' });
      } else {
        counters.unmatchedProvider++;
        lines.push({ externalReference: raw?.externalReference ?? null, status: 'UNMATCHED_PROVIDER', amount, fee, paymentId: null, orderId: null, delta: amount, note: 'provider settled a payment we never recorded' });
      }
      continue;
    }

    claimed.add(candidates.id);
    const ours = round2(Number(candidates.amount) || 0);
    const theirFee = round2(Number(candidates.fee) || 0);
    const delta = round2(amount - fee - ours); // net settled vs. recorded gross
    const grossDelta = round2(amount - ours);

    if (Math.abs(grossDelta) > tolerance) {
      counters.amountMismatch++;
      lines.push({ externalReference: raw.externalReference ?? null, status: 'AMOUNT_MISMATCH', amount, fee, paymentId: candidates.id, orderId: candidates.orderId ?? null, delta: grossDelta, note: 'settled amount differs from recorded payment' });
      continue;
    }
    if (Math.abs(fee - theirFee) > feeTolerance && theirFee !== 0) {
      counters.feeMismatch++;
      lines.push({ externalReference: raw.externalReference ?? null, status: 'FEE_MISMATCH', amount, fee, paymentId: candidates.id, orderId: candidates.orderId ?? null, delta: round2(fee - theirFee), note: 'fee charged differs from the fee we booked' });
      continue;
    }
    counters.matched++;
    lines.push({ externalReference: raw.externalReference ?? null, status: 'MATCHED', amount, fee, paymentId: candidates.id, orderId: candidates.orderId ?? null, delta, note: delta === 0 ? undefined : 'settled net differs from recorded amount' });
  }

  const unmatched = (internalPayments || []).filter((p) => p.id && !claimed.has(p.id));
  const gross = round2((providerLines || []).reduce((sum, l) => sum + (Number(l?.amount) || 0), 0));
  const fees = round2((providerLines || []).reduce((sum, l) => sum + (Number(l?.fee) || 0), 0));
  const expectedNet = round2(gross - fees);
  const matchedNet = round2(lines.filter((l) => l.status === 'MATCHED').reduce((sum, l) => sum + l.amount - l.fee, 0));
  const variance = round2(matchedNet - expectedNet);

  const clean =
    counters.amountMismatch === 0 &&
    counters.feeMismatch === 0 &&
    counters.unmatchedProvider === 0 &&
    counters.duplicates === 0 &&
    unmatched.length === 0 &&
    Math.abs(variance) <= tolerance;

  return {
    lineCount: (providerLines || []).length,
    ...counters,
    unmatchedInternal: unmatched.length,
    gross,
    fees,
    expectedNet,
    matchedNet,
    variance,
    status: clean ? 'RECONCILED' : 'DISCREPANCY',
    lines,
    unmatchedInternalIds: unmatched.map((p) => p.id).filter(Boolean) as string[],
  };
}

/**
 * The headline the treasury screen shows: how long the acquirer is holding our
 * money relative to the rail's promise. A negative figure means they settled
 * early; a large positive figure is float worth financing.
 */
export function floatDays(settledAt: Date, promisedAt: Date): number {
  const ms = new Date(settledAt).getTime() - new Date(promisedAt).getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/** Group raw statement rows into per-day batches ready for persistence. */
export function groupBySettlementDate(lines: ProviderLine[]): { date: string; lines: ProviderLine[]; gross: number; fees: number }[] {
  const buckets = new Map<string, { date: string; lines: ProviderLine[]; gross: number; fees: number }>();
  for (const line of lines || []) {
    const rawDate = line?.valueDate ?? null;
    const key = rawDate ? new Date(rawDate).toISOString().slice(0, 10) : 'UNDATED';
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { date: key, lines: [], gross: 0, fees: 0 };
      buckets.set(key, bucket);
    }
    bucket.lines.push(line);
    bucket.gross = round2(bucket.gross + (Number(line?.amount) || 0));
    bucket.fees = round2(bucket.fees + (Number(line?.fee) || 0));
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface BatchHealth {
  /** 0-100 share of statement value that matched cleanly. */
  matchRate: number;
  discrepancyValue: number;
  label: 'HEALTHY' | 'WATCH' | 'ESCALATE';
}

/** Roll a summary up into a single number an owner can act on. */
export function batchHealth(summary: Pick<ReconciliationSummary, 'gross' | 'expectedNet' | 'matchedNet'>, tolerance = 0.01): BatchHealth {
  const gross = Math.abs(Number(summary.gross) || 0);
  const discrepancyValue = round2(Math.abs((Number(summary.matchedNet) || 0) - (Number(summary.expectedNet) || 0)));
  const matchRate = gross <= 0 ? 100 : round2(Math.max(0, Math.min(100, (1 - discrepancyValue / gross) * 100)));
  const label: BatchHealth['label'] = discrepancyValue <= tolerance ? 'HEALTHY' : matchRate >= 99 ? 'WATCH' : 'ESCALATE';
  return { matchRate, discrepancyValue, label };
}
