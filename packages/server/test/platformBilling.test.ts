import { describe, it, expect } from 'vitest';
import {
  computeAccountStatus,
  isOverdue,
  normalizeMonthly,
  DEFAULT_GRACE_DAYS,
} from '../src/services/platformBilling';

// ─── Platform billing / lifecycle pure functions (no DB) ────────────────────
// These decide what an account's status means and when it is overdue. Kept
// side-effect-free so the operator lifecycle rules are pinned by fast tests.

const now = new Date('2026-09-21T12:00:00Z');
const iso = (d: string | number) => new Date(d);

describe('computeAccountStatus', () => {
  it('honors operator-set terminal states above everything else', () => {
    expect(computeAccountStatus({ status: 'SUSPENDED' }, now)).toBe('SUSPENDED');
    expect(computeAccountStatus({ status: 'CANCELLED', currentPeriodEnd: iso('2099-01-01') }, now)).toBe('CANCELLED');
    expect(computeAccountStatus({ status: 'ARCHIVED' }, now)).toBe('ARCHIVED');
  });

  it('treats a disabled account as suspended even with future coverage', () => {
    expect(computeAccountStatus({ status: 'ACTIVE', isActive: false, currentPeriodEnd: iso('2099-01-01') }, now)).toBe('SUSPENDED');
  });

  it('reasons from coverage and trial dates for live accounts', () => {
    expect(computeAccountStatus({ status: 'ACTIVE', isActive: true, currentPeriodEnd: iso('2099-01-01') }, now)).toBe('ACTIVE');
    expect(computeAccountStatus({ status: 'TRIALING', isActive: true, trialEnd: iso('2099-01-01') }, now)).toBe('TRIALING');
    // Paid period already elapsed → past due (subject to the grace job).
    expect(computeAccountStatus({ status: 'ACTIVE', isActive: true, currentPeriodEnd: iso('2020-01-01') }, now)).toBe('PAST_DUE');
    // Nothing attached yet → a fresh store is ACTIVE.
    expect(computeAccountStatus({ status: 'ACTIVE', isActive: true }, now)).toBe('ACTIVE');
  });

  it('prefers paid coverage over an overlapping trial window', () => {
    const org = { status: 'TRIALING', isActive: true, trialEnd: iso('2020-01-01'), currentPeriodEnd: iso('2099-01-01') };
    expect(computeAccountStatus(org, now)).toBe('ACTIVE');
  });
});

describe('isOverdue', () => {
  it('only flags past-due accounts beyond the grace window', () => {
    const lapsed = iso(now.getTime() - (DEFAULT_GRACE_DAYS + 3) * 86_400_000);
    const withinGrace = iso(now.getTime() - 1 * 86_400_000);
    expect(isOverdue({ status: 'ACTIVE', currentPeriodEnd: lapsed }, now)).toBe(true);
    expect(isOverdue({ status: 'ACTIVE', currentPeriodEnd: withinGrace }, now)).toBe(false);
  });

  it('never auto-suspends a healthy or unset account', () => {
    expect(isOverdue({ status: 'ACTIVE', currentPeriodEnd: iso('2099-01-01') }, now)).toBe(false);
    expect(isOverdue({ status: 'ACTIVE' }, now)).toBe(false);
    expect(isOverdue({ status: 'ARCHIVED' }, now)).toBe(false);
  });
});

describe('normalizeMonthly', () => {
  it('converts a cadence to a monthly figure', () => {
    expect(normalizeMonthly(119, 'MONTH')).toBe(119);
    expect(normalizeMonthly(120, 'YEAR')).toBe(10);
  });

  it('floors garbage and negatives to zero', () => {
    expect(normalizeMonthly(0, 'MONTH')).toBe(0);
    expect(normalizeMonthly(-50, 'MONTH')).toBe(0);
    expect(normalizeMonthly('abc', 'MONTH')).toBe(0);
  });
});
