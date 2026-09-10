import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { ShieldAlert, CheckCircle2, XCircle, Eye } from 'lucide-react';
import clsx from 'clsx';

const SEVERITY_STYLE: Record<string, string> = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-amber-100 text-amber-700',
  HIGH: 'bg-orange-100 text-orange-700',
  CRITICAL: 'bg-rose-100 text-rose-700',
};
const STATUS_STYLE: Record<string, string> = {
  OPEN: 'bg-rose-100 text-rose-700',
  REVIEWING: 'bg-amber-100 text-amber-700',
  RESOLVED: 'bg-emerald-100 text-emerald-700',
  DISMISSED: 'bg-gray-100 text-gray-600',
};

function ruleList(meta: any): { rule: string; message?: string; weight?: number }[] {
  return Array.isArray(meta?.rules) ? meta.rules : [];
}

export default function FraudPage() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    const params: Record<string, string> = {};
    if (statusFilter) params.status = statusFilter;
    const [a, s] = await Promise.all([api.getFraudAlerts(params), api.getFraudStats()]);
    setAlerts(a.data || []);
    setStats(s.data || null);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [statusFilter]);

  const setStatus = async (id: string, status: string) => {
    const note = status === 'RESOLVED' || status === 'DISMISSED' ? prompt('Resolution note (optional):') || undefined : undefined;
    await api.updateFraudAlertStatus(id, status, note);
    load();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Fraud Detection</h1>
          <p className="text-gray-500">Alerts raised automatically during payment authorisation (§37)</p>
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border rounded px-3 py-2 text-sm">
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="REVIEWING">Reviewing</option>
          <option value="RESOLVED">Resolved</option>
          <option value="DISMISSED">Dismissed</option>
        </select>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">Open</div>
            <div className="text-2xl font-bold text-rose-600">{stats.open ?? 0}</div>
          </div>
          {Object.entries(stats.bySeverity || {}).slice(0, 3).map(([sev, count]) => (
            <div key={sev} className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{sev}</div>
              <div className="text-2xl font-bold">{String(count)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-lg border">
        <div className="p-4 border-b flex items-center gap-2">
          <ShieldAlert size={18} />
          <h2 className="font-semibold">Alerts ({alerts.length})</h2>
        </div>
        <div className="divide-y">
          {alerts.map((a) => (
            <div key={a.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{a.rule.replace(/_/g, ' ')}</span>
                    <span className={clsx('text-xs px-2 py-0.5 rounded', SEVERITY_STYLE[a.severity])}>{a.severity}</span>
                    <span className={clsx('text-xs px-2 py-0.5 rounded', STATUS_STYLE[a.status])}>{a.status}</span>
                    <span className="text-xs text-gray-500">score {a.score}</span>
                  </div>
                  <div className="text-sm text-gray-600 mt-1">{a.message}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {a.metadata?.amount != null && `${Number(a.metadata.amount).toFixed(2)} ${a.metadata.currency || ''} · `}
                    {a.metadata?.method ? `${a.metadata.method} · ` : ''}
                    {new Date(a.createdAt).toLocaleString()}
                  </div>
                  <button onClick={() => setExpanded(expanded === a.id ? null : a.id)} className="mt-1 text-xs text-violet-600 hover:text-violet-800 flex items-center gap-1">
                    <Eye size={13} /> {expanded === a.id ? 'Hide rules' : 'View rules'}
                  </button>
                  {expanded === a.id && (
                    <ul className="mt-2 space-y-1">
                      {ruleList(a.metadata).map((r, i) => (
                        <li key={i} className="text-xs bg-gray-50 border rounded px-2 py-1">
                          <span className="font-medium">{r.rule}</span> (weight {r.weight}) — {r.message}
                        </li>
                      ))}
                      {ruleList(a.metadata).length === 0 && <li className="text-xs text-gray-400">No rule detail recorded.</li>}
                    </ul>
                  )}
                </div>
                {(a.status === 'OPEN' || a.status === 'REVIEWING') && (
                  <div className="flex flex-col gap-2 shrink-0">
                    {a.status === 'OPEN' && (
                      <button onClick={() => setStatus(a.id, 'REVIEWING')} className="flex items-center gap-1 text-xs bg-amber-50 border border-amber-200 text-amber-700 px-3 py-1.5 rounded hover:bg-amber-100">
                        <Eye size={14} /> Review
                      </button>
                    )}
                    <button onClick={() => setStatus(a.id, 'RESOLVED')} className="flex items-center gap-1 text-xs bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1.5 rounded hover:bg-emerald-100">
                      <CheckCircle2 size={14} /> Resolve
                    </button>
                    <button onClick={() => setStatus(a.id, 'DISMISSED')} className="flex items-center gap-1 text-xs bg-gray-50 border border-gray-200 text-gray-600 px-3 py-1.5 rounded hover:bg-gray-100">
                      <XCircle size={14} /> Dismiss
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {alerts.length === 0 && <div className="p-8 text-center text-gray-500">No fraud alerts — looking good</div>}
        </div>
      </div>
    </div>
  );
}
