import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Globe, Plus, RefreshCw, Trash2, PlugZap, ArrowDownToLine, ArrowUpFromLine, Link2, ListTree } from 'lucide-react';

/**
 * Sales-channel connectors (Shopify / WooCommerce / BigCommerce).
 *
 * This is a connector, not a directory: the credential is encrypted at rest, the
 * calls are real, and the imports are idempotent. A failed pull says why rather
 * than flipping a green tick.
 */
export default function ChannelsPage() {
  const [providers, setProviders] = useState<any[]>([]);
  const [connections, setConnections] = useState<any[]>([]);
  const [logs, setLogs] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>('');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    provider: 'SHOPIFY',
    label: '',
    shopDomain: '',
    accessToken: '',
    webhookSecret: '',
    apiVersion: '',
  });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [provRes, connRes] = await Promise.all([api.getChannelProviders(), api.getChannelConnections()]);
      setProviders(provRes.data || []);
      setConnections(connRes.data || []);
    } catch (err: any) {
      console.error('Failed to load channels:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const selectedProvider = providers.find((p) => p.provider === form.provider);

  async function create() {
    if (!form.label.trim() || !form.shopDomain.trim()) {
      alert('A channel needs a name you recognise and the store domain.');
      return;
    }
    setSaving(true);
    try {
      await api.createChannelConnection({
        provider: form.provider,
        label: form.label.trim(),
        shopDomain: form.shopDomain.trim(),
        accessToken: form.accessToken.trim() || undefined,
        webhookSecret: form.webhookSecret.trim() || null,
        apiVersion: form.apiVersion.trim() || null,
      });
      setShowForm(false);
      setForm({ provider: 'SHOPIFY', label: '', shopDomain: '', accessToken: '', webhookSecret: '', apiVersion: '' });
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not save the channel');
    } finally {
      setSaving(false);
    }
  }

  async function test(id: string) {
    setBusy(`test:${id}`);
    try {
      const res = await api.testChannelConnection(id);
      alert(res.data?.message || (res.data?.ok ? 'The store answered.' : 'The store did not answer.'));
      await load();
    } catch (err: any) {
      alert(err?.message || 'The store did not answer');
    } finally {
      setBusy('');
    }
  }

  async function sync(id: string, direction: 'PUSH' | 'PULL', entity: 'PRODUCTS' | 'ORDERS' | 'INVENTORY') {
    setBusy(`sync:${id}`);
    try {
      const res = await api.syncChannel(id, { direction, entity, createMissing: direction === 'PULL' && entity === 'PRODUCTS' });
      const d = res.data || {};
      alert(`${direction} ${entity}: ${d.processed ?? 0} processed, ${d.failed ?? 0} failed.${d.message ? ` ${d.message}` : ''}`);
      await load();
    } catch (err: any) {
      alert(err?.message || 'The sync did not finish');
    } finally {
      setBusy('');
    }
  }

  async function showLogs(id: string) {
    try {
      const res = await api.getChannelLogs(id);
      setLogs((prev) => ({ ...prev, [id]: res.data || [] }));
    } catch (err: any) {
      alert(err?.message || 'Could not load the sync log');
    }
  }

  async function remove(id: string) {
    if (!confirm('Remove this channel? Mappings and history are removed with it.')) return;
    try {
      await api.deleteChannelConnection(id);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not remove the channel');
    }
  }

  const webhookBase = `${window.location.origin.replace(/\/$/, '')}/api/channels/webhooks`;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sales Channels</h1>
          <p className="text-gray-500">Live connectors to Shopify, WooCommerce and BigCommerce</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} className="flex items-center gap-2 border px-3 py-2 rounded-lg text-sm hover:bg-gray-50">
            <RefreshCw size={16} /> Refresh
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            <Plus size={18} /> Connect a store
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg border p-6 space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Globe size={18} /> New connection
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Platform</label>
              <select
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                className="w-full border rounded px-3 py-2 text-sm"
              >
                {providers.map((p) => (
                  <option key={p.provider} value={p.provider}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
              <input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Main webshop"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Store domain</label>
              <input
                value={form.shopDomain}
                onChange={(e) => setForm({ ...form, shopDomain: e.target.value })}
                placeholder="my-store.myshopify.com"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {selectedProvider?.credentialLabel ?? 'Access token'}
              </label>
              <input
                value={form.accessToken}
                onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
                type="password"
                placeholder="Stored encrypted; never shown again"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Webhook signing secret</label>
              <input
                value={form.webhookSecret}
                onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
                type="password"
                placeholder="Used to verify inbound orders"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">API version (optional)</label>
              <input
                value={form.apiVersion}
                onChange={(e) => setForm({ ...form, apiVersion: e.target.value })}
                placeholder="2024-10"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
          {selectedProvider && (
            <div className="rounded-lg bg-gray-50 border p-3 text-xs text-gray-600 space-y-1">
              <p>
                <strong>Where to find it:</strong> {selectedProvider.credentialHint}
              </p>
              <p>
                <strong>Webhooks:</strong> {selectedProvider.webhookHint}
              </p>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300">
              Cancel
            </button>
            <button
              onClick={create}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save connection'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading channels…</p>
      ) : connections.length === 0 ? (
        <div className="bg-white rounded-lg border p-6 text-gray-500">
          No store is connected. Until one is, online orders are typed in by hand.
        </div>
      ) : (
        <div className="space-y-4">
          {connections.map((c) => (
            <div key={c.id} className="bg-white rounded-lg border">
              <div className="flex items-start justify-between p-4">
                <div>
                  <h3 className="font-semibold flex items-center gap-2">
                    {c.label}
                    <span className="text-xs font-normal text-gray-500">{c.providerLabel || c.provider}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        c.status === 'CONNECTED' || c.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-800'
                          : c.status === 'ERROR'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {c.status}
                    </span>
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">{c.shopDomain}</p>
                  <p className="text-xs text-gray-500">
                    credential {c.hasToken ? 'stored' : 'missing'} · webhook secret {c.hasWebhookSecret ? 'set' : 'not set'}
                    {c.lastSyncAt && <> · last sync {new Date(c.lastSyncAt).toLocaleString()}</>}
                  </p>
                  {c.lastError && <p className="text-xs text-rose-700 mt-1">{c.lastError}</p>}
                  <p className="text-xs font-mono text-gray-400 mt-1">
                    webhook: {webhookBase}/{c.id}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => test(c.id)}
                    disabled={busy === `test:${c.id}`}
                    title="Test the credential against the live store"
                    className="p-2 rounded hover:bg-blue-50 text-blue-700 disabled:opacity-50"
                  >
                    <PlugZap size={16} />
                  </button>
                  <button onClick={() => showLogs(c.id)} title="Sync log" className="p-2 rounded hover:bg-gray-100 text-gray-700">
                    <ListTree size={16} />
                  </button>
                  <button onClick={() => remove(c.id)} title="Remove" className="p-2 rounded hover:bg-rose-50 text-rose-600">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <div className="border-t px-4 py-3 flex flex-wrap gap-2">
                <button
                  onClick={() => sync(c.id, 'PULL', 'ORDERS')}
                  disabled={busy === `sync:${c.id}`}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
                >
                  <ArrowDownToLine size={14} /> Pull orders
                </button>
                <button
                  onClick={() => sync(c.id, 'PULL', 'PRODUCTS')}
                  disabled={busy === `sync:${c.id}`}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
                >
                  <ArrowDownToLine size={14} /> Import products
                </button>
                <button
                  onClick={() => sync(c.id, 'PUSH', 'INVENTORY')}
                  disabled={busy === `sync:${c.id}`}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
                >
                  <ArrowUpFromLine size={14} /> Push stock
                </button>
                <button
                  onClick={() => sync(c.id, 'PUSH', 'PRODUCTS')}
                  disabled={busy === `sync:${c.id}`}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
                >
                  <ArrowUpFromLine size={14} /> Push catalog
                </button>
                {busy === `sync:${c.id}` && <span className="text-xs text-gray-500 self-center">working…</span>}
              </div>

              {logs[c.id] && (
                <div className="border-t px-4 py-3 bg-gray-50 text-xs">
                  <div className="flex items-center gap-2 mb-2 text-gray-600">
                    <Link2 size={14} /> Recent syncs
                  </div>
                  {logs[c.id].length === 0 ? (
                    <p className="text-gray-500">No sync has run yet.</p>
                  ) : (
                    <table className="w-full">
                      <thead className="text-left text-gray-500">
                        <tr>
                          <th className="py-1">When</th>
                          <th className="py-1">Direction</th>
                          <th className="py-1">Entity</th>
                          <th className="py-1">Status</th>
                          <th className="py-1 text-right">Processed</th>
                          <th className="py-1 text-right">Failed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logs[c.id].slice(0, 10).map((l: any) => (
                          <tr key={l.id} className="border-t">
                            <td className="py-1">{new Date(l.startedAt).toLocaleString()}</td>
                            <td className="py-1">{l.direction}</td>
                            <td className="py-1">{l.entity}</td>
                            <td className="py-1">{l.status}</td>
                            <td className="py-1 text-right">{l.processed ?? 0}</td>
                            <td className="py-1 text-right">{l.failed ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
