import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import {
  Code2, KeyRound, Shield, Plug, FlaskConical, Store, BookOpen,
  Plus, RefreshCw, Copy, X,
  CreditCard, Calculator, ShoppingBag, Bike, Truck, Megaphone, MessageSquare,
  Zap, Users, BarChart3, Star, Banknote, Percent, Boxes, Share2, Calendar,
  LifeBuoy, Landmark,
} from 'lucide-react';

type Tab = 'keys' | 'oauth' | 'integrations' | 'sandbox' | 'marketplace' | 'docs';

// Category → lucide icon (all keys exist in lucide-react; avoids dynamic lookup).
const CATEGORY_ICON: Record<string, any> = {
  PAYMENT: CreditCard, ACCOUNTING: Calculator, ECOMMERCE: ShoppingBag, MARKETPLACE: Store,
  DELIVERY: Bike, SHIPPING: Truck, MARKETING: Megaphone, COMMUNICATION: MessageSquare,
  AUTOMATION: Zap, CRM: Users, ANALYTICS: BarChart3, LOYALTY: Star, HR_PAYROLL: Banknote,
  TAX_COMPLIANCE: Percent, ERP_INVENTORY: Boxes, SOCIAL: Share2, RESERVATIONS: Calendar,
  IDENTITY: Shield, SUPPORT: LifeBuoy, BANKING: Landmark,
};
const iconFor = (cat: string) => CATEGORY_ICON[cat] || Plug;

const FALLBACK_TYPES = ['ECOMMERCE', 'MARKETPLACE', 'PAYMENT', 'ACCOUNTING', 'DELIVERY', 'INTEGRATION'];

