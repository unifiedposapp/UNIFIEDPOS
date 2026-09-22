import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Building, Percent, Calculator, FileBarChart, PlayCircle, BadgeDollarSign } from 'lucide-react';
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
  ghostButton,
  inputClass,
  primaryButton,
} from '../components/GlobalUi';

/**
 * Franchise & multi-entity (§ franchise). Agreements define how each entity
 * owes; the royalty engine turns a closed period into an auditable statement,
 * transfer pricing sets the cost-plus at which stock moves between entities,
 * and consolidation removes the network selling to itself.
 */
const FIRST_OF_PREV_MONTH = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
};
const LAST_OF_PREV_MONTH = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)).toISOString().slice(0, 10);
};

export default function FranchisePage() {
  const [agreements, setAgreements] = useState<any[]>([]);
  const [royalties, setRoyalties] = useState<any>(null);
  const [pnl, setPnl] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [transfer, setTransfer] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    entityCode: '',
    franchiseeName: '',
    locationId: '',
    royaltyModel: 'PERCENT',
    royaltyPercent: '6',
    perItemFee: '0',
    fixedMonthly: '0',
    minimumMonthly: '500',
    marketingFundPercent: '2',
    transferMarkupPercent: '12',
    tiers: '[{"upTo":250000,"percent":6},{"upTo":null,"percent":4}]',
    exclusions: '["TIPS","VOUCHER"]',
    startDate: FIRST_OF_PREV_MONTH(),
  });
  const [whatIf, setWhatIf] = useState({ grossSales: '180000', unitsSold: '2400', excludedTips: '4000' });
  const [price, setPrice] = useState({ cost: '40', quantity: '25', freight: '120', fromAgreement: '' });
  const [accrueWindow, setAccrueWindow] = useState({ periodStart: FIRST_OF_PREV_MONTH(), periodEnd: LAST_OF_PREV_MONTH() });

  const load = useCallback(async () => {
    const [a, r] = await Promise.all([
      call(() => api.getFranchiseAgreements(), setError),
      call(() => api.getRoyaltyAccruals(), setError),
    ]);
    setAgreements(a?.agreements || []);
    setRoyalties(r);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const parseJson = (raw: string, label: string): any => {
    try {
      return JSON.parse(raw || 'null');
    } catch {
      setError(`${label} must be valid JSON`);
      return undefined;
    }
  };

  const save = async () => {
    if (!form.entityCode || !form.franchiseeName) {
      setError('An entity code and franchisee name are required');
      return;
    }
    const tiers = parseJson(form.tiers, 'Tiers');
    const exclusions = parseJson(form.exclusions, 'Exclusions');
    if (tiers === undefined || exclusions === undefined) return;
    const body = {
      entityCode: form.entityCode,
      franchiseeName: form.franchiseeName,
      locationId: form.locationId || null,
      royaltyModel: form.royaltyModel,
      royaltyPercent: Number(form.royaltyPercent) || 0,
      perItemFee: Number(form.perItemFee) || 0,
      fixedMonthly: Number(form.fixedMonthly) || 0,
      minimumMonthly: Number(form.minimumMonthly) || 0,
      marketingFundPercent: Number(form.marketingFundPercent) || 0,
      transferMarkupPercent: Number(form.transferMarkupPercent) || 0,
      tiers: Array.isArray(tiers) ? tiers : null,
      exclusions: Array.isArray(exclusions) ? exclusions : null,
      startDate: form.startDate,
    };
    const data = await call(() => api.saveFranchiseAgreement(body), setError);
    if (data) load();
  };

  const setStatus = async (id: string, status: string) => {
    const reason = status === 'TERMINATED' ? prompt('Reason for terminating:') || undefined : undefined;
    await call(() => api.setFranchiseAgreementStatus(id, status, reason), setError);
    load();
  };

  const runPreview = async () => {
    const selected = agreements[0];
    const exclusions = parseJson(form.exclusions, 'Exclusions');
    if (exclusions === undefined) return;
    const data = await call(
      () =>
        api.previewRoyalty({
          agreement: {
            royaltyModel: form.royaltyModel || selected?.royaltyModel,
            royaltyPercent: Number(form.royaltyPercent),
            tiers: parseJson(form.tiers, 'Tiers'),
            perItemFee: Number(form.perItemFee),
            fixedMonthly: Number(form.fixedMonthly),
            minimumMonthly: Number(form.minimumMonthly),
            marketingFundPercent: Number(form.marketingFundPercent),
            exclusions,
          },
          period: {
            grossSales: Number(whatIf.grossSales),
            unitsSold: Number(whatIf.unitsSold),
            excludedByCategory: exclusions?.length ? { ...(exclusions.includes('TIPS') ? { TIPS: Number(whatIf.excludedTips) } : {}) } : null,
          },
        }),
      setError
    );
    setPreview(data);
  };

  const accrue = async () => {
    const data = await call(() => api.accrueRoyalties(accrueWindow), setError);
    if (data) {
      setPreview(null);
      load();
    }
  };

  const setAccrualStatus = async (id: string, status: string) => {
    await call(() => api.setRoyaltyAccrualStatus(id, status), setError);
    const r = await call(() => api.getRoyaltyAccruals(), setError);
    setRoyalties(r);
  };

  const quoteTransfer = async () => {
    const data = await call(
      () =>
        api.quoteTransferPrice({
          cost: Number(price.cost),
          quantity: Number(price.quantity) || 1,
          freight: Number(price.freight) || 0,
          ...(price.fromAgreement ? { fromAgreement: price.fromAgreement } : {}),
        }),
      setError
    );
    setTransfer(data);
  };

  const loadPnl = async () => {
    const data = await call(() => api.getConsolidatedPnl({ from: accrueWindow.periodStart, to: accrueWindow.periodEnd }), setError);
    setPnl(data);
  };

  const accruals: any[] = royalties?.accruals || [];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Franchise & Multi-Entity"
        subtitle="Agreements per trading entity, the royalty engine that bills them, cost-plus transfer pricing between them, and a consolidated P&L with intercompany profit removed."
        actions={<button className={primaryButton} onClick={accrue}><PlayCircle size={15} /> Accrue {accrueWindow.periodStart.slice(0, 7)}</button>}
      />
      <ErrorNote message={error} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Entities" value={new Set(agreements.map((a) => a.entityCode)).size} hint={`${agreements.filter((a) => a.status === 'ACTIVE').length} active agreements`} />
        <Stat label="Outstanding royalties" value={<Money value={royalties?.outstanding ?? 0} />} tone={royalties?.outstanding ? 'warn' : 'good'} />
        <Stat label="Collected" value={<Money value={royalties?.collected ?? 0} />} tone="good" />
        <Stat label="Aging" value={Object.keys(royalties?.outstandingByBucket || {}).length} hint={Object.entries(royalties?.outstandingByBucket || {}).map(([b, v]) => `${b}: ${Number(v).toFixed(0)}`).join(' · ') || 'nothing overdue'} />
      </div>

      <Card title={`Agreements (${agreements.length})`} icon={<Building size={18} />}>
        <Table head={<tr><Th>Entity</Th><Th>Franchisee</Th><Th>Royalty</Th><Th>Marketing</Th><Th>Minimum</Th><Th>Transfer markup</Th><Th>Status</Th><Th /></tr>}>
          {agreements.map((a: any) => (
            <tr key={a.id}>
              <Td className="font-medium">{a.entityCode}</Td>
              <Td>{a.franchiseeName}</Td>
              <Td>
                {a.royaltyModel === 'PERCENT' && `${Number(a.royaltyPercent)}%`}
                {a.royaltyModel === 'TIERED' && <span>tiered <code className="text-xs">{JSON.stringify(a.tiers)}</code></span>}
                {a.royaltyModel === 'PER_ITEM' && <Money value={a.perItemFee} currency={a.currency} />}
                {a.royaltyModel === 'FIXED' && <Money value={a.fixedMonthly} currency={a.currency} />}
              </Td>
              <Td>{Number(a.marketingFundPercent)}%</Td>
              <Td><Money value={a.minimumMonthly} /></Td>
              <Td>{Number(a.transferMarkupPercent)}%</Td>
              <Td><Badge>{a.status}</Badge></Td>
              <Td className="text-end whitespace-nowrap">
                {a.status !== 'ACTIVE' && <button className={ghostButton} onClick={() => setStatus(a.id, 'ACTIVE')}>Activate</button>}
                {a.status === 'ACTIVE' && (
                  <>
                    <button className={ghostButton} onClick={() => setStatus(a.id, 'SUSPENDED')}>Suspend</button>{' '}
                    <button className={ghostButton} onClick={() => setStatus(a.id, 'TERMINATED')}>Terminate</button>
                  </>
                )}
              </Td>
            </tr>
          ))}
          {agreements.length === 0 && <tr><Td colSpan={8}><Empty>No agreements yet — royalties cannot be billed without one.</Empty></Td></tr>}
        </Table>
      </Card>

      <Card title="New or updated agreement" icon={<Percent size={18} />}>
        <div className="grid md:grid-cols-4 gap-2">
          <Field label="Entity code"><input className={inputClass} value={form.entityCode} onChange={(e) => setForm({ ...form, entityCode: e.target.value })} placeholder="BR-01" /></Field>
          <Field label="Franchisee"><input className={inputClass} value={form.franchiseeName} onChange={(e) => setForm({ ...form, franchiseeName: e.target.value })} /></Field>
          <Field label="Location id (optional)"><input className={inputClass} value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} /></Field>
          <Field label="Start date"><input type="date" className={inputClass} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
          <Field label="Royalty model">
            <select className={inputClass} value={form.royaltyModel} onChange={(e) => setForm({ ...form, royaltyModel: e.target.value })}>
              {['PERCENT', 'TIERED', 'PER_ITEM', 'FIXED'].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Percent"><input className={inputClass} value={form.royaltyPercent} onChange={(e) => setForm({ ...form, royaltyPercent: e.target.value })} /></Field>
          <Field label="Per item fee"><input className={inputClass} value={form.perItemFee} onChange={(e) => setForm({ ...form, perItemFee: e.target.value })} /></Field>
          <Field label="Fixed monthly"><input className={inputClass} value={form.fixedMonthly} onChange={(e) => setForm({ ...form, fixedMonthly: e.target.value })} /></Field>
          <Field label="Minimum monthly"><input className={inputClass} value={form.minimumMonthly} onChange={(e) => setForm({ ...form, minimumMonthly: e.target.value })} /></Field>
          <Field label="Marketing fund %"><input className={inputClass} value={form.marketingFundPercent} onChange={(e) => setForm({ ...form, marketingFundPercent: e.target.value })} /></Field>
          <Field label="Transfer markup %"><input className={inputClass} value={form.transferMarkupPercent} onChange={(e) => setForm({ ...form, transferMarkupPercent: e.target.value })} /></Field>
          <Field label="Non-royalty categories"><input className={inputClass} value={form.exclusions} onChange={(e) => setForm({ ...form, exclusions: e.target.value })} /></Field>
          <div className="md:col-span-4">
            <Field label="Tiers (JSON, ascending band ceilings)"><input className={inputClass + ' font-mono text-xs'} value={form.tiers} onChange={(e) => setForm({ ...form, tiers: e.target.value })} /></Field>
          </div>
        </div>
        <button className={primaryButton + ' mt-2'} onClick={save}>Save agreement</button>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Royalty what-if" icon={<Calculator size={18} />} actions={<button className={ghostButton} onClick={runPreview}>Calculate</button>}>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Gross sales"><input className={inputClass} value={whatIf.grossSales} onChange={(e) => setWhatIf({ ...whatIf, grossSales: e.target.value })} /></Field>
            <Field label="Units sold"><input className={inputClass} value={whatIf.unitsSold} onChange={(e) => setWhatIf({ ...whatIf, unitsSold: e.target.value })} /></Field>
            <Field label="Excluded tips"><input className={inputClass} value={whatIf.excludedTips} onChange={(e) => setWhatIf({ ...whatIf, excludedTips: e.target.value })} /></Field>
          </div>
          {preview && (
            <div className="mt-4 space-y-2 text-sm">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Royalty" value={<Money value={preview.royalty} />} />
                <Stat label="Marketing fund" value={<Money value={preview.marketingFund} />} />
                <Stat label="Total due" value={<Money value={preview.total} />} hint={preview.minimumApplied ? 'minimum applied' : `effective ${preview.effectiveRatePercent == null ? '—' : `${preview.effectiveRatePercent}%`}`} />
              </div>
              <Table head={<tr><Th>Step</Th><Th>How</Th><Th>Amount</Th></tr>}>
                {(preview.calculation || []).map((c: any, i: number) => (
                  <tr key={i}>
                    <Td className="font-medium whitespace-nowrap">{c.step}</Td>
                    <Td className="text-xs text-gray-600">{c.detail}</Td>
                    <Td><Money value={c.amount} /></Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>

        <Card title="Transfer pricing" icon={<BadgeDollarSign size={18} />} actions={<button className={ghostButton} onClick={quoteTransfer}>Quote</button>}>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Field label="Unit cost"><input className={inputClass} value={price.cost} onChange={(e) => setPrice({ ...price, cost: e.target.value })} /></Field>
            <Field label="Quantity"><input className={inputClass} value={price.quantity} onChange={(e) => setPrice({ ...price, quantity: e.target.value })} /></Field>
            <Field label="Freight total"><input className={inputClass} value={price.freight} onChange={(e) => setPrice({ ...price, freight: e.target.value })} /></Field>
            <Field label="From agreement">
              <select className={inputClass} value={price.fromAgreement} onChange={(e) => setPrice({ ...price, fromAgreement: e.target.value })}>
                <option value="">manual markup</option>
                {agreements.map((a: any) => <option key={a.id} value={a.id}>{a.entityCode} ({Number(a.transferMarkupPercent)}%)</option>)}
              </select>
            </Field>
          </div>
          {transfer && (
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 text-sm">
              <Stat label="Markup" value={`${transfer.markupPercent}%`} />
              <Stat label="Unit price" value={<Money value={transfer.unitPrice} />} />
              <Stat label="Invoice total" value={<Money value={transfer.total} />} hint={`${transfer.quantity ?? price.quantity} units`} />
              <Stat label="Profit in stock" value={<Money value={transfer.unrealisedProfit ?? (transfer.unitPrice - transfer.cost) * Number(transfer.quantity || 0)} />} hint="eliminated on consolidation" />
            </div>
          )}
        </Card>
      </div>

      <Card
        title={`Royalty statements (${accruals.length})`}
        icon={<FileBarChart size={18} />}
        actions={
          <div className="flex items-end gap-2">
            <input type="date" className={inputClass} value={accrueWindow.periodStart} onChange={(e) => setAccrueWindow({ ...accrueWindow, periodStart: e.target.value })} />
            <input type="date" className={inputClass} value={accrueWindow.periodEnd} onChange={(e) => setAccrueWindow({ ...accrueWindow, periodEnd: e.target.value })} />
            <button className={ghostButton} onClick={loadPnl}>Consolidate</button>
          </div>
        }
      >
        <Table head={<tr><Th>Period</Th><Th>Entity</Th><Th>Gross sales</Th><Th>Base</Th><Th>Royalty</Th><Th>Fund</Th><Th>Due</Th><Th>Aging</Th><Th>Status</Th><Th /></tr>}>
          {accruals.map((r: any) => (
            <tr key={r.id}>
              <Td className="whitespace-nowrap font-medium">{r.period}</Td>
              <Td>{r.entityCode}</Td>
              <Td><Money value={r.grossSales} /></Td>
              <Td><Money value={r.taxableBase} /></Td>
              <Td><Money value={r.royaltyAmount} /></Td>
              <Td><Money value={r.marketingFundAmount} /></Td>
              <Td className="whitespace-nowrap">{new Date(r.dueDate).toLocaleDateString()}</Td>
              <Td>{r.aging ? <Badge tone={r.aging.bucket === 'CURRENT' ? 'good' : r.aging.bucket === 'OVER_60' ? 'bad' : 'warn'}>{r.aging.bucket} ({r.aging.days}d)</Badge> : <span className="text-gray-400">—</span>}</Td>
              <Td><Badge>{r.status}</Badge></Td>
              <Td className="text-end whitespace-nowrap">
                {r.status === 'CALCULATED' && <button className={ghostButton} onClick={() => setAccrualStatus(r.id, 'INVOICED')}>Invoice</button>}
                {r.status === 'INVOICED' && <button className={ghostButton} onClick={() => setAccrualStatus(r.id, 'PAID')}>Mark paid</button>}
                {(r.status === 'INVOICED' || r.status === 'CALCULATED') && (
                  <>{' '}<button className={ghostButton} onClick={() => setAccrualStatus(r.id, 'DISPUTED')}>Dispute</button></>
                )}
              </Td>
            </tr>
          ))}
          {accruals.length === 0 && (
            <tr><Td colSpan={10}><Empty>No statements accrued. Accruals are idempotent: running a period twice does not bill it twice.</Empty></Td></tr>
          )}
        </Table>
      </Card>

      {pnl && (
        <Card title={`Consolidated P&L — ${pnl.from?.slice(0, 10)} to ${pnl.to?.slice(0, 10)}`} icon={<FileBarChart size={18} />}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Revenue" value={<Money value={pnl.consolidated?.totals?.revenue} />} />
            <Stat label="Gross profit" value={<Money value={pnl.consolidated?.totals?.grossProfit} />} hint={`${pnl.consolidated?.totals?.marginPercent ?? 0}% margin`} />
            <Stat label="EBITDA" value={<Money value={pnl.consolidated?.totals?.ebitda} />} tone={pnl.consolidated?.totals?.ebitda >= 0 ? 'good' : 'bad'} />
            <Stat label="Royalties due" value={<Money value={pnl.consolidated?.royaltiesDue} />} hint={`top: ${pnl.consolidated?.topContributor || '—'}`} />
          </div>
          <div className="mt-4">
            <Table head={<tr><Th>Entity</Th><Th>Revenue</Th><Th>Gross profit</Th><Th>EBITDA</Th><Th>Margin</Th></tr>}>
              {(pnl.consolidated?.entities || []).map((e: any) => (
                <tr key={e.entityCode}>
                  <Td className="font-medium">{e.entityCode}</Td>
                  <Td><Money value={e.revenue} /></Td>
                  <Td><Money value={e.grossProfit} /></Td>
                  <Td><Money value={e.ebitda} /></Td>
                  <Td>{e.marginPercent == null ? '—' : `${e.marginPercent}%`}</Td>
                </tr>
              ))}
            </Table>
          </div>
          <div className="mt-4 grid md:grid-cols-2 gap-4">
            <JsonBox value={pnl.consolidated?.eliminations} />
            <p className="text-xs text-gray-500">{pnl.note}</p>
          </div>
        </Card>
      )}
    </div>
  );
}
