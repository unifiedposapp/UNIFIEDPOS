import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import { offlineService } from '../services/offlineService';
import {
  Wifi, WifiOff, RefreshCw, UploadCloud, CheckCircle2, AlertTriangle, Copy, FlaskConical, X,
} from 'lucide-react';
import clsx from 'clsx';

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={clsx('text-2xl font-bold mt-1', tone)}>{value}</p>
    </div>
  );
}

const btnPrimary = 'px-3 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium flex items-center gap-1';
const btnGhost = 'px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium flex items-center gap-1';

export default function SyncPage() {
  const [online, setOnline] = useState(navigator.onLine);
  const [deviceId, setDeviceId] = useState('');
  const [queue, setQueue] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null); setLoading(true);
      await offlineService.init();
      setDeviceId(offlineService.getDeviceId());
      setQueue(await offlineService.getQueue());
      setOnline(offlineService.isOnline());
      const [s, h, c] = await Promise.all([
        api.getSyncStatus(),
        api.getSyncTransactions(),
        api.getSyncConflicts(),
      ]);
      setStatus(s.data);
      setHistory(h.data || []);
      setConflicts(c.data || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load sync data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const on = () => { setOnline(true); load(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [load]);

  async function handleSyncNow() {
    try {
      setError(null);
      const res = await offlineService.flushTransactions();
      setNotice(`Sync complete — ${res.accepted} accepted, ${res.duplicates} duplicate, ${res.failed} failed.`);
      await load();
    } catch (e: any) {
      setError(e.message || 'Sync failed');
    }
  }

  async function handleQueueTest() {
    try {
      setError(null);
      await offlineService.enqueueTransaction('INVENTORY_ADJUSTMENT', {
        note: 'Manual test transaction queued from Sync page',
        quantity: 0,
      });
      setQueue(await offlineService.getQueue());
      setNotice('Test transaction queued locally. Press "Sync now" to push it to the server.');
    } catch (e: any) {
      setError(e.message || 'Failed to queue transaction');
    }
  }

  function copyDeviceId() {
    navigator.clipboard?.writeText(deviceId);
    setNotice('Device ID copied.');
  }

  const pending = queue.length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Offline &amp; Sync</h1>
          <p className="text-gray-500">Offline-first sync engine and transaction protocol (§25 / §26)</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleQueueTest} className={btnGhost}><FlaskConical size={15} /> Queue Test Tx</button>
          <button onClick={handleSyncNow} className={btnPrimary}><UploadCloud size={15} /> Sync Now</button>
          <button onClick={load} className={btnGhost}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg flex items-center justify-between">
          <span className="text-sm">{error}</span>
          <button onClick={() => setError(null)}><X size={16} /></button>
        </div>
      )}
      {notice && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-2 rounded-lg flex items-center justify-between">
          <span className="text-sm">{notice}</span>
          <button onClick={() => setNotice(null)}><X size={16} /></button>
        </div>
      )}

      {/* Connectivity banner */}
      <div className={clsx('rounded-lg border px-4 py-3 flex items-center gap-3',
        online ? 'bg-green-50 border-green-200 text-green-800' : 'bg-yellow-50 border-yellow-200 text-yellow-800')}>
        {online ? <Wifi size={20} /> : <WifiOff size={20} />}
        <div>
          <p className="font-medium text-sm">{online ? 'Online — transactions sync immediately' : 'Offline — transactions are queued locally (IndexedDB) and will sync on reconnect'}</p>
          <p className="text-xs opacity-80">Device ID: {deviceId || '—'}</p>
        </div>
        {deviceId && <button onClick={copyDeviceId} className="ml-auto text-xs opacity-70 hover:opacity-100 flex items-center gap-1"><Copy size={13} /> Copy</button>}
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Stat label="Local Queue (pending)" value={pending} tone={pending > 0 ? 'text-yellow-600' : ''} />
        <Stat label="Server Synced" value={status?.synced ?? 0} tone="text-green-600" />
        <Stat label="Duplicates Deduped" value={status?.duplicates ?? 0} />
        <Stat label="Conflicts" value={status?.conflicts ?? 0} tone={(status?.conflicts ?? 0) > 0 ? 'text-red-600' : ''} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title={`Local Queue (${queue.length})`}>
          <div className="space-y-2 max-h-72 overflow-auto">
            {queue.map((op) => (
              <div key={op.id} className="border rounded-lg px-3 py-2">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm">{op.protocol?.type || `${op.method} ${op.endpoint}`}</p>
                  <span className="text-xs text-gray-400">#{op.id}</span>
                </div>
                <p className="text-xs text-gray-500">
                  {op.protocol ? `seq ${op.protocol.sequenceNo} · ${op.protocol.transactionId.slice(0, 8)}…` : new Date(op.timestamp).toLocaleString()}
                </p>
              </div>
            ))}
            {queue.length === 0 && <p className="text-sm text-gray-400">Queue empty — everything is synced.</p>}
          </div>
        </Card>

        <Card title={`Devices (${status?.devices?.length || 0})`}>
          <div className="space-y-2 max-h-72 overflow-auto">
            {(status?.devices || []).map((d: any) => (
              <div key={d.deviceId} className="border rounded-lg px-3 py-2 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{d.deviceName}</p>
                  <p className="text-xs text-gray-500">{d.deviceId.slice(0, 12)}… · {d.transactionCount} tx</p>
                </div>
                <div className="text-end">
                  <span className="text-xs bg-gray-100 rounded px-2 py-0.5">{d.status}</span>
                  <p className="text-xs text-gray-400 mt-1">{d.lastSyncAt ? new Date(d.lastSyncAt).toLocaleString() : 'never'}</p>
                </div>
              </div>
            ))}
            {(status?.devices || []).length === 0 && <p className="text-sm text-gray-400">No devices have synced yet.</p>}
          </div>
        </Card>
      </div>

      <Card title={`Sync History (${history.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 uppercase border-b">
              <tr>
                <th className="text-start px-3 py-2">Type</th>
                <th className="text-start px-3 py-2">Transaction</th>
                <th className="text-start px-3 py-2">Seq</th>
                <th className="text-start px-3 py-2">Status</th>
                <th className="text-start px-3 py-2">Device Time</th>
                <th className="text-start px-3 py-2">Synced</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {history.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium">{t.type}</td>
                  <td className="px-3 py-2 text-gray-500 font-mono text-xs">{t.transactionId.slice(0, 12)}…</td>
                  <td className="px-3 py-2 text-gray-500">{t.sequenceNo}</td>
                  <td className="px-3 py-2">
                    <span className={clsx('text-xs rounded px-2 py-0.5',
                      t.status === 'SYNCED' ? 'bg-green-100 text-green-800'
                        : t.status === 'DUPLICATE' ? 'bg-blue-100 text-blue-800'
                        : 'bg-red-100 text-red-800')}>{t.status}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-500">{new Date(t.deviceTimestamp).toLocaleString()}</td>
                  <td className="px-3 py-2 text-gray-500">{new Date(t.syncedAt).toLocaleString()}</td>
                </tr>
              ))}
              {history.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-gray-400 text-center">No sync history yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={`Conflicts (${conflicts.length})`}>
        <div className="space-y-2">
          {conflicts.map((c) => (
            <div key={c.id} className="border border-red-200 bg-red-50 rounded-lg px-3 py-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-red-600" />
                <div>
                  <p className="font-medium text-sm text-red-800">{c.type} · {c.transactionId.slice(0, 12)}…</p>
                  <p className="text-xs text-red-600">{c.conflictReason || 'Unresolved conflict'}</p>
                </div>
              </div>
              <button onClick={async () => { await api.resolveSyncConflict(c.id); load(); }} className={btnGhost}>
                <CheckCircle2 size={15} /> Resolve
              </button>
            </div>
          ))}
          {conflicts.length === 0 && <p className="text-sm text-gray-400">No conflicts. All offline transactions reconciled cleanly.</p>}
        </div>
      </Card>
    </div>
  );
}