const badge = (s: string, ok: boolean) => (
  <span className={`text-xs px-2 py-1 rounded ${ok ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>{s}</span>
);

export default function DeveloperPage() {
  const [tab, setTab] = useState<Tab>('keys');
  const [keys, setKeys] = useState<any>(null);
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [sandbox, setSandbox] = useState<any>(null);
  const [marketplace, setMarketplace] = useState<any[]>([]);
  const [marketCats, setMarketCats] = useState<string[]>([]);
  const [marketFilter, setMarketFilter] = useState<string>('ALL');
  const [catalog, setCatalog] = useState<any>(null);
  const [docs, setDocs] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [newKey, setNewKey] = useState<any>(null);

  const [keyName, setKeyName] = useState('');
  const [oauthForm, setOauthForm] = useState({ name: '', redirectUri: '', scopes: 'read' });
  const [intForm, setIntForm] = useState({ provider: '', type: 'ECOMMERCE', name: '' });

  const guard = useCallback(async (fn: () => Promise<void>) => {
    try { setError(null); setLoading(true); await fn(); }
    catch (e: any) { setError(e.message || 'Request failed'); }
    finally { setLoading(false); }
  }, []);

  const loadTab = useCallback(async (t: Tab) => {
    await guard(async () => {
      if (t === 'keys') setKeys((await api.getApiKeys()).data);
      if (t === 'integrations') {
        setIntegrations((await api.getDeveloperIntegrations()).data || []);
        setCatalog((await api.getDeveloperCatalog()).data);
      }
      if (t === 'sandbox') setSandbox((await api.getSandboxStatus()).data);
      if (t === 'marketplace') {
        const m = (await api.getMarketplace()).data || {};
        setMarketplace(m.apps || []);
        setMarketCats(m.categories || []);
      }
      if (t === 'docs') setDocs((await api.getApiDocs()).data);
    });
  }, [guard]);

  useEffect(() => { loadTab(tab); }, [tab, loadTab]);

  const generateKey = () => guard(async () => {
    if (!keyName.trim()) { setError('Key name is required'); return; }
    const res = await api.generateApiKey(keyName);
    setNewKey(res.data); setKeyName(''); loadTab('keys');
  });

  const registerOAuth = () => guard(async () => {
    if (!oauthForm.name || !oauthForm.redirectUri) { setError('Name and redirect URI are required'); return; }
    const res = await api.registerOAuthApp({
      name: oauthForm.name,
      redirectUri: oauthForm.redirectUri,
      scopes: oauthForm.scopes.split(',').map(s => s.trim()).filter(Boolean),
    });
    setNewKey({ oauth: true, ...res.data });
    setOauthForm({ name: '', redirectUri: '', scopes: 'read' });
  });

  const chooseProvider = (id: string) => {
    const p = (catalog?.providers || []).find((x: any) => x.id === id);
    setIntForm({ provider: id, type: p?.category || intForm.type, name: p?.name || intForm.name });
  };

  const connectIntegration = () => guard(async () => {
    if (!intForm.provider || !intForm.name) { setError('Platform and name are required'); return; }
    await api.connectDeveloperIntegration({ provider: intForm.provider, type: intForm.type, name: intForm.name });
    setIntForm({ provider: '', type: 'ECOMMERCE', name: '' }); loadTab('integrations');
  });
  const connectFromMarketplace = (app: any) => guard(async () => {
    await api.connectDeveloperIntegration({ provider: app.id, type: app.category, name: app.name });
    setTab('integrations');
  });
  const disconnect = (id: string) => guard(async () => {
    if (confirm('Disconnect this integration?')) { await api.disconnectDeveloperIntegration(id); loadTab('integrations'); }
  });
  const resetSandbox = () => guard(async () => {
    if (confirm('Reset sandbox data?')) { await api.resetSandbox(); loadTab('sandbox'); }
  });
  const testWebhook = (id: string) => guard(async () => { await api.testWebhook(id, 'test.ping'); alert('Test webhook delivered'); });

  const copy = (text: string) => { navigator.clipboard?.writeText(text); };

  const catalogGroups = catalog?.groups || [];
  const typeOptions = catalog?.categories || FALLBACK_TYPES;
  const filteredApps = marketFilter === 'ALL' ? marketplace : marketplace.filter(a => a.category === marketFilter);

  const tabs = [
    { id: 'keys' as Tab, label: 'API Keys', icon: KeyRound },
    { id: 'oauth' as Tab, label: 'OAuth Apps', icon: Shield },
    { id: 'integrations' as Tab, label: 'Integrations', icon: Plug, count: integrations.length },
    { id: 'sandbox' as Tab, label: 'Sandbox', icon: FlaskConical },
    { id: 'marketplace' as Tab, label: 'Marketplace', icon: Store, count: marketplace.length },
    { id: 'docs' as Tab, label: 'API Docs', icon: BookOpen },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Code2 size={26} className="text-blue-600" /> Developer Platform</h1>
          <p className="text-gray-500">API keys, OAuth, integrations, sandbox, app marketplace & documentation (§30 / Phase 5)</p>
        </div>
        <button onClick={() => loadTab(tab)} className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg flex items-center justify-between">
          <span className="text-sm">{error}</span>
          <button onClick={() => setError(null)}><X size={16} /></button>
        </div>
      )}

      {newKey && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-green-800">{newKey.oauth ? 'OAuth app registered' : 'API key generated'} — save these now, secrets are shown once.</span>
            <button onClick={() => setNewKey(null)}><X size={16} /></button>
          </div>
          {newKey.publicKey && <SecretRow label="Public key" value={newKey.publicKey} onCopy={copy} />}
          {newKey.secretKey && <SecretRow label="Secret key" value={newKey.secretKey} onCopy={copy} />}
          {newKey.clientId && <SecretRow label="Client ID" value={newKey.clientId} onCopy={copy} />}
          {newKey.clientSecret && <SecretRow label="Client secret" value={newKey.clientSecret} onCopy={copy} />}
        </div>
      )}

      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit flex-wrap">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors ${tab === t.id ? 'bg-white shadow text-blue-700 font-medium' : 'text-gray-600 hover:text-gray-900'}`}>
            <t.icon size={16} />{t.label}
            {t.count !== undefined && <span className="text-xs bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* ── API Keys ── */}
      {tab === 'keys' && keys && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border p-4">
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium mb-1">New API key name</label>
                <input value={keyName} onChange={e => setKeyName(e.target.value)} placeholder="e.g. Mobile App" className="w-full border rounded px-3 py-2" />
              </div>
              <button onClick={generateKey} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"><Plus size={16} /> Generate</button>
            </div>
            <div className="text-xs text-gray-500 mt-2">API version {keys.apiVersion} · base URL <code className="font-mono">{keys.baseUrl}</code></div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <h3 className="text-sm font-semibold mb-2">Available Endpoints</h3>
            <div className="flex flex-wrap gap-2">
              {(keys.endpoints || []).map((e: string) => (
                <code key={e} className="text-xs bg-gray-100 px-2 py-1 rounded font-mono">{e}</code>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-lg border">
            <table className="w-full">
              <thead className="bg-gray-50 border-b"><tr>
                <th className="text-left px-4 py-3 text-sm font-medium">Webhook / Key</th>
                <th className="text-left px-4 py-3 text-sm font-medium">Events</th>
                <th className="text-left px-4 py-3 text-sm font-medium">Status</th>
                <th className="text-right px-4 py-3 text-sm font-medium">OK / Fail</th>
                <th className="px-4 py-3"></th>
              </tr></thead>
              <tbody>
                {(keys.webhooks || []).map((w: any) => (
                  <tr key={w.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-mono">{w.url}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{(w.events || []).join(', ')}</td>
                    <td className="px-4 py-3">{badge(w.isActive ? 'ACTIVE' : 'INACTIVE', w.isActive)}</td>
                    <td className="px-4 py-3 text-sm text-right font-mono">{w.successCount} / {w.failureCount}</td>
                    <td className="px-4 py-3 text-right"><button onClick={() => testWebhook(w.id)} className="text-xs text-blue-600 hover:underline">Test</button></td>
                  </tr>
                ))}
                {(!keys.webhooks || keys.webhooks.length === 0) && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No keys / webhooks</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── OAuth ── */}
      {tab === 'oauth' && (
        <div className="bg-white rounded-lg border p-4 max-w-2xl space-y-3">
          <h3 className="text-sm font-semibold">Register OAuth 2.0 Application</h3>
          <input placeholder="App name" value={oauthForm.name} onChange={e => setOauthForm({ ...oauthForm, name: e.target.value })} className="w-full border rounded px-3 py-2" />
          <input placeholder="Redirect URI (https://...)" value={oauthForm.redirectUri} onChange={e => setOauthForm({ ...oauthForm, redirectUri: e.target.value })} className="w-full border rounded px-3 py-2" />
          <input placeholder="Scopes (comma-separated)" value={oauthForm.scopes} onChange={e => setOauthForm({ ...oauthForm, scopes: e.target.value })} className="w-full border rounded px-3 py-2" />
          <button onClick={registerOAuth} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"><Plus size={16} /> Register App</button>
          <p className="text-xs text-gray-500">Authorization-code flow: authorize at <code className="font-mono">/api/developer/oauth/authorize</code>, exchange at <code className="font-mono">/api/developer/oauth/token</code>.</p>
        </div>
      )}

      {/* ── Integrations ── */}
      {tab === 'integrations' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border p-4">
            {catalog?.stats && (
              <p className="text-xs text-gray-500 mb-3">
                Choose from <b>{catalog.stats.totalProviders}</b> platforms across <b>{catalog.stats.totalCategories}</b> categories — payments, accounting, commerce, marketplaces, delivery, shipping, marketing, CRM, analytics, HR, tax, ERP, identity, banking and more.
              </p>
            )}
            <div className="grid grid-cols-4 gap-3 items-end">
              <div>
                <label className="block text-sm font-medium mb-1">Platform</label>
                <select value={intForm.provider} onChange={e => chooseProvider(e.target.value)} className="w-full border rounded px-3 py-2 bg-white">
                  <option value="">Select a platform…</option>
                  {catalogGroups.map((g: any) => (
                    <optgroup key={g.category} label={g.category.replace(/_/g, ' ')}>
                      {g.providers.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div><label className="block text-sm font-medium mb-1">Type</label>
                <select value={intForm.type} onChange={e => setIntForm({ ...intForm, type: e.target.value })} className="w-full border rounded px-3 py-2 bg-white">
                  {typeOptions.map((t: string) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div><label className="block text-sm font-medium mb-1">Name</label><input placeholder="My integration" value={intForm.name} onChange={e => setIntForm({ ...intForm, name: e.target.value })} className="w-full border rounded px-3 py-2" /></div>
              <button onClick={connectIntegration} className="flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"><Plus size={16} /> Connect</button>
            </div>
          </div>
          <div className="bg-white rounded-lg border">
            <table className="w-full">
              <thead className="bg-gray-50 border-b"><tr>
                <th className="text-left px-4 py-3 text-sm font-medium">Name</th>
                <th className="text-left px-4 py-3 text-sm font-medium">Provider</th>
                <th className="text-left px-4 py-3 text-sm font-medium">Type</th>
                <th className="text-left px-4 py-3 text-sm font-medium">Status</th>
                <th className="text-left px-4 py-3 text-sm font-medium">Last Sync</th>
                <th className="px-4 py-3"></th>
              </tr></thead>
              <tbody>
                {integrations.map(i => (
                  <tr key={i.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium">{i.name}</td>
                    <td className="px-4 py-3 text-sm">{i.provider}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{i.type}</td>
                    <td className="px-4 py-3">{badge(i.status, i.status === 'CONNECTED')}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{i.lastSyncAt ? new Date(i.lastSyncAt).toLocaleString() : '-'}</td>
                    <td className="px-4 py-3 text-right">{i.status === 'CONNECTED' && <button onClick={() => disconnect(i.id)} className="text-xs text-red-600 hover:underline">Disconnect</button>}</td>
                  </tr>
                ))}
                {integrations.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No integrations</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Sandbox ── */}
      {tab === 'sandbox' && sandbox && (
        <div className="bg-white rounded-lg border p-4 max-w-md space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Sandbox Environment</h3>
            {badge(sandbox.isSandbox ? 'SANDBOX' : 'PRODUCTION', sandbox.isSandbox)}
          </div>
          <div className="text-sm text-gray-600">Orders: <b>{sandbox.stats?.orderCount}</b> · Products: <b>{sandbox.stats?.productCount}</b> · Customers: <b>{sandbox.stats?.customerCount}</b></div>
          <button onClick={resetSandbox} className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700"><RefreshCw size={16} /> Reset Sandbox</button>
        </div>
      )}

      {/* ── Marketplace ── */}
      {tab === 'marketplace' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setMarketFilter('ALL')}
              className={`text-xs px-3 py-1.5 rounded-full border ${marketFilter === 'ALL' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              All ({marketplace.length})
            </button>
            {marketCats.map(c => (
              <button key={c} onClick={() => setMarketFilter(c)}
                className={`text-xs px-3 py-1.5 rounded-full border ${marketFilter === c ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {c.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredApps.map(app => {
              const IconC = iconFor(app.category);
              return (
                <div key={app.id} className="bg-white rounded-lg border p-4 flex flex-col">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                      <IconC size={18} className="text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{app.name}</div>
                      <div className="text-[11px] text-gray-400">{app.category.replace(/_/g, ' ')}</div>
                    </div>
                  </div>
                  <div className="text-xs text-gray-600 mt-2 flex-1">{app.description}</div>
                  {(app.configFields || []).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {app.configFields.map((f: string) => (
                        <span key={f} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-mono">{f}</span>
                      ))}
                    </div>
                  )}
                  <button onClick={() => connectFromMarketplace(app)}
                    className="mt-3 w-full text-xs bg-blue-600 text-white py-1.5 rounded hover:bg-blue-700 flex items-center justify-center gap-1">
                    <Plug size={13} /> Connect
                  </button>
                </div>
              );
            })}
          </div>
          {filteredApps.length === 0 && <div className="text-gray-500 text-sm">No apps in this category.</div>}
        </div>
      )}

      {/* ── Docs ── */}
      {tab === 'docs' && docs && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border p-4">
            <h3 className="font-semibold">{docs.title} <span className="text-sm text-gray-400">v{docs.version}</span></h3>
            <p className="text-sm text-gray-600 mt-1">Auth: {docs.authentication} · Base URL: <code className="font-mono">{docs.baseUrl}</code></p>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {Object.entries(docs.resources || {}).map(([group, routes]: any) => (
              <div key={group} className="bg-white rounded-lg border p-4">
                <h4 className="text-sm font-semibold capitalize mb-2">{group}</h4>
                <div className="space-y-1">
                  {routes.map((r: string) => <div key={r} className="text-xs font-mono text-gray-600">{r}</div>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SecretRow({ label, value, onCopy }: { label: string; value: string; onCopy: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-green-700 w-24">{label}</span>
      <code className="flex-1 text-xs font-mono bg-white border rounded px-2 py-1 break-all">{value}</code>
      <button onClick={() => onCopy(value)} className="text-green-700 hover:text-green-900"><Copy size={14} /></button>
    </div>
  );
}
