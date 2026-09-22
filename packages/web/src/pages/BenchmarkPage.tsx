import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { BarChart3, Lock, Users, Table2, ShieldCheck, LineChart } from 'lucide-react';
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  Field,
  JsonBox,
  PageHeader,
  Stat,
  Table,
  Td,
  Th,
  call,
  ghostButton,
  inputClass,
} from '../components/GlobalUi';

/**
 * Peer benchmarking (§ benchmark). The numbers here are deliberately not exact:
 * a cohort below k publishes nothing, outliers are clipped to the 5th/95th
 * percentile, and a Laplace draw is added to every published statistic. This
 * screen surfaces the privacy ledger next to the chart, because a benchmark
 * merchants can trust is one they can also audit.
 */

/** Format a value the way the metric's unit demands. */
function fmt(value: unknown, unit?: string): string {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  if (unit === 'CURRENCY') return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (unit === 'PERCENT') return `${n.toFixed(1)}%`;
  if (unit === 'RATIO') return n.toFixed(2);
  return String(Math.round(n));
}

export default function BenchmarkPage() {
  const [metrics, setMetrics] = useState<any>(null);
  const [all, setAll] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [snapshots, setSnapshots] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [cohort, setCohort] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState('90');
  const [selected, setSelected] = useState('avg_basket');

  const load = useCallback(async () => {
    const params = { windowDays };
    const [m, a, p, s] = await Promise.all([
      call(() => api.getBenchmarkMetrics(), setError),
      call(() => api.getAllBenchmarks(params), setError),
      call(() => api.getBenchmarkProfile(), setError),
      call(() => api.getBenchmarkSnapshots(), setError),
    ]);
    setMetrics(m);
    setAll(a);
    setProfile(p);
    setSnapshots(s);
  }, [windowDays]);

  useEffect(() => {
    load();
  }, [load]);

  const openMetric = async (key: string) => {
    setSelected(key);
    const [d, c] = await Promise.all([
      call(() => api.getBenchmark({ metric: key, windowDays }), setError),
      call(() => api.getBenchmarkCohort(key, { windowDays }), setError),
    ]);
    setDetail(d);
    setCohort(c);
  };

  const rows: any[] = all?.metrics || [];
  const publishedRows = rows.filter((r) => r.publishable);
  const snap: any[] = snapshots?.snapshots || [];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Peer Benchmarking"
        subtitle="How this business compares with similar ones — computed under k-anonymity, outlier clipping and differential-privacy noise, so no peer can be identified from the answer."
        actions={
          <>
            <Field label="">
              <select className={inputClass} value={windowDays} onChange={(e) => setWindowDays(e.target.value)}>
                {['30', '90', '180', '365'].map((d) => <option key={d} value={d}>Last {d} days</option>)}
              </select>
            </Field>
            <button className={ghostButton} onClick={load}>Refresh</button>
          </>
        }
      />
      <ErrorNote message={error} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Published metrics" value={`${all?.published ?? 0}/${all?.total ?? 0}`} tone={all?.published ? 'good' : 'warn'} hint="cells clearing k" />
        <Stat label="Cohort" value={profile?.cohortKey || '—'} hint="market · trade · size band" />
        <Stat label="Minimum cohort (k)" value={metrics?.privacy?.minCohort ?? '—'} hint={`ε = ${metrics?.privacy?.epsilon ?? '—'} · clipping ${metrics?.privacy?.clipping ?? '—'}`} />
        <Stat
          label="Participation"
          value={detail?.participation?.rate != null ? `${detail.participation.rate}%` : '—'}
          tone={detail?.participation?.representative ? 'good' : 'warn'}
          hint={detail?.participation ? `${detail.participation.reporting}/${detail.participation.eligible} peers reporting` : 'representative at ≥25%'}
        />
        <Stat label="Snapshots" value={snap.length} hint="cached from the nightly job" />
      </div>

      <Card title="Every metric at a glance" icon={<BarChart3 size={18} />}>
        <Table head={<tr><Th>Metric</Th><Th>You</Th><Th>Peer median</Th><Th>p25</Th><Th>p75</Th><Th>Percentile</Th><Th>Verdict</Th><Th /></tr>}>
          {rows.map((r: any) => {
            const better = r.higherIsBetter;
            const ahead = r.percentile != null && (better ? r.percentile >= 50 : r.percentile <= 50);
            return (
              <tr key={r.metricKey}>
                <Td className="font-medium">
                  {r.label}
                  <div className="text-xs text-gray-500">{r.higherIsBetter ? 'higher is better' : 'lower is better'}</div>
                </Td>
                <Td className="tabular-nums">{fmt(r.self, r.unit)}</Td>
                <Td className="tabular-nums">{r.publishable ? fmt(r.median, r.unit) : <Badge tone="warn">suppressed</Badge>}</Td>
                <Td className="tabular-nums text-gray-600">{fmt(r.p25, r.unit)}</Td>
                <Td className="tabular-nums text-gray-600">{fmt(r.p75, r.unit)}</Td>
                <Td className="tabular-nums">{r.percentile != null ? `${Math.round(r.percentile)}th` : '—'}</Td>
                <Td>{r.publishable ? <Badge tone={ahead ? 'good' : 'warn'}>{ahead ? 'AHEAD' : 'BEHIND'}</Badge> : <span className="text-xs text-gray-400">cohort &lt; k</span>}</Td>
                <Td className="text-right"><button className={ghostButton} onClick={() => openMetric(r.metricKey)}>Inspect</button></Td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><Td colSpan={8}><Empty>No metrics computed yet.</Empty></Td></tr>}
        </Table>
        {publishedRows.length === 0 && (
          <p className="text-sm text-amber-700 mt-2 flex items-center gap-1">
            <Lock size={14} /> Nothing is publishable for your cohort yet. Nothing is published below k — an empty chart here is the privacy model working, not a failure.
          </p>
        )}
      </Card>

      {detail && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={`${detail.metric?.label || selected} — your position`} icon={<BarChart3 size={18} />}>
            <p className="text-sm text-gray-700 mb-3">{detail.headline}</p>
            {detail.cohort ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="You" value={fmt(detail.self, detail.metric?.unit)} />
                  <Stat label="Peer median" value={fmt(detail.cohort.median, detail.metric?.unit)} hint={`noise ±${Math.abs(detail.cohort.noiseApplied)} applied`} />
                  <Stat label="Percentile" value={detail.cohort.self?.percentile ?? '—'} tone={detail.cohort.self?.verdict === 'AHEAD' ? 'good' : detail.cohort.self?.verdict === 'BEHIND' ? 'warn' : 'default'} hint={detail.cohort.self?.verdict} />
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">Distribution (noised quantiles)</div>
                  <div className="flex items-end gap-1 h-20">
                    {[
                      ['p10', detail.cohort.p10],
                      ['p25', detail.cohort.p25],
                      ['median', detail.cohort.median],
                      ['p75', detail.cohort.p75],
                      ['p90', detail.cohort.p90],
                    ].map(([label, value]: any) => {
                      const nums = [detail.cohort.p10, detail.cohort.p90].filter((n: any) => n != null);
                      const max = Math.max(...nums, 1);
                      const height = value == null ? 0 : Math.max(6, (Math.abs(value) / Math.abs(max)) * 100);
                      return (
                        <div key={label} className="flex-1 flex flex-col items-center gap-1">
                          <div className="w-full bg-blue-100 rounded-t hover:bg-blue-200" style={{ height: `${height}%` }} title={String(value)} />
                          <div className="text-[10px] text-gray-500">{label}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="text-xs text-gray-500">
                  {detail.cohort.cohortSize} peers in cohort · {detail.cohort.clipped} outlier value(s) clipped to the 5th/95th percentile · range {fmt(detail.cohort.range?.min, detail.metric?.unit)}–{fmt(detail.cohort.range?.max, detail.metric?.unit)}
                </div>
              </div>
            ) : (
              <div className="text-sm bg-gray-50 border rounded p-3">
                <div className="flex items-center gap-2 text-gray-700"><Lock size={15} /> Suppressed — {detail.privacy?.reason || `cohort of ${detail.privacy?.cohortSize} is below the minimum of ${detail.privacy?.minimumRequired}`}</div>
                <p className="text-xs text-gray-500 mt-2">
                  Even the median would narrow the answer down to a handful of named businesses, so no figure at all is released for this cell.
                </p>
              </div>
            )}
          </Card>

          <Card title="Privacy ledger for this cell" icon={<ShieldCheck size={18} />}>
            <Table head={<tr><Th>Control</Th><Th>Value</Th></tr>}>
              <tr><Td>Cohort size</Td><Td className="tabular-nums">{detail.privacy?.cohortSize ?? '—'}</Td></tr>
              <tr><Td>Minimum required (k)</Td><Td className="tabular-nums">{detail.privacy?.minimumRequired ?? '—'}</Td></tr>
              <tr><Td>Publishable</Td><Td><Badge tone={detail.privacy?.publishable ? 'good' : 'bad'}>{detail.privacy?.publishable ? 'YES' : 'SUPPRESSED'}</Badge></Td></tr>
              <tr><Td>Epsilon (ε)</Td><Td className="tabular-nums">{detail.privacy?.epsilon ?? '—'}</Td></tr>
              <tr><Td>Noise added</Td><Td className="tabular-nums">{detail.privacy?.noiseApplied ?? 0}</Td></tr>
              <tr><Td>Outliers clipped</Td><Td className="tabular-nums">{detail.privacy?.clipped ?? 0}</Td></tr>
              <tr><Td>Window</Td><Td>{detail.windowDays} days</Td></tr>
            </Table>
            {cohort && (
              <div className="mt-3">
                <div className="text-sm text-gray-600 mb-1">
                  {cohort.publishable ? 'Market shape (individual values are never returned):' : `Cohort ${cohort.cohortSize} < k ${cohort.minimumRequired} — ${cohort.message}`}
                </div>
                {cohort.publishable && <JsonBox value={{ cohortSize: cohort.cohortSize, shape: cohort.shape, range: cohort.range, verdict: cohort.verdict, noiseApplied: cohort.noiseApplied }} />}
              </div>
            )}
          </Card>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="How you are grouped" icon={<Users size={18} />}>
          <div className="text-sm space-y-1">
            <div><span className="text-gray-500">Market:</span> {profile?.countryCode || '—'}</div>
            <div><span className="text-gray-500">Trade:</span> {profile?.industry || '—'}</div>
            <div><span className="text-gray-500">Revenue proxy:</span> {profile?.annualRevenueProxy != null ? Number(profile.annualRevenueProxy).toLocaleString() : '—'}</div>
            <div><span className="text-gray-500">Size band:</span> <Badge tone="info">{profile?.band || '—'}</Badge></div>
            <div><span className="text-gray-500">Cohort key:</span> <code className="text-xs">{profile?.cohortKey || '—'}</code></div>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            A kiosk is never compared with a hypermarket: country, trade and revenue band all have to match before a store counts as your peer.
          </p>
          {profile?.values && <JsonBox value={profile.values} />}
        </Card>

        <Card title="Worst three first" icon={<LineChart size={18} />}>
          <Table head={<tr><Th>Metric</Th><Th>You</Th><Th>Median</Th><Th>Percentile</Th></tr>}>
            {(all?.worstToFirst || []).map((r: any) => (
              <tr key={r.metricKey}>
                <Td className="font-medium">{r.label}</Td>
                <Td className="tabular-nums">{fmt(r.self, r.unit)}</Td>
                <Td className="tabular-nums text-gray-600">{fmt(r.median, r.unit)}</Td>
                <Td className="tabular-nums">{Math.round(r.percentile ?? 0)}th</Td>
              </tr>
            ))}
            {(all?.worstToFirst || []).length === 0 && <tr><Td colSpan={4}><Empty>Nothing publishable to rank yet.</Empty></Td></tr>}
          </Table>
          <p className="text-xs text-gray-500 mt-2">Ranked by percentile, adjusted for direction — for labour cost and shrink, a low percentile is the good result.</p>
        </Card>
      </div>

      <Card title={`Cached snapshots (${snap.length})`} icon={<Table2 size={18} />} actions={<button className={ghostButton} onClick={load}>Reload</button>}>
        <Table head={<tr><Th>Generated</Th><Th>Cohort</Th><Th>Metric</Th><Th>Size / k</Th><Th>Median</Th><Th>p25</Th><Th>p75</Th><Th>Noise</Th></tr>}>
          {snap.slice(0, 25).map((s: any) => (
            <tr key={s.id}>
              <Td className="text-xs text-gray-500 whitespace-nowrap">{s.generatedAt ? new Date(s.generatedAt).toLocaleString() : '—'}</Td>
              <Td className="text-xs font-mono">{s.countryCode} · {s.industry}</Td>
              <Td className="font-medium">{s.metricKey}</Td>
              <Td className="tabular-nums">
                {s.cohortSize}/{s.kValue}{' '}
                <Badge tone={s.publishable ? 'good' : 'warn'}>{s.publishable ? 'PUBLISHED' : 'SUPPRESSED'}</Badge>
              </Td>
              <Td className="tabular-nums">{s.median == null ? '—' : Number(s.median).toFixed(2)}</Td>
              <Td className="tabular-nums text-gray-600">{s.p25 == null ? '—' : Number(s.p25).toFixed(2)}</Td>
              <Td className="tabular-nums text-gray-600">{s.p75 == null ? '—' : Number(s.p75).toFixed(2)}</Td>
              <Td className="tabular-nums text-gray-500">{Number(s.noiseApplied).toFixed(2)}</Td>
            </tr>
          ))}
          {snap.length === 0 && <tr><Td colSpan={8}><Empty>The nightly benchmark job has not run for this tenant yet.</Empty></Td></tr>}
        </Table>
      </Card>
    </div>
  );
}
