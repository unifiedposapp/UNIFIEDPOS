import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useRealtime } from '../hooks/useRealtime';
import {
  Store,
  Plus,
  ExternalLink,
  Copy,
  Trash2,
  Power,
  Check,
  Clock,
  PackageCheck,
  XCircle,
  RefreshCw,
  Truck,
} from 'lucide-react';

// ─── Merchant storefront control room ───────────────────────────────────────
// Publish a location as a public shop, decide which fulfilment methods it offers
// and what they cost, then work the queue of orders the web sent in. Everything
// here is the /api/storefront surface; the customer side lives at /shop/:slug.

const FULFILLMENT_OPTIONS = ['PICKUP', 'CURBSIDE', 'DELIVERY', 'SHIP'] as const;
const STATUS_STEPS = ['CONFIRMED', 'PROCESSING', 'READY', 'COMPLETED'] as const;

interface Storefront {
  id: string;
  name: string;
  slug: string;
  url: string;
  isEnabled: boolean;
  locationId: string | null;
  fulfillmentTypes: string[] | null;
  deliveryFee: number | null;
  minOrderAmount: number | null;
  payOnPickup: boolean;
  headerText: string | null;
  themeColor: string | null;
  pendingOrders: number;
}

const emptyForm = {
  name: '',
  slug: '',
  locationId: '',
  isEnabled: false,
  fulfillmentTypes: ['PICKUP', 'DELIVERY'] as string[],
  deliveryFee: '',
  minOrderAmount: '',
  payOnPickup: true,
  headerText: '',
  themeColor: '#0f766e',
};

