import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Layers, Download, Power, Sparkles, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  PageHeader,
  Stat,
  Table,
  Td,
  Th,
  call,
  ghostButton,
  primaryButton,
} from '../components/GlobalUi';

/**
 * Vertical solutions (§ verticals). Trade packs that switch on capabilities the
 * generic product does not carry. An install is a preview first: the planner the
 * UI shows is the same one the write path runs, so nothing promises a switch the
 * server would then refuse to apply.
 */
export default function VerticalsPage() {
  const [data, setData] = useState<any>(null);
  const [hints, setHints] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<string[]>([]);

  const load = useCallback(async () => {
    const [d, h] = await Promise.all([call(() => api.getVerticals(), setError), call(() => api.getPosHints(), setError)]);
    setData(d);
    setHints(h);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const open = async (code: string) => {
    setAccepted([]);
    const d = await call(() => api.getVertical(code), setError);
    setDetail(d);
  };

  const install = async (code: string) => {
    const needed: string[] = detail?.solution?.confirmations || [];
    if (needed.length && accepted.length < needed.length) {
      setError(`Confirm all ${needed.length} regulated-activity acknowledgement(s) before installing`);
      return;
    }
    await call(() => api.installVertical(code, { confirmations: needed }), setError);
    setDetail(null);
    load();
  };

  const retire = async (code: string) => {
    await call(() => api.retireVertical(code), setError);
    setDetail(null);
    load();
  };

  const solutions: any[] = data?.solutions || [];
  const installedCodes = new Set((data?.installed || []).filter((i: any) => i.status === 'INSTALLED').map((i: any) => i.solutionCode));

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Vertical Solutions"
        subtitle="Trade packs — pharmacy, hardware, fashion, hospitality, automotive and more — that switch on the capabilities your industry needs and teach the POS screen how to behave."
      />
      <ErrorNote message={error} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Your trade" value={data?.industry || 'RETAIL'} hint={data?.countryCode ? `market ${data.countryCode}` : undefined} />
        <Stat label="Solutions" value={solutions.length} />
        <Stat label="Installed" value={installedCodes.size} tone={installedCodes.size ? 'good' : 'default'} />
        <Stat
          label="Active capabilities"
          value={hints?.capabilities?.length ?? new Set((data?.installed || []).flatMap((i: any) => i.features || [])).size}
          hint="switches the product honours today"
        />
      </div>

      {(data?.recommendations || []).length > 0 && (
        <Card title="Recommended for you" icon={<Sparkles size={18} />}>
          <div className="flex gap-2 flex-wrap">
            {data.recommendations.map((r: any) => (
              <button
                key={r.code ?? r}
                onClick={() => open(r.code ?? r)}
                className="border rounded px-3 py-2 text-sm hover:bg-violet-50 flex items-center gap-2"
              >
                <Badge tone="violet">{r.code ?? r}</Badge>
                {r.name && <span className="text-gray-600">{r.name}</span>}
                {installedCodes.has(r.code ?? r) && <CheckCircle2 size={14} className="text-emerald-600" />}
              </button>
            ))}
          </div>
        </Card>
      )}

      {data?.conflicts?.length > 0 && (
        <Card title="Capability conflicts" icon={<AlertTriangle size={18} />}>
          <ul className="text-sm space-y-2">
            {data.conflicts.map((c: any) => (
              <li key={c.capability} className="border border-amber-200 bg-amber-50 rounded px-3 py-2">
                <span className="font-medium">{c.capability}</span> is claimed by {c.codes.join(' and ')} — {c.resolution}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={`Catalogue (${solutions.length})`} icon={<Layers size={18} />}>
        <Table head={<tr><Th>Solution</Th><Th>Trades</Th><Th>Capabilities</Th><Th>Status</Th><Th /></tr>}>
          {solutions.map((s: any) => (
            <tr key={s.code} className={installedCodes.has(s.code) ? 'bg-emerald-50/40' : undefined}>
              <Td>
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-gray-500">{s.tagline}</div>
              </Td>
              <Td className="text-xs text-gray-600">{s.industries.slice(0, 4).join(', ')}{s.industries.length > 4 ? '…' : ''}</Td>
              <Td className="text-xs">
                <div className="flex gap-1 flex-wrap">
                  {s.capabilities.slice(0, 5).map((c: string) => (
                    <span key={c} className="bg-gray-100 rounded px-1.5 py-0.5">{c.replace(/_/g, ' ').toLowerCase()}</span>
                  ))}
                  {s.capabilities.length > 5 && <span className="text-gray-400">+{s.capabilities.length - 5}</span>}
                </div>
              </Td>
              <Td>{installedCodes.has(s.code) ? <Badge tone="good">INSTALLED</Badge> : <Badge tone="neutral">AVAILABLE</Badge>}</Td>
              <Td className="text-right"><button className={ghostButton} onClick={() => open(s.code)}>Details</button></Td>
            </tr>
          ))}
        </Table>
      </Card>

      {hints && (
        <Card title="What the POS terminal does today" icon={<Layers size={18} />}>
          <div className="grid md:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-gray-500 mb-1">Quick actions</div>
              <ul className="space-y-1">
                {(hints.quickActions || []).map((a: any, i: number) => (
                  <li key={i} className="border rounded px-2 py-1">{a.label} <code className="text-xs text-gray-500">{a.action}</code></li>
                ))}
                {(hints.quickActions || []).length === 0 && <li className="text-gray-400">None beyond the defaults.</li>}
              </ul>
            </div>
            <div>
              <div className="text-gray-500 mb-1">Required at checkout</div>
              <ul className="space-y-1">
                {(hints.requiredAtCheckout || []).map((f: string) => <li key={f} className="border rounded px-2 py-1">{f}</li>)}
                {(hints.requiredAtCheckout || []).length === 0 && <li className="text-gray-400">Nothing extra.</li>}
              </ul>
            </div>
            <div>
              <div className="text-gray-500 mb-1">Defaults & notices</div>
              <div className="text-xs text-gray-600">Fulfilment: {hints.defaultFulfillment || 'standard'}</div>
              <div className="text-xs text-gray-600">Line badges: {(hints.lineBadges || []).join(', ') || '—'}</div>
              <ul className="mt-1 space-y-1 text-xs text-amber-700">
                {(hints.notices || []).map((n: string, i: number) => <li key={i}>• {n}</li>)}
              </ul>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-3">Merged across {hints.installed?.length ?? 0} installed solution(s): { (hints.installed || []).join(', ') || 'none' }</p>
        </Card>
      )}

      {detail && (
        <Card
          title={`${detail.solution?.name} — v${detail.solution?.version}`}
          icon={<Download size={18} />}
          actions={
            installedCodes.has(detail.solution?.code) ? (
              <>
                <button className={ghostButton} onClick={() => open(detail.solution.code)}>Re-preview</button>
                <button className={ghostButton} onClick={() => retire(detail.solution.code)}><Power size={14} /> Retire (rolls back its settings)</button>
              </>
            ) : (
              <button className={primaryButton} onClick={() => install(detail.solution.code)}><Download size={15} /> Install</button>
            )
          }
        >
          <p className="text-sm text-gray-600">{detail.solution?.tagline}</p>
          <div className="grid md:grid-cols-2 gap-4 mt-4 text-sm">
            <div>
              <div className="text-gray-500 mb-1">Switches this install turns on</div>
              <ul className="grid grid-cols-2 gap-1">
                {(detail.preview?.added || []).map((c: string) => (
                  <li key={c} className="bg-emerald-50 border border-emerald-200 rounded px-2 py-1 text-emerald-800 text-xs">{c}</li>
                ))}
                {(detail.preview?.alreadyActive || []).map((c: string) => (
                  <li key={c} className="bg-gray-50 border rounded px-2 py-1 text-gray-500 text-xs">{c} (already on)</li>
                ))}
              </ul>
              {(detail.preview?.added || []).length === 0 && (detail.preview?.alreadyActive || []).length === 0 && (
                <Empty>Nothing to switch on.</Empty>
              )}
            </div>
            <div>
              <div className="text-gray-500 mb-1">Settings it may apply</div>
              {Object.keys(detail.preview?.settingsDelta || {}).length === 0 ? (
                <div className="text-xs text-gray-400">None — this pack only adds behaviour.</div>
              ) : (
                <ul className="text-xs space-y-1">
                  {Object.entries(detail.preview.settingsDelta).map(([k, v]) => (
                    <li key={k} className={detail.preview.wouldApply.includes(k) ? '' : 'text-gray-400 line-through'}>
                      <code>{k}</code> = {JSON.stringify(v)}
                      {!detail.preview.wouldApply.includes(k) && ' (not permitted)'}
                    </li>
                  ))}
                </ul>
              )}
              {detail.preview?.conflicts?.length > 0 && (
                <div className="mt-2 text-xs text-amber-700">
                  Conflicts with: {detail.preview.conflicts.map((c: any) => `${c.capability} (${c.codes.join('/')})`).join('; ')}
                </div>
              )}
            </div>
          </div>

          {(detail.solution?.confirmations || []).length > 0 && !installedCodes.has(detail.solution.code) && (
            <div className="mt-4 border border-amber-200 bg-amber-50 rounded p-3 space-y-2">
              <div className="text-sm font-medium text-amber-800">This trade is regulated. Acknowledge each point:</div>
              {detail.solution.confirmations.map((c: string) => (
                <label key={c} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={accepted.includes(c)}
                    onChange={(e) => setAccepted(e.target.checked ? [...accepted, c] : accepted.filter((a) => a !== c))}
                  />
                  <span>{c}</span>
                </label>
              ))}
            </div>
          )}

          {detail.installation && (
            <div className="mt-4 text-xs text-gray-600">
              Installed {new Date(detail.installation.createdAt).toLocaleDateString()} · status {detail.installation.status} · applied delta{' '}
              <code>{JSON.stringify(detail.installation.appliedDelta ?? {})}</code>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
