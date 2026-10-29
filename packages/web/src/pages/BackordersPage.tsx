import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PackageSearch, Plus, BellRing, CheckCircle2, Ban, RefreshCw } from 'lucide-react';

/**
 * Backorders / special orders (§12 retail parity).
 *
 * The shelf is empty; the sale becomes a promise. Each row is who is owed what,
 * since when, and how much deposit they left. Stock only moves at fulfilment,
 * because until then the unit does not exist on the shelf.
 */
export default function BackordersPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    productId: '',
    customerId: '',
    quantity: '1',
    unitPrice: '',
    depositAmount: '',
    expectedAt: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      const [listRes, sumRes, prodRes, custRes] = await Promise.all([
        api.getBackorders(params),
        api.getBackorderSummary(),
        api.getProducts({ pageSize: '200' }),
        api.getCustomers({ pageSize: '200' }),
      ]);
      setRows(listRes.data || []);
      setSummary(sumRes.data);
      setProducts(prodRes.data?.items || []);
      setCustomers(custRes.data?.items || []);
    } catch (err: any) {
      console.error('Failed to load backorders:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function create() {
    if (!form.productId) {
      alert('Choose the product the customer is waiting for.');
      return;
    }
    setSaving(true);
    try {
      await api.createBackorder({
        productId: form.productId,
        customerId: form.customerId || null,
        quantity: Number(form.quantity),
        expectedAt: form.expectedAt || null,
        depositAmount: form.depositAmount ? Number(form.depositAmount) : 0,
        unitPrice: form.unitPrice ? Number(form.unitPrice) : null,
        notes: form.notes || null,
      });
      setShowForm(false);
      setForm({ productId: '', customerId: '', quantity: '1', unitPrice: '', depositAmount: '', expectedAt: '', notes: '' });
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not record the backorder');
    } finally {
      setSaving(false);
    }
  }

  async function fulfill(row: any) {
    const input = window.prompt(
      `How many units are being handed over? (${row.outstandingQty} outstanding)`,
      String(row.outstandingQty),
    );
    if (input === null) return;
    const quantity = Number(input);
    if (!(quantity > 0)) return;
    try {
      await api.fulfillBackorder(row.id, { quantity });
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not fulfil the backorder');
    }
  }

  async function notify(row: any) {
    try {
      await api.notifyBackorder(row.id);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not notify the customer');
    }
  }

  async function cancel(row: any) {
    if (!confirm('Cancel this backorder? The deposit record stays for the refund trail.')) return;
    try {
      await api.cancelBackorder(row.id);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not cancel the backorder');
    }
  }

  const overdue = (row: any) => row.expectedAt && new Date(row.expectedAt) < new Date() && row.status !== 'FULFILLED';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Backorders</h1>
          <p className="text-gray-500">What the store still owes, and to whom</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} className="flex items-center gap-2 border px-3 py-2 rounded-lg text-sm hover:bg-gray-50">
            <RefreshCw size={16} /> Refresh
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            <Plus size={18} /> Take a promise
          </button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-lg border p-4">
            <p className="text-sm text-gray-500">Open promises</p>
            <p className="text-2xl font-bold">{summary.openPromises}</p>
          </div>
          <div className={`rounded-lg border p-4 ${summary.overdue > 0 ? 'bg-rose-50 border-rose-200' : 'bg-white'}`}>
            <p className="text-sm text-gray-500">Past the promised date</p>
            <p className={`text-2xl font-bold ${summary.overdue > 0 ? 'text-rose-700' : ''}`}>{summary.overdue}</p>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <p className="text-sm text-gray-500">Distinct SKUs owed</p>
            <p className="text-2xl font-bold">{summary.products?.length ?? 0}</p>
          </div>
        </div>
      )}

      {summary?.products?.length > 0 && (
        <div className="bg-white rounded-lg border p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Owed by product</h2>
          <div className="flex flex-wrap gap-2">
            {summary.products.slice(0, 24).map((p: any) => (
              <span key={p.productId} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">
                {p.productName} · <strong>{p.outstandingQty}</strong> ({p.promises})
              </span>
            ))}
          </div>
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-lg border p-6 space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <PackageSearch size={18} /> New backorder
          </h2>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Product</label>
              <select
                value={form.productId}
                onChange={(e) => setForm({ ...form, productId: e.target.value })}
                className="w-full border rounded px-3 py-2 text-sm"
              >
                <option value="">Select a product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Customer</label>
              <select
                value={form.customerId}
                onChange={(e) => setForm({ ...form, customerId: e.target.value })}
                className="w-full border rounded px-3 py-2 text-sm"
              >
                <option value="">No account</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Quantity</label>
              <input
                type="number"
                min="0.001"
                step="0.001"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Agreed unit price</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.unitPrice}
                onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
                placeholder="Catalog price"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Deposit taken</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.depositAmount}
                onChange={(e) => setForm({ ...form, depositAmount: e.target.value })}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Expected</label>
              <input
                type="date"
                value={form.expectedAt}
                onChange={(e) => setForm({ ...form, expectedAt: e.target.value })}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
          <input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Notes for the customer or the buyer"
            className="w-full border rounded px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300">
              Cancel
            </button>
            <button
              onClick={create}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Record backorder'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="font-semibold">Promises</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm"
          >
            <option value="">Open (default)</option>
            <option value="OPEN">Open</option>
            <option value="PARTIALLY_FULFILLED">Partially fulfilled</option>
            <option value="FULFILLED">Fulfilled</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>

        {loading ? (
          <p className="p-6 text-gray-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-gray-500">Nothing is owed right now.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3 text-right">Outstanding</th>
                <th className="px-4 py-3 text-right">Deposit</th>
                <th className="px-4 py-3">Expected</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.id} className={overdue(row) ? 'bg-rose-50' : 'hover:bg-gray-50'}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{row.productName}</p>
                    <p className="text-xs text-gray-500">
                      ordered {row.quantity} {row.uom}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {row.customer?.name || '—'}
                    {row.customer?.phone && <p className="text-xs text-gray-500">{row.customer.phone}</p>}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{row.outstandingQty}</td>
                  <td className="px-4 py-3 text-right">${Number(row.depositAmount).toFixed(2)}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {row.expectedAt ? new Date(row.expectedAt).toLocaleDateString() : '—'}
                    {overdue(row) && <span className="ms-1 text-xs text-rose-700">overdue</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        row.status === 'OPEN'
                          ? 'bg-amber-100 text-amber-800'
                          : row.status === 'PARTIALLY_FULFILLED'
                            ? 'bg-blue-100 text-blue-800'
                            : row.status === 'FULFILLED'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {['OPEN', 'PARTIALLY_FULFILLED'].includes(row.status) && (
                        <>
                          <button
                            onClick={() => fulfill(row)}
                            title="Hand over stock"
                            className="p-1.5 rounded hover:bg-green-50 text-green-700"
                          >
                            <CheckCircle2 size={16} />
                          </button>
                          <button
                            onClick={() => notify(row)}
                            title="Tell the customer it is ready"
                            className="p-1.5 rounded hover:bg-blue-50 text-blue-700"
                          >
                            <BellRing size={16} />
                          </button>
                          <button
                            onClick={() => cancel(row)}
                            title="Cancel"
                            className="p-1.5 rounded hover:bg-rose-50 text-rose-600"
                          >
                            <Ban size={16} />
                          </button>
                        </>
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
