import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Link2, Plus, Copy, XCircle, Trash2, Check } from 'lucide-react';

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  PAID: 'bg-blue-100 text-blue-700',
  CANCELLED: 'bg-gray-100 text-gray-600',
  EXPIRED: 'bg-amber-100 text-amber-700',
};

export default function PaymentLinksPage() {
  const [links, setLinks] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [form, setForm] = useState({ amount: '', currency: 'USD', description: '', maxPayments: '1', expiresAt: '' });
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const res = await api.getPaymentLinks();
      setLinks(res.data || []);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    setError('');
    const amount = Number(form.amount);
    if (!amount || amount <= 0) { setError('Enter a valid amount'); return; }
    try {
      await api.createPaymentLink({
        amount,
        currency: form.currency || 'USD',
        description: form.description || undefined,
        maxPayments: Number(form.maxPayments) || 1,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
      });
      setShowForm(false);
      setForm({ amount: '', currency: 'USD', description: '', maxPayments: '1', expiresAt: '' });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const copy = async (url: string, id: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const cancel = async (id: string) => {
    if (!confirm('Cancel this payment link?')) return;
    await api.cancelPaymentLink(id);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this payment link permanently?')) return;
    await api.deletePaymentLink(id);
    load();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Payment Links</h1>
          <p className="text-gray-500">Create shareable "pay by link" requests — settled through your payment provider</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg hover:bg-violet-700">
          <Plus size={18} /> New Link
        </button>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-2 rounded">{error}</div>}

      {showForm && (
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <h3 className="font-semibold">New Payment Link</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <label className="text-sm">
              <span className="text-gray-500">Amount</span>
              <input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })} className="border rounded px-3 py-2 w-full mt-1" />
            </label>
            <label className="text-sm">
              <span className="text-gray-500">Currency</span>
              <input placeholder="USD" value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} className="border rounded px-3 py-2 w-full mt-1" />
            </label>
            <label className="text-sm">
              <span className="text-gray-500">Max payments</span>
              <input type="number" min="1" value={form.maxPayments}
                onChange={(e) => setForm({ ...form, maxPayments: e.target.value })} className="border rounded px-3 py-2 w-full mt-1" />
            </label>
            <label className="text-sm">
              <span className="text-gray-500">Expires (optional)</span>
              <input type="date" value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} className="border rounded px-3 py-2 w-full mt-1" />
            </label>
          </div>
          <input placeholder="Description (shown to the payer)" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} className="border rounded px-3 py-2 w-full" />
          <button onClick={create} className="bg-violet-600 text-white px-4 py-2 rounded hover:bg-violet-700">Create Link</button>
        </div>
      )}

      <div className="bg-white rounded-lg border">
        <div className="p-4 border-b flex items-center gap-2">
          <Link2 size={18} />
          <h2 className="font-semibold">Links ({links.length})</h2>
        </div>
        <div className="divide-y">
          {links.map((l) => (
            <div key={l.id} className="p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="font-medium truncate">{l.description || `Payment link ${l.token.slice(0, 8)}`}</div>
                <div className="text-sm text-gray-500">
                  {Number(l.amount).toFixed(2)} {l.currency} · {l.paymentCount}/{l.maxPayments} paid
                </div>
                <button onClick={() => copy(l.url, l.id)} className="mt-1 flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800">
                  {copied === l.id ? <Check size={13} /> : <Copy size={13} />}
                  <span className="truncate max-w-[280px]">{l.url}</span>
                </button>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-1 rounded ${STATUS_STYLE[l.status] || 'bg-gray-100 text-gray-600'}`}>{l.status}</span>
                {l.status === 'ACTIVE' && (
                  <button onClick={() => cancel(l.id)} title="Cancel" className="text-amber-500 hover:text-amber-700"><XCircle size={16} /></button>
                )}
                <button onClick={() => remove(l.id)} title="Delete" className="text-red-400 hover:text-red-600"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
          {links.length === 0 && <div className="p-8 text-center text-gray-500">No payment links yet</div>}
        </div>
      </div>
    </div>
  );
}
