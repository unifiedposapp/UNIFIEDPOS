// ─── REGISTER LOCK SCREEN (§7 Point of Sale / §37 Security) ─────────────────
// The screen a cashier sees when they come back to a workstation that locked
// itself: their own register, their own name, and a keypad that only their own
// individual PIN gets past. It is deliberately a full-screen, focus-trapping
// overlay — a partial dim lets a colleague read the basket and keep ringing.
//
// Nothing here is the actual protection: the server already refuses every sale on
// a locked session (423 REGISTER_LOCKED). This is the honest, usable half of the
// same rule.
import { useEffect, useRef, useState } from 'react';
import { Delete, Lock, LogOut, Unlock, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';

interface RegisterLockScreenProps {
  open: boolean;
  cashierName?: string;
  registerName?: string | null;
  /** 'MANUAL' (stepped away) or 'IDLE' (auto-locked) — changes the headline. */
  lockReason?: string | null;
  /** Last server rejection ("Incorrect PIN", cooldown notice…). */
  error?: string | null;
  onUnlock: (pin: string) => Promise<boolean>;
  onSignOut: () => void;
}

const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'] as const;
const MAX_PIN_DIGITS = 8;

export default function RegisterLockScreen({
  open,
  cashierName,
  registerName,
  lockReason,
  error,
  onUnlock,
  onSignOut,
}: RegisterLockScreenProps) {
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Each lock starts from a clean pad, and focus lands on the dialog so the
  // physical keyboard (and a barcode scanner left idle) can drive it too.
  useEffect(() => {
    if (open) {
      setPin('');
      setLocalError(null);
      setSubmitting(false);
      headingRef.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  const message = localError || error;

  async function submit() {
    if (submitting) return;
    if (pin.length < 4) {
      setLocalError('Enter your full PIN');
      return;
    }
    setSubmitting(true);
    setLocalError(null);
    const ok = await onUnlock(pin);
    if (!ok) setPin(''); // never leave a rejected code on screen
    setSubmitting(false);
  }

  function press(key: (typeof KEYPAD)[number]) {
    setLocalError(null);
    if (key === 'back') return setPin((p) => p.slice(0, -1));
    if (key === 'clear') return setPin('');
    setPin((p) => (p.length >= MAX_PIN_DIGITS ? p : p + key));
  }

  // Physical keyboard support (a POS keeps a keyboard attached for typing).
  function onKeyDown(e: React.KeyboardEvent) {
    if (/^\d$/.test(e.key)) return press(e.key as (typeof KEYPAD)[number]);
    if (e.key === 'Backspace') return press('back');
    if (e.key === 'Enter') return void submit();
    if (e.key === 'Escape') return setPin('');
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/95 backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Register locked"
      onKeyDown={onKeyDown}
      tabIndex={-1}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-1">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <Lock size={20} />
          </span>
          <div>
            <h2 ref={headingRef} tabIndex={-1} className="text-lg font-bold text-gray-900 outline-none">
              {lockReason === 'IDLE' ? 'Register locked automatically' : 'Register locked'}
            </h2>
            <p className="text-sm text-gray-500">
              {registerName || 'This register'}
              {cashierName ? ` · ${cashierName}` : ''}
            </p>
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Enter your personal PIN to get back in. Only you can unlock your drawer.
        </p>

        {/* Masked PIN — dots only, never the digits themselves. */}
        <div className="flex items-center justify-center gap-2 py-3" aria-label="Entered PIN digits">
          {Array.from({ length: MAX_PIN_DIGITS }).map((_, i) => (
            <span
              key={i}
              className={clsx(
                'h-3 w-3 rounded-full border',
                i < pin.length ? 'border-blue-600 bg-blue-600' : 'border-gray-300 bg-transparent',
              )}
            />
          ))}
        </div>

        {message && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {message}
          </p>
        )}

        <div className="grid grid-cols-3 gap-2 my-4">
          {KEYPAD.map((key) => {
            const isAction = key === 'clear' || key === 'back';
            return (
              <button
                key={key}
                type="button"
                onClick={() => press(key)}
                className={clsx(
                  'flex h-12 items-center justify-center rounded-xl text-lg font-semibold transition-colors',
                  isAction
                    ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    : 'bg-gray-50 text-gray-900 hover:bg-blue-50 active:bg-blue-100',
                )}
                aria-label={key === 'back' ? 'Delete last digit' : key === 'clear' ? 'Clear PIN' : `Digit ${key}`}
              >
                {key === 'back' ? <Delete size={20} /> : key === 'clear' ? <span className="text-sm">C</span> : key}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting || pin.length < 4}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          <Unlock size={18} />
          {submitting ? 'Checking…' : 'Unlock register'}
        </button>

        <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <ShieldCheck size={14} className="text-green-600" />
            Sales are blocked while locked
          </span>
          <button
            type="button"
            onClick={onSignOut}
            className="flex items-center gap-1 font-medium text-gray-600 hover:text-gray-900"
          >
            <LogOut size={14} />
            Not you? Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
