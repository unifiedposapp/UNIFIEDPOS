import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { QrCode, UtensilsCrossed, Percent, Copy, Check, Plus, RefreshCw, Trash2 } from 'lucide-react';
import clsx from 'clsx';

type Tab = 'qr' | 'catering' | 'foodcost';

const CATERING_STATUS = ['PENDING', 'CONFIRMED', 'PREPARING', 'DELIVERED', 'CANCELLED'];

export default function RestaurantOpsPage() {
  const [tab, setTab] = useState<Tab>('qr');
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Restaurant Operations</h1>
        <p className="text-gray-500">Scan-to-order QR codes, catering orders, and food-cost analysis (§17)</p>
      </div>
      <div className="flex gap-2 border-b">
        {([['qr', 'QR Ordering', QrCode], ['catering', 'Catering', UtensilsCrossed], ['foodcost', 'Food Cost', Percent]] as [Tab, string, any][]).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={clsx('flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px',
              tab === id ? 'border-violet-600 text-violet-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700')}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>
      {tab === 'qr' && <QrTab />}
      {tab === 'catering' && <CateringTab />}
      {tab === 'foodcost' && <FoodCostTab />}
    </div>
  );
}

// ─── QR ordering ─────────────────────────────────────────────────────────────
function QrTab() {
  const [tables, setTables] = useState<any[]>([]);
  const [tokens, setTokens] = useState<Record<string, { qrToken: string | null; url: string | null }>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const load = async () => {
    const res = await api.getRestaurantTables();
    const list = res.data || [];
    setTables(list);
    const entries = await Promise.all(list.map(async (t: any) => {
      try {
        const r = await api.getTableQrToken(t.id);
        return [t.id, { qrToken: r.data?.qrToken ?? null, url: r.data?.url ?? null }] as const;
      } catch {
        return [t.id, { qrToken: null, url: null }] as const;
      }
    }));
    setTokens(Object.fromEntries(entries));
  };

  useEffect(() => { load(); }, []);

  const generate = async (id: string) => { await api.createTableQrToken(id); load(); };
  const revoke = async (id: string) => { if (!confirm('Disable scan-to-order for this table?')) return; await api.revokeTableQrToken(id); load(); };
  const copy = async (url: string, id: string) => {
    try { await navigator.clipboard.writeText(url); setCopied(id); setTimeout(() => setCopied(null), 1500); } catch { /* noop */ }
  };

  return (
    <div className="bg-white rounded-lg border">
      <div className="p-4 border-b flex items-center gap-2">
        <QrCode size={18} />
        <h2 className="font-semibold">Tables ({tables.length})</h2>
        <button onClick={load} className="ml-auto text-gray-400 hover:text-gray-600"><RefreshCw size={16} /></button>
      </div>
      <div className="divide-y">
        {tables.map((t) => {
          const tk = tokens[t.id];
          return (
            <div key={t.id} className="p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="font-medium">Table {t.number}{t.name ? ` · ${t.name}` : ''}</div>
                <div className="text-xs text-gray-500">Seats {t.capacity ?? '—'} · {t.status}</div>
                {tk?.url && (
                  <button onClick={() => copy(tk.url!, t.id)} className="mt-1 flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800">
                    {copied === t.id ? <Check size={13} /> : <Copy size={13} />}
                    <span className="truncate max-w-[320px]">{tk.url}</span>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => generate(t.id)} className="flex items-center gap-1 text-xs bg-violet-50 border border-violet-200 text-violet-700 px-3 py-1.5 rounded hover:bg-violet-100">
                  <Plus size={14} /> {tk?.qrToken ? 'Rotate QR' : 'Generate QR'}
                </button>
                {tk?.qrToken && (
                  <button onClick={() => revoke(t.id)} className="text-red-400 hover:text-red-600" title="Revoke"><Trash2 size={16} /></button>
                )}
              </div>
            </div>
          );
        })}
        {tables.length === 0 && <div className="p-8 text-center text-gray-500">No tables yet — add tables on the Restaurant page</div>}
      </div>
      <p className="p-4 text-xs text-gray-400 border-t">
        Print each URL as a QR code and place it on the table. Guests scan, browse the live menu, and send orders straight to the kitchen.
      </p>
    </div>
  );
}

// ─── Catering ────────────────────────────────────────────────────────────────
function CateringTab() {
  const [orders, setOrders] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ contactName: '', contactPhone: '', eventDate: '', guests: '', menuPackage: '', total: '', deposit: '', notes: '' });

  const load = async () => { const res = await api.getCateringOrders(); setOrders(res.data || []); };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.contactName || !form.eventDate || !Number(form.guests)) { alert('Contact name, event date and guests are required'); return; }
    await api.createCateringOrder({
      contactName: form.contactName,
      contactPhone: form.contactPhone || undefined,
      eventDate: new Date(form.eventDate).toISOString(),
      guests: Number(form.guests),
      menuPackage: form.menuPackage || undefined,
      total: form.total ? Number(form.total) : undefined,
      deposit: form.deposit ? Number(form.deposit) : undefined,
      notes: form.notes || undefined,
    });
    setShowForm(false);
    setForm({ contactName: '', contactPhone: '', eventDate: '', guests: '', menuPackage: '', total: '', deposit: '', notes: '' });
    load();
  };

  const setStatus = async (id: string, status: string) => { await api.updateCateringStatus(id, status); load(); };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg hover:bg-violet-700">
          <Plus size={18} /> New Catering Order
        </button>
      </div>
      {showForm && (
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <input placeholder="Contact name" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} className="border rounded px-3 py-2" />
            <input placeholder="Phone" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} className="border rounded px-3 py-2" />
            <input type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} className="border rounded px-3 py-2" />
            <input type="number" min="1" placeholder="Guests" value={form.guests} onChange={(e) => setForm({ ...form, guests: e.target.value })} className="border rounded px-3 py-2" />
            <input placeholder="Menu package" value={form.menuPackage} onChange={(e) => setForm({ ...form, menuPackage: e.target.value })} className="border rounded px-3 py-2" />
            <input type="number" min="0" step="0.01" placeholder="Total" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} className="border rounded px-3 py-2" />
            <input type="number" min="0" step="0.01" placeholder="Deposit" value={form.deposit} onChange={(e) => setForm({ ...form, deposit: e.target.value })} className="border rounded px-3 py-2" />
            <input placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="border rounded px-3 py-2" />
          </div>
          <button onClick={create} className="bg-violet-600 text-white px-4 py-2 rounded hover:bg-violet-700">Create</button>
        </div>
      )}

      <div className="bg-white rounded-lg border">
        <div className="p-4 border-b flex items-center gap-2">
          <UtensilsCrossed size={18} /><h2 className="font-semibold">Catering Orders ({orders.length})</h2>
        </div>
        <div className="divide-y">
          {orders.map((o) => (
            <div key={o.id} className="p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="font-medium">{o.contactName} · {o.guests} guests</div>
                <div className="text-sm text-gray-500">
                  {new Date(o.eventDate).toLocaleDateString()} {o.menuPackage ? `· ${o.menuPackage}` : ''}
                </div>
                <div className="text-xs text-gray-400">{Number(o.total).toFixed(2)} total · {Number(o.deposit).toFixed(2)} deposit</div>
              </div>
              <select value={o.status} onChange={(e) => setStatus(o.id, e.target.value)} className="border rounded px-3 py-1.5 text-sm">
                {CATERING_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          ))}
          {orders.length === 0 && <div className="p-8 text-center text-gray-500">No catering orders</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Food cost ───────────────────────────────────────────────────────────────
function FoodCostTab() {
  const [target, setTarget] = useState(35);
  const [data, setData] = useState<any>(null);

  const load = async () => { const res = await api.getFoodCostAnalysis(target); setData(res.data); };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-500">Target food-cost %</label>
        <input type="number" min="1" max="95" value={target} onChange={(e) => setTarget(Number(e.target.value))} className="border rounded px-3 py-1.5 w-24 text-sm" />
        <button onClick={load} className="flex items-center gap-1 bg-violet-600 text-white px-3 py-1.5 rounded text-sm hover:bg-violet-700">
          <RefreshCw size={14} /> Analyze
        </button>
        {data && <span className="text-xs text-gray-400">source: {data.source}</span>}
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Items" value={String(data.summary.itemCount)} />
            <Stat label="Avg food-cost %" value={`${data.summary.avgFoodCostPct}%`} />
            <Stat label="Avg margin %" value={`${data.summary.avgMarginPct}%`} />
            <Stat label="Above target" value={String(data.summary.aboveTargetCount)} tone={data.summary.aboveTargetCount > 0 ? 'bad' : 'good'} />
          </div>
          <div className="bg-white rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-start text-gray-500">
                <tr>
                  <th className="p-3">Item</th><th className="p-3">Category</th>
                  <th className="p-3 text-end">Sell</th><th className="p-3 text-end">Cost</th>
                  <th className="p-3 text-end">Food-cost %</th><th className="p-3 text-end">Margin %</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.items.map((r: any) => (
                  <tr key={r.productId} className={clsx(r.aboveTarget && 'bg-rose-50')}>
                    <td className="p-3 font-medium">{r.name}</td>
                    <td className="p-3 text-gray-500">{r.category || '—'}</td>
                    <td className="p-3 text-end">{r.sellPrice.toFixed(2)}</td>
                    <td className="p-3 text-end">{r.costPrice.toFixed(2)}</td>
                    <td className={clsx('p-3 text-end font-medium', r.aboveTarget ? 'text-rose-600' : 'text-emerald-600')}>{r.foodCostPct}%</td>
                    <td className="p-3 text-end">{r.marginPct}%</td>
                  </tr>
                ))}
                {data.items.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-gray-500">No menu items or products</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className={clsx('text-2xl font-bold', tone === 'bad' ? 'text-rose-600' : tone === 'good' ? 'text-emerald-600' : '')}>{value}</div>
    </div>
  );
}
