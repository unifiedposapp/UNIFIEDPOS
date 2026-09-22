import { describe, it, expect } from 'vitest';
import {
  normalizeReference,
  reconcileBatch,
  floatDays,
  groupBySettlementDate,
  batchHealth,
  type ProviderLine,
  type InternalPayment,
} from '../src/services/settlement';

const payment = (overrides: Partial<InternalPayment> & { id: string }): InternalPayment => ({
  amount: 100,
  fee: 2.5,
  externalReference: `INV-${overrides.id}`,
  ...overrides,
});

const line = (overrides: Partial<ProviderLine>): ProviderLine => ({ amount: 100, fee: 2.5, externalReference: 'INV-p1', ...overrides });

describe('normalizeReference', () => {
  it('makes bank-specific spellings of the same reference equal', () => {
    expect(normalizeReference('inv-001')).toBe('INV001');
    expect(normalizeReference(' INV/001 ')).toBe('INV001');
    expect(normalizeReference('inv.001')).toBe(normalizeReference('INV_001'));
    expect(normalizeReference(null)).toBeNull();
    expect(normalizeReference('   ')).toBeNull();
  });
});

describe('reconcileBatch', () => {
  it('matches a clean statement and reports no variance', () => {
    const summary = reconcileBatch([line({})], [payment({ id: 'p1' })]);
    expect(summary.status).toBe('RECONCILED');
    expect(summary.matched).toBe(1);
    expect(summary.lines[0].status).toBe('MATCHED');
    expect(summary.variance).toBe(0);
    expect(summary.unmatchedInternal).toBe(0);
    expect(summary.gross).toBe(100);
    expect(summary.expectedNet).toBe(97.5);
  });

  it('flags a settled amount that differs from what we recorded', () => {
    const summary = reconcileBatch([line({ amount: 90 })], [payment({ id: 'p1' })]);
    expect(summary.amountMismatch).toBe(1);
    expect(summary.lines[0]).toMatchObject({ status: 'AMOUNT_MISMATCH', delta: -10 });
    expect(summary.status).toBe('DISCREPANCY');
  });

  it('respects the currency tolerance it was given', () => {
    const provider = [line({ amount: 100.05 })];
    expect(reconcileBatch(provider, [payment({ id: 'p1' })], { tolerance: 0.01 }).amountMismatch).toBe(1);
    expect(reconcileBatch(provider, [payment({ id: 'p1' })], { tolerance: 0.1 }).amountMismatch).toBe(0);
  });

  it('catches a fee the merchant agreement never authorised', () => {
    const summary = reconcileBatch([line({ fee: 9 })], [payment({ id: 'p1' })]);
    expect(summary.feeMismatch).toBe(1);
    expect(summary.lines[0].status).toBe('FEE_MISMATCH');
  });

  it('surfaces money that arrived with no payment behind it', () => {
    const summary = reconcileBatch([line({ externalReference: 'INV-unknown', amount: 500 })], [payment({ id: 'p1' })]);
    expect(summary.unmatchedProvider).toBe(1);
    expect(summary.lines[0].status).toBe('UNMATCHED_PROVIDER');
    // The payment we recorded never settled, which is the other half of the story.
    expect(summary.unmatchedInternal).toBe(1);
    expect(summary.unmatchedInternalIds).toEqual(['p1']);
  });

  it('reports a doubled-up reference rather than collapsing it onto one payment', () => {
    const summary = reconcileBatch([line({}), line({})], [payment({ id: 'p1' })]);
    expect(summary.duplicates).toBe(1);
    expect(summary.lines.map((l) => l.status)).toEqual(['MATCHED', 'DUPLICATE']);
  });

  it('matches on the provider id when the merchant reference is missing', () => {
    const summary = reconcileBatch(
      [{ providerRef: 'ch_xxx', amount: 100, fee: 2.5 }],
      [{ id: 'p9', providerRef: 'ch_xxx', amount: 100, fee: 2.5 }]
    );
    expect(summary.matched).toBe(1);
  });

  it('separates a fee disagreement from a clean match', () => {
    const summary = reconcileBatch([line({ fee: 3 })], [payment({ id: 'p1', fee: 2.5 })]);
    // Amount agrees, fee differs from what was booked: a fee mismatch, not a match.
    expect(summary.lines[0].status).toBe('FEE_MISMATCH');
    expect(summary.matched).toBe(0);
  });

  it('treats an empty statement as a total shortfall rather than a clean batch', () => {
    const summary = reconcileBatch([], [payment({ id: 'p1' })]);
    expect(summary.status).toBe('DISCREPANCY');
    expect(summary.unmatchedInternalIds).toEqual(['p1']);
    expect(summary.gross).toBe(0);
  });
});

describe('float + grouping', () => {
  it('measures how long the acquirer held the money', () => {
    const promised = new Date('2026-03-10T00:00:00Z');
    expect(floatDays(new Date('2026-03-12T00:00:00Z'), promised)).toBe(2);
    expect(floatDays(new Date('2026-03-09T00:00:00Z'), promised)).toBe(-1);
    expect(floatDays(new Date('nonsense'), promised)).toBe(0);
  });

  it('batches statement rows by value date, undated last', () => {
    const groups = groupBySettlementDate([
      line({ valueDate: '2026-03-11T00:00:00Z' }),
      line({ valueDate: '2026-03-10T00:00:00Z', amount: 50 }),
      line({ valueDate: null, amount: 20 }),
    ]);
    expect(groups.map((g) => g.date)).toEqual(['2026-03-10', '2026-03-11', 'UNDATED']);
    expect(groups[0].gross).toBe(50);
    expect(groups[1].fees).toBe(2.5);
  });
});

describe('batchHealth', () => {
  it('calls a matching batch healthy', () => {
    expect(batchHealth({ gross: 1000, expectedNet: 985, matchedNet: 985 })).toEqual({ matchRate: 100, discrepancyValue: 0, label: 'HEALTHY' });
  });

  it('watches a small gap and escalates a big one', () => {
    expect(batchHealth({ gross: 1000, expectedNet: 985, matchedNet: 984 }).label).toBe('WATCH');
    const bad = batchHealth({ gross: 1000, expectedNet: 985, matchedNet: 900 });
    expect(bad.matchRate).toBe(91.5);
    expect(bad.label).toBe('ESCALATE');
  });

  it('does not call an empty batch a problem', () => {
    expect(batchHealth({ gross: 0, expectedNet: 0, matchedNet: 0 })).toEqual({ matchRate: 100, discrepancyValue: 0, label: 'HEALTHY' });
  });
});
