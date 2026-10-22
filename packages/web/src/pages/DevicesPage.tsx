import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Monitor, Plus, RefreshCw, Power, XCircle, Wifi, WifiOff } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  ONLINE: 'bg-green-100 text-green-800',
  OFFLINE: 'bg-gray-100 text-gray-800',
  MAINTENANCE: 'bg-yellow-100 text-yellow-800',
  RETIRED: 'bg-red-100 text-red-800',
};

const TYPE_COLORS: Record<string, string> = {
  POS_TERMINAL: 'bg-blue-100 text-blue-800',
  MOBILE: 'bg-purple-100 text-purple-800',
  KIOSK: 'bg-indigo-100 text-indigo-800',
  KITCHEN_DISPLAY: 'bg-orange-100 text-orange-800',
};

export default function DevicesPage() {
  const [devices, setDevices] = useState<any[]>([]);
  const [overview, setOverview] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'POS_TERMINAL', registerId: '' });
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [devRes, ovRes] = await Promise.all([
        api.getDevices(),
        api.getDeviceOverview(),
      ]);
      setDevices(devRes.data || []);
      setOverview(ovRes.data?.summary || null);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not load devices');
    }
  };

  useEffect(() => { load(); }, []);

  const register = async () => {
    if (!form.name.trim()) { setError('Enter a device name.'); return; }
    try {
      await api.registerDevice({ name: form.name.trim(), type: form.type, registerId: form.registerId || undefined });
      setShowForm(false);
      setForm({ name: '', type: 'POS_TERMINAL', registerId: '' });
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not register device');
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await api.updateDeviceStatus(id, status);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not update device');
    }
  };

  const revoke = async (id: string) => {
    if (!confirm('Revoke this device credential? The device will need re-registration.')) return;
    try {
      await api.revokeDeviceCredential(id);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not revoke credential');
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Device Management</h1>
          <p className="text-gray-500">Register, monitor, and manage POS devices</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
          <Plus size={18} /> Register Device
        </button>
      </div>

      {/* Overview Cards */}
      {overview && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white border rounded-lg p-4">
            <div className="text-sm text-gray-500 mb-1">Total Devices</div>
            <div className="text-2xl font-bold">{overview.total}</div>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-green-600 mb-1"><Wifi size={16} /> Online</div>
            <div className="text-2xl font-bold">{overview.online || 0}</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-red-600 mb-1"><WifiOff size={16} /> Offline</div>
            <div className="text-2xl font-bold">{overview.offline || 0}</div>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="text-sm text-yellow-600 mb-1">Maintenance</div>
            <div className="text-2xl font-bold">{overview.maintenance || 0}</div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Register Form */}
      {showForm && (
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <h3 className="font-semibold">Register New Device</h3>
          <div className="grid grid-cols-4 gap-3">
            <input placeholder="Device Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="border rounded px-3 py-2" />
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="border rounded px-3 py-2">
              <option value="POS_TERMINAL">POS Terminal</option>
              <option value="MOBILE">Mobile Device</option>
              <option value="KIOSK">Kiosk</option>
              <option value="KITCHEN_DISPLAY">Kitchen Display</option>
            </select>
            <input placeholder="Register ID (optional)" value={form.registerId} onChange={e => setForm({ ...form, registerId: e.target.value })} className="border rounded px-3 py-2" />
            <button onClick={register} className="bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700">Register</button>
          </div>
        </div>
      )}

      {/* Device List */}
      <div className="bg-white rounded-lg border">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-start px-4 py-3 text-sm font-medium">Device</th>
              <th className="text-start px-4 py-3 text-sm font-medium">Type</th>
              <th className="text-start px-4 py-3 text-sm font-medium">Status</th>
              <th className="text-start px-4 py-3 text-sm font-medium">Location</th>
              <th className="text-start px-4 py-3 text-sm font-medium">Last Heartbeat</th>
              <th className="text-start px-4 py-3 text-sm font-medium">Config Ver</th>
              <th className="text-end px-4 py-3 text-sm font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d: any) => (
              <tr key={d.id} className="border-b hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Monitor size={16} className="text-gray-400" />
                    <div>
                      <div className="text-sm font-medium">{d.name}</div>
                      <div className="text-xs text-gray-500 font-mono">{d.registerId || d.id.slice(0, 12)}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-1 rounded ${TYPE_COLORS[d.type] || 'bg-gray-100'}`}>{d.type}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-1 rounded ${STATUS_COLORS[d.status] || ''}`}>{d.status}</span>
                </td>
                <td className="px-4 py-3 text-sm">{d.locationId ? d.locationId.slice(0, 12) : '-'}</td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {d.lastHeartbeatAt ? new Date(d.lastHeartbeatAt).toLocaleString() : 'Never'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">{d.configVersion || '-'}</td>
                <td className="px-4 py-3 text-end">
                  <div className="flex items-center gap-1 justify-end">
                    {d.status !== 'ONLINE' && d.status !== 'RETIRED' && (
                      <button onClick={() => updateStatus(d.id, 'ONLINE')} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200" title="Set Online">
                        <Power size={12} />
                      </button>
                    )}
                    {d.status === 'ONLINE' && (
                      <button onClick={() => updateStatus(d.id, 'OFFLINE')} className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded hover:bg-gray-200" title="Set Offline">
                        <WifiOff size={12} />
                      </button>
                    )}
                    {d.status !== 'MAINTENANCE' && d.status !== 'RETIRED' && (
                      <button onClick={() => updateStatus(d.id, 'MAINTENANCE')} className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded hover:bg-yellow-200" title="Maintenance">
                        <RefreshCw size={12} />
                      </button>
                    )}
                    {d.status !== 'RETIRED' && (
                      <>
                        <button onClick={() => updateStatus(d.id, 'RETIRED')} className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200" title="Retire">
                          <XCircle size={12} />
                        </button>
                        <button onClick={() => revoke(d.id)} className="text-xs bg-red-50 text-red-600 px-2 py-1 rounded hover:bg-red-100" title="Revoke Credential">
                          Revoke
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {devices.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No devices registered</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
