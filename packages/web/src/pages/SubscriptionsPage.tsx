import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Repeat, Plus, CreditCard, XCircle, RotateCcw, TrendingUp } from 'lucide-react';
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  Field,
  PageHeader,
  Stat,
  Table,
  Td,
  Th,
  call,
  ghostButton,
  inputClass,
  primaryButton,
} from '../components/GlobalUi';

/**
 * Recurring Subscription Billing. Plans on the left, the live book on the
 * right: status mix and MRR up top, then per-subscription lifecycle actions
 * (cancel now / at period end, reinstate) and the invoice history the dunning
 * ladder drives. The scheduler tick does the charging; this page is the
 * control surface and the audit trail.
 */

const STATUS_TONES: Record<string, 'good' | 'warn' | 'bad' | 'info'> = {
  ACTIVE: 'good', TRIALING: 'info', PAST_DUE: 'warn', CANCELLED: 'bad', EXPIRED: 'bad',
  OPEN: 'info', PAID: 'good', UNPAID: 'warn', DUNNING: 'warn', VOID: 'bad',
};

export default function SubscriptionsPage() {
  const [plans, setPlans] = useState<any[]>([]);
  const [subs, setSubs] = useState<any[]>([]);
  const [overview, setOverview] = useState<any>(null);
  const [selected, setSelected] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [planForm, setPlanForm] = useState({ name: '', interval: 'MONTH', amount: '9.99', currency: 'USD', trialDays: '0' });
  const [showSubForm, setShowSubForm] = useState(false);
  const [subForm, setSubForm] = useState({ customerId: '', planId: '' });

  const load = useCallback(async () => {
    const [p, s, o] = await Promise.all([
      call(() => api.getSubscriptionPlans(), setError),
      call(() => api.getSubscriptions(), setError),
      call(() => api.getSubscriptionOverview(), setError),
    ]);
    setPlans(Array.isArray(p) ? p : p?.plans || []);
    setSubs(Array.isArray(s) ? s : s?.subscriptions || []);
    setOverview(o);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openSub = async (id: string) => {
    const s = subs.find((x) => x.id === id);
    setSelected(s);
    const inv = await call(() => api.getSubscriptionInvoices(id), setError);
    setInvoices(Array.isArray(inv) ? inv : inv?.invoices || []);
  };

  const createPlan = async () => {
    await call(async () =>
      api.createSubscriptionPlan({
        name: planForm.name,
        interval: planForm.interval,
        amount: Number(planForm.amount),
        currency: planForm.currency,
        trialDays: Number(planForm.trialDays) || 0,
      }), setError);
    setShowPlanForm(false);
    setPlanForm({ name: '', interval: 'MONTH', amount: '9.99', currency: 'USD', trialDays: '0' });
    load();
  };

  const createSub = async () => {
    await call(() => api.createSubscription({ customerId: subForm.customerId, planId: subForm.planId }), setError);
    setShowSubForm(false);
    load();
  };

  const cancel = async (id: string, atPeriodEnd: boolean) => {
    await call(() => api.cancelSubscription(id, { atPeriodEnd }), setError);
    load();
  };

  const reinstate = async (id: string) => {
    await call(() => api.reinstateSubscription(id), setError);
    load();
  };

  const runCycle = async () => {
    await call(() => api.generateSubscriptionInvoices(), setError);
    load();
  };

  const maxMonth = Math.max(1, ...(overview?.revenueByMonth || []).map((r: any) => Number(r.total)));

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Subscriptions"
        subtitle="Recurring billing: plans, trials, invoices and the dunning ladder — all collected through the same money path as one-off payments."
        actions={
          <>
            <button className={ghostButton} onClick={runCycle}>Run billing cycle</button>
            <button className={primaryButton} onClick={() => setShowSubForm((v) => !v)}><Plus size={14} className="inline -mt-0.5 mr-1" />New subscription</button>
            <button className={ghostButton} onClick={() => setShowPlanForm((v) => !v)}><Plus size={14} className="inline -mt-0.5 mr-1" />New plan</button>
          </>
        }
      />
      <ErrorNote message={error} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Subscriptions" value={overview?.subscriptions ?? 0} hint={`${overview?.byStatus?.ACTIVE || 0} active`} />
        <Stat label="MRR" value={overview ? `$${Number(overview.mrr).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'} hint="normalized to monthly" tone="good" />
        <Stat label="Open invoices" value={overview?.openInvoices ?? 0} tone={overview?.openInvoices ? 'warn' : 'good'} hint="awaiting collection" />
        <Stat label="Collected (12mo)" value={overview ? `$${Number(overview.collectedLast12Months).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'} hint="paid subscription invoices" />
      </div>

      {showPlanForm && (
        <Card title="New plan" icon={<Plus size={18} />}>
          <div className="grid gap-3 md:grid-cols-5">
            <Field label="Name"><input className={inputClass} value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} /></Field>
            <Field label="Interval">
              <select className={inputClass} value={planForm.interval} onChange={(e) => setPlanForm({ ...planForm, interval: e.target.value })}>
                {['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'].map((i) => <option key={i}>{i}</option>)}
              </select>
            </Field>
            <Field label="Amount"><input className={inputClass} inputMode="decimal" value={planForm.amount} onChange={(e) => setPlanForm({ ...planForm, amount: e.target.value })} /></Field>
            <Field label="Currency"><input className={inputClass} maxLength={3} value={planForm.currency} onChange={(e) => setPlanForm({ ...planForm, currency: e.target.value.toUpperCase() })} /></Field>
            <Field label="Trial days"><input className={inputClass} inputMode="numeric" value={planForm.trialDays} onChange={(e) => setPlanForm({ ...planForm, trialDays: e.target.value })} /></Field>
          </div>
          <button className={primaryButton + ' mt-3'} onClick={createPlan} disabled={!planForm.name}>Create plan</button>
        </Card>
      )}

      {showSubForm && (
        <Card title="New subscription" icon={<Repeat size={18} />}>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Customer ID"><input className={inputClass} value={subForm.customerId} onChange={(e) => setSubForm({ ...subForm, customerId: e.target.value })} placeholder="customer uuid" /></Field>
            <Field label="Plan">
              <select className={inputClass} value={subForm.planId} onChange={(e) => setSubForm({ ...subForm, planId: e.target.value })}>
                <option value="">Choose…</option>
                {plans.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} — {p.amount} {p.currency}/{p.interval}</option>)}
              </select>
            </Field>
            <div className="flex items-end"><button className={primaryButton} onClick={createSub} disabled={!subForm.customerId || !subForm.planId}>Start subscription</button></div>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Plans" icon={<CreditCard size={18} />}>
          {plans.length === 0 ? (
            <Empty>No plans yet — create one to start billing recurringly.</Empty>
          ) : (
            <Table head={<tr><Th>Plan</Th><Th>Price</Th><Th>Trial</Th><Th>Status</Th><Th /></tr>}>
              {plans.map((p) => (
                <tr key={p.id}>
                  <Td className="font-medium">{p.name}</Td>
                  <Td>{Number(p.amount).toLocaleString()} {p.currency} / {p.intervalCount > 1 ? `${p.intervalCount}× ` : ''}{p.interval.toLowerCase()}(s)</Td>
                  <Td>{p.trialDays ? `${p.trialDays}d` : '—'}</Td>
                  <Td><Badge tone={p.active ? 'good' : 'warn'}>{p.active ? 'ACTIVE' : 'DEACTIVATED'}</Badge></Td>
                  <Td>
                    <button
                      className={ghostButton}
                      onClick={async () => { await call(() => api.deleteSubscriptionPlan(p.id), setError); load(); }}
                      title="Deactivate (or delete when no live subscriptions)"
                      aria-label={`Deactivate plan ${p.name}`}
                    >
                      <XCircle size={14} />
                    </button>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Subscriptions" icon={<Repeat size={18} />}>
          {subs.length === 0 ? (
            <Empty>No subscriptions yet.</Empty>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <Table head={<tr><Th>Customer</Th><Th>Plan</Th><Th>Period ends</Th><Th>Status</Th><Th /></tr>}>
                {subs.map((s) => (
                  <tr key={s.id} className="cursor-pointer" onClick={() => openSub(s.id)}>
                    <Td>{s.customer?.name || s.customerId.slice(0, 8)}</Td>
                    <Td>{s.plan?.name || '—'}</Td>
                    <Td>{new Date(s.currentPeriodEnd).toLocaleDateString()}</Td>
                    <Td>
                      <Badge tone={STATUS_TONES[s.status] || 'info'}>{s.status}</Badge>
                      {s.cancelAtPeriodEnd && s.status !== 'CANCELLED' && <span className="ml-1 text-[10px] text-amber-600">ends soon</span>}
                    </Td>
                    <Td>
                      {['CANCELLED', 'EXPIRED'].includes(s.status) ? (
                        <button className={ghostButton} onClick={(e) => { e.stopPropagation(); reinstate(s.id); }} title="Reinstate" aria-label={`Reinstate subscription ${s.id.slice(0, 8)}`}><RotateCcw size={14} /></button>
                      ) : (
                        <button className={ghostButton} onClick={(e) => { e.stopPropagation(); cancel(s.id, false); }} title="Cancel immediately" aria-label={`Cancel subscription ${s.id.slice(0, 8)}`}><XCircle size={14} /></button>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      </div>

      {selected && (
        <Card title={`Invoices — ${selected.customer?.name || selected.id.slice(0, 8)}`} icon={<CreditCard size={18} />}>
          <Table head={<tr><Th>#</Th><Th>Period</Th><Th>Amount</Th><Th>Status</Th><Th>Attempts</Th><Th>Paid</Th></tr>}>
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <Td className="font-mono text-xs">{inv.number || inv.id.slice(0, 8)}</Td>
                <Td>{new Date(inv.periodStart).toLocaleDateString()} → {new Date(inv.periodEnd).toLocaleDateString()}</Td>
                <Td>{Number(inv.amount).toLocaleString()} {inv.currency}</Td>
                <Td><Badge tone={STATUS_TONES[inv.status] || 'info'}>{inv.status}</Badge></Td>
                <Td>{inv.attemptCount}</Td>
                <Td>{inv.paidAt ? new Date(inv.paidAt).toLocaleDateString() : '—'}</Td>
              </tr>
            ))}
            {invoices.length === 0 && <tr><Td colSpan={6} className="text-center text-gray-500">No invoices yet</Td></tr>}
          </Table>
        </Card>
      )}

      {overview?.revenueByMonth?.length > 0 && (
        <Card title="Collected revenue by month" icon={<TrendingUp size={18} />}>
          <div className="flex h-32 items-end gap-2">
            {overview.revenueByMonth.map((r: any) => (
              <div key={r.month} className="flex flex-col items-center gap-1" title={`${r.month}: $${r.total}`}>
                <div className="w-8 rounded-t bg-emerald-500/70" style={{ height: `${Math.max(4, (Number(r.total) / maxMonth) * 100)}%` }} />
                <span className="text-[10px] text-gray-500">{r.month.slice(2)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
