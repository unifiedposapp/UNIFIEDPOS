import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Monitor, Tablet, Plus, Copy, ExternalLink, Trash2, RefreshCw, ShieldCheck } from 'lucide-react';

/**
 * Kiosk and customer-display pairing (§7 in-store experience).
 *
 * A paired device authenticates with a token, not a login — so this page is the
 * only place a token is ever shown. The list deliberately shows a preview
 * instead: a stolen tablet is then a support ticket (revoke) rather than a
 * credential leak.
 */

const MODE_LABEL: Record<string, string> = {
  KIOSK: 'Self-service kiosk',
  CUSTOMER_DISPLAY: 'Customer display',
};

export default function KioskPage() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [registers, setRegisters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [paired, setPaired] = useState<any>(null);

  const [form, setForm] = useState({ label: '', mode: 'KIOSK', registerId: '' });

  async function load() {
    setLoading(true);
    try {
      const [sessRes, regRes] = await Promise.all([api.getKioskSessions(), api.getRegisters()]);
      setSessions(sessRes.data || []);
      setRegisters(regRes.data || []);
    } catch (err: any) {
      setError(err?.message || 'Could not load the paired devices');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const deviceUrl = (token: string) => `${window.location.origin}/device/${token}`;

  async function pair() {
    if (!form.label) {
      alert('Give the device a name so you can recognise it later.');
      return;
    }
    setBusy('pair');
    setError('');
    try {
      const res = await api.pairKiosk({
        label: form.label,
        mode: form.mode as 'KIOSK' | 'CUSTOMER_DISPLAY',
        registerId: form.registerId || null,
      });
      setPaired(res.data);
      setForm({ label: '', mode: form.mode, registerId: '' });
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not pair the device');
    } finally {
      setBusy('');
    }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this device? It will have to be paired again to be used.')) return;
    try {
      await api.revokeKiosk(id);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not revoke the device');
    }
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Kiosk &amp; Displays</h1>
          <p className="text-gray-500">
            Pair a self-service kiosk or a customer-facing display — no login needed on the device
          </p>
        </div>
        <button onClick={load} className="p-2 border rounded-lg bg-white hover:bg-gray-50" title="Reload">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {paired && (
        <div className="bg-white rounded-lg border-2 border-green-300 p-6 space-y-3">
          <div className="flex items-center gap-2 font-semibold text-green-800">
            <ShieldCheck size={18} /> Device paired
          </div>
          <p className="text-sm text-gray-700">
            {paired.label} · {MODE_LABEL[paired.mode] ?? paired.mode}. Open this link on the device. The token is
            shown once — pair again if it is lost.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-gray-50 border rounded px-3 py-2 text-xs break-all">
              {deviceUrl(paired.token)}
            </code>
            <button
              onClick={() => copy(deviceUrl(paired.token))}
              className="flex items-center gap-1 px-3 py-2 border rounded text-sm hover:bg-gray-50"
            >
              <Copy size={14} /> Copy
            </button>
            <Link
              to={`/device/${paired.token}`}
              className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
            >
              <ExternalLink size={14} /> Open
            </Link>
          </div>
          <button onClick={() => setPaired(null)} className="text-xs text-gray-500 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg border p-6 space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Plus size={18} /> Pair a device
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="Name this device (e.g. Front counter pole)"
            className="border rounded px-3 py-2 text-sm md:col-span-2"
          />
          <select
            value={form.mode}
            onChange={(e) => setForm({ ...form, mode: e.target.value })}
            className="border rounded px-3 py-2 text-sm"
          >
            <option value="KIOSK">Self-service kiosk</option>
            <option value="CUSTOMER_DISPLAY">Customer display</option>
          </select>
          <select
            value={form.registerId}
            onChange={(e) => setForm({ ...form, registerId: e.target.value })}
            className="border rounded px-3 py-2 text-sm"
          >
            <option value="">No register</option>
            {registers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500 max-w-xl">
            A kiosk shows the catalogue and submits guest orders to the counter. A customer display mirrors the
            cashier&apos;s live basket — the till pushes each change, so the guest never sees a stale total.
          </p>
          <button
            onClick={pair}
            disabled={busy === 'pair'}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            {busy === 'pair' ? 'Pairing…' : 'Pair device'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold">Paired devices</div>
        {sessions.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">No devices paired yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2">Device</th>
                <th className="text-left px-4 py-2">Mode</th>
                <th className="text-left px-4 py-2">Token</th>
                <th className="text-left px-4 py-2">Last seen</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2 font-medium">{s.label}</td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-1 text-xs text-gray-700">
                      {s.mode === 'KIOSK' ? <Tablet size={12} /> : <Monitor size={12} />}
                      {MODE_LABEL[s.mode] ?? s.mode}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{s.tokenPreview}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : 'Never'}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        s.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {s.status === 'ACTIVE' && (
                      <button
                        onClick={() => revoke(s.id)}
                        className="text-gray-400 hover:text-rose-600"
                        title="Revoke"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
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
