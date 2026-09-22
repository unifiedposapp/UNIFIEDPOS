import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import {
  Building2, Map, Warehouse, MapPin, Plus, RefreshCw, Trash2, X, Globe, CheckCircle2, AlertTriangle,
} from 'lucide-react';

type Tab = 'overview' | 'coverage' | 'regions' | 'warehouses' | 'locations';

const money = (n: any) => `$${Number(n || 0).toFixed(2)}`;

export default function EnterprisePage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<any>(null);
  const [regions, setRegions] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [coverage, setCoverage] = useState<any>(null);
  const [provisioning, setProvisioning] = useState(false);

  const [showRegionForm, setShowRegionForm] = useState(false);
  const [regionForm, setRegionForm] = useState({ name: '', description: '' });
  const [showWarehouseForm, setShowWarehouseForm] = useState(false);
  const [warehouseForm, setWarehouseForm] = useState({ name: '', address: '', phone: '', manager: '' });

  const guard = useCallback(async (fn: () => Promise<void>) => {
    try { setError(null); setLoading(true); await fn(); }
    catch (e: any) { setError(e.message || 'Request failed'); }
    finally { setLoading(false); }
  }, []);

  const loadTab = useCallback(async (t: Tab) => {
    await guard(async () => {
      if (t === 'overview') setOverview((await api.getEnterpriseOverview()).data);
      if (t === 'coverage') setCoverage((await api.getRegionCoverage()).data);
      if (t === 'regions') setRegions((await api.getRegions()).data || []);
      if (t === 'warehouses') setWarehouses((await api.getWarehouses()).data || []);
      if (t === 'locations') {
        setLocations((await api.getLocations()).data || []);
        if (regions.length === 0) setRegions((await api.getRegions()).data || []);
      }
    });
  }, [guard, regions.length]);

  useEffect(() => { loadTab(tab); }, [tab, loadTab]);

  const createRegion = () => guard(async () => {
    await api.createRegion({ name: regionForm.name, description: regionForm.description || undefined });
    setShowRegionForm(false); setRegionForm({ name: '', description: '' }); loadTab('regions');
  });
  const removeRegion = (id: string) => guard(async () => {
    if (confirm('Delete this region?')) { await api.deleteRegion(id); loadTab('regions'); }
  });

  const createWarehouse = () => guard(async () => {
    await api.createWarehouse({
      name: warehouseForm.name,
      address: warehouseForm.address || undefined,
      phone: warehouseForm.phone || undefined,
      manager: warehouseForm.manager || undefined,
    });
    setShowWarehouseForm(false); setWarehouseForm({ name: '', address: '', phone: '', manager: '' }); loadTab('warehouses');
  });
  const removeWarehouse = (id: string) => guard(async () => {
    if (confirm('Delete this warehouse?')) { await api.deleteWarehouse(id); loadTab('warehouses'); }
  });

  const assignRegion = (locationId: string, regionId: string) => guard(async () => {
    await api.assignLocationRegion(locationId, regionId || null); loadTab('locations');
  });

  const provisionGlobal = async () => {
    setProvisioning(true);
    try {
      const res = await api.provisionGlobalRegions();
      setCoverage(res.data?.coverage ?? null);
    } catch (e: any) {
      setError(e.message || 'Failed to provision global regions');
    } finally {
      setProvisioning(false);
    }
    loadTab(tab);
  };

  const tabs = [
    { id: 'overview' as Tab, label: 'Overview', icon: Building2 },
    { id: 'coverage' as Tab, label: 'Global Coverage', icon: Globe },
    { id: 'regions' as Tab, label: 'Regions', icon: Map, count: regions.length },
    { id: 'warehouses' as Tab, label: 'Warehouses', icon: Warehouse, count: warehouses.length },
    { id: 'locations' as Tab, label: 'Locations', icon: MapPin, count: locations.length },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Enterprise</h1>
          <p className="text-gray-500">Multi-region & warehouse management across locations (§4 Organization → Region → Location)</p>
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

      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit flex-wrap">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors ${tab === t.id ? 'bg-white shadow text-blue-700 font-medium' : 'text-gray-600 hover:text-gray-900'}`}>
            <t.icon size={16} />{t.label}
            {t.count !== undefined && <span className="text-xs bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && overview && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-lg border p-4"><div className="text-sm text-gray-500">Regions</div><div className="text-2xl font-bold">{overview.totalRegions}</div></div>
            <div className="bg-white rounded-lg border p-4"><div className="text-sm text-gray-500">Active Locations</div><div className="text-2xl font-bold">{overview.totalLocations}</div></div>
            <div className="bg-white rounded-lg border p-4"><div className="text-sm text-gray-500">Warehouses</div><div className="text-2xl font-bold">{overview.totalWarehouses}</div></div>
          </div>
          {overview.globalCoverage && (
            <div className="bg-white rounded-lg border p-4 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                {overview.globalCoverage.complete
                  ? <CheckCircle2 size={22} className="text-green-600" />
                  : <AlertTriangle size={22} className="text-amber-500" />}
                <div>
                  <div className="font-medium">Global region coverage</div>
                  <div className="text-sm text-gray-500">
                    {overview.globalCoverage.covered}/{overview.globalCoverage.total} nations covered
                    {overview.globalCoverage.complete ? ' — no country left out' : ` — ${overview.globalCoverage.uncoveredCount} uncovered`}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setTab('coverage')} className="px-3 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">View details</button>
                <button onClick={provisionGlobal} disabled={provisioning}
                  className="flex items-center gap-2 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-60">
                  <Globe size={16} className={provisioning ? 'animate-spin' : ''} /> {provisioning ? 'Provisioning…' : 'Provision Global Regions'}
                </button>
              </div>
            </div>
          )}
          <div className="bg-white rounded-lg border">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-start px-4 py-3 text-sm font-medium">Location</th>
                  <th className="text-start px-4 py-3 text-sm font-medium">Region</th>
                  <th className="text-end px-4 py-3 text-sm font-medium">Orders</th>
                  <th className="text-end px-4 py-3 text-sm font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {(overview.locations || []).map((l: any) => (
                  <tr key={l.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm">{l.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{l.region}</td>
                    <td className="px-4 py-3 text-sm text-end font-mono">{l.orders}</td>
                    <td className="px-4 py-3 text-sm text-end font-mono">{money(l.revenue)}</td>
                  </tr>
                ))}
                {(!overview.locations || overview.locations.length === 0) && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">No location data</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Global Coverage ── */}
      {tab === 'coverage' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border p-5 flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-full ${coverage?.complete ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                {coverage?.complete ? <CheckCircle2 size={28} /> : <AlertTriangle size={28} />}
              </div>
              <div>
                <div className="text-sm text-gray-500">Global coverage</div>
                <div className="text-2xl font-bold">
                  {coverage?.covered ?? 0}<span className="text-gray-400">/{coverage?.total ?? 249}</span> <span className="text-base font-medium text-gray-600">nations covered</span>
                </div>
                <div className="text-sm mt-1">
                  {coverage?.complete
                    ? <span className="text-green-600">Every nation and country on Earth is covered — none left out.</span>
                    : <span className="text-amber-600">{coverage?.uncovered?.length ?? 249} nation(s) not covered yet. Provision the global regions to reach 249/249.</span>}
                </div>
              </div>
            </div>
            <button onClick={provisionGlobal} disabled={provisioning}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-60">
              <Globe size={16} className={provisioning ? 'animate-spin' : ''} />
              {provisioning ? 'Provisioning…' : 'Provision Global Regions'}
            </button>
          </div>

          {coverage && (
            <div className="bg-white rounded-lg border p-4">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-500">Worldwide coverage</span>
                <span className="font-medium">{Math.round((coverage.covered / (coverage.total || 1)) * 100)}%</span>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full ${coverage.complete ? 'bg-green-500' : 'bg-amber-500'}`}
                  style={{ width: `${(coverage.covered / (coverage.total || 1)) * 100}%` }} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {(coverage?.byContinent || []).map((c: any) => (
              <div key={c.continent} className="bg-white rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{c.continent}</span>
                  {c.complete ? <CheckCircle2 size={16} className="text-green-600" /> : <AlertTriangle size={16} className="text-amber-500" />}
                </div>
                <div className="text-2xl font-bold mt-1">{c.covered}<span className="text-gray-400 text-base">/{c.total}</span></div>
                <div className="text-xs text-gray-500">nations</div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-lg border">
            <div className="px-4 py-3 border-b font-medium text-sm">Sub-regions ({coverage?.bySubregion?.length ?? 0})</div>
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-start px-4 py-2 text-sm font-medium">Continent</th>
                  <th className="text-start px-4 py-2 text-sm font-medium">Sub-region</th>
                  <th className="text-end px-4 py-2 text-sm font-medium">Nations</th>
                  <th className="text-end px-4 py-2 text-sm font-medium">Covered</th>
                </tr>
              </thead>
              <tbody>
                {(coverage?.bySubregion || []).map((s: any) => (
                  <tr key={`${s.continent}-${s.subregion}`} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm">{s.continent}</td>
                    <td className="px-4 py-2 text-sm">{s.subregion}</td>
                    <td className="px-4 py-2 text-sm text-end font-mono">{s.total}</td>
                    <td className="px-4 py-2 text-sm text-end">
                      <span className={`px-2 py-0.5 rounded text-xs ${s.complete ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{s.covered}/{s.total}</span>
                    </td>
                  </tr>
                ))}
                {(coverage?.bySubregion?.length ?? 0) === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">No global regions yet — click “Provision Global Regions”.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {coverage && !coverage.complete && (coverage.uncovered?.length ?? 0) > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="font-medium text-amber-800 mb-2">Nations not covered ({coverage.uncovered.length})</div>
              <div className="flex flex-wrap gap-2">
                {coverage.uncovered.map((code: string) => (
                  <span key={code} className="text-xs bg-white border border-amber-300 text-amber-800 px-2 py-1 rounded">{code}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Regions ── */}
      {tab === 'regions' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowRegionForm(!showRegionForm)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
              <Plus size={16} /> New Region
            </button>
          </div>
          {showRegionForm && (
            <div className="bg-white rounded-lg border p-4">
              <div className="grid grid-cols-3 gap-3">
                <input placeholder="Region name" value={regionForm.name} onChange={e => setRegionForm({ ...regionForm, name: e.target.value })} className="border rounded px-3 py-2" />
                <input placeholder="Description" value={regionForm.description} onChange={e => setRegionForm({ ...regionForm, description: e.target.value })} className="border rounded px-3 py-2" />
                <button onClick={createRegion} className="bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700">Create</button>
              </div>
            </div>
          )}
          <div className="bg-white rounded-lg border">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-start px-4 py-3 text-sm font-medium">Region</th>
                  <th className="text-start px-4 py-3 text-sm font-medium">Type</th>
                  <th className="text-end px-4 py-3 text-sm font-medium">Nations</th>
                  <th className="text-start px-4 py-3 text-sm font-medium">Locations</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {regions.map(r => (
                  <tr key={r.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium">{r.name}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`text-xs px-2 py-0.5 rounded ${r.type === 'GLOBAL' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'}`}>
                        {r.type === 'GLOBAL' ? 'Global' : 'Custom'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-end font-mono">{r.countryCount ?? '-'}</td>
                    <td className="px-4 py-3 text-sm">{(r.locations || []).map((l: any) => l.name).join(', ') || '-'}</td>
                    <td className="px-4 py-3 text-end">
                      {r.type !== 'GLOBAL' && (
                        <button onClick={() => removeRegion(r.id)} className="text-red-500 hover:text-red-700"><Trash2 size={16} /></button>
                      )}
                    </td>
                  </tr>
                ))}
                {regions.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No regions</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Warehouses ── */}
      {tab === 'warehouses' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowWarehouseForm(!showWarehouseForm)} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700">
              <Plus size={16} /> New Warehouse
            </button>
          </div>
          {showWarehouseForm && (
            <div className="bg-white rounded-lg border p-4">
              <div className="grid grid-cols-5 gap-3">
                <input placeholder="Name" value={warehouseForm.name} onChange={e => setWarehouseForm({ ...warehouseForm, name: e.target.value })} className="border rounded px-3 py-2" />
                <input placeholder="Address" value={warehouseForm.address} onChange={e => setWarehouseForm({ ...warehouseForm, address: e.target.value })} className="border rounded px-3 py-2" />
                <input placeholder="Phone" value={warehouseForm.phone} onChange={e => setWarehouseForm({ ...warehouseForm, phone: e.target.value })} className="border rounded px-3 py-2" />
                <input placeholder="Manager" value={warehouseForm.manager} onChange={e => setWarehouseForm({ ...warehouseForm, manager: e.target.value })} className="border rounded px-3 py-2" />
                <button onClick={createWarehouse} className="bg-indigo-600 text-white rounded px-4 py-2 hover:bg-indigo-700">Create</button>
              </div>
            </div>
          )}
          <div className="bg-white rounded-lg border">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-start px-4 py-3 text-sm font-medium">Warehouse</th>
                  <th className="text-start px-4 py-3 text-sm font-medium">Address</th>
                  <th className="text-start px-4 py-3 text-sm font-medium">Manager</th>
                  <th className="text-start px-4 py-3 text-sm font-medium">Phone</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {warehouses.map(w => (
                  <tr key={w.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium">{w.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{w.address || '-'}</td>
                    <td className="px-4 py-3 text-sm">{w.manager || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{w.phone || '-'}</td>
                    <td className="px-4 py-3 text-end">
                      <button onClick={() => removeWarehouse(w.id)} className="text-red-500 hover:text-red-700"><Trash2 size={16} /></button>
                    </td>
                  </tr>
                ))}
                {warehouses.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No warehouses</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Locations ── */}
      {tab === 'locations' && (
        <div className="bg-white rounded-lg border">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-start px-4 py-3 text-sm font-medium">Location</th>
                <th className="text-start px-4 py-3 text-sm font-medium">Status</th>
                <th className="text-start px-4 py-3 text-sm font-medium">Assign Region</th>
              </tr>
            </thead>
            <tbody>
              {locations.map(l => (
                <tr key={l.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium">{l.name}</td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded ${l.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>{l.isActive ? 'ACTIVE' : 'INACTIVE'}</span></td>
                  <td className="px-4 py-3">
                    <select value={l.regionId || ''} onChange={e => assignRegion(l.id, e.target.value)} className="border rounded px-3 py-1.5 text-sm">
                      <option value="">— Unassigned —</option>
                      {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {locations.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-500">No locations</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
