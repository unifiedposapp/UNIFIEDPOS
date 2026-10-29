import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import {
  Table2,
  Play,
  Save,
  Download,
  Trash2,
  Plus,
  RefreshCw,
  Clock,
  CheckCircle2,
} from 'lucide-react';

/**
 * Custom report builder (§16 reporting).
 *
 * The server publishes a closed vocabulary of sources and columns; this page is
 * the picker for it. Nothing is queried directly from the browser — a report is
 * a definition the API validates before it reads a single row, which is why an
 * unknown column fails here rather than returning an empty table.
 */

const isoDate = (d: Date) => {
  const copy = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return copy.toISOString().slice(0, 10);
};

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type ColumnDef = { key: string; label: string; type: string; summable?: boolean };
type SourceDef = { source: string; label: string; columns: ColumnDef[] };

type FilterRow = { key: string; op: 'eq' | 'ne' | 'gte' | 'lte' | 'contains'; value: string };

export default function ReportBuilderPage() {
  const [sources, setSources] = useState<SourceDef[]>([]);
  const [definitions, setDefinitions] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [source, setSource] = useState('');
  const [columns, setColumns] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState('');
  const [sortBy, setSortBy] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [range, setRange] = useState(() => {
    const now = new Date();
    return {
      from: isoDate(new Date(now.getTime() - 30 * 86_400_000)),
      to: isoDate(new Date(now.getTime() + 86_400_000)),
    };
  });
  const [filters, setFilters] = useState<FilterRow[]>([]);

  const [result, setResult] = useState<any>(null);

  const [saveName, setSaveName] = useState('');
  const [saveCron, setSaveCron] = useState('');
  const [saveRecipients, setSaveRecipients] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [srcRes, defRes, runRes] = await Promise.all([
        api.getReportSources(),
        api.getReportDefinitions(),
        api.getReportRuns(),
      ]);
      const list: SourceDef[] = srcRes.data || [];
      setSources(list);
      setDefinitions(defRes.data || []);
      setRuns(runRes.data || []);
      if (!source && list.length > 0) {
        const first = list[0];
        setSource(first.source);
        // Start with a readable default rather than an empty table.
        setColumns(first.columns.slice(0, 5).map((c) => c.key));
      }
    } catch (err: any) {
      setError(err?.message || 'Could not load the report vocabulary');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeSource = useMemo(() => sources.find((s) => s.source === source), [sources, source]);

  function changeSource(next: string) {
    setSource(next);
    setGroupBy('');
    setSortBy('');
    setFilters([]);
    setResult(null);
    const def = sources.find((s) => s.source === next);
    setColumns(def ? def.columns.slice(0, 5).map((c) => c.key) : []);
  }

  function toggleColumn(key: string) {
    setColumns((prev) => (prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]));
    if (groupBy === key) setGroupBy('');
    if (sortBy === key) setSortBy('');
  }

  /** Filters are grouped by operator, then keyed by column, matching FilterSet. */
  function buildFilters() {
    const out: Record<string, Record<string, unknown>> = {};
    for (const f of filters) {
      if (!f.key || f.value === '') continue;
      const column = activeSource?.columns.find((c) => c.key === f.key);
      const value = column?.type === 'number' ? Number(f.value) : f.value;
      if (column?.type === 'number' && Number.isNaN(value as number)) continue;
      out[f.op] = { ...(out[f.op] ?? {}), [f.key]: value };
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  function runInput() {
    return {
      source,
      columns,
      filters: buildFilters(),
      groupBy: groupBy || null,
      sortBy: sortBy || null,
      sortDir,
      from: range.from,
      to: range.to,
      limit: 5000,
    };
  }

  async function runReport() {
    if (columns.length === 0) {
      alert('Pick at least one column.');
      return;
    }
    setBusy('run');
    setError('');
    try {
      const res = await api.runReport(runInput());
      setResult(res.data);
    } catch (err: any) {
      setResult(null);
      setError(err?.body?.errors?.join(' · ') || err?.message || 'The report could not be built');
    } finally {
      setBusy('');
    }
  }

  async function exportCsv() {
    setBusy('csv');
    try {
      const blob = await api.downloadFile('/reports/run', {
        method: 'POST',
        body: { ...runInput(), format: 'csv' },
      });
      saveBlob(blob, `report-${source.toLowerCase()}.csv`);
    } catch (err: any) {
      alert(err?.message || 'Could not export the CSV');
    } finally {
      setBusy('');
    }
  }

  async function saveDefinition() {
    if (!saveName) {
      alert('Give the report a name.');
      return;
    }
    if (columns.length === 0) {
      alert('Pick at least one column before saving.');
      return;
    }
    setBusy('save');
    try {
      await api.createReportDefinition({
        name: saveName,
        source,
        columns,
        filters: buildFilters(),
        groupBy: groupBy || null,
        sortBy: sortBy || null,
        sortDir,
        scheduleCron: saveCron || null,
        recipients: saveRecipients
          ? saveRecipients
              .split(',')
              .map((r) => r.trim())
              .filter(Boolean)
          : [],
      });
      setSaveName('');
      setSaveCron('');
      setSaveRecipients('');
      setNotice('Saved. It will appear under saved reports and can be scheduled.');
      await load();
    } catch (err: any) {
      setError(err?.body?.errors?.join(' · ') || err?.message || 'Could not save the report');
    } finally {
      setBusy('');
    }
  }

  async function runSaved(definition: any) {
    setBusy(definition.id);
    try {
      const res = await api.runReportDefinition(definition.id);
      setResult(res.data);
      setSource(String(definition.source));
      setColumns(definition.columns ?? []);
      setGroupBy(definition.groupBy ?? '');
      setSortBy(definition.sortBy ?? '');
      await load();
    } catch (err: any) {
      setError(err?.body?.errors?.join(' · ') || err?.message || 'Could not run the saved report');
    } finally {
      setBusy('');
    }
  }

  async function exportSaved(definition: any) {
    setBusy(`csv-${definition.id}`);
    try {
      const blob = await api.downloadFile(`/reports/definitions/${definition.id}/run`, {
        method: 'POST',
        body: { format: 'csv' },
      });
      saveBlob(blob, `${definition.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.csv`);
    } catch (err: any) {
      alert(err?.message || 'Could not export the CSV');
    } finally {
      setBusy('');
    }
  }

  async function removeDefinition(id: string) {
    if (!confirm('Delete this saved report?')) return;
    try {
      await api.deleteReportDefinition(id);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not delete the report');
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Report Builder</h1>
          <p className="text-gray-500">
            Choose a source, pick your columns, group and filter — then save it or schedule it
          </p>
        </div>
        <button onClick={load} className="p-2 border rounded-lg bg-white hover:bg-gray-50" title="Reload">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {notice && (
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-4 py-3 text-sm">
          <CheckCircle2 size={16} className="mt-0.5" />
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice('')} className="text-blue-600 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      <div className="bg-white rounded-lg border p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-xs font-medium text-gray-600">
            Source
            <select
              value={source}
              onChange={(e) => changeSource(e.target.value)}
              className="mt-1 w-full border rounded px-3 py-2 text-sm"
            >
              {sources.map((s) => (
                <option key={s.source} value={s.source}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-gray-600">
            From
            <input
              type="date"
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
              className="mt-1 w-full border rounded px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-gray-600">
            To
            <input
              type="date"
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
              className="mt-1 w-full border rounded px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-gray-600">
            Group by
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value)}
              className="mt-1 w-full border rounded px-3 py-2 text-sm"
            >
              <option value="">No grouping (one row each)</option>
              {(activeSource?.columns ?? []).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <div className="text-xs font-medium text-gray-600 mb-2">Columns</div>
          <div className="flex flex-wrap gap-2">
            {(activeSource?.columns ?? []).map((c) => {
              const on = columns.includes(c.key);
              return (
                <button
                  key={c.key}
                  onClick={() => toggleColumn(c.key)}
                  className={`px-3 py-1 rounded-full text-xs border ${
                    on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                  title={`${c.type}${c.summable ? ' · totalled' : ''}`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-xs font-medium text-gray-600">
            Sort by
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="mt-1 w-full border rounded px-3 py-2 text-sm"
            >
              <option value="">Source order</option>
              {(activeSource?.columns ?? []).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-gray-600">
            Direction
            <select
              value={sortDir}
              onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}
              className="mt-1 w-full border rounded px-3 py-2 text-sm"
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </label>
          <div className="md:col-span-2">
            <div className="text-xs font-medium text-gray-600 mb-1">Filters</div>
            <div className="space-y-2">
              {filters.map((f, index) => (
                <div key={index} className="flex items-center gap-2">
                  <select
                    value={f.key}
                    onChange={(e) => {
                      const next = [...filters];
                      next[index] = { ...next[index], key: e.target.value };
                      setFilters(next);
                    }}
                    className="border rounded px-2 py-1 text-sm flex-1"
                  >
                    <option value="">Column…</option>
                    {(activeSource?.columns ?? []).map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={f.op}
                    onChange={(e) => {
                      const next = [...filters];
                      next[index] = { ...next[index], op: e.target.value as FilterRow['op'] };
                      setFilters(next);
                    }}
                    className="border rounded px-2 py-1 text-sm"
                  >
                    <option value="eq">=</option>
                    <option value="ne">≠</option>
                    <option value="gte">≥</option>
                    <option value="lte">≤</option>
                    <option value="contains">contains</option>
                  </select>
                  <input
                    value={f.value}
                    onChange={(e) => {
                      const next = [...filters];
                      next[index] = { ...next[index], value: e.target.value };
                      setFilters(next);
                    }}
                    placeholder="Value"
                    className="border rounded px-2 py-1 text-sm w-28"
                  />
                  <button
                    onClick={() => setFilters(filters.filter((_, i) => i !== index))}
                    className="text-gray-400 hover:text-rose-600"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => setFilters([...filters, { key: '', op: 'eq', value: '' }])}
                className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
              >
                <Plus size={12} /> Add a filter
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t pt-4">
          <button
            onClick={exportCsv}
            disabled={busy === 'csv' || columns.length === 0}
            className="flex items-center gap-2 px-4 py-2 border rounded-lg text-sm bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            <Download size={16} /> {busy === 'csv' ? 'Exporting…' : 'Export CSV'}
          </button>
          <button
            onClick={runReport}
            disabled={busy === 'run'}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            <Play size={16} /> {busy === 'run' ? 'Running…' : 'Run report'}
          </button>
        </div>
      </div>

      {result && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h2 className="font-semibold flex items-center gap-2">
              <Table2 size={18} /> Result
            </h2>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span>
                {result.matchedRows ?? result.rows?.length ?? 0} matched rows · showing{' '}
                {result.rows?.length ?? 0}
              </span>
              <span className="flex items-center gap-1">
                <Clock size={12} /> {result.durationMs ?? 0} ms
              </span>
              {result.truncated && (
                <span className="text-amber-700 bg-amber-100 px-2 py-0.5 rounded">truncated</span>
              )}
            </div>
          </div>

          {(result.rows ?? []).length === 0 ? (
            <div className="p-6 text-sm text-gray-500">
              No rows match this definition. Widen the date range or loosen a filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    {(result.columns ?? []).map((c: ColumnDef) => (
                      <th
                        key={c.key}
                        className={`px-4 py-2 ${c.type === 'number' ? 'text-right' : 'text-left'}`}
                      >
                        {c.label}
                      </th>
                    ))}
                    {groupBy && <th className="px-4 py-2 text-right">Count</th>}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {result.rows.map((row: any, i: number) => (
                    <tr key={i} className="hover:bg-gray-50">
                      {(result.columns ?? []).map((c: ColumnDef) => (
                        <td
                          key={c.key}
                          className={`px-4 py-2 ${c.type === 'number' ? 'text-right tabular-nums' : ''}`}
                        >
                          {c.type === 'date' && row[c.key]
                            ? new Date(row[c.key]).toLocaleString()
                            : c.type === 'number'
                              ? Number(row[c.key] ?? 0).toFixed(2)
                              : typeof row[c.key] === 'boolean'
                                ? row[c.key]
                                  ? 'Yes'
                                  : 'No'
                                : (row[c.key] ?? '—')}
                        </td>
                      ))}
                      {groupBy && <td className="px-4 py-2 text-right tabular-nums">{row.count ?? ''}</td>}
                    </tr>
                  ))}
                </tbody>
                {result.totals && Object.keys(result.totals).length > 0 && (
                  <tfoot className="bg-gray-50 font-medium">
                    <tr>
                      {(result.columns ?? []).map((c: ColumnDef, index: number) => (
                        <td key={c.key} className={`px-4 py-2 ${c.type === 'number' ? 'text-right tabular-nums' : ''}`}>
                          {index === 0
                            ? 'Totals'
                            : c.summable && result.totals[c.key] !== undefined
                              ? Number(result.totals[c.key]).toFixed(2)
                              : ''}
                        </td>
                      ))}
                      {groupBy && <td />}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border p-6 space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Save size={18} /> Save this report
          </h2>
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="Name (e.g. Daily sales by channel)"
            className="w-full border rounded px-3 py-2 text-sm"
          />
          <input
            value={saveCron}
            onChange={(e) => setSaveCron(e.target.value)}
            placeholder="Schedule (cron, optional) — e.g. 0 7 * * *"
            className="w-full border rounded px-3 py-2 text-sm"
          />
          <input
            value={saveRecipients}
            onChange={(e) => setSaveRecipients(e.target.value)}
            placeholder="Recipients (comma separated emails)"
            className="w-full border rounded px-3 py-2 text-sm"
          />
          <button
            onClick={saveDefinition}
            disabled={busy === 'save'}
            className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            {busy === 'save' ? 'Saving…' : 'Save definition'}
          </button>
          <p className="text-xs text-gray-500">
            A definition is validated when saved, so a scheduled report cannot fail silently later.
          </p>
        </div>

        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="px-4 py-3 border-b font-semibold">Saved reports</div>
          {definitions.length === 0 ? (
            <div className="p-6 text-sm text-gray-500">Nothing saved yet.</div>
          ) : (
            <div className="divide-y">
              {definitions.map((d) => (
                <div key={d.id} className="px-4 py-3 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{d.name}</div>
                    <div className="text-xs text-gray-500">
                      {d.source} · {d.columns?.length ?? 0} columns
                      {d.groupBy ? ` · grouped by ${d.groupBy}` : ''}
                      {d.scheduleCron ? ` · ${d.scheduleCron}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => runSaved(d)}
                      disabled={busy === d.id}
                      className="flex items-center gap-1 text-blue-600 hover:underline disabled:opacity-50 text-xs"
                    >
                      <Play size={12} /> {busy === d.id ? '…' : 'Run'}
                    </button>
                    <button
                      onClick={() => exportSaved(d)}
                      disabled={busy === `csv-${d.id}`}
                      className="flex items-center gap-1 text-blue-600 hover:underline disabled:opacity-50 text-xs"
                    >
                      <Download size={12} /> CSV
                    </button>
                    <button
                      onClick={() => removeDefinition(d.id)}
                      className="text-gray-400 hover:text-rose-600"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold">Recent runs</div>
        {runs.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">No report has been run yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2">Report</th>
                <th className="text-left px-4 py-2">When</th>
                <th className="text-right px-4 py-2">Rows</th>
                <th className="text-right px-4 py-2">Duration</th>
                <th className="text-left px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2">{r.name}</td>
                  <td className="px-4 py-2 text-gray-600">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.rowCount}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.durationMs} ms</td>
                  <td className="px-4 py-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        r.status === 'OK' ? 'bg-green-100 text-green-800' : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {r.status}
                    </span>
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
