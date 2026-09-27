import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import {
  ShieldCheck, Users, Building2, CreditCard, BarChart3, History as HistoryIcon,
  Pause, Play, Ban, Archive, Trash2, RotateCcw, Wallet, Layers, RefreshCw,
} from 'lucide-react';
import {
  PageHeader, Card, Stat, Badge, Table, Th, Td, Money, Empty, ErrorNote,
  Field, JsonBox, inputClass, primaryButton, ghostButton, dangerButton, call,
} from '../components/GlobalUi';

/**
 * Platform Admin Console — the SaaS-operator surface.
 *
 * Unlike every other screen (scoped to one organization), this page reaches
 * across ALL tenants: it lists organizations and users platform-wide, manages
 * the plans tenants buy from UnifiedPOS, records tenant payments, rolls up
 * revenue, and drives the account lifecycle (suspend / restore / cancel /
 * archive / permanent purge). It is gated to the SUPER_ADMIN role; the sidebar
 * link only appears for that role and the route redirects anyone else away.
 * Every action hits real cross-tenant endpoints under /api/platform.
 */

type Tab = 'accounts' | 'users' | 'billing' | 'revenue' | 'history';

interface Overview {
  tenants: number;
  users: number;
  activePlans: number;
  mrr: number;
  lifetimeRevenue: number;
  byStatus: Record<string, number>;
}
interface PlanRef { id: string; name: string; priceMonthly: number; interval: string }
interface OrgRow {
  id: string; name: string; email?: string | null; country?: string | null; currency: string;
  status: string; isActive: boolean; trialEnd?: string | null; currentPeriodEnd?: string | null;
  createdAt: string; users: number; owner?: { name: string; email: string } | null; plan?: PlanRef | null;
}
interface UserRow {
  id: string; email: string; name: string; role: string; isActive: boolean;
  mfaEnabled?: boolean; createdAt: string; organization?: { id: string; name: string } | null;
}
interface PlatformPlan { id: string; name: string; code: string; priceMonthly: number; interval: string; trialDays: number; active: boolean; features?: string | null }
interface PaymentRow { id: string; amount: number; currency: string; method: string; reference?: string | null; periodCoveredUntil: string; createdAt: string; organization?: { name: string } | null }
interface RevenuePoint { month: string; total: number }
interface HistoryRow { id: string; action: string; resourceType: string; resourceId?: string | null; newValue?: unknown; metadata?: { by?: string } | null; createdAt: string; organization?: { name: string } | null }

const parseFeatures = (raw?: string | null): string[] => {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
};

/** Consistent status pill colour for the platform lifecycle states. */
function accountTone(status: string): 'good' | 'info' | 'warn' | 'bad' | 'neutral' {
  switch (status) {
    case 'ACTIVE': return 'good';
    case 'TRIALING': return 'info';
    case 'PAST_DUE': return 'warn';
    case 'SUSPENDED':
    case 'CANCELLED': return 'bad';
    default: return 'neutral';
  }
}

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');

