// ─── REGISTER LOCK HOOK (§7 Point of Sale / §37 Security) ───────────────────
// Owns the POS workstation's drawer-lock lifecycle: the cashier's own open
// session, whether that drawer is currently locked behind their individual PIN,
// the organization's idle auto-lock policy, and the activity timer that fires the
// lock the moment the cashier walks away.
//
// The overlay this feeds is a convenience; the server refuses sales on a locked
// session regardless (middleware/registerAccess.ts), so a tampered client gains
// nothing. State is refreshed on an interval so a lock applied in another tab —
// or lifted by a supervisor — is reflected without a reload.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

const FALLBACK_IDLE_MINUTES = 5;
/** How often the workstation re-reads the drawer state from the server. */
const SESSION_POLL_MS = 60_000;
/** Activity sampling interval for the idle countdown. */
const IDLE_TICK_MS = 5_000;

export interface RegisterLockController {
  /** The cashier's own open session (null when no register is open). */
  session: any | null;
  /** True while the drawer is locked and the overlay must be shown. */
  locked: boolean;
  loading: boolean;
  /** Whether this cashier has an individual PIN to lock (and unlock) with. */
  pinConfigured: boolean;
  /** Org policy: idle minutes before an unattended register locks itself. */
  idleLockMinutes: number;
  registerName: string | null;
  /** Last error from an unlock attempt (rendered by the PIN pad). */
  unlockError: string | null;
  lock: (reason?: 'MANUAL' | 'IDLE') => Promise<void>;
  /** Returns true only when the server accepted the PIN. */
  unlock: (pin: string) => Promise<boolean>;
  refresh: () => Promise<void>;
  /** Re-arm the lock (e.g. the cashier chose a PIN for the first time). */
  setPinConfigured: (configured: boolean) => void;
}

export function useRegisterLock(options: { enabled?: boolean } = {}): RegisterLockController {
  const enabled = options.enabled !== false;

  const [session, setSession] = useState<any | null>(null);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pinConfigured, setPinConfigured] = useState(false);
  const [idleLockMinutes, setIdleLockMinutes] = useState(FALLBACK_IDLE_MINUTES);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  // Last human interaction with this workstation, and a guard so a slow network
  // cannot make the idle timer fire the lock twice.
  const lastActivityRef = useRef(Date.now());
  const lockingRef = useRef(false);
  const stateRef = useRef({ locked: false, pinConfigured: false, idleLockMinutes: FALLBACK_IDLE_MINUTES, hasSession: false });
  stateRef.current = { locked, pinConfigured, idleLockMinutes, hasSession: !!session };

  const refresh = useCallback(async () => {
    try {
      const res = await api.getRegisterSession();
      const data = res.data || null;
      setSession(data);
      setLocked(!!data?.locked);
      if (data) {
        if (typeof data.pinConfigured === 'boolean') setPinConfigured(data.pinConfigured);
        if (data.idleLockMinutes) setIdleLockMinutes(data.idleLockMinutes);
      } else {
        // No drawer open: learn the PIN/policy state from the lightweight calls.
        const [pinRes, policyRes] = await Promise.all([
          api.getRegisterPinStatus().catch(() => null),
          api.getRegisterPolicy().catch(() => null),
        ]);
        if (pinRes?.data) setPinConfigured(!!pinRes.data.pinConfigured);
        if (policyRes?.data?.idleLockMinutes) setIdleLockMinutes(policyRes.data.idleLockMinutes);
      }
    } catch (err) {
      // A transient failure must never trap the cashier out of the POS.
      console.error('Failed to load register session:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  const lock = useCallback(async (reason: 'MANUAL' | 'IDLE' = 'MANUAL') => {
    if (lockingRef.current || !stateRef.current.hasSession || stateRef.current.locked) return;
    if (!stateRef.current.pinConfigured) return; // nothing to lock behind yet
    lockingRef.current = true;
    try {
      await api.lockRegister(reason);
      setLocked(true);
      setUnlockError(null);
    } catch (err: any) {
      console.error('Failed to lock register:', err);
    } finally {
      lockingRef.current = false;
    }
  }, []);

  const unlock = useCallback(async (pin: string): Promise<boolean> => {
    try {
      await api.unlockRegister(pin);
      setLocked(false);
      setUnlockError(null);
      lastActivityRef.current = Date.now();
      await refresh();
      return true;
    } catch (err: any) {
      setUnlockError(err?.message || 'Incorrect PIN');
      return false;
    }
  }, [refresh]);

  // Activity tracking: any pointer/key interaction re-arms the idle countdown,
  // and returning to the tab counts as activity only if the drawer was never
  // locked in the first place (a lock is not undone by focusing the window).
  useEffect(() => {
    if (!enabled) return;
    const mark = () => { lastActivityRef.current = Date.now(); };
    const events: (keyof DocumentEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    events.forEach((e) => document.addEventListener(e, mark, { passive: true }));
    return () => events.forEach((e) => document.removeEventListener(e, mark));
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      const { locked: isLocked, pinConfigured: hasPin, idleLockMinutes: minutes, hasSession } = stateRef.current;
      if (!hasSession || isLocked || !hasPin || minutes <= 0) return;
      if (document.visibilityState === 'hidden') return; // a backgrounded tab is not a walked-away till
      if (Date.now() - lastActivityRef.current >= minutes * 60_000) void lock('IDLE');
    }, IDLE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [enabled, lock]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => void refresh(), SESSION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, refresh]);

  return {
    session,
    locked,
    loading,
    pinConfigured,
    idleLockMinutes,
    registerName: session?.register?.name || null,
    unlockError,
    lock,
    unlock,
    refresh,
    setPinConfigured,
  };
}
