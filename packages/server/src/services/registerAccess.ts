// ─── REGISTER ACCESS SERVICE (§37 Security / §7 Point of Sale) ──────────────
// One physical drawer must belong to exactly one cashier at a time, and walking
// away from it must never leave the money exposed. This module owns every rule
// behind that guarantee:
//
//   1. An *individual* register PIN per cashier (bcrypt-hashed, never stored or
//      returned in plain text) — the thing that reopens a locked drawer.
//   2. A per-session HANDOVER LOCK: while a cashier's register session is
//      locked, that drawer accepts no sales, no discounts and no cash movement
//      until the SAME cashier re-authenticates.
//   3. Register OCCUPANCY: a register holding another cashier's open session can
//      never be opened by a second cashier, so two people can never share — and
//      therefore never corrupt or raid — each other's drawer.
//
// Every function here is pure (no I/O, clock injected) so the rules are unit-
// testable without a database; the thin Prisma wrappers at the bottom are the
// only place that touches rows.
import bcrypt from 'bcryptjs';
import { prisma } from '../db/client.js';

// ── Policy constants (single source of truth for server + tests) ────────────
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;
/** Consecutive wrong PINs before the PIN itself is temporarily frozen. */
export const MAX_PIN_ATTEMPTS = 5;
/** How long a frozen PIN stays frozen (minutes). */
export const PIN_LOCKOUT_MINUTES = 5;
/** Idle time before the POS auto-locks an unattended drawer (minutes). */
export const DEFAULT_IDLE_LOCK_MINUTES = 5;
export const MIN_IDLE_LOCK_MINUTES = 1;
export const MAX_IDLE_LOCK_MINUTES = 60;

export const LOCK_REASON = {
  MANUAL: 'MANUAL', // cashier tapped "Lock Register"
  IDLE: 'IDLE', // the workstation auto-locked on inactivity
} as const;
export type LockReason = keyof typeof LOCK_REASON;

// ── PIN strength ────────────────────────────────────────────────────────────
export type PinIssue = 'MISSING' | 'NOT_DIGITS' | 'TOO_SHORT' | 'TOO_LONG' | 'TOO_WEAK';

/**
 * Validate a candidate register PIN. Digits only, 4–8 long. A PIN is a
 * convenience factor at a shared workstation, so we deliberately keep the
 * keyboard usable on a touchscreen — but we reject the trivially guessable
 * patterns (runs like 1234/4321 and repeats like 1111) which are what actually
 * gets a drawer opened by a colleague standing behind the cashier.
 * Returns `null` when the PIN is acceptable, otherwise the first issue found.
 */
export function validateRegisterPin(pin: unknown): PinIssue | null {
  if (typeof pin !== 'string' || pin.length === 0) return 'MISSING';
  if (!/^\d+$/.test(pin)) return 'NOT_DIGITS';
  if (pin.length < PIN_MIN_LENGTH) return 'TOO_SHORT';
  if (pin.length > PIN_MAX_LENGTH) return 'TOO_LONG';
  if (isRepeating(pin) || isSequencial(pin)) return 'TOO_WEAK';
  return null;
}

function isRepeating(pin: string): boolean {
  return new Set(pin.split('')).size === 1;
}

// Ascending or descending digit run of the whole PIN (1234, 9876, 4567…).
function isSequencial(pin: string): boolean {
  const codes = pin.split('').map((c) => c.charCodeAt(0));
  let ascending = true;
  let descending = true;
  for (let i = 1; i < codes.length; i++) {
    ascending = ascending && codes[i] - codes[i - 1] === 1;
    descending = descending && codes[i - 1] - codes[i] === 1;
  }
  return ascending || descending;
}

export const PIN_ISSUE_MESSAGES: Record<PinIssue, string> = {
  MISSING: 'A PIN is required',
  NOT_DIGITS: 'The PIN must be digits only',
  TOO_SHORT: `The PIN must be at least ${PIN_MIN_LENGTH} digits`,
  TOO_LONG: `The PIN must be at most ${PIN_MAX_LENGTH} digits`,
  TOO_WEAK: 'The PIN cannot be a repeated or sequential run of digits',
};

