// ─── REGISTER ACCESS RULES (§37 Security / §7 Point of Sale) ────────────────
// The whole "one drawer, one cashier, my code only" guarantee reduces to these
// pure decisions, so they are tested without a database: PIN strength, the
// brute-force freeze arithmetic, occupancy (can this cashier take this register?)
// and the access gate that refuses sales on a locked drawer.
import { describe, it, expect } from 'vitest';
import {
  validateRegisterPin,
  pinIssueMessage,
  hashRegisterPin,
  verifyRegisterPin,
  pinLockState,
  pinLockoutUntil,
  normalizeIdleMinutes,
  shouldIdleLock,
  decideOpenRegister,
  decideRegisterAccess,
  MAX_PIN_ATTEMPTS,
  PIN_LOCKOUT_MINUTES,
  DEFAULT_IDLE_LOCK_MINUTES,
  MAX_IDLE_LOCK_MINUTES,
} from '../src/services/registerAccess';

describe('validateRegisterPin', () => {
  it('accepts a 4–8 digit personal code', () => {
    expect(validateRegisterPin('2585')).toBeNull();
    expect(validateRegisterPin('903418')).toBeNull();
    expect(validateRegisterPin('13579246')).toBeNull();
  });

  it('rejects missing and non-digit input', () => {
    expect(validateRegisterPin('')).toBe('MISSING');
    expect(validateRegisterPin(undefined)).toBe('MISSING');
    expect(validateRegisterPin(null)).toBe('MISSING');
    expect(validateRegisterPin(1234)).toBe('MISSING'); // not a string
    expect(validateRegisterPin('12a4')).toBe('NOT_DIGITS');
    expect(validateRegisterPin('12 34')).toBe('NOT_DIGITS');
  });

  it('enforces the length window', () => {
    expect(validateRegisterPin('123')).toBe('TOO_SHORT');
    expect(validateRegisterPin('123456789')).toBe('TOO_LONG');
  });

  it('rejects repeated and straight-run codes a colleague would guess', () => {
    expect(validateRegisterPin('1111')).toBe('TOO_WEAK');
    expect(validateRegisterPin('000000')).toBe('TOO_WEAK');
    expect(validateRegisterPin('1234')).toBe('TOO_WEAK');
    expect(validateRegisterPin('4321')).toBe('TOO_WEAK');
    expect(validateRegisterPin('456789')).toBe('TOO_WEAK');
  });

  it('does not treat an ascending pair as a full run', () => {
    // Only whole-PIN sequences are weak; 12 inside 9125 is fine.
    expect(validateRegisterPin('9125')).toBeNull();
  });

  it('explains every issue to the cashier', () => {
    const issue = validateRegisterPin('1234');
    expect(issue && pinIssueMessage(issue)).toMatch(/repeated or sequential/);
    expect(pinIssueMessage('TOO_SHORT')).toMatch(/at least 4/);
  });
});

describe('hashRegisterPin / verifyRegisterPin', () => {
  it('stores a hash that is not the PIN and still verifies it', async () => {
    const hash = await hashRegisterPin('2585');
    expect(hash).not.toContain('2585');
    expect(hash.startsWith('$2')).toBe(true); // bcrypt
    await expect(verifyRegisterPin(hash, '2585')).resolves.toBe(true);
    await expect(verifyRegisterPin(hash, '2586')).resolves.toBe(false);
  });

  it('never matches an unset PIN', async () => {
    await expect(verifyRegisterPin(null, '2585')).resolves.toBe(false);
    await expect(verifyRegisterPin(undefined, '2585')).resolves.toBe(false);
    await expect(verifyRegisterPin('', '2585')).resolves.toBe(false);
  });

  it('two cashiers sharing a code get different hashes (salted)', async () => {
    expect(await hashRegisterPin('2585')).not.toEqual(await hashRegisterPin('2585'));
  });
});

describe('pinLockState', () => {
  const now = 1_700_000_000_000;

  it('grants the full budget to a fresh PIN', () => {
    expect(pinLockState({ now })).toEqual({
      locked: false,
      remainingAttempts: MAX_PIN_ATTEMPTS,
      retryAfterSeconds: 0,
    });
  });

  it('counts the budget down with each failure', () => {
    expect(pinLockState({ failedAttempts: 2, now }).remainingAttempts).toBe(MAX_PIN_ATTEMPTS - 2);
    expect(pinLockState({ failedAttempts: MAX_PIN_ATTEMPTS - 1, now }).remainingAttempts).toBe(1);
  });

  it('freezes while the lockout window is open', () => {
    const state = pinLockState({ failedAttempts: MAX_PIN_ATTEMPTS, lockedUntil: new Date(now + 60_000), now });
    expect(state.locked).toBe(true);
    expect(state.remainingAttempts).toBe(0);
    expect(state.retryAfterSeconds).toBe(60);
  });

  it('releases the freeze the moment it expires', () => {
    const state = pinLockState({ failedAttempts: MAX_PIN_ATTEMPTS, lockedUntil: new Date(now - 1), now });
    expect(state.locked).toBe(false);
    expect(state.retryAfterSeconds).toBe(0);
  });

  it('ignores a negative attempt counter', () => {
    expect(pinLockState({ failedAttempts: -5, now }).remainingAttempts).toBe(MAX_PIN_ATTEMPTS);
  });
});

