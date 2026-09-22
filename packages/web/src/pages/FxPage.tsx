import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { ArrowLeftRight, Download, RefreshCw, Sigma } from 'lucide-react';
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  Field,
  PageHeader,
  Stat,
  Table,
  Td,
  Th,
  call,
  ghostButton,
  inputClass,
  primaryButton,
} from '../components/GlobalUi';

/**
 * Exchange Rates (§ FX layer). A global business quotes and reports in many
 * currencies but consolidates in one, so every conversion must carry the rate
 * it used, where it came from, and how old it is. This page is the tenant's
 * rate table, a provenance-tagged converter, and the manual/import path that
 * feeds the franchise consolidation engine.
 */

interface RateRow {
  id: string;
  from: string;
  to: string;
  rate: number;
  source: string | null;
  effectiveDate: string;
  fetchedAt: string;
}

const IMPORT_TEMPLATE = `USD,NGN,1480.50,2026-09-20
EUR,GBP,0.8600,2026-09-20`;

export default function FxPage() {
  const [rates, setRates] = useState<RateRow[]>([]);
  const [provider, setProvider] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Converter state
  const [amount, setAmount] = useState('100');
  const [from, setFrom] = useState('USD');
  const [to, setTo] = useState('EUR');
  const [result, setResult] = useState<any>(null);
  const [converting, setConverting] = useState(false);

  // Import state
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState(IMPORT_TEMPLATE);
  const [importLive, setImportLive] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    const [r, p] = await Promise.all([
      call(() => api.getFxRates(), setError),
      call(() => api.getFxProvider(), setError),
    ]);
    setRates(r?.rates || []);
    setProvider(p);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const doConvert = async () => {
    setConverting(true);
    setError(null);
    try {
      const res = await api.fxConvert({ amount: Number(amount), from, to });
      setResult(res?.data ?? res);
    } catch (e: any) {
      setResult(null);
      setError(e?.message || 'Conversion failed — no rate available for that pair');
    } finally {
      setConverting(false);
    }
  };

  const doImport = async () => {
    const parsed = importText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const [f, t, rate, date] = line.split(/[,;\t]+/).map((s) => (s || '').trim());
        return { from: f.toUpperCase(), to: t.toUpperCase(), rate: Number(rate), effectiveDate: date || undefined };
      })
      .filter((r) => /^[A-Z]{3}$/.test(r.from) && /^[A-Z]{3}$/.test(r.to) && Number.isFinite(r.rate) && r.rate > 0);
    if (!parsed.length) {
      setError('Nothing to import — expected lines like: USD,NGN,1480.50,2026-09-20');
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const res = await api.importFxRates({ rates: parsed, source: 'MANUAL', fetchLive: importLive });
      const data = res?.data ?? res;
      setImportOpen(false);
      await load();
      setError(null);
      window.alert(`Imported ${data?.upserted ?? parsed.length} rate rows.`);
    } catch (e: any) {
      setError(e?.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const latestPerPair = new Map<string, RateRow>();
  for (const r of rates) {
    const key = `${r.from}|${r.to}`;
    if (!latestPerPair.has(key)) latestPerPair.set(key, r); // already newest-first
  }
  const display = [...latestPerPair.values()];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Exchange Rates"
        subtitle="The tenant FX table behind every multi-currency report: conversions are tagged with their rate, source and age, and nothing is ever silently converted 1:1."
        actions={
          <>
            <button className={ghostButton} onClick={() => setImportOpen((v) => !v)}>
              <Download size={14} className="inline -mt-0.5 mr-1" />
              Import
            </button>
            <button className={ghostButton} onClick={load}>
              <RefreshCw size={14} className="inline -mt-0.5 mr-1" />
              Refresh
            </button>
          </>
        }
      />
      <ErrorNote message={error} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Stored rate rows" value={rates.length} hint="full history" tone={rates.length ? 'good' : 'warn'} />
        <Stat label="Distinct pairs" value={display.length} hint="latest per pair" />
        <Stat
          label="Live provider"
          value={provider?.configured ? 'Configured' : 'Not configured'}
          tone={provider?.configured ? 'good' : 'warn'}
          hint={provider?.configured ? provider?.env : 'set FX_RATES_URL; static fallback in use'}
        />
        <Stat
          label="Last fetched"
          value={provider?.lastFetchedAt ? new Date(provider.lastFetchedAt).toLocaleDateString() : '—'}
          hint={provider?.lastSource || 'no provider pull yet'}
        />
      </div>

      {importOpen && (
        <Card title="Import rates" icon={<Download size={18} />}>
          <p className="mb-2 text-xs text-ink-500">
            One row per line: <code className="rounded bg-ink-50 px-1">FROM,TO,RATE[,EFFECTIVE_DATE]</code>. Rates are upserted per
            pair and effective date; a stale row never shadows a newer quote.
          </p>
          <textarea
            className={inputClass + ' h-32 w-full font-mono text-xs'}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            aria-label="Rate rows to import"
          />
          <label className="mt-2 flex items-center gap-2 text-sm text-ink-600">
            <input type="checkbox" checked={importLive} onChange={(e) => setImportLive(e.target.checked)} />
            Also pull live quotes from the configured provider
          </label>
          <div className="mt-3 flex gap-2">
            <button className={primaryButton} onClick={doImport} disabled={importing}>
              {importing ? 'Importing…' : 'Import rates'}
            </button>
            <button className={ghostButton} onClick={() => setImportOpen(false)}>Cancel</button>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Converter" icon={<ArrowLeftRight size={18} />} className="lg:col-span-1">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Amount">
                <input className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="From">
                  <input className={inputClass} value={from} maxLength={3} onChange={(e) => setFrom(e.target.value.toUpperCase())} />
                </Field>
                <Field label="To">
                  <input className={inputClass} value={to} maxLength={3} onChange={(e) => setTo(e.target.value.toUpperCase())} />
                </Field>
              </div>
            </div>
            <button className={primaryButton} onClick={doConvert} disabled={converting}>
              {converting ? 'Converting…' : 'Convert'}
            </button>
            {result && (
              <div className="rounded-lg border border-ink-100 bg-ink-50/50 p-3 text-sm">
                <div className="flex items-baseline justify-between">
                  <span className="text-ink-500">{`${Number(result.amount).toLocaleString()} ${result.from}`}</span>
                  <span className="text-lg font-semibold text-ink-900">
                    {Number(result.converted).toLocaleString(undefined, { maximumFractionDigits: 2 })} {result.to}
                  </span>
                </div>
                <div className="mt-2 space-y-1 text-xs text-ink-500">
                  <div>1 {result.from} = {result.rate} {result.to} · 1 {result.to} = {result.inverse} {result.from}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={result.method === 'DIRECT' ? 'good' : 'info'}>{result.method}</Badge>
                    <Badge tone={result.basis === 'STORED' ? 'info' : 'warn'}>{result.basis}</Badge>
                    {result.stale && <Badge tone="warn">STALE {result.ageDays != null ? `(${result.ageDays}d)` : ''}</Badge>}
                  </div>
                  <div>source: {result.source}{result.asOf ? ` · as of ${new Date(result.asOf).toLocaleDateString()}` : ''}</div>
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card title="Rate table" icon={<Sigma size={18} />} className="lg:col-span-2">
          {display.length === 0 ? (
            <Empty>No rates stored yet — import a table or configure FX_RATES_URL. Until then conversions use the clearly-labelled STATIC fallback.</Empty>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              <Table head={<tr><Th>Pair</Th><Th>Rate</Th><Th>Source</Th><Th>Effective</Th><Th>Fetched</Th></tr>}>
                {display.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium">{r.from}/{r.to}</Td>
                    <Td className="font-mono">{r.rate}</Td>
                    <Td><Badge tone={String(r.source).startsWith('STATIC') ? 'warn' : 'info'}>{r.source || 'MANUAL'}</Badge></Td>
                    <Td>{new Date(r.effectiveDate).toLocaleDateString()}</Td>
                    <Td>{r.fetchedAt ? new Date(r.fetchedAt).toLocaleString() : '—'}</Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
