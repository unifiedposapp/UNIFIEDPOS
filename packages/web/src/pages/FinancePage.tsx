import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { PiggyBank, Gauge, Send, TrendingDown, CheckCircle2, XCircle } from 'lucide-react';
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
 * Embedded finance (§ finance). Working-capital lending underwritten from this
 * tenant's own settlement history and repaid by a daily sweep of card sales.
 * The score is shown with the factors that produced it: a merchant who is
 * declined is told why, and a merchant who is approved sees the price is a
 * function of their volatility rather than a black box.
 */
export default function FinancePage() {
  const [eligibility, setEligibility] = useState<any>(null);
  const [facilities, setFacilities] = useState<any[]>([]);
  const [position, setPosition] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [quote, setQuote] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [apply, setApply] = useState({ requestedAmount: '10000', termMonths: '6', acknowledgeTerms: false });
  const [quoteForm, setQuoteForm] = useState({ principal: '10000', months: '6', annualRatePercent: '' });

  const load = useCallback(async () => {
    const [e, f, p] = await Promise.all([
      call(() => api.getFinanceEligibility(), setError),
      call(() => api.getCreditFacilities(), setError),
      call(() => api.getFinancePosition(), setError),
    ]);
    setEligibility(e);
    setFacilities(f?.facilities || []);
    setPosition(p);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submitApplication = async () => {
    const data = await call(
      () =>
        api.applyForFacility({
          requestedAmount: Number(apply.requestedAmount),
          termMonths: Number(apply.termMonths),
          acknowledgeTerms: apply.acknowledgeTerms,
        }),
      setError
    );
    if (data) load();
  };

  const decide = async (id: string, approved: boolean) => {
    if (approved) {
      const limit = prompt('Approved limit (blank = take the suggested limit):');
      if (limit === null) return;
      await call(() => api.approveCreditFacility(id, limit ? { approvedLimit: Number(limit) } : {}), setError);
    } else {
      const reason = prompt('Reason for declining:') || 'Does not meet the trading history threshold';
      await call(() => api.declineCreditFacility(id, reason), setError);
    }
    load();
  };

  const openFacility = async (id: string) => {
    const data = await call(() => api.getCreditFacility(id), setError);
    setDetail(data);
  };

  const sweep = async (id: string) => {
    await call(() => api.sweepCreditFacility(id), setError);
    openFacility(id);
    load();
  };

  const runQuote = async () => {
    const data = await call(
      () =>
        api.quoteFacility({
          principal: Number(quoteForm.principal),
          months: Number(quoteForm.months),
          ...(quoteForm.annualRatePercent ? { annualRatePercent: Number(quoteForm.annualRatePercent) } : {}),
        }),
      setError
    );
    setQuote(data);
  };

  const decision = eligibility?.decision;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Embedded Finance"
        subtitle="Working-capital credit underwritten on your own settlement history, repaid automatically from daily card takings."
      />
      <ErrorNote message={error} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Credit score"
          value={decision ? `${decision.score} / 850` : '—'}
          hint={decision?.band}
          tone={decision?.qualifies ? 'good' : 'warn'}
        />
        <Stat label="Suggested limit" value={decision ? <Money value={decision.suggestedLimit} /> : '—'} hint={`confidence ${decision ? Math.round(decision.confidence * 100) : 0}%`} />
        <Stat label="Rate offered" value={decision ? `${decision.ratePercent}% p.a.` : '—'} hint={eligibility?.bands ? `base ${eligibility.baseRatePercent}%` : undefined} />
        <Stat
          label="Outstanding"
          value={position ? <Money value={position.outstanding} /> : '—'}
          hint={position?.nextDue ? `next due ${new Date(position.nextDue.dueDate).toLocaleDateString()}` : 'no live facility'}
          tone={position?.outstanding > 0 ? 'warn' : 'good'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Underwriting" icon={<Gauge size={18} />}>
          {!decision ? (
            <Empty>No decision yet.</Empty>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3">
                <Badge tone={decision.qualifies ? 'good' : 'bad'}>{decision.qualifies ? 'ELIGIBLE' : 'NOT ELIGIBLE'}</Badge>
                <span className="text-sm text-gray-600">Band {decision.band} · revenue proxy <Money value={decision.annualRevenueProxy} /></span>
              </div>
              <Table head={<tr><Th>Factor</Th><Th>Points</Th><Th>Why</Th></tr>}>
                {decision.factors.map((f: any) => (
                  <tr key={f.key}>
                    <Td className="font-medium whitespace-nowrap">{f.label}</Td>
                    <Td className={f.points < 0 ? 'text-rose-600 tabular-nums' : 'text-emerald-700 tabular-nums'}>{f.points > 0 ? `+${f.points}` : f.points}</Td>
                    <Td className="text-xs text-gray-600">{f.detail}</Td>
                  </tr>
                ))}
              </Table>
              {decision.declineReasons?.length > 0 && (
                <div className="mt-3 text-sm text-rose-700">
                  Blocking: {decision.declineReasons.join(', ')}
                  <div className="text-xs text-gray-500 mt-1">Minimum {eligibility.minimumMonths} months of trading history is required.</div>
                </div>
              )}
            </>
          )}
        </Card>

        <Card title="Term sheet" icon={<PiggyBank size={18} />}>
          <Table head={<tr><Th>Term</Th><Th>Installment</Th><Th>Interest</Th><Th>Total repayable</Th></tr>}>
            {(decision?.terms || []).map((t: any) => (
              <tr key={t.months}>
                <Td>{t.months} months</Td>
                <Td><Money value={t.installment} /></Td>
                <Td><Money value={t.totalInterest} /></Td>
                <Td><Money value={t.totalRepayable} /></Td>
              </tr>
            ))}
            {!decision?.terms?.length && <tr><Td colSpan={4}><Empty>Nothing to quote until a score exists.</Empty></Td></tr>}
          </Table>
          <p className="text-xs text-gray-500 mt-2">
            Repayment is a daily sweep of {decision?.sweepPercent ?? 0}% of net card sales, so a quiet week costs a little and a busy week pays down more.
          </p>

          {decision?.qualifies && (
            <div className="mt-4 border-t pt-4 space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <Field label="Amount wanted"><input className={inputClass} value={apply.requestedAmount} onChange={(e) => setApply({ ...apply, requestedAmount: e.target.value })} /></Field>
                <Field label="Term">
                  <select className={inputClass} value={apply.termMonths} onChange={(e) => setApply({ ...apply, termMonths: e.target.value })}>
                    {(eligibility.terms || [3, 6, 12]).map((m: number) => <option key={m} value={m}>{m} months</option>)}
                  </select>
                </Field>
                <Field label="Accept terms">
                  <input type="checkbox" checked={apply.acknowledgeTerms} onChange={(e) => setApply({ ...apply, acknowledgeTerms: e.target.checked })} className="mt-2" />
                </Field>
              </div>
              <button className={primaryButton} onClick={submitApplication} disabled={!apply.acknowledgeTerms}>
                <Send size={15} /> Submit application
              </button>
            </div>
          )}
        </Card>
      </div>

      <Card title="Facilities" icon={<PiggyBank size={18} />}>
        <Table head={<tr><Th>Requested</Th><Th>Limit</Th><Th>Outstanding</Th><Th>Rate</Th><Th>Term</Th><Th>Sweep</Th><Th>Status</Th><Th /></tr>}>
          {facilities.map((f: any) => (
            <tr key={f.id}>
              <Td><Money value={f.requestedAmount} /></Td>
              <Td><Money value={f.approvedLimit} /></Td>
              <Td><Money value={f.outstanding} /></Td>
              <Td>{Number(f.rate)}%</Td>
              <Td>{f.termMonths} mo</Td>
              <Td>{Number(f.sweepPercent)}%</Td>
              <Td><Badge>{f.status}</Badge></Td>
              <Td className="text-end whitespace-nowrap">
                <button className={ghostButton} onClick={() => openFacility(f.id)}>Schedule</button>
                {f.status === 'PENDING' && (
                  <>
                    {' '}<button className={primaryButton} onClick={() => decide(f.id, true)}><CheckCircle2 size={14} /> Approve</button>
                    {' '}<button className={ghostButton} onClick={() => decide(f.id, false)}><XCircle size={14} /> Decline</button>
                  </>
                )}
              </Td>
            </tr>
          ))}
          {facilities.length === 0 && <tr><Td colSpan={8}><Empty>No applications yet.</Empty></Td></tr>}
        </Table>
        {position && (position.monthlyDebtService ?? 0) > 0 && (
          <p className="text-xs text-gray-500 mt-3">
            Monthly debt service <Money value={position.monthlyDebtService} /> · debt-to-revenue {position.debtToRevenue == null ? '—' : `${(position.debtToRevenue * 100).toFixed(1)}%`} · available <Money value={position.available} />
          </p>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Amortisation calculator" icon={<TrendingDown size={18} />}>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Principal"><input className={inputClass} value={quoteForm.principal} onChange={(e) => setQuoteForm({ ...quoteForm, principal: e.target.value })} /></Field>
            <Field label="Months"><input className={inputClass} value={quoteForm.months} onChange={(e) => setQuoteForm({ ...quoteForm, months: e.target.value })} /></Field>
            <Field label="Rate % (blank = your offer)"><input className={inputClass} value={quoteForm.annualRatePercent} onChange={(e) => setQuoteForm({ ...quoteForm, annualRatePercent: e.target.value })} /></Field>
          </div>
          <button className={primaryButton + ' mt-2'} onClick={runQuote}>Calculate</button>
          {quote && (
            <div className="mt-4 text-sm space-y-1">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Installment" value={<Money value={quote.installment ?? quote.schedule?.[0]?.total} />} />
                <Stat label="Total interest" value={<Money value={quote.totalInterest} />} />
                <Stat label="Effective APR" value={quote.apr == null ? '—' : `${Number(quote.apr).toFixed(2)}%`} />
              </div>
              {(quote.firstThree || []).map((r: any) => (
                <div key={r.period} className="flex justify-between border rounded px-2 py-1 text-xs">
                  <span>Period {r.period}</span>
                  <span className="text-gray-500">principal <Money value={r.principal} /> · interest <Money value={r.interest} /></span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {detail && (
          <Card title={`Repayment schedule — ${detail.facility?.id?.slice(0, 8)}`} icon={<PiggyBank size={18} />} actions={<button className={ghostButton} onClick={() => sweep(detail.facility.id)}>Sweep today</button>}>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <Stat label="Repaid" value={`${detail.progress?.percentPaid?.toFixed?.(1) ?? detail.progress?.percentPaid}%`} tone="good" hint={<Money value={detail.progress?.paid} />} />
              <Stat label="Remaining" value={<Money value={detail.progress?.remaining} />} />
              <Stat label="Days to clear" value={detail.projection?.daysToClear ?? '—'} hint={`sweep ≈ ${Math.round((detail.facility?.sweepPercent ?? 0) * 100) / 100}% of ${detail.projection?.yesterdayNetSales ?? 0}`} />
            </div>
            <Table head={<tr><Th>#</Th><Th>Due</Th><Th>Principal</Th><Th>Interest</Th><Th>Total</Th><Th>Paid</Th><Th>Status</Th></tr>}>
              {(detail.repayments || []).map((r: any) => (
                <tr key={r.id}>
                  <Td className="tabular-nums">{r.period}</Td>
                  <Td className="whitespace-nowrap">{new Date(r.dueDate).toLocaleDateString()}</Td>
                  <Td><Money value={r.principal} /></Td>
                  <Td><Money value={r.interest} /></Td>
                  <Td><Money value={r.total} /></Td>
                  <Td><Money value={r.paidAmount} /></Td>
                  <Td><Badge>{r.status}</Badge></Td>
                </tr>
              ))}
              {(detail.repayments || []).length === 0 && <tr><Td colSpan={7}><Empty>No schedule: this facility is not active.</Empty></Td></tr>}
            </Table>
          </Card>
        )}
      </div>
    </div>
  );
}