describe('pinLockoutUntil', () => {
  const now = 1_700_000_000_000;

  it('does not freeze before the last allowed attempt', () => {
    expect(pinLockoutUntil(MAX_PIN_ATTEMPTS - 1, now)).toBeNull();
  });

  it('freezes for the policy window once the budget is spent', () => {
    const until = pinLockoutUntil(MAX_PIN_ATTEMPTS, now);
    expect(until).toBeInstanceOf(Date);
    expect((until as Date).getTime() - now).toBe(PIN_LOCKOUT_MINUTES * 60 * 1000);
  });

  it('keeps freezing on further guesses (never shortens the window)', () => {
    const until = pinLockoutUntil(MAX_PIN_ATTEMPTS + 3, now);
    expect((until as Date).getTime() - now).toBe(PIN_LOCKOUT_MINUTES * 60 * 1000);
  });
});

describe('normalizeIdleMinutes', () => {
  it('keeps sane values in range', () => {
    expect(normalizeIdleMinutes(10)).toBe(10);
    expect(normalizeIdleMinutes(1)).toBe(1);
    expect(normalizeIdleMinutes(60)).toBe(MAX_IDLE_LOCK_MINUTES);
  });

  it('clamps absurd windows instead of trusting the client', () => {
    expect(normalizeIdleMinutes(9999)).toBe(MAX_IDLE_LOCK_MINUTES);
    expect(normalizeIdleMinutes(-5)).toBe(DEFAULT_IDLE_LOCK_MINUTES);
    expect(normalizeIdleMinutes(0)).toBe(DEFAULT_IDLE_LOCK_MINUTES);
  });

  it('falls back to the default for junk', () => {
    expect(normalizeIdleMinutes(undefined)).toBe(DEFAULT_IDLE_LOCK_MINUTES);
    expect(normalizeIdleMinutes('abc')).toBe(DEFAULT_IDLE_LOCK_MINUTES);
    expect(normalizeIdleMinutes(null)).toBe(DEFAULT_IDLE_LOCK_MINUTES);
  });

  it('floors fractional minutes', () => {
    expect(normalizeIdleMinutes(4.7)).toBe(4);
  });
});

describe('shouldIdleLock', () => {
  const t0 = 1_700_000_000_000;

  it('locks once the idle window has fully elapsed', () => {
    expect(shouldIdleLock(t0, t0 + 5 * 60_000, 5)).toBe(true);
    expect(shouldIdleLock(t0, t0 + 4 * 60_000, 5)).toBe(false);
  });

  it('re-arms on activity', () => {
    // A cashier who touched the screen a minute ago is not walked away from.
    expect(shouldIdleLock(t0 + 4 * 60_000, t0 + 5 * 60_000, 5)).toBe(false);
  });

  it('clamps a bogus configured window rather than locking instantly', () => {
    expect(shouldIdleLock(t0, t0 + 1000, -3)).toBe(false); // falls back to 5 min
    expect(shouldIdleLock(t0, t0 + 1000, NaN)).toBe(false);
  });

  it('refuses to lock on an unknown activity time', () => {
    expect(shouldIdleLock(NaN, t0 + 10 * 60_000, 5)).toBe(false);
  });
});

describe('decideOpenRegister — one drawer, one cashier', () => {
  const me = 'employee-me';

  it('lets a cashier take a free register', () => {
    expect(decideOpenRegister(me, null)).toBe('OK');
    expect(decideOpenRegister(me, undefined)).toBe('OK');
  });

  it('points a cashier at their own already-open drawer', () => {
    expect(decideOpenRegister(me, { employeeId: me })).toBe('ALREADY_OPEN');
    expect(decideOpenRegister(me, { employeeId: me, locked: true })).toBe('ALREADY_OPEN');
  });

  it('refuses a register another cashier is actively using', () => {
    expect(decideOpenRegister(me, { employeeId: 'other', locked: false })).toBe('OCCUPIED');
  });

  it('refuses a locked drawer even though nobody is standing at it', () => {
    // This is the heart of the feature: an empty-looking, locked till is still
    // somebody's money. It cannot be handed to a second cashier.
    expect(decideOpenRegister(me, { employeeId: 'other', locked: true })).toBe('LOCKED_TO_OTHER');
  });
});

describe('decideRegisterAccess — the sales gate', () => {
  it('allows work by a cashier with no drawer open (back office)', () => {
    expect(decideRegisterAccess(null)).toBe('ALLOW');
    expect(decideRegisterAccess(undefined)).toBe('ALLOW');
  });

  it('allows an unlocked session', () => {
    expect(decideRegisterAccess({ locked: false })).toBe('ALLOW');
    expect(decideRegisterAccess({})).toBe('ALLOW');
  });

  it('blocks every money movement behind a locked session', () => {
    expect(decideRegisterAccess({ locked: true })).toBe('LOCKED');
  });
});
