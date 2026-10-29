import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { CreditCard, Plus, RefreshCw, Trash2, Receipt, XCircle, Undo2, Banknote } from 'lucide-react';

/**
 * Card-present payments (Stripe Terminal).
 *
 * Every other charge in this product is tokenised, which is fine for the web and
 * useless at a counter where the guest taps a physical card. This page pairs the
 * readers, starts the charge, and — for restaurants — captures at the tipped
 * total once the guest has written it down.
 */
export default function TerminalPage() {
  const [provider, setProvider] = useState<any>(null);
  const [readers, setReaders] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ label: '', registrationCode: '', deviceType: 'CHIPPER_2X' });
  const [saving, setSaving] = useState(false);

  // Manual charge against an order id, for when the till sends the guest to a
  // reader this workstation cannot drive directly.
  const [chargeOrderId, setChargeOrderId] = useState('');
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeReaderId, setChargeReaderId] = useState('');
  const [chargeManual, setChargeManual] = useState(false);
  const [charging, setCharging] = useState(false);

  async function load(refresh = false) {
    setLoading(true);
    try {
      const [providerRes, readerRes, pendingRes] = await Promise.all([
        api.getTerminalProvider(),
        api.getTerminalReaders(refresh),
        api.getPendingTerminalPayments(),
      ]);
      setProvider(providerRes.data);
      setReaders(readerRes.data || []);
      setPending(pendingRes.data || []);
    } catch (err: any) {
      console.error('Failed to load terminal state:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function refreshReaders() {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  }

  async function register() {
    if (!form.label.trim() || !form.registrationCode.trim()) {
      alert('A reader needs both a name you recognise and the pairing code from its screen.');
      return;
    }
    setSaving(true);
    try {
      const res = await api.registerTerminalReader({
        label: form.label.trim(),
        registrationCode: form.registrationCode.trim(),
        deviceType: form.deviceType,
      });
      if (res.simulated) {
        alert('Reader registered in simulation mode — set STRIPE_SECRET_KEY to drive real hardware.');
      }
      setShowForm(false);
      setForm({ label: '', registrationCode: '', deviceType: 'CHIPPER_2X' });
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not register the reader');
    } finally {
      setSaving(false);
    }
  }

  async function removeReader(id: string) {
    if (!confirm('Unregister this reader? It will stop accepting charges from this store.')) return;
    try {
      await api.deleteTerminalReader(id);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not unregister the reader');
    }
  }

  async function charge() {
    if (!chargeOrderId.trim()) {
      alert('Enter the order this payment settles.');
      return;
    }
    setCharging(true);
    try {
      const res = await api.chargeTerminal({
        orderId: chargeOrderId.trim(),
        ...(chargeAmount ? { amount: Number(chargeAmount) } : {}),
        ...(chargeReaderId ? { readerId: chargeReaderId } : {}),
        captureMethod: chargeManual ? 'manual' : 'automatic',
      });
      alert(
        res.data?.payment?.status === 'AUTHORIZED'
          ? 'Card authorised. Capture it with the tip once the guest has signed.'
          : 'Payment taken on the reader.',
      );
      setChargeOrderId('');
      setChargeAmount('');
      await load();
    } catch (err: any) {
      alert(err?.message || 'The reader did not complete the charge');
    } finally {
      setCharging(false);
    }
  }

  async function capture(row: any) {
    const authorised = Number(row.amount);
    const input = window.prompt(
      `Tip to add (authorisation was ${authorised.toFixed(2)}; a capture may not exceed it by more than 20%):`,
      '0',
    );
    if (input === null) return;
    const tip = Number(input) || 0;
    if (tip < 0) return;
    try {
      const res = await api.captureTerminalPayment(row.id, { tipAmount: tip, amount: Number((authorised + tip).toFixed(2)) });
      alert(`Captured ${Number(res.data?.captured?.amount ?? authorised + tip).toFixed(2)} (tip ${Number(res.data?.tip ?? tip).toFixed(2)}).`);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not capture the authorisation');
    }
  }

  async function cancelPayment(row: any) {
    if (!confirm('Release this authorisation? The guest will need to pay again.')) return;
    try {
      await api.cancelTerminalPayment(row.id);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not cancel the authorisation');
    }
  }

  async function refund(row: any) {
    const input = window.prompt(`Refund how much of ${Number(row.amount).toFixed(2)}?`, String(Number(row.amount).toFixed(2)));
    if (input === null) return;
    const amount = Number(input);
    if (!(amount > 0)) return;
    const reason = window.prompt('Reason for the refund (kept on the audit trail):', 'Customer request') || undefined;
    try {
      await api.refundTerminalPayment(row.id, { amount, reason });
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not refund the payment');
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Card-Present Terminals</h1>
          <p className="text-gray-500">Pair readers, take the tap, capture at the tipped total</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refreshReaders}
            disabled={refreshing}
            className="flex items-center gap-2 border px-3 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Reconcile
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            <Plus size={18} /> Register reader
          </button>
        </div>
      </div>

      <div className={`rounded-lg border p-4 ${provider?.configured ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
        <p className="text-sm font-medium">
          {provider?.configured ? 'Live processor connected' : 'Simulation mode'}
          <span className="ms-2 font-normal text-gray-600">provider: {provider?.provider ?? 'unknown'}</span>
        </p>
        <p className="text-xs text-gray-600 mt-1">
          {provider?.configured
            ? 'Charges are sent to the real reader and settle against your merchant account.'
            : 'No STRIPE_SECRET_KEY is set, so charges are simulated deterministically. Pairing, capture and tip adjustment all behave normally — only the money is pretend.'}
        </p>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg border p-6 space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <CreditCard size={18} /> Pair a reader
          </h2>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name on the shop floor</label>
              <input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Counter 2"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Registration code</label>
              <input
                value={form.registrationCode}
                onChange={(e) => setForm({ ...form, registrationCode: e.target.value })}
                placeholder="From the reader's screen"
                className="w-full border rounded px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Device type</label>
              <select
                value={form.deviceType}
                onChange={(e) => setForm({ ...form, deviceType: e.target.value })}
                className="w-full border rounded px-3 py-2 text-sm"
              >
                <option value="CHIPPER_2X">Stripe Reader M2</option>
                <option value="WISEPOS_E">WisePOS E</option>
                <option value="WISEPAD_3">WisePad 3</option>
                <option value="VERIFONE_P400">Verifone P400</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300">
              Cancel
            </button>
            <button
              onClick={register}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Pairing…' : 'Register'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border overflow-hidden">
        <h2 className="px-4 py-3 border-b font-semibold">Readers</h2>
        {loading ? (
          <p className="p-6 text-gray-500">Loading…</p>
        ) : readers.length === 0 ? (
          <p className="p-6 text-gray-500">No readers paired yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Device</th>
                <th className="px-4 py-3">Serial</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last seen</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {readers.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{r.label}</td>
                  <td className="px-4 py-3">{r.deviceType}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.serialNumber || '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        r.status === 'ONLINE'
                          ? 'bg-green-100 text-green-800'
                          : r.status === 'DISABLED'
                            ? 'bg-gray-200 text-gray-700'
                            : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {r.lastSeenAt ? new Date(r.lastSeenAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => removeReader(r.id)} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-white rounded-lg border p-6 space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Banknote size={18} /> Charge an order
        </h2>
        <div className="grid grid-cols-4 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Order ID</label>
            <input
              value={chargeOrderId}
              onChange={(e) => setChargeOrderId(e.target.value)}
              placeholder="Paste the order id from the order screen"
              className="w-full border rounded px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Amount (blank = balance)</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={chargeAmount}
              onChange={(e) => setChargeAmount(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Reader</label>
            <select
              value={chargeReaderId}
              onChange={(e) => setChargeReaderId(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value="">Any online reader</option>
              {readers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={chargeManual} onChange={(e) => setChargeManual(e.target.checked)} />
          Authorise only (manual capture) — for a tab or a table that will add a tip
        </label>
        <button
          onClick={charge}
          disabled={charging}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {charging ? 'Sending to reader…' : 'Charge'}
        </button>
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <h2 className="px-4 py-3 border-b font-semibold flex items-center gap-2">
          <Receipt size={16} /> Awaiting capture ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="p-6 text-gray-500">Nothing is held open.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3 text-right">Authorised</th>
                <th className="px-4 py-3">Taken</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pending.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{p.order?.orderNumber ?? p.orderId}</td>
                  <td className="px-4 py-3 text-right font-medium">${Number(p.amount).toFixed(2)}</td>
                  <td className="px-4 py-3 text-gray-600">{new Date(p.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => capture(p)}
                        title="Capture with tip"
                        className="p-1.5 rounded hover:bg-green-50 text-green-700"
                      >
                        <CreditCard size={16} />
                      </button>
                      <button
                        onClick={() => cancelPayment(p)}
                        title="Release the hold"
                        className="p-1.5 rounded hover:bg-rose-50 text-rose-600"
                      >
                        <XCircle size={16} />
                      </button>
                      <button
                        onClick={() => refund(p)}
                        title="Refund"
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-700"
                      >
                        <Undo2 size={16} />
                      </button>
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
