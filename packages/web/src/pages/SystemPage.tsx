import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import {
  Activity, Gauge, ShieldCheck, DatabaseBackup, RefreshCw, CheckCircle2, AlertTriangle, X,
} from 'lucide-react';

type Tab = 'overview' | 'observability' | 'nfr' | 'backup';

const money = (n: any) => `$${Number(n || 0).toFixed(2)}`;

function StatusPill({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${ok ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
      {ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
      {label || (ok ? 'PASS' : 'WARN')}
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between text-sm py-1 border-b last:border-0">
      <span className="text-gray-500">{k}</span>
      <span className="font-medium text-gray-800 text-end">{v}</span>
    </div>
  );
}

export default function SystemPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [metrics, setMetrics] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [obs, setObs] = useState<any>(null);
  const [nfr, setNfr] = useState<any>(null);
  const [backup, setBackup] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const guard = useCallback(async (fn: () => Promise<void>) => {
    try { setError(null); setLoading(true); await fn(); }
    catch (e: any) { setError(e.message || 'Request failed'); }
    finally { setLoading(false); }
  }, []);

  const loadTab = useCallback(async (t: Tab) => {
    await guard(async () => {
      if (t === 'overview') {
        setMetrics((await api.getSystemMetrics()).data);
        setHealth(await api.getSystemHealth());
      }
      if (t === 'observability') setObs((await api.getObservability()).data);
      if (t === 'nfr') setNfr((await api.getNFR()).data);
      if (t === 'backup') setBackup((await api.getBackupConfig()).data);
    });
  }, [guard]);

  useEffect(() => { loadTab(tab); }, [tab, loadTab]);

  const tabs = [
    { id: 'overview' as Tab, label: 'Overview', icon: Gauge },
    { id: 'observability' as Tab, label: 'Observability', icon: Activity },
    { id: 'nfr' as Tab, label: 'NFR Status', icon: ShieldCheck },
    { id: 'backup' as Tab, label: 'Backup & DR', icon: DatabaseBackup },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">System & Observability</h1>
          <p className="text-gray-500">Platform health, metrics, non-functional requirements and disaster recovery (§39)</p>
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
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && metrics && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border p-4"><div className="text-sm text-gray-500">Total Revenue</div><div className="text-2xl font-bold text-green-600">{money(metrics.orders?.totalRevenue)}</div></div>
            <div className="bg-white rounded-lg border p-4"><div className="text-sm text-gray-500">Today</div><div className="text-2xl font-bold text-blue-600">{money(metrics.orders?.todayRevenue)}</div><div className="text-xs text-gray-400">{metrics.orders?.today} orders</div></div>
            <div className="bg-white rounded-lg border p-4"><div className="text-sm text-gray-500">Orders</div><div className="text-2xl font-bold">{metrics.orders?.total}</div><div className="text-xs text-gray-400">{metrics.orders?.paid} paid · {metrics.orders?.refunded} refunded</div></div>
            <div className="bg-white rounded-lg border p-4"><div className="text-sm text-gray-500">Locations</div><div className="text-2xl font-bold">{metrics.locations?.total}</div><div className="text-xs text-gray-400">{metrics.team?.employees} employees</div></div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <Card title="Catalog & Customers">
              <KV k="Products" v={metrics.catalog?.products} />
              <KV k="Customers" v={metrics.customers?.total} />
              <KV k="Cancelled orders" v={metrics.orders?.cancelled} />
            </Card>
            <Card title="Platform Health">
              <KV k="Low-stock items" v={<span className={metrics.health?.lowStockItems > 0 ? 'text-red-600' : ''}>{metrics.health?.lowStockItems}</span>} />
              <KV k="Pending events" v={metrics.health?.pendingEvents} />
              <KV k="Webhook failures" v={<span className={metrics.health?.webhookFailures > 0 ? 'text-red-600' : ''}>{metrics.health?.webhookFailures}</span>} />
              {health && <KV k="Server status" v={<StatusPill ok={health.status === 'healthy'} label={health.status} />} />}
              {health && <KV k="Uptime" v={`${Math.round(health.uptime || 0)}s`} />}
              {health && <KV k="Node" v={health.nodeVersion} />}
            </Card>
          </div>
        </div>
      )}

      {/* ── Observability ── */}
      {tab === 'observability' && obs && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card title="System">
            <KV k="Uptime" v={`${Math.round(obs.system?.uptime || 0)}s`} />
            <KV k="Node version" v={obs.system?.nodeVersion} />
            <KV k="Heap used" v={`${obs.system?.memory?.heapUsed} / ${obs.system?.memory?.heapTotal} MB`} />
            <KV k="RSS" v={`${obs.system?.memory?.rss} MB`} />
          </Card>
          <Card title="Database & Events">
            <KV k="DB latency" v={obs.database?.latency} />
            <KV k="DB status" v={<StatusPill ok={obs.database?.status === 'healthy'} label={obs.database?.status} />} />
            <KV k="Pending events" v={obs.events?.pending} />
            <KV k="Failed events" v={<span className={obs.events?.failed > 0 ? 'text-red-600' : ''}>{obs.events?.failed}</span>} />
          </Card>
          <Card title="Payments (24h)">
            <KV k="Total" v={obs.payments?.total24h} />
            <KV k="Failed" v={obs.payments?.failed24h} />
            <KV k="Failure rate" v={obs.payments?.failureRate} />
          </Card>
          <Card title="Recent Webhook Deliveries">
            {obs.webhooks?.recentDeliveries?.length ? (
              <div className="space-y-1 max-h-48 overflow-auto">
                {obs.webhooks.recentDeliveries.map((d: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs py-1 border-b last:border-0">
                    <span className="font-mono text-gray-600">{d.event}</span>
                    <span className={d.success ? 'text-green-600' : 'text-red-600'}>{d.success ? '✓' : '✗'} {d.status}</span>
                  </div>
                ))}
              </div>
            ) : <div className="text-sm text-gray-400">No recent deliveries</div>}
          </Card>
        </div>
      )}

      {/* ── NFR ── */}
      {tab === 'nfr' && nfr && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card title="Performance">
            {Object.entries(nfr.performance || {}).map(([k, v]: any) => (
              <KV key={k} k={k} v={<span className="flex items-center gap-2"><span className="text-xs text-gray-500">{v.current} / {v.target}</span><StatusPill ok={v.status === 'PASS'} label={v.status} /></span>} />
            ))}
          </Card>
          <Card title="Availability">
            {Object.entries(nfr.availability || {}).map(([k, v]: any) => (
              <KV key={k} k={k} v={typeof v === 'object' ? (v.implemented ? <StatusPill ok label="YES" /> : v.current || '-') : String(v)} />
            ))}
          </Card>
          <Card title="Reliability">
            {Object.entries(nfr.reliability || {}).map(([k, v]: any) => (
              <KV key={k} k={k} v={<StatusPill ok={!!v.implemented} label={v.implemented ? 'YES' : 'NO'} />} />
            ))}
          </Card>
          <Card title="Security">
            {Object.entries(nfr.security || {}).map(([k, v]: any) => (
              <KV key={k} k={k} v={<StatusPill ok={!!v.implemented} label={v.implemented ? 'YES' : 'NO'} />} />
            ))}
          </Card>
          <Card title="Scalability">
            {Object.entries(nfr.scalability || {}).map(([k, v]: any) => (
              <KV key={k} k={k} v={<span className="text-xs">{v.currentOrganizations ?? v.currentProducts ?? v.currentOrders ?? ''} {v.description ? `· ${v.description}` : ''}</span>} />
            ))}
          </Card>
          <Card title="Extensibility">
            {Object.entries(nfr.extensibility || {}).map(([k, v]: any) => (
              <KV key={k} k={k} v={<StatusPill ok={!!v.implemented} label={v.implemented ? 'YES' : 'PLANNED'} />} />
            ))}
          </Card>
        </div>
      )}

      {/* ── Backup & DR ── */}
      {tab === 'backup' && backup && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card title="Backup Strategy">
            <div className="text-sm text-gray-700 mb-2">{backup.backup?.strategy}</div>
            <KV k="Database" v={backup.backup?.database?.type} />
            <KV k="Status" v={<StatusPill ok={backup.backup?.database?.status === 'healthy'} label={backup.backup?.database?.status} />} />
            <KV k="Latency" v={backup.backup?.database?.latency} />
            {Object.entries(backup.backup?.database?.recommendedBackupConfig || {}).map(([k, v]: any) => (
              <KV key={k} k={k} v={<span className="text-xs">{String(v)}</span>} />
            ))}
          </Card>
          <Card title="Event Log">
            <KV k="Total events" v={backup.backup?.eventLog?.totalEvents} />
            <KV k="Audit events" v={backup.backup?.eventLog?.totalAuditEvents} />
            <KV k="Immutable" v={<StatusPill ok={!!backup.backup?.eventLog?.immutable} label={backup.backup?.eventLog?.immutable ? 'YES' : 'NO'} />} />
            <div className="text-xs text-gray-500 mt-2">{backup.backup?.eventLog?.retentionPolicy}</div>
          </Card>
          <Card title="Disaster Recovery">
            <KV k="RPO" v={backup.disasterRecovery?.rpo} />
            <KV k="RTO" v={backup.disasterRecovery?.rto} />
            <div className="text-xs text-gray-500 mt-2 mb-1">{backup.disasterRecovery?.strategy}</div>
            <ol className="text-xs text-gray-600 list-decimal list-inside space-y-0.5 mt-2">
              {(backup.disasterRecovery?.failoverProcess || []).map((s: string, i: number) => <li key={i}>{s.replace(/^\d+\.\s*/, '')}</li>)}
            </ol>
          </Card>
          <Card title="Data Integrity">
            {Object.entries(backup.dataIntegrity || {}).map(([k, v]: any) => (
              <KV key={k} k={k} v={<span className="text-xs">{String(v)}</span>} />
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
