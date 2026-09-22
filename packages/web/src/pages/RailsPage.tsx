import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Landmark, Plus, Calculator, CheckCircle2, Trash2, Wallet } from 'lucide-react';
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  Field,
  JsonBox,
  Money,
  PageHeader,
  Stat,
  Table,
  Td,
  Th,
  call,
  dangerButton,
  ghostButton,
  inputClass,
  primaryButton,
} from '../components/GlobalUi';

/**
 * Local payment rails and settlement reconciliation (§ rails).
 *
 * Two halves: which instrument actually moves money in this market, and whether
 * the statement the provider sent matches what we booked. The second is where
 * merchants quietly lose money, so the variance is the headline number.
 */
const SAMPLE_STATEMENT = JSON.stringify(
  [{ reference: 'INV-1001', amount: 250, fee: 1.4 }, { reference: 'INV-1002', amount: 89.5, fee: 0.6 }],
  null,
  2
);

export default function RailsPage() {
  const [catalog, setCatalog] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [quote, setQuote] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState({ railCode: 'SEPA', label: '', identifier: '', holderName: '', isPrimary: true });
  const [quoteForm, setQuoteForm] = useState({ amount: '500', feePercent: '0.3', feeFixed: '0.25' });
  const [statement, setStatement] = useState(SAMPLE_STATEMENT);
  const [reconcile, setReconcile] = useState({ railCode: 'SEPA', provider: 'MANUAL', tolerance: '0.01' });

  const load = useCallback(async () => {
    const [c, a, b] = await Promise.all([
      call(() => api.getRailCatalog(), setError),
      call(() => api.getRailAccounts(), setError),
      call(() => api.getSettlementBatches({ limit: '20' }), setError),
    ]);
    setCatalog(c);
    setAccounts(a || []);
    setBatches(b?.batches || []);
    setTotals(b?.totals || null);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runQuote = async () => {
    const data = await call(
      () => api.quoteRail({ amount: Number(quoteForm.amount), feePercent: Number(quoteForm.feePercent) || 0, feeFixed: Number(quoteForm.feeFixed) || 0 }),
      setError
    );
    setQuote(data);
  };

  const addAccount = async () => {
    if (!account.label || !account.identifier) return;
    await call(() => api.createRailAccount(account), setError);
    setAccount({ ...account, label: '', identifier: '', holderName: '' });
    load();
  };

  const reconcileStatement = async () => {
    let lines: unknown;
    try {
      lines = JSON.parse(statement);
    } catch {
      setError('Statement lines must be valid JSON');
      return;
    }
    if (!Array.isArray(lines) || !lines.length) {
      setError('Statement lines must be a non-empty array');
      return;
    }
    const data = await call(
      () => api.createSettlementBatch({ railCode: reconcile.railCode, provider: reconcile.provider, tolerance: Number(reconcile.tolerance) || 0.01, lines: lines as any }),
      setError
    );
    if (data?.batch) openBatch(data.batch.id);
    load();
  };

  const openBatch = async (id: string) => {
    const data = await call(() => api.getSettlementBatch(id), setError);
    setDetail(data);
  };

  const signOff = async (id: string) => {
    const note = prompt('Note explaining why this variance is accepted:');
    if (note === null) return;
    await call(() => api.signOffSettlement(id, { note }), setError);
    openBatch(id);
    load();
  };

  const available: any[] = catalog?.available || [];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Payment Rails"
        subtitle="The domestic instruments each market actually clears through, and a reconciliation of what the provider settled against what we booked."
      />
      <ErrorNote message={error} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Market" value={catalog?.countryCode || '—'} hint={catalog?.currency ? `settles in ${catalog.currency}` : undefined} />
        <Stat label="Rails available" value={available.length} hint={`${catalog?.coverage?.railCount ?? catalog?.rails?.length ?? 0} known worldwide`} />
        <Stat label="Default rail" value={catalog?.defaultRail?.code || '—'} hint={catalog?.defaultRail?.name} tone={catalog?.defaultRail ? 'good' : 'warn'} />
        <Stat
          label="Open variance"
          value={<Money value={totals?.variance ?? 0} />}
          hint={`${totals?.open ?? 0} batches unreconciled`}
          tone={Math.abs(Number(totals?.variance || 0)) > 1 ? 'bad' : 'good'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Rails in this market" icon={<Landmark size={18} />}>
          <Table head={<tr><Th>Rail</Th><Th>Settlement</Th><Th>Identifier</Th><Th>Limits</Th><Th /></tr>}>
            {available.map((r: any) => (
              <tr key={r.code}>
                <Td>
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-gray-500">{r.code} · {r.currencies.join(', ')}</div>
                </Td>
                <Td>{r.instant ? <Badge tone="good">INSTANT</Badge> : `T+${r.settlementDays}`}</Td>
                <Td className="text-gray-600">{r.identifierKind}</Td>
                <Td className="text-xs text-gray-500">{r.maxAmount ? `≤ ${Number(r.maxAmount).toLocaleString()}` : '—'}{r.reversible ? ' · reversible' : ''}</Td>
                <Td>
                  <button
                    className={ghostButton}
                    onClick={() => {
                      setReconcile({ ...reconcile, railCode: r.code });
                      setAccount({ ...account, railCode: r.code });
                    }}
                  >
                    Use
                  </button>
                </Td>
              </tr>
            ))}
            {available.length === 0 && <tr><Td colSpan={5}><Empty>No domestic rail is mapped for this market yet.</Empty></Td></tr>}
          </Table>
          {available.some((r: any) => r.notes) && (
            <p className="text-xs text-gray-500 mt-3">{available.find((r: any) => r.notes)?.notes}</p>
          )}
        </Card>

        <Card title="Route a payment" icon={<Calculator size={18} />}>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Amount"><input className={inputClass} value={quoteForm.amount} onChange={(e) => setQuoteForm({ ...quoteForm, amount: e.target.value })} /></Field>
            <Field label="Fee %"><input className={inputClass} value={quoteForm.feePercent} onChange={(e) => setQuoteForm({ ...quoteForm, feePercent: e.target.value })} /></Field>
            <Field label="Fee fixed"><input className={inputClass} value={quoteForm.feeFixed} onChange={(e) => setQuoteForm({ ...quoteForm, feeFixed: e.target.value })} /></Field>
          </div>
          <button className={primaryButton + ' mt-2'} onClick={runQuote}>Compare rails</button>
          {quote && (
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge tone="info">{quote.rail?.code}</Badge>
                <span className="font-medium">{quote.rail?.name}</span>
                {quote.overRailLimit && <Badge tone="bad">OVER LIMIT</Badge>}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="border rounded p-2"><div className="text-xs text-gray-500">Fee</div><Money value={quote.fee} /></div>
                <div className="border rounded p-2"><div className="text-xs text-gray-500">Net</div><Money value={quote.net} /></div>
                <div className="border rounded p-2"><div className="text-xs text-gray-500">Settles</div>{new Date(quote.settlesOn).toLocaleDateString()}</div>
              </div>
              {quote.alternatives?.length > 0 && (
                <div className="text-xs text-gray-500">
                  Also viable: {quote.alternatives.map((a: any) => `${a.code}${a.instant ? ' (instant)' : ` T+${a.settlementDays}`}`).join(', ')}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <Card title={`Receiving accounts (${accounts.length})`} icon={<Wallet size={18} />}>
        <Table head={<tr><Th>Label</Th><Th>Rail</Th><Th>Identifier</Th><Th>Validation</Th><Th>Primary</Th><Th /></tr>}>
          {accounts.map((a: any) => (
            <tr key={a.id}>
              <Td className="font-medium">{a.label}</Td>
              <Td>{a.railCode} · {a.countryCode}</Td>
              <Td><code className="text-xs">{a.identifier}</code></Td>
              <Td>
                <Badge>{a.verification}</Badge>
                {a.validationNote && <div className="text-xs text-gray-500 mt-0.5">{a.validationNote}</div>}
              </Td>
              <Td>{a.isPrimary ? '✓' : ''}</Td>
              <Td className="text-right whitespace-nowrap">
                {!a.isPrimary && (
                  <button className={ghostButton} onClick={async () => { await call(() => api.setPrimaryRailAccount(a.id), setError); load(); }}>
                    Make primary
                  </button>
                )}{' '}
                <button className={dangerButton} onClick={async () => { await call(() => api.removeRailAccount(a.id), setError); load(); }}>
                  <Trash2 size={14} />
                </button>
              </Td>
            </tr>
          ))}
          {accounts.length === 0 && <tr><Td colSpan={6}><Empty>No receiving instruments registered.</Empty></Td></tr>}
        </Table>

        <div className="grid md:grid-cols-5 gap-2 mt-4">
          <Field label="Rail">
            <select className={inputClass} value={account.railCode} onChange={(e) => setAccount({ ...account, railCode: e.target.value })}>
              {(catalog?.rails || []).map((r: any) => (
                <option key={r.code} value={r.code}>{r.code} — {r.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Label"><input className={inputClass} value={account.label} onChange={(e) => setAccount({ ...account, label: e.target.value })} placeholder="Main operating account" /></Field>
          <Field label="Identifier" hint="Checked against the rail's own algorithm">
            <input className={inputClass} value={account.identifier} onChange={(e) => setAccount({ ...account, identifier: e.target.value })} placeholder="DE89370400440532013000" />
          </Field>
          <Field label="Holder name"><input className={inputClass} value={account.holderName} onChange={(e) => setAccount({ ...account, holderName: e.target.value })} /></Field>
          <Field label="Primary">
            <input type="checkbox" checked={account.isPrimary} onChange={(e) => setAccount({ ...account, isPrimary: e.target.checked })} className="mt-2" />
          </Field>
        </div>
        <button className={primaryButton + ' mt-2'} onClick={addAccount}><Plus size={15} /> Register account</button>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Reconcile a provider statement" icon={<CheckCircle2 size={18} />}>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Rail">
              <select className={inputClass} value={reconcile.railCode} onChange={(e) => setReconcile({ ...reconcile, railCode: e.target.value })}>
                {available.map((r: any) => <option key={r.code} value={r.code}>{r.code}</option>)}
              </select>
            </Field>
            <Field label="Provider"><input className={inputClass} value={reconcile.provider} onChange={(e) => setReconcile({ ...reconcile, provider: e.target.value })} /></Field>
            <Field label="Tolerance"><input className={inputClass} value={reconcile.tolerance} onChange={(e) => setReconcile({ ...reconcile, tolerance: e.target.value })} /></Field>
          </div>
          <Field label="Statement lines (JSON)">
            <textarea className={inputClass + ' font-mono text-xs'} rows={7} value={statement} onChange={(e) => setStatement(e.target.value)} />
          </Field>
          <p className="text-xs text-gray-500 mt-1">
            Leave <code>reference</code> out to reconcile purely by value. Internal payments in the statement window are pulled automatically.
          </p>
          <button className={primaryButton + ' mt-2'} onClick={reconcileStatement}>Reconcile</button>
        </Card>

        <Card title="Settlement batches" icon={<Landmark size={18} />}>
          <Table head={<tr><Th>Date</Th><Th>Rail</Th><Th>Gross</Th><Th>Variance</Th><Th>Matched</Th><Th>Status</Th><Th /></tr>}>
            {batches.map((b: any) => (
              <tr key={b.id}>
                <Td className="whitespace-nowrap">{new Date(b.batchDate).toLocaleDateString()}</Td>
                <Td>{b.railCode}</Td>
                <Td><Money value={b.grossAmount} currency={b.currency} /></Td>
                <Td className={Math.abs(Number(b.variance)) > 0.01 ? 'text-rose-600 tabular-nums' : 'tabular-nums'}><Money value={b.variance} /></Td>
                <Td className="tabular-nums">{b.matchedCount}/{b.lineCount}</Td>
                <Td><Badge>{b.status}</Badge></Td>
                <Td className="text-right"><button className={ghostButton} onClick={() => openBatch(b.id)}>Open</button></Td>
              </tr>
            ))}
            {batches.length === 0 && <tr><Td colSpan={7}><Empty>No statements imported yet.</Empty></Td></tr>}
          </Table>
        </Card>
      </div>

      {detail && (
        <Card title={`Batch ${detail.batch?.id.slice(0, 8)} — ${detail.batch?.railCode}`} icon={<Landmark size={18} />}>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Match rate" value={`${detail.health?.matchRate?.toFixed?.(1) ?? detail.health?.matchRate}%`} tone={detail.health?.label === 'HEALTHY' ? 'good' : detail.health?.label === 'WATCH' ? 'warn' : 'bad'} hint={detail.health?.label} />
            <Stat label="Discrepancy" value={<Money value={detail.health?.discrepancyValue} />} />
            <Stat label="Float days" value={detail.settlement?.floatDays ?? '—'} hint={detail.settlement?.instant ? 'instant rail' : `promised ${new Date(detail.settlement?.promisedOn).toLocaleDateString()}`} />
            <Stat label="Reversible" value={detail.settlement?.reversible ? 'Yes' : 'No'} hint={detail.settlement?.reversible ? 'Return risk stays on the ledger' : 'Irrevocable once settled'} />
            <Stat label="Lines" value={detail.lines?.length ?? 0} />
          </div>
          <div className="mt-4">
            <Table head={<tr><Th>Reference</Th><Th>Status</Th><Th>Amount</Th><Th>Fee</Th><Th>Note</Th></tr>}>
              {(detail.lines || []).slice(0, 50).map((l: any) => (
                <tr key={l.id}>
                  <Td><code className="text-xs">{l.externalReference || '—'}</code></Td>
                  <Td><Badge>{l.status}</Badge></Td>
                  <Td><Money value={l.amount} /></Td>
                  <Td><Money value={l.fee} /></Td>
                  <Td className="text-xs text-gray-500">{l.note}</Td>
                </tr>
              ))}
            </Table>
          </div>
          {detail.batch?.discrepancyDetail && (
            <div className="mt-4 grid md:grid-cols-2 gap-4">
              <JsonBox value={detail.batch.discrepancyDetail} />
              {detail.batch.status !== 'SIGNED_OFF' && (
                <button className={dangerButton + ' self-start'} onClick={() => signOff(detail.batch.id)}>Accept variance and sign off</button>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
