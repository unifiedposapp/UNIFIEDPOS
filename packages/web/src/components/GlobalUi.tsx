import { ReactNode } from 'react';
import clsx from 'clsx';

/**
 * Shared primitives for the ten global-expansion screens.
 *
 * Those pages all have the same anatomy - a title with an explanation, a strip
 * of headline numbers, and a stack of tables - so the markup lives here once
 * and each page keeps only the parts that are specific to its subsystem.
 */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-gray-600 mt-1 max-w-3xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function Card({ title, icon, actions, children, className }: { title?: string; icon?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('bg-white rounded-lg border', className)}>
      {(title || actions) && (
        <header className="p-4 border-b flex items-center justify-between gap-3">
          <h2 className="font-semibold flex items-center gap-2 min-w-0">
            {icon}
            <span className="truncate">{title}</span>
          </h2>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone = 'default' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad' }) {
  const tones = { default: 'text-gray-900', good: 'text-emerald-600', warn: 'text-amber-600', bad: 'text-rose-600' };
  return (
    <div className="bg-white rounded-lg border p-4 min-w-0" role="group" aria-label={`${label}: ${String(value)}`}>
      <div className="text-sm text-gray-600 truncate">{label}</div>
      <div className={clsx('text-2xl font-bold break-words', tones[tone])}>{value}</div>
      {hint && <div className="text-xs text-gray-500 mt-1">{hint}</div>}
    </div>
  );
}

const BADGE_TONES: Record<string, string> = {
  neutral: 'bg-gray-100 text-gray-700',
  good: 'bg-emerald-100 text-emerald-700',
  warn: 'bg-amber-100 text-amber-700',
  bad: 'bg-rose-100 text-rose-700',
  info: 'bg-blue-100 text-blue-700',
  violet: 'bg-violet-100 text-violet-700',
};

/** Maps a status word to a colour so the same pill reads consistently everywhere. */
export function statusTone(status: unknown): keyof typeof BADGE_TONES {
  const s = String(status || '').toUpperCase();
  if (['ACTIVE', 'OK', 'HEALTHY', 'MATCHED', 'VERIFIED', 'PAID', 'TRANSMITTED', 'RECONCILED', 'INSTALLED', 'APPROVED', 'CLEAN', 'LIVE', 'OPEN_FOR_BUSINESS'].includes(s)) return 'good';
  if (['SEALED', 'PENDING', 'DRAFT', 'WATCH', 'UNVERIFIED', 'REVIEWING', 'INVOICE', 'DISCREPANCY', 'DEGRADED', 'PARTIAL'].includes(s)) return 'warn';
  if (['FAILED', 'REJECTED', 'ESCALATE', 'CRITICAL', 'ISOLATED', 'SUSPENDED', 'TERMINATED', 'UNINSTALLED', 'DOWN', 'MAJOR', 'STALE', 'DISPUTED'].includes(s)) return 'bad';
  return 'neutral';
}

export function Badge({ children, tone }: { children: ReactNode; tone?: keyof typeof BADGE_TONES }) {
  return (
    <span className={clsx('text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap', BADGE_TONES[tone ?? statusTone(children)])}>
      {String(children)}
    </span>
  );
}

export function Money({ value, currency }: { value: unknown; currency?: string }) {
  const n = Number(value || 0);
  return (
    <span className="tabular-nums">
      {n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      {currency ? <span className="text-gray-500 text-xs ms-1">{currency}</span> : null}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-center text-gray-600 py-8">{children}</div>;
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={clsx('text-start text-xs uppercase tracking-wide text-gray-600 font-medium px-3 py-2', className)}>{children}</th>;
}

export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={clsx('px-3 py-2 align-top', className)}>{children}</td>;
}

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto -mx-4">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 border-y">{head}</thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}

export const inputClass = 'border rounded px-3 py-2 text-sm bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
export const primaryButton = 'bg-blue-600 text-white text-sm px-3 py-2 rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1';
export const ghostButton = 'border text-sm px-3 py-2 rounded hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';
export const dangerButton = 'border border-rose-200 text-rose-700 text-sm px-3 py-2 rounded hover:bg-rose-50 disabled:opacity-50 flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400';

/** Field wrapper so the ten forms look like one product. */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-gray-700">{label}</span>
      {children}
      {hint && <span className="text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

/** JSON editor that degrades to a disabled box when the payload is invalid. */
export function JsonBox({ value }: { value: unknown }) {
  return (
    <pre className="text-xs bg-gray-50 border rounded p-3 overflow-x-auto max-h-72">
      {typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2)}
    </pre>
  );
}

/** Renders the error a request threw, or nothing. Keeps every page honest. */
export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <div role="alert" className="text-sm bg-rose-50 border border-rose-200 text-rose-700 rounded px-3 py-2">{message}</div>;
}

/**
 * Runs an api call and unwraps the `{success, data}` envelope, surfacing the
 * server's `message` when the call came back unsuccessful. Every global page
 * goes through this so no failure is ever swallowed silently.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function call(fn: () => Promise<any>, setError: (m: string | null) => void): Promise<any> {
  try {
    setError(null);
    const res = await fn();
    if (res && res.success === false) setError(res.message || 'Request failed');
    return res?.data ?? null;
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
    return null;
  }
}
