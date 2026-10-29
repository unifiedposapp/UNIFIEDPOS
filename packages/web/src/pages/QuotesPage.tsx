import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { FileText, Plus, Trash2, Send, CheckCircle, XCircle, ArrowRightLeft } from 'lucide-react';

/**
 * Quotes / estimates (§17 B2B selling).
 *
 * A quote is a priced, expiring promise that can become an order without anyone
 * re-keying the basket. Every total shown here was computed by the server from
 * the lines, so what the customer receives on paper is what the order will carry.
 */
export default function QuotesPage() {
  const [quotes, setQuotes] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<{ productId: string; quantity: string; unitPrice: string }[]>([
    { productId: '', quantity: '1', unitPrice: '' },
  ]);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      const [quoteRes, custRes, prodRes] = await Promise.all([
        api.getQuotes(params),
        api.getCustomers({ pageSize: '200' }),
        api.getProducts({ pageSize: '200' }),
      ]);
      setQuotes(quoteRes.data || []);
      setCustomers(custRes.data?.items || []);
      setProducts(prodRes.data?.items || []);
    } catch (err: any) {
      console.error('Failed to load quotes:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  function resetForm() {
    setCustomerId('');
    setValidUntil('');
    setNotes('');
    setLines([{ productId: '', quantity: '1', unitPrice: '' }]);
    setShowForm(false);
  }

  async function createQuote() {
    const clean = lines
      .filter((l) => l.productId && Number(l.quantity) > 0)
      .map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity),
        // A blank price means "use the catalog price", which the server decides.
        ...(l.unitPrice ? { unitPrice: Number(l.unitPrice) } : {}),
      }));
    if (clean.length === 0) {
      alert('Add at least one line with a product and a quantity.');
      return;
    }

    setSaving(true);
    try {
      await api.createQuote({
        customerId: customerId || null,
        validUntil: validUntil || null,
        notes: notes || null,
        lines: clean,
      });
      resetForm();
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not create the quote');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(id: string, status: string) {
    try {
      await api.setQuoteStatus(id, { status });
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not update the quote');
    }
  }

  async function convert(id: string) {
    if (!confirm('Turn this quote into a draft order?')) return;
    try {
      const res = await api.convertQuote(id);
      alert(`Order ${res.data?.order?.orderNumber ?? ''} created from the quote.`);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not convert the quote');
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this quote?')) return;
    try {
      await api.deleteQuote(id);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not delete the quote');
    }
  }

  const statusStyle = (status: string) =>
    status === 'ACCEPTED'
      ? 'bg-green-100 text-green-800'
      : status === 'DECLINED'
        ? 'bg-rose-100 text-rose-800'
        : status === 'CONVERTED'
          ? 'bg-blue-100 text-blue-800'
          : status === 'SENT'
            ? 'bg-amber-100 text-amber-800'
            : 'bg-gray-100 text-gray-600';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Quotes &amp; Estimates</h1>
          <p className="text-gray-500">Price a job, send it, and turn the accepted ones into orders</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="SENT">Sent</option>
            <option value="ACCEPTED">Accepted</option>
            <option value="DECLINED">Declined</option>
            <option value="CONVERTED">Converted</option>
          </select>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            <Plus size={18} /> New quote
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg border p-6 space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileText size={18} /> New quote
          </h2>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Customer</label>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
              >
                <option value="">Walk-in / no account</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Valid until</label>
              <input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Scope, lead time, terms…"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={index} className="flex items-center gap-2">
                <select
                  value={line.productId}
                  onChange={(e) => {
                    const next = [...lines];
                    next[index] = { ...next[index], productId: e.target.value };
                    setLines(next);
                  }}
                  className="flex-1 border rounded px-3 py-2 text-sm"
                >
                  <option value="">Select a product…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — ${Number(p.price).toFixed(2)}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={line.quantity}
                  onChange={(e) => {
                    const next = [...lines];
                    next[index] = { ...next[index], quantity: e.target.value };
                    setLines(next);
                  }}
                  placeholder="Qty"
                  className="w-24 border rounded px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.unitPrice}
                  onChange={(e) => {
                    const next = [...lines];
                    next[index] = { ...next[index], unitPrice: e.target.value };
                    setLines(next);
                  }}
                  placeholder="Catalog price"
                  className="w-32 border rounded px-3 py-2 text-sm"
                />
                <button
                  onClick={() => setLines(lines.filter((_, i) => i !== index))}
                  disabled={lines.length === 1}
                  className="p-2 text-rose-600 hover:bg-rose-50 rounded disabled:opacity-30"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button
              onClick={() => setLines([...lines, { productId: '', quantity: '1', unitPrice: '' }])}
              className="text-sm text-blue-600 hover:underline"
            >
              + Add another line
            </button>
          </div>

          <div className="flex gap-2">
            <button onClick={resetForm} className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300">
              Cancel
            </button>
            <button
              onClick={createQuote}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save quote'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border overflow-hidden">
        {loading ? (
          <p className="p-6 text-gray-500">Loading quotes…</p>
        ) : quotes.length === 0 ? (
          <p className="p-6 text-gray-500">No quotes yet. Create one to price a job for a customer.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3">Quote</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Lines</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Valid until</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {quotes.map((q) => (
                <tr key={q.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{q.quoteNumber}</td>
                  <td className="px-4 py-3">{q.customer?.name || q.customerName || '—'}</td>
                  <td className="px-4 py-3">{q.lines?.length ?? q._count?.lines ?? 0}</td>
                  <td className="px-4 py-3 text-right font-medium">
                    {q.currency} {Number(q.totalAmount).toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded ${statusStyle(q.status)}`}>{q.status}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {q.validUntil ? new Date(q.validUntil).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {q.status === 'DRAFT' && (
                        <button
                          onClick={() => setStatus(q.id, 'SENT')}
                          title="Mark as sent"
                          className="p-1.5 rounded hover:bg-amber-50 text-amber-700"
                        >
                          <Send size={16} />
                        </button>
                      )}
                      {(q.status === 'DRAFT' || q.status === 'SENT') && (
                        <>
                          <button
                            onClick={() => setStatus(q.id, 'ACCEPTED')}
                            title="Mark as accepted"
                            className="p-1.5 rounded hover:bg-green-50 text-green-700"
                          >
                            <CheckCircle size={16} />
                          </button>
                          <button
                            onClick={() => setStatus(q.id, 'DECLINED')}
                            title="Mark as declined"
                            className="p-1.5 rounded hover:bg-rose-50 text-rose-700"
                          >
                            <XCircle size={16} />
                          </button>
                        </>
                      )}
                      {['DRAFT', 'SENT', 'ACCEPTED'].includes(q.status) && (
                        <button
                          onClick={() => convert(q.id)}
                          title="Convert to an order"
                          className="p-1.5 rounded hover:bg-blue-50 text-blue-700"
                        >
                          <ArrowRightLeft size={16} />
                        </button>
                      )}
                      {q.status !== 'CONVERTED' && (
                        <button
                          onClick={() => remove(q.id)}
                          title="Delete"
                          className="p-1.5 rounded hover:bg-rose-50 text-rose-600"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