/** Human-readable rejection reason for a validation issue. */
export function pinIssueMessage(issue: PinIssue): string {
  return PIN_ISSUE_MESSAGES[issue];
}

/** A PIN is never reused verbatim as a password — hash it like one. */
export function hashRegisterPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

export function verifyRegisterPin(hash: string | null | undefined, pin: string): Promise<boolean> {
  if (!hash) return Promise.resolve(false);
  return bcrypt.compare(pin, hash);
}

// ── Brute-force freeze ──────────────────────────────────────────────────────
export interface PinLockState {
  /** True while the PIN is frozen after too many wrong guesses. */
  locked: boolean;
  /** Attempts still allowed before the freeze (0 while frozen). */
  remainingAttempts: number;
  /** Whole seconds left on the freeze (0 when not frozen). */
  retryAfterSeconds: number;
}

/**
 * Decide whether a PIN may be tried right now. `lockedUntil` wins over the
 * attempt counter so an expired freeze immediately restores one more budget of
 * attempts (the counter is cleared by the caller on unlock success).
 */
export function pinLockState(input: {
  failedAttempts?: number | null;
  lockedUntil?: Date | null;
  now?: number;
  maxAttempts?: number;
}): PinLockState {
  const now = input.now ?? Date.now();
  const maxAttempts = input.maxAttempts ?? MAX_PIN_ATTEMPTS;
  const attempts = Math.max(0, input.failedAttempts ?? 0);
  const until = input.lockedUntil ? new Date(input.lockedUntil).getTime() : 0;

  if (until > now) {
    return { locked: true, remainingAttempts: 0, retryAfterSeconds: Math.ceil((until - now) / 1000) };
  }
  if (attempts >= maxAttempts) {
    // Counter says frozen but the window already elapsed — usable again.
    return { locked: false, remainingAttempts: 0, retryAfterSeconds: 0 };
  }
  return { locked: false, remainingAttempts: maxAttempts - attempts, retryAfterSeconds: 0 };
}

/** The freeze window to apply when the Nth consecutive wrong attempt is reached. */
export function pinLockoutUntil(attemptsAfterFailure: number, now: number = Date.now()): Date | null {
  if (attemptsAfterFailure < MAX_PIN_ATTEMPTS) return null;
  return new Date(now + PIN_LOCKOUT_MINUTES * 60 * 1000);
}

// ── Idle auto-lock ──────────────────────────────────────────────────────────
/** Clamp a user-configured idle window into a sane range. */
export function normalizeIdleMinutes(minutes: unknown): number {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_IDLE_LOCK_MINUTES;
  return Math.min(MAX_IDLE_LOCK_MINUTES, Math.max(MIN_IDLE_LOCK_MINUTES, Math.floor(n)));
}

/** True once `idleMinutes` have passed since the last cashier interaction. */
export function shouldIdleLock(lastActivityAt: number, now: number, idleMinutes: number): boolean {
  const minutes = normalizeIdleMinutes(idleMinutes);
  if (!Number.isFinite(lastActivityAt) || !Number.isFinite(now)) return false;
  return now - lastActivityAt >= minutes * 60 * 1000;
}

// ── Register occupancy ──────────────────────────────────────────────────────
export type OpenDecision =
  | 'OK' // free to take this register
  | 'ALREADY_OPEN' // caller already holds an open drawer
  | 'OCCUPIED' // another cashier holds an unlocked session on it
  | 'LOCKED_TO_OTHER' // another cashier walked away and locked it
  | 'NOT_AVAILABLE'; // register does not exist in this organization / retired

/**
 * Decide whether `employeeId` may start a session on a register.
 * `held` is the register's current OPEN session (with its owner), if any.
 * The core isolation rule: a register with somebody else's open session is
 * somebody else's drawer — nobody else may take it over, locked or not.
 */
export function decideOpenRegister(
  employeeId: string,
  held: { employeeId: string; locked?: boolean } | null | undefined,
): OpenDecision {
  if (!held) return 'OK';
  if (held.employeeId === employeeId) return 'ALREADY_OPEN';
  return held.locked ? 'LOCKED_TO_OTHER' : 'OCCUPIED';
}

