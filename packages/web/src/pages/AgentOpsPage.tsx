import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Bot, Play, CheckCircle2, XCircle, PackageSearch, TrendingUp } from 'lucide-react';
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  Field,
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
 * Agentic back-office (§ agent). The buying agent forecasts demand, sizes a
 * safety stock per SKU and drafts purchase orders — but it never commits spend.
 * Every run stays a DRAFT until a human approves it, which is the whole point
 * of this screen.
 */
export default function AgentOpsPage() {
  const [overview, setOverview] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [lowStock, setLowStock] = useState<any>(null);
  const [forecast, setForecast] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardrails, setGuardrails] = useState({ horizonDays: '14', lookbackDays: '90', serviceLevel: '0.975', maxSpend: '', maxLines: '' });

  const load = useCallback(async () => {
    const [o, r, l] = await Promise.all([
      call(() => api.getAgentOverview(), setError),
      call(() => api.getReplenishmentRuns({ limit: '20' }), setError),
      call(() => api.getAgentLowStock(), setError),
    ]);
    setOverview(o);
    setRuns(r?.runs || []);
    setLowStock(l);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runPlan = async () => {
    const data = await call(
      () =>
        api.runReplenishment({
          horizonDays: Number(guardrails.horizonDays) || 14,
          lookbackDays: Number(guardrails.lookbackDays) || 90,
          serviceLevel: Number(guardrails.serviceLevel) || 0.975,
          maxSpend: guardrails.maxSpend ? Number(guardrails.maxSpend) : null,
          maxLines: guardrails.maxLines ? Number(guardrails.maxLines) : null,
        }),
      setError
    );
    setPreview(data);
    load();
  };

  const approve = async (id: string) => {
    const data = await call(() => api.approveReplenishmentRun(id), setError);
    if (data) setPreview({ ...(preview || {}), purchaseOrders: data.purchaseOrders || [], approved: true });
    load();
  };

  const discard = async (id: string) => {
    await call(() => api.discardReplenishmentRun(id, prompt('Why is this plan being discarded?') || undefined), setError);
    load();
  };

  const inspect = async (id: string) => {
    const run = await call(() => api.getReplenishmentRun(id), setError);
    if (run) setPreview({ runId: run.id, status: run.status, plan: run.plan, ...run });
  };

  const showForecast = async (productId: string) => {
    const data = await call(() => api.getAgentForecast(productId), setError);
    setForecast(data);
  };

  const planItems: any[] = preview?.items || preview?.plan?.items?.filter((i: any) => i.action === 'ORDER') || [];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Buying Agent"
        subtitle="Demand forecasting, safety stock and draft purchase orders. The agent proposes; only a person disposes — nothing is ordered until it is approved here."
        actions={
          <button className={primaryButton} onClick={runPlan}>
            <Play size={15} /> Draft a replenishment plan
          </button>
        }
      />
      <ErrorNote message={error} />

      {overview && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Drafts awaiting you" value={overview.drafts ?? 0} tone={overview.drafts ? 'warn' : 'good'} hint={`${overview.draftLines ?? 0} lines`} />
          <Stat label="Draft value" value={<Money value={overview.draftValue} />} />
          <Stat label="Approved runs" value={overview.approvedRuns ?? 0} hint={`${overview.draftPurchaseOrders ?? 0} open POs`} tone="good" />
          <Stat label="Committed spend" value={<Money value={overview.committedValue} />} />
          <Stat label="SKUs tracked" value={overview.skusTracked ?? 0} hint={`service level ${(overview.serviceLevel * 100).toFixed(1)}%`} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Guardrails" icon={<TrendingUp size={18} />} className="lg:col-span-1">
          <div className="space-y-2">
            <Field label="Horizon (days)"><input className={inputClass} value={guardrails.horizonDays} onChange={(e) => setGuardrails({ ...guardrails, horizonDays: e.target.value })} /></Field>
            <Field label="History to learn from (days)"><input className={inputClass} value={guardrails.lookbackDays} onChange={(e) => setGuardrails({ ...guardrails, lookbackDays: e.target.value })} /></Field>
            <Field label="Service level" hint="0.95 = accept a 5% stockout risk"><input className={inputClass} value={guardrails.serviceLevel} onChange={(e) => setGuardrails({ ...guardrails, serviceLevel: e.target.value })} /></Field>
            <Field label="Max spend" hint="Blank = no cap; over-cap lines are trimmed and reported"><input className={inputClass} value={guardrails.maxSpend} onChange={(e) => setGuardrails({ ...guardrails, maxSpend: e.target.value })} /></Field>
            <Field label="Max lines"><input className={inputClass} value={guardrails.maxLines} onChange={(e) => setGuardrails({ ...guardrails, maxLines: e.target.value })} /></Field>
          </div>
        </Card>

        <Card title={`Low stock today (${lowStock?.total ?? 0})`} icon={<PackageSearch size={18} />} className="lg:col-span-2">
          <Table head={<tr><Th>Product</Th><Th>Location</Th><Th>On hand</Th><Th>Reorder at</Th><Th>Cover</Th><Th /></tr>}>
            {(lowStock?.items || []).slice(0, 12).map((i: any) => (
              <tr key={`${i.productId}-${i.locationId}`}>
                <Td>
                  <div className="font-medium">{i.name}</div>
                  <div className="text-xs text-gray-500">{i.sku}</div>
                </Td>
                <Td className="text-gray-600">{i.locationName || i.locationId}</Td>
                <Td className="tabular-nums">{i.quantity}</Td>
                <Td className="tabular-nums">{i.reorderPoint}</Td>
                <Td className="tabular-nums">{i.daysOfCover == null ? '—' : `${i.daysOfCover} d`}</Td>
                <Td className="text-right"><button className={ghostButton} onClick={() => showForecast(i.productId)}>Forecast</button></Td>
              </tr>
            ))}
            {(lowStock?.items || []).length === 0 && <tr><Td colSpan={6}><Empty>Nothing below its reorder point.</Empty></Td></tr>}
          </Table>
          {lowStock && <p className="text-xs text-gray-500 mt-2">Value at risk if none of it is replaced: <Money value={lowStock.exposure} /></p>}
        </Card>
      </div>

      {preview && (
        <Card
          title={`Draft plan ${preview.runId?.slice(0, 8) ?? ''}`}
          icon={<Bot size={18} />}
          actions={
            preview.status === 'DRAFT' ? (
              <>
                <button className={primaryButton} onClick={() => approve(preview.runId)}><CheckCircle2 size={15} /> Approve into POs</button>
                <button className={ghostButton} onClick={() => discard(preview.runId)}><XCircle size={15} /> Discard</button>
              </>
            ) : (
              <Badge>{preview.status}</Badge>
            )
          }
        >
          <p className="text-sm text-gray-600">{preview.summary || preview.plan?.summary}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
            <Stat label="Lines" value={preview.totals?.lines ?? preview.plan?.totals?.lines ?? planItems.length} />
            <Stat label="Units" value={preview.totals?.units ?? preview.plan?.totals?.units ?? 0} />
            <Stat label="Estimated cost" value={<Money value={preview.totals?.cost ?? preview.plan?.totals?.cost} />} />
            <Stat
              label="Trimmed by cap"
              value={(preview.totals?.trimmed ?? preview.plan?.totals?.trimmed) || 0}
              tone={(preview.totals?.trimmed ?? preview.plan?.totals?.trimmed) ? 'warn' : 'good'}
              hint={<Money value={preview.totals?.trimmedCost ?? preview.plan?.totals?.trimmedCost ?? 0} />}
            />
          </div>

          <Table head={<tr><Th>Product</Th><Th>Supplier</Th><Th>Available</Th><Th>Demand</Th><Th>Safety</Th><Th>Target</Th><Th>Qty</Th><Th>Cost</Th><Th>Cover</Th></tr>}>
            {planItems.map((i: any) => (
              <tr key={i.productId}>
                <Td>
                  <div className="font-medium">{i.name}</div>
                  <div className="text-xs text-gray-500">{i.sku}</div>
                </Td>
                <Td className="text-gray-600">{i.supplierName || <span className="text-amber-600">no supplier</span>}</Td>
                <Td className="tabular-nums">{i.available}</Td>
                <Td className="tabular-nums">{i.demand}</Td>
                <Td className="tabular-nums">{i.safetyStock}</Td>
                <Td className="tabular-nums">{i.targetStock}</Td>
                <Td className="tabular-nums font-medium">{i.quantity}</Td>
                <Td><Money value={i.cost} /></Td>
                <Td className="tabular-nums">{i.daysOfCover == null ? '—' : `${i.daysOfCover} d`}</Td>
              </tr>
            ))}
            {planItems.length === 0 && <tr><Td colSpan={9}><Empty>No lines needed on these inputs.</Empty></Td></tr>}
          </Table>

          {(preview.bySupplier || preview.plan?.bySupplier)?.length > 0 && (
            <div className="mt-4 text-sm">
              <div className="text-gray-500 mb-1">Split into {preview.bySupplier?.length ?? preview.plan?.bySupplier?.length} purchase orders:</div>
              <ul className="space-y-1">
                {(preview.bySupplier || preview.plan?.bySupplier).map((s: any) => (
                  <li key={s.supplierId || 'none'} className="flex justify-between border rounded px-2 py-1">
                    <span>{s.supplierName || 'Unassigned supplier'}</span>
                    <span className="text-gray-500">{s.lines} lines · {s.units} units · <Money value={s.cost} /></span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.purchaseOrders?.length > 0 && (
            <div className="mt-3 text-sm text-emerald-700">
              Created: {preview.purchaseOrders.map((p: any) => `${p.id.slice(0, 8)} (${p.lines} lines, ${Number(p.total).toFixed(2)})`).join(' · ')}
            </div>
          )}
        </Card>
      )}

      {forecast && (
        <Card title={`Demand profile — ${forecast.product?.name}`} icon={<TrendingUp size={18} />}>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Avg / day" value={forecast.avgPerDay} />
            <Stat label="Std dev / day" value={forecast.stdDevPerDay} />
            <Stat label="On hand" value={forecast.onHand} hint={`available ${forecast.available}`} />
            <Stat label="Days of cover" value={forecast.daysOfCover ?? '—'} tone={forecast.daysOfCover < forecast.product?.leadTimeDays ? 'bad' : 'default'} />
            <Stat label="Suggested order" value={forecast.suggestedQuantity ?? forecast.recommendation?.quantity ?? '—'} />
          </div>
          <div className="mt-4 flex items-end gap-0.5 h-24 overflow-x-auto">
            {(forecast.history || []).slice(-60).map((d: any, i: number) => {
              const max = Math.max(...(forecast.history || []).map((x: any) => x.quantity || x.units || 0), 1);
              const v = d.quantity ?? d.units ?? 0;
              return <div key={i} title={`${d.date}: ${v}`} className="bg-blue-200 rounded-t" style={{ height: `${Math.max(2, (v / max) * 100)}%`, width: '10px' }} />;
            })}
          </div>
          <p className="text-xs text-gray-500 mt-2">Last {Math.min(60, (forecast.history || []).length)} days of actual demand; the horizon forecast is {forecast.horizonDays} days.</p>
        </Card>
      )}

      <Card title="Run history" icon={<Bot size={18} />}>
        <Table head={<tr><Th>Created</Th><Th>Trigger</Th><Th>Horizon</Th><Th>Lines</Th><Th>Suppliers</Th><Th>Value</Th><Th>Status</Th><Th /></tr>}>
          {runs.map((r: any) => (
            <tr key={r.id}>
              <Td className="whitespace-nowrap text-gray-600">{new Date(r.createdAt).toLocaleString()}</Td>
              <Td><Badge tone={r.trigger === 'AUTO' ? 'info' : 'neutral'}>{r.trigger}</Badge></Td>
              <Td>{r.horizonDays} d</Td>
              <Td className="tabular-nums">{r.itemCount}</Td>
              <Td className="tabular-nums">{r.supplierCount}</Td>
              <Td><Money value={r.estimatedCost} /></Td>
              <Td><Badge>{r.status}</Badge></Td>
              <Td className="text-right whitespace-nowrap">
                <button className={ghostButton} onClick={() => inspect(r.id)}>Inspect</button>
                {r.status === 'DRAFT' && (
                  <>
                    {' '}<button className={primaryButton} onClick={() => approve(r.id)}>Approve</button>
                    {' '}<button className={ghostButton} onClick={() => discard(r.id)}>Discard</button>
                  </>
                )}
              </Td>
            </tr>
          ))}
          {runs.length === 0 && <tr><Td colSpan={8}><Empty>No plans drafted yet. The nightly job drafts one automatically for tenants with low-stock alerts switched on.</Empty></Td></tr>}
        </Table>
      </Card>
    </div>
  );
}