export default function AdminPortalPage() {
  const { user } = useAuthStore();
  const [tab, setTab] = useState<Tab>('accounts');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [revenue, setRevenue] = useState<RevenuePoint[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  // Modals
  const [purgeTarget, setPurgeTarget] = useState<OrgRow | null>(null);
  const [purgeText, setPurgeText] = useState('');
  const [payTarget, setPayTarget] = useState<OrgRow | null>(null);
  const [payForm, setPayForm] = useState({ amount: '', months: '1', method: 'BANK_TRANSFER' });
  const [userModal, setUserModal] = useState(false);
  const [userForm, setUserForm] = useState({ name: '', email: '', password: '', role: 'MANAGER', organizationId: '' });

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const flash = (msg: string) => { setNote(msg); setTimeout(() => setNote(null), 4000); };

  const loadOverview = useCallback(async () => {
    setOverview(await call(() => api.getPlatformOverview(), setError));
  }, []);
  // Plans are needed by two tabs: the Accounts row-level plan picker AND the
  // Billing management card. Loading them alongside Overview on mount means
  // the Accounts tab's dropdown is populated the first time you land on the
  // page, not only after you switch to Billing once. Payments stay lazy on
  // the Billing tab because they are the ledger, not a control input.
  const loadPlans = useCallback(async () => {
    const p = await call(() => api.getPlatformPlans(), setError);
    if (p) setPlans(p as PlatformPlan[]);
  }, []);
  const loadOrgs = useCallback(async () => {
    const params: Record<string, string> = {};
    if (statusFilter) params.status = statusFilter;
    if (search.trim()) params.q = search.trim();
    const rows = await call(() => api.getPlatformOrganizations(params), setError);
    if (rows) setOrgs(rows as OrgRow[]);
  }, [statusFilter, search]);
  const loadUsers = useCallback(async () => {
    const rows = await call(() => api.getPlatformUsers(), setError);
    if (rows) setUsers(rows as UserRow[]);
  }, []);
  const loadBilling = useCallback(async () => {
    const [p, pay] = await Promise.all([
      call(() => api.getPlatformPlans(), setError),
      call(() => api.getPlatformPayments(), setError),
    ]);
    if (p) setPlans(p as PlatformPlan[]);
    if (pay) setPayments(pay as PaymentRow[]);
  }, []);
  const loadRevenue = useCallback(async () => {
    const data = await call(() => api.getPlatformRevenue(12), setError);
    if (data) setRevenue((data as { series: RevenuePoint[] }).series || []);
  }, []);
  const loadHistory = useCallback(async () => {
    const rows = await call(() => api.getPlatformHistory(150), setError);
    if (rows) setHistory(rows as HistoryRow[]);
  }, []);

  // Overview + plans are always relevant; load once on mount (guarded).
  useEffect(() => {
    if (isSuperAdmin) {
      void loadOverview();
      void loadPlans();
    }
  }, [isSuperAdmin, loadOverview, loadPlans]);

  // (Re)load the active tab's collection whenever we switch to it.
  useEffect(() => {
    if (!isSuperAdmin) return;
    if (tab === 'accounts') void loadOrgs();
    else if (tab === 'users') void loadUsers();
    else if (tab === 'billing') void loadBilling();
    else if (tab === 'revenue') void loadRevenue();
    else if (tab === 'history') void loadHistory();
  }, [isSuperAdmin, tab, loadOrgs, loadUsers, loadBilling, loadRevenue, loadHistory]);

  if (!isSuperAdmin) return <Navigate to="/pos" replace />;

  /** Runs a lifecycle/booking action, then refreshes the affected collections. */
  const run = async (label: string, fn: () => Promise<any>) => {
    setBusy(true);
    const data = await call(fn, setError);
    setBusy(false);
    if (data !== null) {
      flash(label);
      await Promise.all([loadOverview(), loadOrgs(), loadHistory()]);
    }
  };

  const orgAction = (org: OrgRow, verb: 'suspend' | 'restore' | 'cancel' | 'archive' | 'reinstate') => {
    const map = {
      suspend: { fn: () => api.suspendOrganization(org.id), msg: `${org.name} suspended.` },
      restore: { fn: () => api.restoreOrganization(org.id), msg: `${org.name} restored.` },
      cancel: { fn: () => api.cancelOrganization(org.id), msg: `${org.name} cancelled.` },
      archive: { fn: () => api.archiveOrganization(org.id), msg: `${org.name} archived (recoverable).` },
      reinstate: { fn: () => api.reinstateOrganization(org.id), msg: `${org.name} reinstated.` },
    } as const;
    return run(map[verb].msg, map[verb].fn);
  };

  const submitPurge = async () => {
    if (!purgeTarget) return;
    await run(`${purgeTarget.name} permanently deleted.`, () => api.purgeOrganization(purgeTarget.id, purgeText));
    setPurgeTarget(null);
    setPurgeText('');
  };

  const submitPayment = async () => {
    if (!payTarget) return;
    await run(`Payment recorded for ${payTarget.name}.`, () =>
      api.recordPlatformPayment(payTarget.id, { amount: Number(payForm.amount), months: Number(payForm.months) || 1, method: payForm.method }));
    setPayTarget(null);
    setPayForm({ amount: '', months: '1', method: 'BANK_TRANSFER' });
  };

  const submitUser = async () => {
    await run(`User ${userForm.email} created.`, () => api.createPlatformUser(userForm));
    setUserModal(false);
    setUserForm({ name: '', email: '', password: '', role: 'MANAGER', organizationId: '' });
    await loadUsers();
  };

  const assignPlan = async (org: OrgRow, planId: string, startTrial: boolean) => {
    await run(startTrial ? `${org.name} started on ${planId ? 'trial' : 'plan'}.` : `${org.name} plan updated.`,
      () => api.assignPlatformPlan(org.id, { platformPlanId: planId || null, startTrial }));
  };

  const toggleUserActive = (u: UserRow, active: boolean) =>
    run(`${u.email} ${active ? 'reactivated' : 'deactivated'}.`,
      () => (active ? api.reactivatePlatformUser(u.id) : api.deactivatePlatformUser(u.id)));

  const maxRevenue = revenue.reduce((m, r) => Math.max(m, r.total), 0) || 1;
  const s = overview?.byStatus || {};

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <PageHeader
        title="Platform Admin Console"
        subtitle="Cross-tenant operations: monitor every organization and user, manage the plans tenants buy, record payments, and control each account's lifecycle."
        actions={<Badge tone="violet"><span className="inline-flex items-center gap-1"><ShieldCheck size={12} /> SUPER_ADMIN</span></Badge>}
      />

      <ErrorNote message={error} />
      {note && <div className="text-sm bg-emerald-50 border border-emerald-200 text-emerald-700 rounded px-3 py-2">{note}</div>}

      {/* Headline metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat label="Tenants" value={overview?.tenants ?? '—'} />
        <Stat label="Active" value={s.ACTIVE ?? '—'} tone="good" />
        <Stat label="Trialing" value={s.TRIALING ?? '—'} tone="default" />
        <Stat label="Suspended" value={(s.SUSPENDED ?? 0) + (s.PAST_DUE ?? 0)} tone="bad" />
        <Stat label="MRR" value={overview ? <Money value={overview.mrr} currency="USD" /> : '—'} tone="good" />
        <Stat label="Lifetime revenue" value={overview ? <Money value={overview.lifetimeRevenue} currency="USD" /> : '—'} />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b">
        {([
          ['accounts', 'Accounts', Building2],
          ['users', 'Users', Users],
          ['billing', 'Plans & Payments', CreditCard],
          ['revenue', 'Revenue', BarChart3],
          ['history', 'History', HistoryIcon],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={
              'flex items-center gap-2 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ' +
              (tab === key ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800')
            }
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {/* ── Accounts ── */}
      {tab === 'accounts' && (
        <Card
          title={`Organizations (${orgs.length})`}
          icon={<Building2 size={16} />}
          actions={
            <div className="flex items-center gap-2">
              <input className={inputClass} placeholder="Search name / email" value={search} onChange={(e) => setSearch(e.target.value)} />
              <select className={inputClass} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                {['ACTIVE', 'TRIALING', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'ARCHIVED'].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <button className={ghostButton} onClick={() => loadOrgs()} title="Refresh"><RefreshCw size={14} /></button>
            </div>
          }
        >
          {orgs.length === 0 ? <Empty>No organizations.</Empty> : (
            <Table head={<tr><Th>Organization</Th><Th>Owner</Th><Th>Plan</Th><Th>Status</Th><Th>Users</Th><Th>Paid through</Th><Th className="text-end">Actions</Th></tr>}>
              {orgs.map((o) => (
                <tr key={o.id} className="hover:bg-gray-50">
                  <Td>
                    <div className="font-medium">{o.name}</div>
                    <div className="text-xs text-gray-500">{o.email} · {o.country || '—'}</div>
                  </Td>
                  <Td><div className="text-xs">{o.owner?.name || '—'}<br /><span className="text-gray-400">{o.owner?.email}</span></div></Td>
                  <Td>
                    <select
                      className={inputClass + ' max-w-[9rem]'}
                      value={o.plan?.id || ''}
                      disabled={busy}
                      onChange={(e) => {
                        const el = e.currentTarget;
                        void assignPlan(o, el.value, false);
                      }}
                    >
                      <option value="">— none —</option>
                      {plans.map((p) => <option key={p.id} value={p.id}>{p.name} (${p.priceMonthly})</option>)}
                    </select>
                    {!!o.plan && <button className="text-xs text-blue-600 ms-1 disabled:opacity-40" disabled={busy} onClick={() => assignPlan(o, o.plan!.id, true)}>start trial</button>}
                  </Td>
                  <Td><Badge tone={accountTone(o.status)}>{o.status}</Badge></Td>
                  <Td>{o.users}</Td>
                  <Td className="text-xs">{fmtDate(o.currentPeriodEnd || o.trialEnd)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1 justify-end">
                      {o.status !== 'SUSPENDED' && !['CANCELLED', 'ARCHIVED'].includes(o.status) && (
                        <ActionBtn onClick={() => orgAction(o, 'suspend')} icon={Pause} label="Suspend" />
                      )}
                      {o.status === 'SUSPENDED' && <ActionBtn onClick={() => orgAction(o, 'restore')} icon={Play} label="Restore" />}
                      {['CANCELLED', 'ARCHIVED'].includes(o.status)
                        ? <ActionBtn onClick={() => orgAction(o, 'reinstate')} icon={RotateCcw} label="Reinstate" />
                        : <ActionBtn onClick={() => orgAction(o, 'cancel')} icon={Ban} label="Cancel" />}
                      <ActionBtn onClick={() => setPayTarget(o)} icon={Wallet} label="Payment" />
                      {!['ARCHIVED'].includes(o.status) && <ActionBtn onClick={() => orgAction(o, 'archive')} icon={Archive} label="Archive" />}
                      <ActionBtn danger onClick={() => { setPurgeTarget(o); setPurgeText(''); }} icon={Trash2} label="Purge" />
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {/* ── Users ── */}
      {tab === 'users' && (
        <Card
          title={`Users (${users.length})`}
          icon={<Users size={16} />}
          actions={<button className={primaryButton} onClick={() => { setUserModal(true); if (!userForm.organizationId && orgs[0]) setUserForm({ ...userForm, organizationId: orgs[0].id }); }}>+ Add user</button>}
        >
          {users.length === 0 ? <Empty>No users.</Empty> : (
            <Table head={<tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Organization</Th><Th>Status</Th><Th className="text-end">Actions</Th></tr>}>
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <Td>{u.name}</Td>
                  <Td className="text-xs">{u.email}{u.mfaEnabled && <span className="ms-1 text-emerald-600" title="MFA on">· MFA</span>}</Td>
                  <Td><Badge tone={u.role === 'SUPER_ADMIN' ? 'violet' : 'neutral'}>{u.role}</Badge></Td>
                  <Td className="text-xs">{u.organization?.name || <span className="text-gray-400">platform</span>}</Td>
                  <Td>{u.isActive ? <Badge tone="good">ACTIVE</Badge> : <Badge tone="bad">DISABLED</Badge>}</Td>
                  <Td className="text-end">
                    {u.role !== 'SUPER_ADMIN' && (u.isActive
                      ? <button className={dangerButton} disabled={busy} onClick={() => toggleUserActive(u, false)}>Deactivate</button>
                      : <button className={ghostButton} disabled={busy} onClick={() => toggleUserActive(u, true)}>Reactivate</button>)}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {/* ── Billing: plans + payments ── */}
      {tab === 'billing' && (
        <div className="space-y-5">
          <Card title="Platform plans" icon={<Layers size={16} />}>
            {plans.length === 0 ? <Empty>No plans yet.</Empty> : (
              <Table head={<tr><Th>Name</Th><Th>Code</Th><Th>Price</Th><Th>Trial</Th><Th>Status</Th><Th>Features</Th></tr>}>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <Td className="font-medium">{p.name}</Td>
                    <Td className="text-xs">{p.code}</Td>
                    <Td><Money value={p.priceMonthly} currency="USD" />/{p.interval === 'YEAR' ? 'yr' : 'mo'}</Td>
                    <Td>{p.trialDays ? `${p.trialDays}d` : '—'}</Td>
                    <Td>{p.active ? <Badge tone="good">LIVE</Badge> : <Badge tone="neutral">OFF</Badge>}</Td>
                    <Td className="text-xs text-gray-500">{parseFeatures(p.features).join(' · ')}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
          <Card title="Payments ledger" icon={<CreditCard size={16} />}>
            {payments.length === 0 ? <Empty>No tenant payments recorded yet.</Empty> : (
              <Table head={<tr><Th>Date</Th><Th>Organization</Th><Th>Method</Th><Th>Covers until</Th><Th className="text-end">Amount</Th></tr>}>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <Td className="text-xs">{fmtDate(p.createdAt)}</Td>
                    <Td>{p.organization?.name || '—'}</Td>
                    <Td className="text-xs">{p.method}{p.reference ? ` · ${p.reference}` : ''}</Td>
                    <Td className="text-xs">{fmtDate(p.periodCoveredUntil)}</Td>
                    <Td className="text-end"><Money value={p.amount} currency={p.currency} /></Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}

      {/* ── Revenue ── */}
      {tab === 'revenue' && (
        <Card title="Monthly platform revenue (last 12 months)" icon={<BarChart3 size={16} />}>
          {revenue.length === 0 ? <Empty>No revenue data.</Empty> : (
            <div className="flex items-end gap-2 h-56 pt-4">
              {revenue.map((r) => (
                <div key={r.month} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
                  <span className="text-[10px] text-gray-500 tabular-nums">{r.total ? Math.round(r.total) : ''}</span>
                  <div className="w-full bg-blue-500/80 rounded-t transition-all" style={{ height: `${(r.total / maxRevenue) * 100}%`, minHeight: r.total ? '3px' : '1px' }} title={`${r.month}: ${r.total}`} />
                  <span className="text-[10px] text-gray-400 rotate-0 truncate">{r.month.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── History ── */}
      {tab === 'history' && (
        <Card title="Account lifecycle history" icon={<HistoryIcon size={16} />}>
          {history.length === 0 ? <Empty>No lifecycle events yet.</Empty> : (
            <Table head={<tr><Th>When</Th><Th>Organization</Th><Th>Action</Th><Th>By</Th><Th>Detail</Th></tr>}>
              {history.map((h) => (
                <tr key={h.id}>
                  <Td className="text-xs whitespace-nowrap">{new Date(h.createdAt).toLocaleString()}</Td>
                  <Td>{h.organization?.name || '—'}</Td>
                  <Td><Badge tone={h.action.includes('PURGE') || h.action.includes('SUSPEND') ? 'bad' : h.action.includes('RESTORE') || h.action.includes('PAYMENT') ? 'good' : 'neutral'}>{h.action}</Badge></Td>
                  <Td className="text-xs">{h.metadata?.by || 'system'}</Td>
                  <Td className="text-xs max-w-xs truncate"><JsonBox value={h.newValue} /></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {/* ── Purge modal (irreversible) ── */}
      {purgeTarget && (
        <ModalShell title="Permanently delete organization" onClose={() => setPurgeTarget(null)}>
          <p className="text-sm text-gray-700">
            This <strong className="text-rose-700">permanently</strong> erases <strong>{purgeTarget.name}</strong> and every
            order, payment, and audit record it owns. This cannot be undone. Consider <em>Archive</em> instead if you may need the data.
          </p>
          <p className="text-sm mt-3">Type the organization name <code className="bg-gray-100 px-1 rounded">{purgeTarget.name}</code> to confirm:</p>
          <input className={inputClass + ' w-full mt-1'} value={purgeText} onChange={(e) => setPurgeText(e.target.value)} />
          <div className="flex justify-end gap-2 mt-4">
            <button className={ghostButton} onClick={() => setPurgeTarget(null)}>Cancel</button>
            <button className={dangerButton} disabled={busy || purgeText !== purgeTarget.name} onClick={submitPurge}>
              <Trash2 size={14} /> Delete permanently
            </button>
          </div>
        </ModalShell>
      )}

      {/* ── Payment modal ── */}
      {payTarget && (
        <ModalShell title={`Record payment — ${payTarget.name}`} onClose={() => setPayTarget(null)}>
          <p className="text-sm text-gray-600">Recording a payment extends the paid-through date and restores the account to ACTIVE.</p>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="Amount (USD)"><input type="number" min="0" step="0.01" className={inputClass} value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} /></Field>
            <Field label="Months covered"><input type="number" min="1" step="1" className={inputClass} value={payForm.months} onChange={(e) => setPayForm({ ...payForm, months: e.target.value })} /></Field>
            <Field label="Method">
              <select className={inputClass} value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
                {['BANK_TRANSFER', 'CARD', 'CASH', 'PAYPAL', 'OTHER'].map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className={ghostButton} onClick={() => setPayTarget(null)}>Cancel</button>
            <button className={primaryButton} disabled={busy || !Number(payForm.amount)} onClick={submitPayment}>Record payment</button>
          </div>
        </ModalShell>
      )}

      {/* ── Add user modal ── */}
      {userModal && (
        <ModalShell title="Add user account" onClose={() => setUserModal(false)}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name"><input className={inputClass} value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} /></Field>
            <Field label="Email"><input type="email" className={inputClass} value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} /></Field>
            <Field label="Temp password" hint="min 8 chars"><input type="text" className={inputClass} value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} /></Field>
            <Field label="Role">
              <select className={inputClass} value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
                {['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'].map((r) => <option key={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Organization">
              <select className={inputClass} value={userForm.organizationId} onChange={(e) => setUserForm({ ...userForm, organizationId: e.target.value })}>
                <option value="">Select…</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className={ghostButton} onClick={() => setUserModal(false)}>Cancel</button>
            <button className={primaryButton} disabled={busy || !userForm.name || !userForm.email || userForm.password.length < 8 || !userForm.organizationId} onClick={submitUser}>Create user</button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

function ActionBtn({ onClick, icon: Icon, label, danger }: { onClick: () => void; icon: any; label: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={
        'inline-flex items-center gap-1 rounded px-2 py-1 text-xs border transition-colors ' +
        (danger ? 'border-rose-200 text-rose-700 hover:bg-rose-50' : 'border-gray-200 text-gray-700 hover:bg-gray-50')
      }
    >
      <Icon size={13} /> {label}
    </button>
  );
}

function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="font-semibold">{title}</h3>
          <button className="text-gray-400 hover:text-gray-700" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
