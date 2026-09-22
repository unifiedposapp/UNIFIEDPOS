import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { COPYRIGHT } from '../data/legal';
import {
  ShieldCheck, Cookie, Download, Trash2, FileCheck2, CheckCircle2,
  AlertTriangle, XCircle, Link2, Lock, Save, Info, Award,
} from 'lucide-react';
import {
  SAQ_A_ELIGIBILITY, SAQ_A_SECTIONS, SOC2_TSC, SUBPROCESSORS, ATTESTATION_CHECKLIST,
} from '../data/trustCenter';

const STATUS_STYLE: Record<string, { label: string; cls: string; Icon: any }> = {
  IMPLEMENTED: { label: 'Implemented', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
  PARTIAL: { label: 'Partial', cls: 'bg-amber-50 text-amber-700 border-amber-200', Icon: AlertTriangle },
  GAP: { label: 'Gap', cls: 'bg-rose-50 text-rose-700 border-rose-200', Icon: XCircle },
  DELEGATED: { label: 'Delegated', cls: 'bg-primary-50 text-primary-700 border-primary-200', Icon: Link2 },
};

const TABS = [
  { id: 'checklist', label: 'Regulation checklist', Icon: FileCheck2 },
  { id: 'consent', label: 'Consent', Icon: Cookie },
  { id: 'data', label: 'Your data & requests', Icon: Download },
  { id: 'governance', label: 'Security & governance', Icon: Lock },
  { id: 'trust', label: 'Trust center', Icon: Award },
] as const;

export default function CompliancePage() {
  const { user } = useAuthStore();
  const role = user?.role || '';
  const isOwner = role === 'OWNER';
  const canManage = role === 'OWNER' || role === 'ADMIN';

  const [tab, setTab] = useState<'checklist' | 'consent' | 'data' | 'governance' | 'trust'>('checklist');
  const [data, setData] = useState<any>(null);
  const [domainFilter, setDomainFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [consent, setConsent] = useState<any>({ necessary: true, functional: false, analytics: false, marketing: false, thirdPartySharing: false });
  const [consentMeta, setConsentMeta] = useState<any>({ hasConsent: false, updatedAt: null });
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  // §37 security & governance panel state
  const [gov, setGov] = useState<any>({ mfa: null, retention: null, breaches: [], ropa: [] });
  const [govBusy, setGovBusy] = useState('');
  const [mfaSetup, setMfaSetup] = useState<any>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [retDays, setRetDays] = useState('');
  const [legalHold, setLegalHold] = useState(false);
  const [breachTitle, setBreachTitle] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [cl, cn] = await Promise.all([api.getComplianceChecklist(), api.getComplianceConsent()]);
      setData(cl.data);
      if (cn.data?.consent) setConsent(cn.data.consent);
      setConsentMeta({ hasConsent: cn.data?.hasConsent, updatedAt: cn.data?.updatedAt });
      if (canManage) {
        try { const rq = await api.getComplianceRequests(); setRequests(rq.data || []); } catch { /* role-gated */ }
      }
    } catch (e) {
      console.error('Failed to load compliance data:', e);
    } finally {
      setLoading(false);
    }
  }

  async function loadGovernance() {
    try {
      const [m, r, b, rp] = await Promise.all([
        api.getMfaStatus().catch(() => null),
        api.getRetention().catch(() => null),
        api.getBreaches().catch(() => null),
        api.getRopa().catch(() => null),
      ]);
      setGov({ mfa: m?.data ?? null, retention: r?.data ?? null, breaches: b?.data ?? [], ropa: rp?.data ?? [] });
      if (r?.data) {
        setRetDays(r.data.dataRetentionDays != null ? String(r.data.dataRetentionDays) : '');
        setLegalHold(!!r.data.legalHold);
      }
    } catch (e) {
      console.error('Failed to load governance data:', e);
    }
  }

  useEffect(() => { if (tab === 'governance') loadGovernance(); }, [tab]);

  async function onMfaSetup() { setGovBusy('mfa'); try { const r = await api.mfaSetup(); setMfaSetup(r.data); } catch (e: any) { alert(e.message); } finally { setGovBusy(''); } }
  async function onMfaEnable() { setGovBusy('mfa'); try { await api.mfaEnable(mfaCode); setMfaSetup(null); setMfaCode(''); loadGovernance(); } catch (e: any) { alert(e.message); } finally { setGovBusy(''); } }
  async function onMfaDisable() { const code = prompt('Enter your current 6-digit code to disable MFA:'); if (!code) return; setGovBusy('mfa'); try { await api.mfaDisable(code); loadGovernance(); } catch (e: any) { alert(e.message); } finally { setGovBusy(''); } }
  async function onSaveRetention() { setGovBusy('ret'); try { await api.updateRetention({ dataRetentionDays: retDays === '' ? null : Number(retDays), legalHold }); loadGovernance(); } catch (e: any) { alert(e.message); } finally { setGovBusy(''); } }
  async function onPurge() { if (!confirm('Apply the retention policy now? Older personal data will be deleted.')) return; setGovBusy('purge'); try { const r = await api.purgeRetainedData(); alert(`Purged ${r.data?.deleted ?? 0} record(s).`); } catch (e: any) { alert(e.message); } finally { setGovBusy(''); } }
  async function onReportBreach() { if (!breachTitle.trim()) return; setGovBusy('breach'); try { await api.createBreach({ title: breachTitle }); setBreachTitle(''); loadGovernance(); } catch (e: any) { alert(e.message); } finally { setGovBusy(''); } }
  async function onNotifyBreach(id: string) { setGovBusy('notify' + id); try { await api.notifyBreach(id, { regulator: true, individuals: true }); loadGovernance(); } catch (e: any) { alert(e.message); } finally { setGovBusy(''); } }

  const groups = data?.groups || [];
  const stats = data?.stats || {};
  const purposes = data?.purposes || [];
  const domains = data?.domains || [];

  const filteredGroups = useMemo(() => {
    return groups
      .map((g: any) => ({
        ...g,
        items: g.items.filter((it: any) =>
          (domainFilter === 'ALL' || it.domain === domainFilter) &&
          (statusFilter === 'ALL' || it.status === statusFilter)),
      }))
      .filter((g: any) => g.items.length > 0);
  }, [groups, domainFilter, statusFilter]);

  async function refreshRequests() {
    if (!canManage) return;
    try { const rq = await api.getComplianceRequests(); setRequests(rq.data || []); } catch { /* ignore */ }
  }

  async function saveConsent() {
    setBusy('consent');
    try {
      await api.saveComplianceConsent({ type: 'CONSENT', source: 'compliance-center', ...consent, necessary: true });
      setConsentMeta({ hasConsent: true, updatedAt: new Date().toISOString() });
      alert('Consent preferences saved.');
    } catch (e: any) { alert(e.message || 'Failed to save consent'); }
    finally { setBusy(''); }
  }

  async function exportData() {
    if (!confirm('Export a copy of your organization data as JSON?')) return;
    setBusy('export');
    try {
      const res = await api.exportComplianceData();
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `unifiedpos-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      await refreshRequests();
    } catch (e: any) { alert(e.message || 'Export failed'); }
    finally { setBusy(''); }
  }

  async function requestDeletion() {
    if (!confirm('Submit a data deletion (right-to-erasure) request? This is recorded for governed processing; it does not erase data instantly.')) return;
    const reason = prompt('Reason (optional):') || undefined;
    setBusy('delete');
    try {
      await api.requestComplianceDeletion(reason);
      alert('Deletion request submitted. Our team will follow up.');
      await refreshRequests();
    } catch (e: any) { alert(e.message || 'Failed to submit request'); }
    finally { setBusy(''); }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Loading compliance center...</div>;
  }

  return (
    <div className="p-6">
      <div className="max-w-5xl">
        {/* ── Luxury header ── */}
        <div className="flex items-center gap-3 mb-1">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-ink-900 text-gold-400 shadow-luxe-sm">
            <ShieldCheck size={22} />
          </span>
          <div>
            <h1 className="font-display text-3xl text-ink-900">Compliance Center</h1>
            <div className="gold-rule mt-1" />
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-2 mb-5">
          Your privacy, security and regulatory posture across every region you operate in — plus consent and data-subject rights.
        </p>

        {/* ── Stat pills ── */}
        <div className="flex flex-wrap gap-2 mb-6">
          <StatPill label="Regulations tracked" value={stats.total} tone="ink" />
          <StatPill label="Implemented" value={stats.implemented} tone="emerald" />
          <StatPill label="Partial" value={stats.partial} tone="amber" />
          <StatPill label="Gaps" value={stats.gap} tone="rose" />
          <StatPill label="Delegated" value={stats.delegated} tone="primary" />
        </div>

        {/* ── Tabs ── */}
        <div className="flex flex-wrap gap-2 mb-6">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition ${
                tab === t.id
                  ? 'bg-ink-900 text-gold-300 border-ink-900 shadow-luxe-sm'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gold-300 hover:text-ink-800'
              }`}
            >
              <t.Icon size={16} /> {t.label}
            </button>
          ))}
        </div>

        {/* ── Checklist ── */}
        {tab === 'checklist' && (
          <div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-luxe-sm p-4 mb-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Filter by status</p>
              <div className="flex flex-wrap gap-2 mb-4">
                <Chip active={statusFilter === 'ALL'} onClick={() => setStatusFilter('ALL')}>All</Chip>
                {Object.entries(STATUS_STYLE).map(([k, v]) => (
                  <Chip key={k} active={statusFilter === k} onClick={() => setStatusFilter(k)}>{v.label}</Chip>
                ))}
              </div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Filter by domain</p>
              <div className="flex flex-wrap gap-2">
                <Chip active={domainFilter === 'ALL'} onClick={() => setDomainFilter('ALL')}>All domains</Chip>
                {domains.map((d: any) => (
                  <Chip key={d.id} active={domainFilter === d.id} onClick={() => setDomainFilter(d.id)}>{d.label}</Chip>
                ))}
              </div>
            </div>

            {filteredGroups.length === 0 && (
              <p className="text-sm text-gray-400">No regulations match the current filters.</p>
            )}

            <div className="space-y-6">
              {filteredGroups.map((g: any) => (
                <div key={g.domain}>
                  <h2 className="font-display text-xl text-ink-900 mb-3 flex items-center gap-2">
                    {g.label}
                    <span className="text-xs font-sans font-medium text-gray-400">({g.items.length})</span>
                  </h2>
                  <div className="grid gap-3">
                    {g.items.map((it: any) => (
                      <div key={it.id} className="bg-white rounded-xl border border-gray-200 shadow-luxe-sm p-4 hover:border-gold-300 transition">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-ink-900">{it.regulation}</h3>
                          <StatusBadge status={it.status} />
                          <span className="text-xs text-gray-400 ml-auto">{it.region}</span>
                        </div>
                        <p className="text-sm text-gray-600 mt-1.5">{it.summary}</p>
                        <div className="grid sm:grid-cols-2 gap-4 mt-3">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600 mb-1.5">Addressed by</p>
                            <ul className="space-y-1">
                              {it.addressedBy.map((a: string, i: number) => (
                                <li key={i} className="text-xs text-gray-600 flex gap-1.5">
                                  <CheckCircle2 size={13} className="text-emerald-500 mt-0.5 shrink-0" />{a}
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-500 mb-1.5">Remaining gaps</p>
                            <ul className="space-y-1">
                              {it.gaps.map((gp: string, i: number) => (
                                <li key={i} className="text-xs text-gray-600 flex gap-1.5">
                                  <AlertTriangle size={13} className="text-amber-500 mt-0.5 shrink-0" />{gp}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex items-start gap-2 text-xs text-gray-500 bg-gold-50 border border-gold-200 rounded-lg p-3">
              <Info size={15} className="text-gold-600 mt-0.5 shrink-0" />
              <span>This checklist reflects shipped product features and is guidance, not legal advice. Statuses for taxes, card security and regional mandates depend on your providers and jurisdictions — confirm obligations with qualified counsel.</span>
            </div>
          </div>
        )}

        {/* ── Consent ── */}
        {tab === 'consent' && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-luxe-sm p-6">
            <h2 className="font-display text-xl text-ink-900 mb-1">Consent preferences</h2>
            <p className="text-xs text-gray-500 mb-4">
              Control optional data uses. Strictly-necessary processing is always on.{' '}
              {consentMeta.updatedAt ? `Last updated ${new Date(consentMeta.updatedAt).toLocaleString()}.` : 'No consent recorded yet.'}{' '}
              See the <Link to="/legal/cookies" className="text-primary-600 hover:underline">Cookie Policy</Link>.
            </p>
            <div className="space-y-3">
              {purposes.map((p: any) => (
                <label key={p.key} className={`flex items-start gap-3 p-3 rounded-lg border ${p.essential ? 'bg-gray-50 border-gray-200' : 'border-gray-200 hover:border-gold-300'} transition`}>
                  <input
                    type="checkbox"
                    disabled={p.essential}
                    checked={p.essential ? true : !!consent[p.key]}
                    onChange={(e) => setConsent((c: any) => ({ ...c, [p.key]: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-gold-500 focus:ring-gold-400 disabled:opacity-60"
                  />
                  <span>
                    <span className="text-sm font-medium text-ink-900 flex items-center gap-1.5">
                      {p.label}{p.essential && <Lock size={12} className="text-gray-400" />}
                    </span>
                    <span className="text-xs text-gray-500 block">{p.description}</span>
                  </span>
                </label>
              ))}
            </div>
            <button
              onClick={saveConsent}
              disabled={busy === 'consent'}
              className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-ink-900 text-gold-300 text-sm font-medium hover:bg-ink-800 shadow-luxe-sm disabled:opacity-50"
            >
              <Save size={16} /> {busy === 'consent' ? 'Saving...' : 'Save preferences'}
            </button>
          </div>
        )}

        {/* ── Data & requests ── */}
        {tab === 'data' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 shadow-luxe-sm p-6">
              <h2 className="font-display text-xl text-ink-900 mb-1">Your data (DSAR)</h2>
              <p className="text-xs text-gray-500 mb-4">
                Exercise your right of access &amp; portability, and your right to erasure. Exports are generated as JSON; deletion requests are recorded for governed processing.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={exportData}
                  disabled={!canManage || busy === 'export'}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-ink-900 text-gold-300 text-sm font-medium hover:bg-ink-800 shadow-luxe-sm disabled:opacity-40"
                >
                  <Download size={16} /> {busy === 'export' ? 'Preparing...' : 'Export my data'}
                </button>
                <button
                  onClick={requestDeletion}
                  disabled={!isOwner || busy === 'delete'}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm font-medium hover:bg-rose-100 disabled:opacity-40"
                >
                  <Trash2 size={16} /> {busy === 'delete' ? 'Submitting...' : 'Request deletion'}
                </button>
              </div>
              {!canManage && <p className="text-xs text-gray-400 mt-2">Only owners and admins can export organization data.</p>}
              {!isOwner && <p className="text-xs text-gray-400 mt-1">Only the account owner can submit a deletion request.</p>}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-luxe-sm p-6">
              <h2 className="font-display text-xl text-ink-900 mb-3">Requests &amp; consent history</h2>
              {requests.length === 0 ? (
                <p className="text-sm text-gray-400">No records yet. Actions you take here will appear in this audit trail.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {requests.map((r: any) => (
                    <li key={r.id} className="py-2.5 flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-sm">
                        <FileCheck2 size={15} className="text-gold-500" />
                        <span className="font-medium text-ink-900">{String(r.type).replace(/_/g, ' ')}</span>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{r.status}</span>
                      </span>
                      <span className="text-xs text-gray-400">{new Date(r.createdAt).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-luxe-sm p-6">
              <h2 className="font-display text-xl text-ink-900 mb-3">Related policies</h2>
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                <Link to="/legal/privacy" className="text-primary-600 hover:underline">Privacy Policy</Link>
                <Link to="/legal/dpa" className="text-primary-600 hover:underline">Data Processing Agreement</Link>
                <Link to="/legal/cookies" className="text-primary-600 hover:underline">Cookie Policy</Link>
                <Link to="/legal/accessibility" className="text-primary-600 hover:underline">Accessibility Statement</Link>
                <Link to="/legal/refunds" className="text-primary-600 hover:underline">Refund &amp; Return Policy</Link>
              </div>
              <p className="text-[11px] text-gray-400 mt-4 leading-relaxed">{COPYRIGHT}</p>
            </div>
          </div>
        )}

        {tab === 'governance' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-luxe-sm p-6">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <h2 className="font-display text-xl text-ink-900 flex items-center gap-2"><Lock size={18} className="text-gold-500" /> Two-factor authentication</h2>
                  <p className="text-sm text-gray-500 mt-1">Protect your account with a TOTP authenticator app (Google Authenticator, Authy, 1Password...).</p>
                </div>
                <span className={`text-[11px] px-2.5 py-1 rounded-full border ${gov.mfa?.mfaEnabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                  {gov.mfa?.mfaEnabled ? 'Enabled' : gov.mfa ? 'Not enabled' : 'Unknown'}
                </span>
              </div>

              {mfaSetup ? (
                <div className="rounded-lg border border-gold-200 bg-gold-50/40 p-4 space-y-3">
                  <p className="text-sm text-ink-900">Add this account to your authenticator app using the setup key below, then enter the 6-digit code it shows to finish enabling MFA.</p>
                  <p className="text-xs text-gray-500">Setup key: <code className="bg-white px-1.5 py-0.5 rounded border border-gray-200 font-mono">{mfaSetup.secret}</code></p>
                  <p className="text-[11px] text-gray-400 break-all">otpauth link: {mfaSetup.otpauthUrl}</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="000000"
                      className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-center tracking-[0.3em] focus:ring-2 focus:ring-gold-400 focus:border-gold-400 outline-none"
                    />
                    <button onClick={onMfaEnable} disabled={mfaCode.length !== 6 || govBusy === 'mfa'} className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-40">
                      {govBusy === 'mfa' ? 'Verifying...' : 'Verify & enable'}
                    </button>
                    <button onClick={() => { setMfaSetup(null); setMfaCode(''); }} className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                  </div>
                </div>
              ) : gov.mfa?.mfaEnabled ? (
                <button onClick={onMfaDisable} disabled={govBusy === 'mfa'} className="px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm font-medium hover:bg-rose-100 disabled:opacity-40">
                  {govBusy === 'mfa' ? 'Working...' : 'Disable MFA'}
                </button>
              ) : (
                <button onClick={onMfaSetup} disabled={govBusy === 'mfa' || !gov.mfa} className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-40">
                  {govBusy === 'mfa' ? 'Preparing...' : 'Set up MFA'}
                </button>
              )}
              {!gov.mfa && <p className="text-xs text-gray-400 mt-2">MFA status unavailable — apply the latest database schema and restart the server.</p>}
            </div>

            {canManage && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-luxe-sm p-6">
                <h2 className="font-display text-xl text-ink-900 mb-1">Data retention</h2>
                <p className="text-sm text-gray-500 mb-4">Define how long customer personal data is kept. Purging is blocked while a legal hold is active.</p>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-ink-900">
                    Retention (days)
                    <input
                      type="number"
                      min={1}
                      value={retDays}
                      onChange={(e) => setRetDays(e.target.value)}
                      placeholder="e.g. 730"
                      className="w-28 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gold-400 focus:border-gold-400 outline-none"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-ink-900">
                    <input type="checkbox" checked={legalHold} onChange={(e) => setLegalHold(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-gold-400" />
                    Legal hold (blocks purges)
                  </label>
                  <button onClick={onSaveRetention} disabled={govBusy === 'ret'} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-40">
                    <Save size={15} /> {govBusy === 'ret' ? 'Saving...' : 'Save policy'}
                  </button>
                  {isOwner && (
                    <button onClick={onPurge} disabled={govBusy === 'purge' || legalHold} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm font-medium hover:bg-rose-100 disabled:opacity-40">
                      <Trash2 size={15} /> {govBusy === 'purge' ? 'Purging...' : 'Apply retention purge'}
                    </button>
                  )}
                </div>
                {gov.retention && (
                  <p className="text-xs text-gray-400 mt-3">
                    Current policy: {gov.retention.dataRetentionDays != null ? `${gov.retention.dataRetentionDays} days` : 'not set'} · legal hold {gov.retention.legalHold ? 'ACTIVE' : 'off'}
                  </p>
                )}
              </div>
            )}

            {canManage && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-luxe-sm p-6">
                <h2 className="font-display text-xl text-ink-900 mb-1">Breach register</h2>
                <p className="text-sm text-gray-500 mb-4">Record personal-data breach incidents and log regulator / individual notifications (GDPR Art. 33-34).</p>
                <div className="flex items-center gap-2 mb-4">
                  <input
                    type="text"
                    value={breachTitle}
                    onChange={(e) => setBreachTitle(e.target.value)}
                    placeholder="Short description of the incident..."
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gold-400 focus:border-gold-400 outline-none"
                  />
                  <button onClick={onReportBreach} disabled={govBusy === 'breach' || !breachTitle.trim()} className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-40">
                    {govBusy === 'breach' ? 'Recording...' : 'Record incident'}
                  </button>
                </div>
                {gov.breaches.length === 0 ? (
                  <p className="text-sm text-gray-400">No incidents recorded. That's good news.</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {gov.breaches.map((b: any) => (
                      <li key={b.id} className="py-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-ink-900">{b.title}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            Detected {new Date(b.detectedAt).toLocaleString()} · severity {b.severity} · {b.affectedRecords ?? 0} record(s)
                            {b.regulatorNotifiedAt && ` · regulator notified ${new Date(b.regulatorNotifiedAt).toLocaleDateString()}`}
                          </p>
                        </div>
                        <span className="flex items-center gap-2">
                          <span className={`text-[11px] px-2 py-0.5 rounded-full border ${b.status === 'CLOSED' ? 'bg-gray-50 text-gray-500 border-gray-200' : b.status === 'NOTIFIED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>{b.status}</span>
                          {isOwner && b.status !== 'NOTIFIED' && b.status !== 'CLOSED' && (
                            <button onClick={() => onNotifyBreach(b.id)} disabled={govBusy === 'notify' + b.id} className="text-xs px-3 py-1.5 rounded-lg border border-gold-200 bg-gold-50 text-gold-700 font-medium hover:bg-gold-100 disabled:opacity-40">
                              {govBusy === 'notify' + b.id ? 'Logging...' : 'Log notification'}
                            </button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-200 shadow-luxe-sm p-6">
              <h2 className="font-display text-xl text-ink-900 mb-1">Records of processing (RoPA)</h2>
              <p className="text-sm text-gray-500 mb-4">GDPR Art. 30 record of processing activities carried out by UnifiedPOS.</p>
              <div className="space-y-2">
                {(gov.ropa || []).map((a: any) => (
                  <details key={a.id} className="rounded-lg border border-gray-200 bg-gray-50/50">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-900 flex items-center gap-2">
                      <Info size={14} className="text-gold-500" /> {a.activity} <span className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-500">{a.legalBasis}</span>
                    </summary>
                    <div className="px-4 pb-4 text-xs text-gray-600 space-y-1.5">
                      <p><span className="font-semibold text-ink-900">Purpose:</span> {a.purpose}</p>
                      <p><span className="font-semibold text-ink-900">Data categories:</span> {Array.isArray(a.dataCategories) ? a.dataCategories.join(', ') : a.dataCategories}</p>
                      <p><span className="font-semibold text-ink-900">Data subjects:</span> {Array.isArray(a.dataSubjects) ? a.dataSubjects.join(', ') : a.dataSubjects}</p>
                      <p><span className="font-semibold text-ink-900">Retention:</span> {a.retention}</p>
                      <p><span className="font-semibold text-ink-900">Recipients:</span> {Array.isArray(a.recipients) ? a.recipients.join(', ') : a.recipients}</p>
                      {a.crossBorderTransfers && <p><span className="font-semibold text-ink-900">Cross-border transfers:</span> {a.crossBorderTransfers}</p>}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'trust' && (
          <div className="space-y-6">
            {/* PCI DSS SAQ A */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-luxe-sm p-6">
              <h2 className="font-display text-xl text-ink-900 flex items-center gap-2 mb-1">
                <Award size={18} className="text-gold-500" /> PCI DSS {SAQ_A_ELIGIBILITY.version} — {SAQ_A_ELIGIBILITY.form}
              </h2>
              <p className="text-sm font-medium text-gray-700">{SAQ_A_ELIGIBILITY.headline}</p>
              <ul className="mt-3 space-y-1.5">
                {SAQ_A_ELIGIBILITY.rationale.map((r, i) => (
                  <li key={i} className="text-xs text-gray-600 flex gap-1.5">
                    <CheckCircle2 size={13} className="text-emerald-500 mt-0.5 shrink-0" />{r}
                  </li>
                ))}
              </ul>
              <div className="mt-4 grid gap-2">
                {SAQ_A_SECTIONS.map((s) => (
                  <div key={s.part} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-gray-400">{s.part}</span>
                      <span className="text-sm font-medium text-ink-900">{s.title}</span>
                      <StatusBadge status={s.status} />
                    </div>
                    <p className="text-xs text-gray-600 mt-1">{s.detail}</p>
                  </div>
                ))}
              </div>
              {SAQ_A_ELIGIBILITY.outOfScope.map((o, i) => (
                <p key={i} className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mt-3 flex gap-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />{o}
                </p>
              ))}
            </div>

            {/* SOC 2 Trust Services Criteria */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-luxe-sm p-6">
              <h2 className="font-display text-xl text-ink-900 mb-1">SOC 2 Trust Services Criteria</h2>
              <p className="text-sm text-gray-500 mb-4">Control map from the shipped product to the five Trust Services Criteria, with evidence pointers for your auditor.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-start px-3 py-2 font-medium">Criterion</th>
                      <th className="text-start px-3 py-2 font-medium">Requirement</th>
                      <th className="text-start px-3 py-2 font-medium">How UnifiedPOS addresses it</th>
                      <th className="text-start px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SOC2_TSC.map((c) => (
                      <tr key={c.id} className="border-b align-top">
                        <td className="px-3 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">{c.id}</td>
                        <td className="px-3 py-2 text-ink-900">{c.requirement}</td>
                        <td className="px-3 py-2 text-xs text-gray-600">
                          {c.how}
                          {c.evidence && <div className="text-[11px] text-gray-400 mt-1">Evidence: {c.evidence}</div>}
                        </td>
                        <td className="px-3 py-2"><StatusBadge status={c.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Sub-processors + attestation checklist */}
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl border border-gray-200 shadow-luxe-sm p-6">
                <h2 className="font-display text-lg text-ink-900 mb-3">Sub-processors</h2>
                <ul className="space-y-2">
                  {SUBPROCESSORS.map((sp) => (
                    <li key={sp.name} className="text-sm">
                      <span className="font-medium text-ink-900">{sp.name}</span>
                      <span className="text-xs text-gray-500 block">{sp.role}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 shadow-luxe-sm p-6">
                <h2 className="font-display text-lg text-ink-900 mb-3">Attestation checklist</h2>
                <ul className="space-y-2">
                  {ATTESTATION_CHECKLIST.map((t, i) => (
                    <li key={i} className="text-xs text-gray-600 flex gap-2">
                      <Info size={13} className="text-gold-500 mt-0.5 shrink-0" />{t}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="flex items-start gap-2 text-xs text-gray-500 bg-gold-50 border border-gold-200 rounded-lg p-3">
              <Info size={15} className="text-gold-600 mt-0.5 shrink-0" />
              <span>This Trust Center is a documentation scaffold and guidance — not a completed attestation or legal advice. PCI SAQ A must be attested with your acquirer; SOC 2 requires an independent auditor. Statuses reflect shipped product controls.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.PARTIAL;
  const Icon = s.Icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${s.cls}`}>
      <Icon size={12} /> {s.label}
    </span>
  );
}

function StatPill({ label, value, tone }: { label: string; value: number; tone: string }) {
  const tones: Record<string, string> = {
    ink: 'text-ink-900', emerald: 'text-emerald-600', amber: 'text-amber-600',
    rose: 'text-rose-600', primary: 'text-primary-600',
  };
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-luxe-sm px-3.5 py-2 flex items-baseline gap-2">
      <span className={`text-xl font-bold ${tones[tone] || 'text-ink-900'}`}>{value ?? 0}</span>
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
        active ? 'bg-ink-900 text-gold-300 border-ink-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gold-300'
      }`}
    >
      {children}
    </button>
  );
}
