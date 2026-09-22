import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Store, ShieldCheck, FileJson, Ban, Plus, Eye } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
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
 * Agentic commerce (§ agents). A mandate is a human-signed, machine-presentable
 * purchase authorisation: ceiling, line items, expiry, nonce, signature. This
 * screen issues them, shows how they ended, and previews exactly what an agent
 * sees when it discovers the storefront — the same JSON-LD an autonomous buyer
 * would parse, with no marketing copy in between.
 */
const BLANK_MANDATE = JSON.stringify(
  { agent_id: 'agent-example', mandate_type: 'PURCHASE', currency: 'USD', ceiling_amount: 100, items: [{ sku: 'SKU-1', quantity: 1, max_unit_price: 80 }], expires_at: new Date(Date.now() + 3_600_000).toISOString() },
  null,
  2
);

export default function AgentStorefrontPage() {
  const organization = useAuthStore((s) => s.organization);
  const [mandates, setMandates] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [overview, setOverview] = useState<any>(null);
  const [descriptor, setDescriptor] = useState<any>(null);
  const [catalog, setCatalog] = useState<any>(null);
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [verifyBody, setVerifyBody] = useState(BLANK_MANDATE);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<any>(null);
  const [form, setForm] = useState({ agentId: 'agent-example', agentName: 'Example Agent', ceilingAmount: '100', currency: '', ttlHours: '1', items: '[{"sku":"SKU-1","quantity":1,"maxUnitPrice":80}]' });

  const merchantId = organization?.id || '';

  const load = useCallback(async () => {
    const [m, o] = await Promise.all([call(() => api.getAgentMandates({ limit: '50' }), setError), call(() => api.getAgentStorefrontOverview(), setError)]);
    setMandates(m?.mandates || []);
    setMeta(m);
    setOverview(o);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const issue = async () => {
    let items: unknown;
    try {
      items = JSON.parse(form.items);
    } catch {
      setError('Mandate lines must be valid JSON');
      return;
    }
    const data = await call(
      () =>
        api.createAgentMandate({
          agentId: form.agentId,
          agentName: form.agentName || undefined,
          ceilingAmount: Number(form.ceilingAmount),
          currency: form.currency || undefined,
          ttlSeconds: Math.round(Number(form.ttlHours || 1) * 3600),
          items,
        }),
      setError
    );
    if (data) setIssued(data);
    load();
  };

  const revoke = async (id: string) => {
    const reason = prompt('Why is this authorisation being revoked?') || undefined;
    await call(() => api.revokeAgentMandate(id, reason), setError);
    load();
  };

  const previewDescriptor = async () => {
    const [d, c] = await Promise.all([
      call(() => api.getPublicAgentDescriptor(merchantId), setError),
      call(() => api.getPublicAgentCatalog(merchantId, { limit: '5' }), setError),
    ]);
    setDescriptor(d);
    setCatalog(c);
  };

  const verify = async () => {
    let mandate: unknown;
    try {
      mandate = JSON.parse(verifyBody);
    } catch {
      setError('Mandate must be valid JSON');
      return;
    }
    const data = await call(() => api.verifyAgentMandate({ merchantId, mandate }), setError);
    setVerifyResult(data);
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Agent Storefront"
        subtitle="Let autonomous buying agents shop here safely: signed mandates with ceilings and expiry, a machine-readable catalog, and a public endpoint that refuses anything unsigned."
        actions={
          <button className={ghostButton} onClick={previewDescriptor} disabled={!merchantId}>
            <Eye size={15} /> Preview as an agent
          </button>
        }
      />
      <ErrorNote message={error} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Storefront" value={overview?.published ? 'Published' : overview?.installStatus || 'Not installed'} tone={overview?.published ? 'good' : 'warn'} hint="install the Agent Storefront app to publish" />
        <Stat label="Mandates issued" value={overview?.total ?? mandates.length} />
        <Stat label="Agent spend" value={<Money value={meta?.spent ?? 0} />} tone="good" />
        <Stat label="Protocol" value={overview?.spec || meta?.spec || '—'} hint={meta?.algorithm} />
      </div>

      <Card title="How mandates ended" icon={<Store size={18} />}>
        <div className="flex gap-3 flex-wrap text-sm">
          {overview?.byStatus?.length > 0 ? (
            overview.byStatus.map((s: any) => (
              <div key={s.status} className="border rounded px-3 py-2 flex items-center gap-2">
                <Badge>{s.status}</Badge>
                <span className="tabular-nums">{s.count}</span>
                <span className="text-gray-400"><Money value={s.value} /></span>
              </div>
            ))
          ) : (
            <span className="text-gray-500">No mandates have been presented yet.</span>
          )}
        </div>
        {overview?.endpoints && (
          <div className="mt-3 text-xs text-gray-500">
            Machine surface: {Object.entries(overview.endpoints).map(([k, v]) => (
              <span key={k} className="mr-3"><span className="text-gray-400">{k}:</span> <code>{String(v)}</code></span>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Issue a mandate" icon={<Plus size={18} />}>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Agent id"><input className={inputClass} value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })} /></Field>
            <Field label="Agent name"><input className={inputClass} value={form.agentName} onChange={(e) => setForm({ ...form, agentName: e.target.value })} /></Field>
            <Field label="Ceiling amount"><input className={inputClass} value={form.ceilingAmount} onChange={(e) => setForm({ ...form, ceilingAmount: e.target.value })} /></Field>
            <Field label="Currency" hint="blank = your trading currency"><input className={inputClass} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></Field>
            <Field label="Valid for (hours)"><input className={inputClass} value={form.ttlHours} onChange={(e) => setForm({ ...form, ttlHours: e.target.value })} /></Field>
          </div>
          <Field label="Lines (JSON)" hint="sku / productId / gtin, quantity, optional max unit price">
            <textarea rows={5} className={inputClass + ' font-mono text-xs'} value={form.items} onChange={(e) => setForm({ ...form, items: e.target.value })} />
          </Field>
          <button className={primaryButton + ' mt-2'} onClick={issue}>Sign and issue</button>

          {issued && (
            <div className="mt-4 border-t pt-3 space-y-2">
              <div className="text-sm flex items-center gap-2">
                <Badge tone="good">ISSUED</Badge>
                <span className="text-gray-600">nonce {issued.mandate?.nonce}</span>
                <button className={ghostButton} onClick={() => setVerifyBody(JSON.stringify(issued.mandate, null, 2))}>Send this to the verifier</button>
              </div>
              <JsonBox value={issued.mandate} />
              <p className="text-xs text-gray-500">
                The signature covers exactly the fields above. Hand this object to the agent; the merchant secret that signed it never leaves the server.
              </p>
            </div>
          )}
        </Card>

        <Card title="Verify a mandate the way the server does" icon={<ShieldCheck size={18} />}>
          <p className="text-sm text-gray-600 mb-2">
            Paste any mandate — a freshly issued one, or that same one with a single character changed — and the public endpoint reports the ceiling, live
            prices, stock and whether the signature still holds. A hand-written mandate will always be refused: only the merchant can sign one.
          </p>
          <textarea rows={9} className={inputClass + ' font-mono text-xs'} value={verifyBody} onChange={(e) => setVerifyBody(e.target.value)} />
          <button className={primaryButton + ' mt-2'} onClick={verify}><ShieldCheck size={15} /> Verify</button>
          {verifyResult && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <Badge tone={verifyResult.signatureValid ? 'good' : 'bad'}>{verifyResult.signatureValid ? 'SIGNATURE VALID' : 'SIGNATURE INVALID'}</Badge>
                <Badge tone={verifyResult.verdict?.accept ? 'good' : 'bad'}>{verifyResult.verdict?.accept ? 'WOULD ACCEPT' : `REFUSED: ${verifyResult.verdict?.code}`}</Badge>
                {verifyResult.replayed && <Badge tone="bad">ALREADY USED</Badge>}
                <span className="text-gray-600">quoted total <Money value={verifyResult.total} /></span>
              </div>
              {verifyResult.verdict?.message && <div className="text-sm text-gray-600">{verifyResult.verdict.message}</div>}
              <JsonBox value={verifyResult} />
            </div>
          )}
        </Card>
      </div>

      {(descriptor || catalog) && (
        <Card title="What an agent sees" icon={<FileJson size={18} />}>
          <div className="grid lg:grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-gray-500 mb-1">GET /api/agents/public/descriptor?merchant={merchantId.slice(0, 8)}…</div>
              <JsonBox value={descriptor} />
            </div>
            <div>
              <div className="text-sm text-gray-500 mb-1">GET /api/agents/public/catalog.jsonld — {catalog?.itemListElement?.length ?? 0} items</div>
              <JsonBox value={catalog} />
            </div>
          </div>
        </Card>
      )}

      <Card title="Mandates" icon={<Store size={18} />}>
        <Table head={<tr><Th>Issued</Th><Th>Agent</Th><Th>Type</Th><Th>Ceiling</Th><Th>Spent</Th><Th>Expires</Th><Th>Status</Th><Th /></tr>}>
          {mandates.map((m: any) => (
            <tr key={m.id}>
              <Td className="whitespace-nowrap text-gray-600">{new Date(m.createdAt).toLocaleString()}</Td>
              <Td>
                <div className="font-medium">{m.agentName || m.agentId}</div>
                <div className="text-xs text-gray-500">{m.agentId}</div>
              </Td>
              <Td>{m.mandateType}</Td>
              <Td><Money value={m.ceilingAmount} currency={m.currency} /></Td>
              <Td><Money value={m.amount} /></Td>
              <Td className="whitespace-nowrap">{new Date(m.expiresAt).toLocaleDateString()}</Td>
              <Td>
                <Badge>{m.status}</Badge>
                {m.rejectReason && <div className="text-xs text-gray-500 mt-0.5 max-w-48">{m.rejectReason}</div>}
              </Td>
              <Td className="text-right">
                {(m.status === 'ACTIVE' || m.status === 'EXPIRED') && (
                  <button className={dangerButton} onClick={() => revoke(m.id)}><Ban size={14} /> Revoke</button>
                )}
              </Td>
            </tr>
          ))}
          {mandates.length === 0 && <tr><Td colSpan={8}><Empty>No mandates issued. An agent cannot buy anything until one exists.</Empty></Td></tr>}
        </Table>
      </Card>
    </div>
  );
}
