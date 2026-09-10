import { useEffect, useState, useCallback } from 'react';
import {
  Tag, Ticket, Megaphone, Users, Plus, X, RefreshCw, Trash2, Edit2, Send, Play,
  Eye, Ban, Target, TrendingUp, FlaskConical, MousePointerClick,
} from 'lucide-react';
import { api } from '../api/client';
import clsx from 'clsx';

type Tab = 'promotions' | 'coupons' | 'campaigns' | 'segments';

const money = (n: any) => `$${Number(n || 0).toFixed(2)}`;
const todayISO = () => new Date().toISOString().slice(0, 10);
const rate = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(1) : '0.0');

const input = 'w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm';
const btnPrimary = 'px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-1 disabled:opacity-50';
const btnGhost = 'px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium flex items-center gap-1 disabled:opacity-50';

const PROMOTION_TYPES = ['PERCENTAGE', 'FIXED', 'BOGO', 'BUNDLE'];
const COUPON_TYPES = ['PERCENTAGE', 'FIXED', 'FREE_SHIPPING'];
const CAMPAIGN_TYPES = ['EMAIL', 'SMS', 'PUSH', 'SOCIAL'];

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    green: 'bg-green-100 text-green-700', red: 'bg-red-100 text-red-700',
    blue: 'bg-blue-100 text-blue-700', purple: 'bg-purple-100 text-purple-700',
    indigo: 'bg-indigo-100 text-indigo-700', gray: 'bg-gray-100 text-gray-700',
    amber: 'bg-amber-100 text-amber-800',
  };
  return <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', tones[tone] || tones.gray)}>{children}</span>;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-600">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="text-xs text-gray-400 mt-1 block">{hint}</span>}
    </label>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: React.ReactNode; sub?: string; tone: string }) {
  return (
    <div className="bg-white rounded-lg border p-4 flex items-start gap-3">
      <div className={clsx('p-2 rounded-lg', tone)}><Icon size={18} /></div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 truncate">{label}</p>
        <p className="text-xl font-bold leading-tight">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

const emptyPromo = { name: '', description: '', type: 'PERCENTAGE', value: '', minPurchase: '', maxDiscount: '', applicableProducts: [] as string[], startDate: todayISO(), endDate: '' };
const emptyCoupon = { code: '', description: '', type: 'PERCENTAGE', value: '', minPurchase: '', maxDiscount: '', usageLimit: '', perCustomerLimit: '1', startDate: todayISO(), endDate: '' };
const emptyCampaign = { name: '', type: 'EMAIL', audience: 'all', subject: '', message: '', scheduledAt: '' };

export default function MarketingPage() {
  const [tab, setTab] = useState<Tab>('promotions');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [overview, setOverview] = useState<any>(null);
  const [promotions, setPromotions] = useState<any[]>([]);
  const [coupons, setCoupons] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [segments, setSegments] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  const [promoModal, setPromoModal] = useState<null | { id?: string; form: typeof emptyPromo }>(null);
  const [couponModal, setCouponModal] = useState<null | { id?: string; form: typeof emptyCoupon }>(null);
  const [campaignModal, setCampaignModal] = useState<null | { id?: string; form: typeof emptyCampaign }>(null);

  const [testCode, setTestCode] = useState('');
  const [testTotal, setTestTotal] = useState('');
  const [testResult, setTestResult] = useState<null | { ok: boolean; text: string }>(null);

  const flash = (m: string) => { setNotice(m); window.setTimeout(() => setNotice(null), 3500); };

  const load = useCallback(async () => {
    try {
      setError(null); setLoading(true);
      const [ov, p, c, camp, seg, prod] = await Promise.all([
        api.getMarketingOverview(), api.getPromotions(), api.getCoupons(),
        api.getCampaigns(), api.getSegments(), api.getProducts(),
      ]);
      setOverview(ov.data);
      setPromotions(p.data || []);
      setCoupons(c.data || []);
      setCampaigns(camp.data || []);
      setSegments(seg.data || []);
      setProducts(prod.data?.items || prod.data || []);
    } catch (e: any) { setError(e.message || 'Failed to load marketing data'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const guard = async (fn: () => Promise<void>, okMsg?: string) => {
    try { setBusy(true); setError(null); await fn(); if (okMsg) flash(okMsg); await load(); }
    catch (e: any) { setError(e.message || 'Request failed'); }
    finally { setBusy(false); }
  };

  // ── Promotions ──
  const savePromotion = async () => {
    if (!promoModal) return;
    const f = promoModal.form;
    const payload: any = {
      name: f.name, description: f.description || undefined, type: f.type,
      value: Number(f.value || 0), minPurchase: Number(f.minPurchase || 0),
      maxDiscount: f.maxDiscount ? Number(f.maxDiscount) : undefined,
      applicableProducts: f.applicableProducts, startDate: f.startDate,
      endDate: f.endDate || undefined,
    };
    await guard(async () => {
      if (promoModal.id) await api.updatePromotion(promoModal.id, payload);
      else await api.createPromotion(payload);
      setPromoModal(null);
    }, promoModal.id ? 'Promotion updated' : 'Promotion created');
  };

  // ── Coupons ──
  const saveCoupon = async () => {
    if (!couponModal) return;
    const f = couponModal.form;
    const payload: any = {
      code: f.code.toUpperCase(), description: f.description || undefined, type: f.type,
      value: Number(f.value || 0), minPurchase: Number(f.minPurchase || 0),
      maxDiscount: f.maxDiscount ? Number(f.maxDiscount) : undefined,
      usageLimit: f.usageLimit ? Number(f.usageLimit) : undefined,
      perCustomerLimit: f.perCustomerLimit ? Number(f.perCustomerLimit) : undefined,
      startDate: f.startDate, endDate: f.endDate || undefined,
    };
    await guard(async () => {
      if (couponModal.id) await api.updateCoupon(couponModal.id, payload);
      else await api.createCoupon(payload);
      setCouponModal(null);
    }, couponModal.id ? 'Coupon updated' : 'Coupon created');
  };

  const runCouponTest = async () => {
    setTestResult(null);
    try {
      const res = await api.validateCoupon(testCode.trim(), testTotal ? Number(testTotal) : undefined);
      const d = res.data || {};
      setTestResult({ ok: true, text: `Valid — ${d.coupon?.type} discount of ${money(d.discount)} applies.` });
    } catch (e: any) { setTestResult({ ok: false, text: e.message || 'Invalid coupon' }); }
  };

  // ── Campaigns ──
  const saveCampaign = async () => {
    if (!campaignModal) return;
    const f = campaignModal.form;
    const payload: any = {
      name: f.name, type: f.type, audience: f.audience, subject: f.subject || undefined,
      message: f.message || undefined, scheduledAt: f.scheduledAt || undefined,
    };
    await guard(async () => {
      if (campaignModal.id) await api.updateCampaign(campaignModal.id, payload);
      else await api.createCampaign(payload);
      setCampaignModal(null);
    }, campaignModal.id ? 'Campaign updated' : 'Campaign created');
  };

  const openCampaignForSegment = (key: string) => {
    setTab('campaigns');
    setCampaignModal({ form: { ...emptyCampaign, audience: key } });
  };

  const editPromo = (p: any) => setPromoModal({
    id: p.id,
    form: {
      name: p.name || '', description: p.description || '', type: p.type || 'PERCENTAGE',
      value: String(p.value ?? ''), minPurchase: String(p.minPurchase ?? ''), maxDiscount: p.maxDiscount != null ? String(p.maxDiscount) : '',
      applicableProducts: p.applicableProducts || [], startDate: (p.startDate || '').slice(0, 10) || todayISO(), endDate: (p.endDate || '').slice(0, 10),
    },
  });
  const editCoupon = (c: any) => setCouponModal({
    id: c.id,
    form: {
      code: c.code || '', description: c.description || '', type: c.type || 'PERCENTAGE',
      value: String(c.value ?? ''), minPurchase: String(c.minPurchase ?? ''), maxDiscount: c.maxDiscount != null ? String(c.maxDiscount) : '',
      usageLimit: c.usageLimit != null ? String(c.usageLimit) : '', perCustomerLimit: String(c.perCustomerLimit ?? 1),
      startDate: (c.startDate || '').slice(0, 10) || todayISO(), endDate: (c.endDate || '').slice(0, 10),
    },
  });

  const tabs = [
    { id: 'promotions' as Tab, label: 'Promotions', icon: Tag },
    { id: 'coupons' as Tab, label: 'Coupons', icon: Ticket },
    { id: 'campaigns' as Tab, label: 'Campaigns', icon: Megaphone },
    { id: 'segments' as Tab, label: 'Segments', icon: Users },
  ];

  if (loading && !overview) return <div className="p-6 text-gray-500">Loading marketing…</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Megaphone size={24} /> Marketing</h1>
          <p className="text-gray-500">Promotions, coupons, campaigns and RFM-driven customer segments (§13)</p>
        </div>
        <button onClick={load} className={btnGhost}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh</button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg flex items-center justify-between">
          <span className="text-sm">{error}</span><button onClick={() => setError(null)}><X size={16} /></button>
        </div>
      )}
      {notice && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-2 rounded-lg text-sm">{notice}</div>
      )}

      {/* KPI dashboard */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <Kpi icon={Tag} tone="bg-blue-50 text-blue-600" label="Active promotions" value={overview.promotions?.active} sub={`of ${overview.promotions?.total} total`} />
          <Kpi icon={Ticket} tone="bg-purple-50 text-purple-600" label="Coupons redeemed" value={overview.coupons?.redeemed} sub={`${overview.coupons?.active} active`} />
          <Kpi icon={Send} tone="bg-indigo-50 text-indigo-600" label="Messages sent" value={overview.campaigns?.sent} sub={`${overview.campaigns?.running} running`} />
          <Kpi icon={Eye} tone="bg-amber-50 text-amber-600" label="Open rate" value={`${overview.campaigns?.openRate}%`} sub={`${overview.campaigns?.opened} opens`} />
          <Kpi icon={MousePointerClick} tone="bg-green-50 text-green-600" label="Conversion rate" value={`${overview.campaigns?.conversionRate}%`} sub={`${overview.campaigns?.converted} conversions`} />
          <Kpi icon={Users} tone="bg-gray-100 text-gray-600" label="Reachable audience" value={overview.audience?.customers} sub={`${overview.audience?.optInRate}% opted in`} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx('px-4 py-2 rounded-md text-sm font-medium flex items-center gap-1.5 transition',
              tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {/* ── PROMOTIONS ── */}
      {tab === 'promotions' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button className={btnPrimary} onClick={() => setPromoModal({ form: { ...emptyPromo } })}><Plus size={16} /> New Promotion</button>
          </div>
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b text-sm font-medium text-gray-600">
                <tr>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Type</th>
                  <th className="text-left px-4 py-3">Value</th>
                  <th className="text-left px-4 py-3">Min purchase</th>
                  <th className="text-left px-4 py-3">Window</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {promotions.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium">{p.name}<div className="text-xs text-gray-400">{p.applicableProducts?.length ? `${p.applicableProducts.length} products` : 'All products'}</div></td>
                    <td className="px-4 py-3"><Pill tone="blue">{p.type}</Pill></td>
                    <td className="px-4 py-3 text-sm">{p.type === 'PERCENTAGE' ? `${Number(p.value)}%` : money(p.value)}</td>
                    <td className="px-4 py-3 text-sm">{Number(p.minPurchase) > 0 ? money(p.minPurchase) : '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{new Date(p.startDate).toLocaleDateString()} → {p.endDate ? new Date(p.endDate).toLocaleDateString() : 'no end'}</td>
                    <td className="px-4 py-3"><Pill tone={p.isActive ? 'green' : 'red'}>{p.isActive ? 'Active' : 'Inactive'}</Pill></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button className="p-1.5 text-gray-400 hover:text-blue-600" onClick={() => editPromo(p)}><Edit2 size={15} /></button>
                        <button className="p-1.5 text-gray-400 hover:text-red-600" disabled={busy} onClick={() => guard(async () => { await api.deletePromotion(p.id); }, 'Promotion deactivated')}><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {promotions.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500">No promotions yet — create one to start driving revenue.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── COUPONS ── */}
      {tab === 'coupons' && (
        <div className="space-y-4">
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 flex justify-end">
              <button className={btnPrimary} onClick={() => setCouponModal({ form: { ...emptyCoupon } })}><Plus size={16} /> New Coupon</button>
            </div>
            <div className="lg:col-start-3 lg:row-start-1 bg-white rounded-lg border p-4">
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-2"><FlaskConical size={16} /> Test a coupon</h3>
              <div className="flex gap-2">
                <input className={input} placeholder="CODE" value={testCode} onChange={(e) => setTestCode(e.target.value)} />
                <input className={input} type="number" placeholder="Order total" value={testTotal} onChange={(e) => setTestTotal(e.target.value)} />
                <button className={btnGhost} onClick={runCouponTest}>Check</button>
              </div>
              {testResult && (
                <p className={clsx('text-xs mt-2', testResult.ok ? 'text-green-700' : 'text-red-600')}>{testResult.text}</p>
              )}
            </div>
          </div>
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b text-sm font-medium text-gray-600">
                <tr>
                  <th className="text-left px-4 py-3">Code</th>
                  <th className="text-left px-4 py-3">Type</th>
                  <th className="text-left px-4 py-3">Value</th>
                  <th className="text-left px-4 py-3">Min</th>
                  <th className="text-left px-4 py-3">Usage</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {coupons.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-mono font-medium">{c.code}</td>
                    <td className="px-4 py-3"><Pill tone="purple">{c.type}</Pill></td>
                    <td className="px-4 py-3 text-sm">{c.type === 'PERCENTAGE' ? `${Number(c.value)}%` : c.type === 'FREE_SHIPPING' ? 'Free shipping' : money(c.value)}</td>
                    <td className="px-4 py-3 text-sm">{Number(c.minPurchase) > 0 ? money(c.minPurchase) : '—'}</td>
                    <td className="px-4 py-3 text-sm">{c.usedCount}{c.usageLimit ? ` / ${c.usageLimit}` : ''}</td>
                    <td className="px-4 py-3"><Pill tone={c.isActive ? 'green' : 'red'}>{c.isActive ? 'Active' : 'Inactive'}</Pill></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button title="Record a redemption" className="p-1.5 text-gray-400 hover:text-green-600" disabled={busy} onClick={() => guard(async () => { await api.redeemCoupon(c.id); }, 'Redemption recorded')}><Ticket size={15} /></button>
                        <button className="p-1.5 text-gray-400 hover:text-blue-600" onClick={() => editCoupon(c)}><Edit2 size={15} /></button>
                        <button className="p-1.5 text-gray-400 hover:text-red-600" disabled={busy} onClick={() => guard(async () => { await api.deleteCoupon(c.id); }, 'Coupon deactivated')}><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {coupons.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500">No coupons yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── CAMPAIGNS ── */}
      {tab === 'campaigns' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button className={btnPrimary} onClick={() => setCampaignModal({ form: { ...emptyCampaign } })}><Plus size={16} /> New Campaign</button>
          </div>
          <div className="grid gap-3">
            {campaigns.map((c) => {
              const sent = c.sentCount || 0, opened = c.openedCount || 0, converted = c.convertedCount || 0;
              const segName = segments.find((s) => s.key === String(c.audience || '').toLowerCase())?.name || c.audience;
              return (
                <div key={c.id} className="bg-white rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{c.name}</h3>
                        <Pill tone="indigo">{c.type}</Pill>
                        <Pill tone={c.status === 'RUNNING' ? 'green' : c.status === 'CANCELLED' ? 'red' : 'gray'}>{c.status}</Pill>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Audience: {segName}{c.subject ? ` · “${c.subject}”` : ''}</p>
                      {c.message && <p className="text-sm text-gray-600 mt-1 line-clamp-2">{c.message}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {c.status !== 'RUNNING' && c.status !== 'CANCELLED' && (
                        <button className={btnPrimary} disabled={busy} onClick={() => guard(async () => { await api.launchCampaign(c.id, c.audience); }, `Launched to ${segName}`)}><Play size={15} /> Launch</button>
                      )}
                      {c.status === 'RUNNING' && (
                        <>
                          <button className={btnGhost} disabled={busy} title="Record an open" onClick={() => guard(async () => { await api.engageCampaign(c.id, 'open'); })}><Eye size={15} /></button>
                          <button className={btnGhost} disabled={busy} title="Record a conversion" onClick={() => guard(async () => { await api.engageCampaign(c.id, 'convert'); })}><MousePointerClick size={15} /></button>
                          <button className={btnGhost} disabled={busy} title="Cancel campaign" onClick={() => guard(async () => { await api.cancelCampaign(c.id); }, 'Campaign cancelled')}><Ban size={15} /></button>
                        </>
                      )}
                      <button className="p-1.5 text-gray-400 hover:text-blue-600" onClick={() => setCampaignModal({
                        id: c.id,
                        form: { name: c.name, type: c.type, audience: String(c.audience || 'all'), subject: c.subject || '', message: c.message || '', scheduledAt: (c.scheduledAt || '').slice(0, 16) },
                      })}><Edit2 size={15} /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-3 mt-4 pt-3 border-t text-center">
                    <div><p className="text-lg font-bold">{sent}</p><p className="text-xs text-gray-400">Sent</p></div>
                    <div><p className="text-lg font-bold">{opened}</p><p className="text-xs text-gray-400">Opened</p></div>
                    <div><p className="text-lg font-bold">{converted}</p><p className="text-xs text-gray-400">Converted</p></div>
                    <div><p className="text-lg font-bold text-amber-600">{rate(opened, sent)}%</p><p className="text-xs text-gray-400">Open rate</p></div>
                    <div><p className="text-lg font-bold text-green-600">{rate(converted, sent)}%</p><p className="text-xs text-gray-400">Conv. rate</p></div>
                  </div>
                </div>
              );
            })}
            {campaigns.length === 0 && <div className="bg-white rounded-lg border px-4 py-10 text-center text-gray-500">No campaigns yet — build one and target a segment.</div>}
          </div>
        </div>
      )}

      {/* ── SEGMENTS ── */}
      {tab === 'segments' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {segments.map((s) => (
            <div key={s.key} className="bg-white rounded-lg border p-4 flex flex-col">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2"><Target size={16} className="text-blue-600" /><h3 className="font-semibold text-sm">{s.name}</h3></div>
                <span className="text-2xl font-bold text-blue-600">{s.count}</span>
              </div>
              <p className="text-xs text-gray-500 mt-2 flex-1">{s.description}</p>
              <div className="flex items-center justify-between mt-3 pt-3 border-t">
                <span className="text-xs text-gray-400 flex items-center gap-1"><TrendingUp size={12} /> avg {money(s.avgValue)}</span>
                <button className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100 flex items-center gap-1" onClick={() => openCampaignForSegment(s.key)}>
                  <Megaphone size={12} /> Target
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── MODALS ── */}
      {promoModal && (
        <Modal title={promoModal.id ? 'Edit promotion' : 'New promotion'} onClose={() => setPromoModal(null)}>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Name"><input className={input} value={promoModal.form.name} onChange={(e) => setPromoModal({ ...promoModal, form: { ...promoModal.form, name: e.target.value } })} /></Field>
            <Field label="Type">
              <select className={input} value={promoModal.form.type} onChange={(e) => setPromoModal({ ...promoModal, form: { ...promoModal.form, type: e.target.value } })}>
                {PROMOTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Value" hint={promoModal.form.type === 'PERCENTAGE' ? 'Percent off (e.g. 15)' : 'Amount off'}>
              <input className={input} type="number" step="0.01" value={promoModal.form.value} onChange={(e) => setPromoModal({ ...promoModal, form: { ...promoModal.form, value: e.target.value } })} />
            </Field>
            <Field label="Minimum purchase"><input className={input} type="number" step="0.01" value={promoModal.form.minPurchase} onChange={(e) => setPromoModal({ ...promoModal, form: { ...promoModal.form, minPurchase: e.target.value } })} /></Field>
            <Field label="Max discount (optional)"><input className={input} type="number" step="0.01" value={promoModal.form.maxDiscount} onChange={(e) => setPromoModal({ ...promoModal, form: { ...promoModal.form, maxDiscount: e.target.value } })} /></Field>
            <Field label="Description"><input className={input} value={promoModal.form.description} onChange={(e) => setPromoModal({ ...promoModal, form: { ...promoModal.form, description: e.target.value } })} /></Field>
            <Field label="Start date"><input className={input} type="date" value={promoModal.form.startDate} onChange={(e) => setPromoModal({ ...promoModal, form: { ...promoModal.form, startDate: e.target.value } })} /></Field>
            <Field label="End date (optional)"><input className={input} type="date" value={promoModal.form.endDate} onChange={(e) => setPromoModal({ ...promoModal, form: { ...promoModal.form, endDate: e.target.value } })} /></Field>
            <div className="md:col-span-2">
              <Field label="Applicable products" hint="Leave empty to apply to the whole catalog.">
                <div className="max-h-40 overflow-auto border rounded-lg p-2 grid grid-cols-2 gap-1">
                  {products.map((p) => {
                    const on = promoModal.form.applicableProducts.includes(p.id);
                    return (
                      <label key={p.id} className="flex items-center gap-2 text-sm px-1 py-0.5">
                        <input type="checkbox" checked={on} onChange={() => {
                          const next = on ? promoModal.form.applicableProducts.filter((x) => x !== p.id) : [...promoModal.form.applicableProducts, p.id];
                          setPromoModal({ ...promoModal, form: { ...promoModal.form, applicableProducts: next } });
                        }} />
                        <span className="truncate">{p.name}</span>
                      </label>
                    );
                  })}
                  {products.length === 0 && <span className="text-sm text-gray-400">No products found.</span>}
                </div>
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button className={btnGhost} onClick={() => setPromoModal(null)}>Cancel</button>
            <button className={btnPrimary} disabled={busy || !promoModal.form.name} onClick={savePromotion}>{promoModal.id ? 'Save changes' : 'Create promotion'}</button>
          </div>
        </Modal>
      )}

      {couponModal && (
        <Modal title={couponModal.id ? 'Edit coupon' : 'New coupon'} onClose={() => setCouponModal(null)}>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Code"><input className={input} value={couponModal.form.code} onChange={(e) => setCouponModal({ ...couponModal, form: { ...couponModal.form, code: e.target.value.toUpperCase() } })} placeholder="SAVE10" /></Field>
            <Field label="Type">
              <select className={input} value={couponModal.form.type} onChange={(e) => setCouponModal({ ...couponModal, form: { ...couponModal.form, type: e.target.value } })}>
                {COUPON_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Value"><input className={input} type="number" step="0.01" value={couponModal.form.value} onChange={(e) => setCouponModal({ ...couponModal, form: { ...couponModal.form, value: e.target.value } })} /></Field>
            <Field label="Minimum purchase"><input className={input} type="number" step="0.01" value={couponModal.form.minPurchase} onChange={(e) => setCouponModal({ ...couponModal, form: { ...couponModal.form, minPurchase: e.target.value } })} /></Field>
            <Field label="Max discount (optional)"><input className={input} type="number" step="0.01" value={couponModal.form.maxDiscount} onChange={(e) => setCouponModal({ ...couponModal, form: { ...couponModal.form, maxDiscount: e.target.value } })} /></Field>
            <Field label="Usage limit (optional)"><input className={input} type="number" value={couponModal.form.usageLimit} onChange={(e) => setCouponModal({ ...couponModal, form: { ...couponModal.form, usageLimit: e.target.value } })} /></Field>
            <Field label="Per-customer limit"><input className={input} type="number" value={couponModal.form.perCustomerLimit} onChange={(e) => setCouponModal({ ...couponModal, form: { ...couponModal.form, perCustomerLimit: e.target.value } })} /></Field>
            <Field label="Description"><input className={input} value={couponModal.form.description} onChange={(e) => setCouponModal({ ...couponModal, form: { ...couponModal.form, description: e.target.value } })} /></Field>
            <Field label="Start date"><input className={input} type="date" value={couponModal.form.startDate} onChange={(e) => setCouponModal({ ...couponModal, form: { ...couponModal.form, startDate: e.target.value } })} /></Field>
            <Field label="End date (optional)"><input className={input} type="date" value={couponModal.form.endDate} onChange={(e) => setCouponModal({ ...couponModal, form: { ...couponModal.form, endDate: e.target.value } })} /></Field>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button className={btnGhost} onClick={() => setCouponModal(null)}>Cancel</button>
            <button className={btnPrimary} disabled={busy || !couponModal.form.code} onClick={saveCoupon}>{couponModal.id ? 'Save changes' : 'Create coupon'}</button>
          </div>
        </Modal>
      )}

      {campaignModal && (
        <Modal title={campaignModal.id ? 'Edit campaign' : 'New campaign'} onClose={() => setCampaignModal(null)}>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Name"><input className={input} value={campaignModal.form.name} onChange={(e) => setCampaignModal({ ...campaignModal, form: { ...campaignModal.form, name: e.target.value } })} /></Field>
            <Field label="Channel">
              <select className={input} value={campaignModal.form.type} onChange={(e) => setCampaignModal({ ...campaignModal, form: { ...campaignModal.form, type: e.target.value } })}>
                {CAMPAIGN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Target segment" hint="Launch resolves live membership from order history.">
              <select className={input} value={campaignModal.form.audience} onChange={(e) => setCampaignModal({ ...campaignModal, form: { ...campaignModal.form, audience: e.target.value } })}>
                {segments.map((s) => <option key={s.key} value={s.key}>{s.name} ({s.count})</option>)}
              </select>
            </Field>
            <Field label="Schedule (optional)"><input className={input} type="datetime-local" value={campaignModal.form.scheduledAt} onChange={(e) => setCampaignModal({ ...campaignModal, form: { ...campaignModal.form, scheduledAt: e.target.value } })} /></Field>
            <div className="md:col-span-2"><Field label="Subject"><input className={input} value={campaignModal.form.subject} onChange={(e) => setCampaignModal({ ...campaignModal, form: { ...campaignModal.form, subject: e.target.value } })} /></Field></div>
            <div className="md:col-span-2"><Field label="Message"><textarea className={input} rows={4} value={campaignModal.form.message} onChange={(e) => setCampaignModal({ ...campaignModal, form: { ...campaignModal.form, message: e.target.value } })} /></Field></div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button className={btnGhost} onClick={() => setCampaignModal(null)}>Cancel</button>
            <button className={btnPrimary} disabled={busy || !campaignModal.form.name} onClick={saveCampaign}>{campaignModal.id ? 'Save changes' : 'Create campaign'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