export type AccessDecision =
  | 'ALLOW' // no session at all (back-office work) or own unlocked session
  | 'LOCKED' // own session is locked — re-authenticate with the PIN
  | 'FOREIGN_LOCKED'; // should never happen with a correct token, defended anyway

/**
 * Gate for money-moving requests (sales, refunds, cash moves): the caller's own
 * open session must not be locked. `session` is the CALLER's session only — the
 * route looks it up by employeeId, so one cashier's lock can never be cleared
 * (or bypassed) by another.
 */
export function decideRegisterAccess(session: { locked?: boolean } | null | undefined): AccessDecision {
  if (!session) return 'ALLOW';
  return session.locked ? 'LOCKED' : 'ALLOW';
}

// ── Thin Prisma wrappers (the only I/O in this module) ──────────────────────
export interface OpenSessionLike {
  id: string;
  registerId: string;
  employeeId: string;
  locked: boolean;
  lockReason?: string | null;
  status: string;
}

/** The caller's currently open drawer, if any (newest wins on legacy doubles). */
export async function findOpenSession(employeeId: string | undefined): Promise<OpenSessionLike | null> {
  if (!employeeId) return null;
  const session = await prisma.registerSession.findFirst({
    where: { employeeId, status: 'OPEN' },
    orderBy: { openedAt: 'desc' },
    select: { id: true, registerId: true, employeeId: true, locked: true, lockReason: true, status: true },
  });
  return session as OpenSessionLike | null;
}

/**
 * The register's current open drawer (any owner) — used for the occupancy rule.
 * Restricted to `organizationId` so a register id from another tenant can never
 * be matched.
 */
export async function findRegisterHolder(
  registerId: string,
  organizationId: string,
): Promise<{ employeeId: string; locked: boolean } | null> {
  const holder = await prisma.registerSession.findFirst({
    where: { registerId, status: 'OPEN', register: { organizationId } },
    orderBy: { openedAt: 'desc' },
    select: { employeeId: true, locked: true },
  });
  return holder ?? null;
}

/** PIN state a cashier may always read about themselves. */
export async function loadPinState(employeeId: string) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { registerPin: true, pinFailedAttempts: true, pinLockedUntil: true, pinUpdatedAt: true },
  });
  return {
    pinConfigured: !!employee?.registerPin,
    pinUpdatedAt: employee?.pinUpdatedAt ?? null,
    lock: pinLockState({
      failedAttempts: employee?.pinFailedAttempts,
      lockedUntil: employee?.pinLockedUntil,
    }),
  };
}

/**
 * Verify a cashier's PIN and record the outcome. Never throws on a wrong PIN —
 * it returns the remaining budget so the caller can render a friendly message
 * (and so a wrong guess can never be turned into a 500).
 */
export async function consumePinAttempt(
  employeeId: string,
  pin: string,
  now: number = Date.now(),
): Promise<{ ok: true } | { ok: false; lock: PinLockState }> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { registerPin: true, pinFailedAttempts: true, pinLockedUntil: true },
  });
  if (!employee?.registerPin) return { ok: false, lock: pinLockState({}) };

  const gate = pinLockState({ failedAttempts: employee.pinFailedAttempts, lockedUntil: employee.pinLockedUntil, now });
  if (gate.locked) return { ok: false, lock: gate };

  if (await verifyRegisterPin(employee.registerPin, pin)) {
    if (employee.pinFailedAttempts !== 0 || employee.pinLockedUntil) {
      await prisma.employee.update({
        where: { id: employeeId },
        data: { pinFailedAttempts: 0, pinLockedUntil: null },
      });
    }
    return { ok: true };
  }

  const attempts = employee.pinFailedAttempts + 1;
  const lockedUntil = pinLockoutUntil(attempts, now) ?? employee.pinLockedUntil;
  await prisma.employee.update({
    where: { id: employeeId },
    data: { pinFailedAttempts: attempts, pinLockedUntil: lockedUntil },
  });
  return {
    ok: false,
    lock: pinLockState({ failedAttempts: attempts, lockedUntil, now }),
  };
}
