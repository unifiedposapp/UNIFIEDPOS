import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { TrendingUp, Activity, Users, Sparkles } from 'lucide-react';
import clsx from 'clsx';

type Tab = 'forecast' | 'anomalies' | 'segments';

export default function AIAnalyticsPage() {
  const [tab, setTab] = useState<Tab>('forecast');
  const [summary, setSummary] = useState<any>(null);

  const loadSummary = async () => {
    try { const r = await api.getCopilotSummary(); setSummary(r.data); } catch { /* optional */ }
  };
  useEffect(() => { loadSummary(); }, []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Predictive Analytics</h1>
        <p className="text-gray-500">Statistical forecasting, anomaly detection and RFM segmentation</p>
      </div>

      {summary?.text && (
        <div className="bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200 rounded-lg p-4 flex gap-3">
          <Sparkles className="text-violet-500 shrink-0" size={20} />
          <div>
            <div className="text-xs uppercase tracking-wide text-violet-500 font-semibold mb-1">AI summary</div>
            <p className="text-sm text-gray-700">{summary.text}</p>
          </div>
        </div>
      )}
      {summary?.provider === 'none' && (
        <div className="text-xs text-gray-400">{summary.note}</div>
      )}

      <div className="flex gap-2 border-b">
        {([['forecast', 'Forecast', TrendingUp], ['anomalies', 'Anomalies', Activity], ['segments', 'Segments', Users]] as [Tab, string, any][]).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={clsx('flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px',
              tab === id ? 'border-violet-600 text-violet-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700')}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {tab === 'forecast' && <ForecastTab />}
      {tab === 'anomalies' && <AnomaliesTab />}
      {tab === 'segments' && <SegmentsTab />}
    </div>
  );
}

function ForecastTab() {
  const [data, setData] = useState<any>(null);
  const [metric, setMetric] = useState<'revenue' | 'orders'>('revenue');
  const [horizon, setHorizon] = useState(7);

  const load = async () => {
    const r = await api.getAIForecast({ metric, horizon: String(horizon), days: '60' });
    setData(r.data);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [metric, horizon]);

  if (!data) return <div className="text-gray-500">Loading…</div>;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select value={metric} onChange={(e) => setMetric(e.target.value as any)} className="border rounded px-3 py-1.5 text-sm">
          <option value="revenue">Revenue</option><option value="orders">Orders</option>
        </select>
        <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} className="border rounded px-3 py-1.5 text-sm">
          {[7, 14, 30].map((h) => <option key={h} value={h}>Next {h} days</option>)}
        </select>
        <span className="text-xs text-gray-500">
          trend <b className={data.trend === 'UP' ? 'text-emerald-600' : data.trend === 'DOWN' ? 'text-rose-600' : ''}>{data.trend}</b> ·
          fit r²={data.r2} · confidence {data.confidence}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Card label="Baseline avg" value={String(data.baselineAvg)} />
        <Card label="Slope / day" value={String(data.slope)} />
        <Card label={`Total next ${data.horizonDays}d`} value={String(data.totalPredicted)} />
      </div>
      <div className="bg-white rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-start text-gray-500">
            <tr><th className="p-3">Date</th><th className="p-3 text-end">Predicted</th><th className="p-3 text-end">80% range</th></tr>
          </thead>
          <tbody className="divide-y">
            {data.forecast.map((f: any) => (
              <tr key={f.date}>
                <td className="p-3">{f.date}</td>
                <td className="p-3 text-end font-medium">{f.predicted}</td>
                <td className="p-3 text-end text-gray-400">{f.lower} – {f.upper}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnomaliesTab() {
  const [data, setData] = useState<any>(null);
  const [metric, setMetric] = useState<'revenue' | 'orders'>('revenue');
  const load = async () => { const r = await api.getAIAnomalies({ metric, days: '60' }); setData(r.data); };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [metric]);

  if (!data) return <div className="text-gray-500">Loading…</div>;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select value={metric} onChange={(e) => setMetric(e.target.value as any)} className="border rounded px-3 py-1.5 text-sm">
          <option value="revenue">Revenue</option><option value="orders">Orders</option>
        </select>
        <span className="text-xs text-gray-500">mean {data.stats.mean} · σ {data.stats.stdDev} · threshold {data.threshold}σ</span>
      </div>
      <div className="bg-white rounded-lg border">
        <div className="p-4 border-b font-semibold">Flagged days ({data.anomalies.length})</div>
        <div className="divide-y">
          {data.anomalies.map((a: any) => (
            <div key={a.index} className="p-3 flex items-center justify-between">
              <span className="text-sm">{a.date}</span>
              <span className={clsx('text-sm font-medium', a.direction === 'HIGH' ? 'text-emerald-600' : 'text-rose-600')}>
                {a.value} ({a.direction}, z={a.zScore})
              </span>
            </div>
          ))}
          {data.anomalies.length === 0 && <div className="p-8 text-center text-gray-500">No anomalies detected — activity is within normal range</div>}
        </div>
      </div>
    </div>
  );
}

const SEGMENT_TONE: Record<string, string> = {
  CHAMPIONS: 'bg-emerald-100 text-emerald-700',
  LOYAL: 'bg-blue-100 text-blue-700',
  POTENTIAL_LOYALIST: 'bg-cyan-100 text-cyan-700',
  NEW_CUSTOMERS: 'bg-violet-100 text-violet-700',
  AT_RISK: 'bg-amber-100 text-amber-700',
  CANNOT_LOSE: 'bg-orange-100 text-orange-700',
  HIBERNATING: 'bg-gray-100 text-gray-600',
  LOST: 'bg-rose-100 text-rose-700',
  NEEDS_ATTENTION: 'bg-yellow-100 text-yellow-700',
};

function SegmentsTab() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api.getAISegments({ limit: '500' }).then((r) => setData(r.data)); }, []);
  if (!data) return <div className="text-gray-500">Loading…</div>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {data.summary.map((s: any) => (
          <div key={s.segment} className="bg-white rounded-lg border p-3">
            <span className={clsx('text-xs px-2 py-0.5 rounded', SEGMENT_TONE[s.segment] || 'bg-gray-100 text-gray-600')}>{s.segment.replace(/_/g, ' ')}</span>
            <div className="text-xl font-bold mt-2">{s.customers}</div>
            <div className="text-xs text-gray-400">{s.revenue.toFixed(2)} lifetime</div>
          </div>
        ))}
        {data.summary.length === 0 && <div className="col-span-full text-gray-500">No customers to segment yet</div>}
      </div>
      <div className="bg-white rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-start text-gray-500">
            <tr><th className="p-3">Customer</th><th className="p-3">Segment</th><th className="p-3 text-end">R</th><th className="p-3 text-end">F</th><th className="p-3 text-end">M</th><th className="p-3 text-end">Spend</th></tr>
          </thead>
          <tbody className="divide-y">
            {data.customers.slice(0, 100).map((c: any) => (
              <tr key={c.customerId}>
                <td className="p-3 font-medium">{c.name || '—'}</td>
                <td className="p-3"><span className={clsx('text-xs px-2 py-0.5 rounded', SEGMENT_TONE[c.segment] || 'bg-gray-100 text-gray-600')}>{c.segment.replace(/_/g, ' ')}</span></td>
                <td className="p-3 text-end">{c.r}</td><td className="p-3 text-end">{c.f}</td><td className="p-3 text-end">{c.m}</td>
                <td className="p-3 text-end">{c.monetary.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
