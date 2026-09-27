// ─── PLATFORM BILLING HELPERS ────────────────────────────────────────────────
// Pure functions (no Prisma) that model a tenant's lifecycle against the
// platform. Routes and the scheduler share these so a manual "Suspend" click,
// a "record payment", and the 15-minute overdue job all agree on what a state
// means. Keeping them side-effect-free makes them trivially unit-testable.

import { round2 } from './moneyMath.js';

/** The full set of normalized platform-account states. */
export type AccountStatus =
  | 'ACTIVE'
  | 'TRIALING'
  | 'PAST_DUE'
  | 'SUSPENDED'
  | 'CANCELLED'
  | 'ARCHIVED';

/** The subset of Organization columns these helpers read. */
export interface AccountFields {
  status?: string | null;
  isActive?: boolean | null;
  trialEnd?: Date | null;
  currentPeriodEnd?: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Default grace window (days) after coverage lapses before we suspend. */
export const DEFAULT_GRACE_DAYS = 7;

/**
 * Derive the effective lifecycle state. Operator-set terminal states
 * (SUSPENDED/CANCELLED/ARCHIVED) always win; otherwise we reason from the
 * paid-through date and trial expiry. A tenant with no billing coverage yet is
 * treated as ACTIVE (a freshly-registered store before it is put on a plan).
 */
export function computeAccountStatus(org: AccountFields, now: Date = new Date()): AccountStatus {
  const stored = (org.status || '').toUpperCase();
  if (stored === 'ARCHIVED' || stored === 'CANCELLED' || stored === 'SUSPENDED') {
    return stored;
  }
  // Fast enable/disable flag is authoritative for a manual suspension.
  if (org.isActive === false) return 'SUSPENDED';

  const coverageEnd = org.currentPeriodEnd ?? null;
  const trialEnd = org.trialEnd ?? null;

  // Paid through a future date → clearly active.
  if (coverageEnd && now.getTime() <= coverageEnd.getTime()) return 'ACTIVE';

  // Inside a free trial (and not already past a paid period) → trialing.
  if (trialEnd && now.getTime() <= trialEnd.getTime()) return 'TRIALING';

  // Coverage lapsed → past due (the scheduler suspends once grace elapses).
  if (coverageEnd || trialEnd) return 'PAST_DUE';

  // No plan / coverage attached yet.
  return 'ACTIVE';
}

/**
 * Whether a tenant is overdue and past the grace window, i.e. safe to suspend
 * automatically. A tenant with no coverage dates is never auto-suspended (we
 * do not punish stores the operator has not put on a plan).
 */
export function isOverdue(
  org: AccountFields,
  now: Date = new Date(),
  graceDays: number = DEFAULT_GRACE_DAYS,
): boolean {
  const status = computeAccountStatus(org, now);
  if (status !== 'PAST_DUE') return false;
  const coverageEnd = org.currentPeriodEnd ?? org.trialEnd ?? null;
  if (!coverageEnd) return false;
  return now.getTime() > coverageEnd.getTime() + graceDays * DAY_MS;
}

/**
 * A plan's monthly revenue contribution. MONTH plans count at face value; YEAR
 * plans are normalized to a twelfth so mixed-cadence MRR is comparable.
 */
export function normalizeMonthly(amount: number | string, interval: string): number {
  const n = Number(amount || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if ((interval || 'MONTH').toUpperCase() === 'YEAR') return round2(n / 12);
  return round2(n);
}