export default function StorefrontPage() {
  const [rows, setRows] = useState<Storefront[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [overview, setOverview] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [form, setForm] = useState<any>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'sites' | 'queue'>('sites');

  const load = useCallback(async () => {
    const [sites, loc, ov, os] = await Promise.all([api.getStorefronts(), api.getLocations(), api.getStorefrontOverview(), api.getStorefrontOrders()]);
    setRows(sites.data || []);
    setLocations(loc.data || []);
    setOverview(ov.data);
    setOrders(os.data || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  // A new web order should appear on the screen while the owner is looking at it.
  useRealtime(() => {
    load();
  });

  const startEdit = (row: Storefront) => {
    setEditing(row.id);
    setForm({
      name: row.name,
      slug: row.slug,
      locationId: row.locationId || '',
      isEnabled: row.isEnabled,
      fulfillmentTypes: row.fulfillmentTypes?.length ? row.fulfillmentTypes : ['PICKUP'],
      deliveryFee: row.deliveryFee != null ? String(row.deliveryFee) : '',
      minOrderAmount: row.minOrderAmount != null ? String(row.minOrderAmount) : '',
      payOnPickup: row.payOnPickup,
      headerText: row.headerText || '',
      themeColor: row.themeColor || '#0f766e',
    });
    setShowForm(true);
  };

  const save = async () => {
    setBusy(true);
    setNotice('');
    const payload = {
      name: form.name,
      slug: form.slug || undefined,
      locationId: form.locationId || null,
      isEnabled: form.isEnabled,
      fulfillmentTypes: form.fulfillmentTypes.length ? form.fulfillmentTypes : undefined,
      deliveryFee: form.deliveryFee === '' ? null : Number(form.deliveryFee),
      minOrderAmount: form.minOrderAmount === '' ? null : Number(form.minOrderAmount),
      payOnPickup: form.payOnPickup,
      headerText: form.headerText || null,
      themeColor: form.themeColor || null,
    };
    try {
      if (editing) await api.updateStorefront(editing, payload);
      else await api.createStorefront(payload);
      setShowForm(false);
      setEditing(null);
      setForm(emptyForm);
      await load();
      setNotice('Saved.');
    } catch (e: any) {
      setNotice(e?.message || 'Could not save the storefront.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (row: Storefront) => {
    await api.updateStorefront(row.id, { isEnabled: !row.isEnabled });
    load();
  };

  const remove = async (row: Storefront) => {
    if (!confirm(`Remove ${row.name}? Orders already placed stay in your history.`)) return;
    await api.deleteStorefront(row.id);
    load();
  };

  const setStatus = async (order: any, status: string) => {
    setBusy(true);
    try {
      await api.setStorefrontOrderStatus(order.id, status);
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink-900">
            <Store size={22} className="text-gold-500" /> Online storefront
          </h1>
          <p className="text-sm text-ink-400">Sell from the same stock number on the web as at the counter.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-600 hover:bg-ink-50">
            <RefreshCw size={15} /> Refresh
          </button>
          <button
            onClick={() => {
              setEditing(null);
              setForm(emptyForm);
              setShowForm(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800"
          >
            <Plus size={16} /> New storefront
          </button>
        </div>
      </header>

      {overview && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Published shops" value={overview.publishedStorefronts} />
          <Stat label="Web orders today" value={overview.ordersToday} />
          <Stat label="Orders (30 days)" value={overview.orders30d} />
          <Stat label="Online revenue (30 days)" value={money(overview.revenue30d)} />
        </div>
      )}

      <div className="flex gap-1 border-b border-ink-100">
        <Tab active={tab === 'sites'} onClick={() => setTab('sites')} label={`Shops (${rows.length})`} />
        <Tab active={tab === 'queue'} onClick={() => setTab('queue')} label={`Order queue (${overview?.awaitingAction ?? 0})`} />
      </div>

      {notice && <div className="rounded-lg border border-gold-200 bg-gold-50 px-3 py-2 text-sm text-ink-700">{notice}</div>}

      {tab === 'sites' && (
        <div className="space-y-4">
          {showForm && (
            <div className="space-y-4 rounded-xl border border-ink-200 bg-white p-4">
              <h2 className="font-semibold text-ink-900">{editing ? 'Edit storefront' : 'Publish a storefront'}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Labeled label="Shop name">
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Downtown Counter" className={inputCls} />
                </Labeled>
                <Labeled label="Web address (optional)">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-ink-400">/shop/</span>
                    <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} placeholder="auto from name" className={inputCls} />
                  </div>
                </Labeled>
                <Labeled label="Location">
                  <select value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} className={inputCls}>
                    <option value="">Company-wide catalog</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </Labeled>
                <Labeled label="Header message">
                  <input value={form.headerText} onChange={(e) => setForm({ ...form, headerText: e.target.value })} placeholder="Free delivery over $40 this week" className={inputCls} />
                </Labeled>
                <Labeled label="Delivery fee">
                  <input type="number" min="0" step="0.01" value={form.deliveryFee} onChange={(e) => setForm({ ...form, deliveryFee: e.target.value })} placeholder="0.00" className={inputCls} />
                </Labeled>
                <Labeled label="Minimum order">
                  <input type="number" min="0" step="0.01" value={form.minOrderAmount} onChange={(e) => setForm({ ...form, minOrderAmount: e.target.value })} placeholder="none" className={inputCls} />
                </Labeled>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-400">How customers get their goods</div>
                <div className="flex flex-wrap gap-2">
                  {FULFILLMENT_OPTIONS.map((f) => {
                    const on = form.fulfillmentTypes.includes(f);
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() =>
                          setForm({ ...form, fulfillmentTypes: on ? form.fulfillmentTypes.filter((x: string) => x !== f) : [...form.fulfillmentTypes, f] })
                        }
                        className={`rounded-full border px-3 py-1.5 text-sm ${on ? 'border-transparent bg-ink-900 text-white' : 'border-ink-200 text-ink-600 hover:bg-ink-50'}`}
                      >
                        {on && <Check size={13} className="me-1 inline" />}
                        {f.charAt(0) + f.slice(1).toLowerCase()}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-5">
                <label className="flex items-center gap-2 text-sm text-ink-700">
                  <input type="checkbox" checked={form.payOnPickup} onChange={(e) => setForm({ ...form, payOnPickup: e.target.checked })} />
                  Collect payment on pickup / delivery
                </label>
                <label className="flex items-center gap-2 text-sm text-ink-700">
                  <input type="checkbox" checked={form.isEnabled} onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })} />
                  Live (customers can order now)
                </label>
                <label className="flex items-center gap-2 text-sm text-ink-700">
                  Theme
                  <input type="color" value={form.themeColor} onChange={(e) => setForm({ ...form, themeColor: e.target.value })} className="h-8 w-12 cursor-pointer rounded border border-ink-200" />
                </label>
              </div>

              <div className="flex gap-2">
                <button onClick={save} disabled={busy || !form.name} className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-gold-400 disabled:opacity-50">
                  {editing ? 'Save changes' : 'Create storefront'}
                </button>
                <button
                  onClick={() => {
                    setShowForm(false);
                    setEditing(null);
                    setForm(emptyForm);
                  }}
                  className="rounded-lg border border-ink-200 px-4 py-2 text-sm text-ink-600 hover:bg-ink-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            {rows.map((row) => (
              <div key={row.id} className="rounded-xl border border-ink-100 bg-white p-4 shadow-luxe-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-semibold text-ink-900">{row.name}</h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${row.isEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-ink-100 text-ink-500'}`}
                      >
                        {row.isEnabled ? 'Live' : 'Draft'}
                      </span>
                    </div>
                    <a href={row.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs text-teal-600 hover:underline">
                      {row.url.replace(/^https?:\/\//, '')} <ExternalLink size={12} />
                    </a>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-ink-500">
                      {(row.fulfillmentTypes || []).map((f) => (
                        <span key={f} className="rounded bg-ink-50 px-1.5 py-0.5">
                          {f}
                        </span>
                      ))}
                      {row.deliveryFee ? <span className="rounded bg-ink-50 px-1.5 py-0.5">delivery {money(row.deliveryFee)}</span> : null}
                      {row.minOrderAmount ? <span className="rounded bg-ink-50 px-1.5 py-0.5">min {money(row.minOrderAmount)}</span> : null}
                      {row.payOnPickup ? <span className="rounded bg-ink-50 px-1.5 py-0.5">pay on collection</span> : null}
                    </div>
                  </div>
                  {row.pendingOrders > 0 && (
                    <span className="shrink-0 rounded-full bg-gold-500 px-2 py-1 text-xs font-bold text-ink-950">{row.pendingOrders} new</span>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => startEdit(row)} className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-50">
                    Edit
                  </button>
                  <button onClick={() => toggle(row)} className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-50">
                    <Power size={12} /> {row.isEnabled ? 'Take offline' : 'Publish'}
                  </button>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(row.url);
                      setNotice('Shop link copied.');
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-50"
                  >
                    <Copy size={12} /> Copy link
                  </button>
                  <button onClick={() => remove(row)} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50">
                    <Trash2 size={12} /> Remove
                  </button>
                </div>
              </div>
            ))}
            {!rows.length && (
              <div className="rounded-xl border border-dashed border-ink-200 p-8 text-center text-sm text-ink-400 lg:col-span-2">
                No storefront yet — create one to start taking web orders against your live stock.
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'queue' && (
        <div className="space-y-3">
          {orders.map((order) => {
            const fulfillment = order.fulfillments?.[0];
            const step = STATUS_STEPS.indexOf(order.status);
            return (
              <div key={order.id} className="rounded-xl border border-ink-100 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink-900">{order.orderNumber}</span>
                      <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-ink-500">{order.fulfillmentType}</span>
                      <span className="rounded bg-gold-100 px-1.5 py-0.5 text-[11px] font-medium text-gold-700">{order.status}</span>
                    </div>
                    <div className="mt-1 text-xs text-ink-500">
                      {new Date(order.createdAt).toLocaleString()} ·{' '}
                      {order.customer?.name || fulfillment?.recipientName || 'Guest'}
                      {(order.customer?.phone || fulfillment?.phoneNumber) && <span> · {order.customer?.phone || fulfillment?.phoneNumber}</span>}
                      {(order.customer?.email || fulfillment?.recipientName) && <span> · {order.customer?.email}</span>}
                    </div>
                    {fulfillment?.addressLine1 && (
                      <div className="mt-0.5 flex items-start gap-1 text-xs text-ink-500">
                        <Truck size={12} className="mt-0.5" /> {[fulfillment.addressLine1, fulfillment.addressLine2, fulfillment.city, fulfillment.postalCode, fulfillment.country].filter(Boolean).join(', ')}
                      </div>
                    )}
                    {order.notes && <div className="mt-1 text-xs italic text-ink-400">{order.notes}</div>}
                  </div>
                  <div className="text-end">
                    <div className="font-mono text-lg font-semibold">{money(Number(order.totalAmount), order.currency)}</div>
                    <div className="text-[11px] text-ink-400">{order.items?.reduce((s: number, i: any) => s + i.quantity, 0) ?? 0} items</div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {step === 0 && (
                    <QueueButton onClick={() => setStatus(order, 'PROCESSING')} icon={Clock} label="Start preparing" />
                  )}
                  {(step === 0 || step === 1) && (
                    <QueueButton onClick={() => setStatus(order, 'READY')} icon={PackageCheck} label="Ready" tone="teal" />
                  )}
                  {step >= 0 && step < 3 && (
                    <QueueButton onClick={() => setStatus(order, 'COMPLETED')} icon={Check} label="Completed" tone="emerald" />
                  )}
                  {step < 3 && order.status !== 'CANCELLED' && (
                    <QueueButton onClick={() => setStatus(order, 'CANCELLED')} icon={XCircle} label="Cancel" tone="rose" />
                  )}
                  {step === 3 && <div className="text-xs text-emerald-600">Closed out</div>}
                  {order.status === 'CANCELLED' && <div className="text-xs text-rose-500">Cancelled — stock returned</div>}
                </div>
              </div>
            );
          })}
          {!orders.length && <div className="rounded-xl border border-dashed border-ink-200 p-8 text-center text-sm text-ink-400">No web orders yet.</div>}
        </div>
      )}
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-400';

function money(value: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value) || 0);
  } catch {
    return `$${(Number(value) || 0).toFixed(2)}`;
  }
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-ink-100 bg-white p-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-400">{label}</div>
      <div className="font-display text-xl font-semibold text-ink-900">{value}</div>
    </div>
  );
}

function Tab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={`-mb-px border-b-2 px-3 py-2 text-sm ${active ? 'border-gold-500 font-medium text-ink-900' : 'border-transparent text-ink-400 hover:text-ink-700'}`}>
      {label}
    </button>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-400">{label}</span>
      {children}
    </label>
  );
}

function QueueButton({ onClick, icon: Icon, label, tone = 'ink' }: { onClick: () => void; icon: any; label: string; tone?: 'ink' | 'teal' | 'emerald' | 'rose' }) {
  const tones: Record<string, string> = {
    ink: 'border-ink-200 text-ink-700 hover:bg-ink-50',
    teal: 'border-teal-200 text-teal-700 hover:bg-teal-50',
    emerald: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50',
    rose: 'border-rose-200 text-rose-600 hover:bg-rose-50',
  };
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${tones[tone]}`}>
      <Icon size={13} /> {label}
    </button>
  );
}
