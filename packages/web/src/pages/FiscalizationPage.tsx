import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Receipt, Link2, Send, ShieldCheck, Usb, Trash2, Percent, Globe2, Scale, CreditCard } from 'lucide-react';
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
  dangerButton,
  ghostButton,
  inputClass,
  primaryButton,
} from '../components/GlobalUi';

/**
 * Fiscalization (§ fiscal). The screen answers three questions an inspector
 * asks: which regime applies to me, is every receipt sealed into the chain,
 * and can I prove the chain has not been edited since.
 */
export default function FiscalizationPage() {
  const [profiles, setProfiles] = useState<any>(null);
  const [tax, setTax] = useState<any>(null);
  const [taxQuery, setTaxQuery] = useState('');
  const [compliance, setCompliance] = useState<any>(null);
  const [compQuery, setCompQuery] = useState('');
  const [gateways, setGateways] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [chain, setChain] = useState<any>(null);
  const [selected, setSelected] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ serialNumber: '', profileCode: '', activationCode: '', locationId: '' });

  const load = useCallback(async () => {
    const [p, s, d, tx, cp, gw] = await Promise.all([
      call(() => api.getFiscalProfiles(), setError),
      call(() => api.getFiscalStatus(), setError),
      call(() => api.getFiscalDocuments({ limit: '25' }), setError),
      call(() => api.getTaxProfiles(), setError),
      call(() => api.getComplianceProfiles(), setError),
      call(() => api.getRegionalGateways(), setError),
    ]);
    setProfiles(p);
    setStatus(s);
    setDocuments(d?.documents || []);
    setTax(tx);
    setCompliance(cp);
    setGateways(gw);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Refetch only the chain list when the status filter changes: the rest of the
  // screen is unaffected, so toggling a filter stays instant.
  useEffect(() => {
    (async () => {
      const d = await call(() => api.getFiscalDocuments({ limit: '25', ...(statusFilter ? { status: statusFilter } : {}) }), setError);
      setDocuments(d?.documents || []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const registerDevice = async () => {
    if (!form.serialNumber || !form.profileCode) return;
    await call(() => api.createFiscalDevice({ ...form, activationCode: form.activationCode || undefined, locationId: form.locationId || undefined }), setError);
    setForm({ serialNumber: '', profileCode: '', activationCode: '', locationId: '' });
    load();
  };

  const verifyChain = async () => {
    const data = await call(() => api.verifyFiscalChain(), setError);
    setChain(data);
  };

  const transmit = async () => {
    await call(() => api.transmitFiscalDocuments({ limit: 25 }), setError);
    setChain(null);
    load();
  };

  const openDocument = async (id: string) => {
    const data = await call(() => api.getFiscalDocument(id), setError);
    setSelected(data);
  };

  const profile = status?.profile;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Fiscalization"
        subtitle="Country receipt regimes, tamper-evident hash-chain seals, and the evidence trail an audit asks for."
        actions={
          <>
            <button className={ghostButton} onClick={verifyChain}>
              <Link2 size={15} /> Verify chain
            </button>
            <button className={primaryButton} onClick={transmit}>
              <Send size={15} /> Transmit pending
            </button>
          </>
        }
      />
      <ErrorNote message={error} />

      {status && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Market" value={status.countryCode || '—'} hint={profile?.country} />
          <Stat label="Regime" value={profile?.regime || '—'} hint={profile?.code} tone={profile?.requiresSeal ? 'warn' : 'default'} />
          <Stat label="Sealed documents" value={status.documents?.total ?? 0} hint={new Date(status.documents?.lastSealed?.sealedAt || Date.now()).toLocaleString()} />
          <Stat
            label="Device readiness"
            value={status.deviceRequired ? (status.deviceReady ? 'Ready' : 'Missing') : 'Not required'}
            tone={status.deviceRequired && !status.deviceReady ? 'bad' : 'good'}
            hint={status.bridgeConfigured ? 'Authority bridge configured' : 'Simulated transmission (no bridge configured)'}
          />
        </div>
      )}

      {chain && (
        <Card title="Chain verification" icon={<ShieldCheck size={18} />}>
          <div className="flex items-center gap-3 flex-wrap">
            <Badge tone={chain.ok ? 'good' : 'bad'}>{chain.ok ? 'INTACT' : 'BROKEN'}</Badge>
            <span className="text-sm text-gray-600">
              {chain.checked} documents checked for {chain.profileCode} · contiguous: {chain.contiguous ? 'yes' : 'no'}
            </span>
            {!chain.ok && <span className="text-sm text-rose-600">{chain.reason} at {chain.brokenAt}</span>}
            {chain.sequenceGaps?.length > 0 && <span className="text-sm text-rose-600">Sequence gaps: {chain.sequenceGaps.slice(0, 10).join(', ')}</span>}
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Registered devices (${status?.devices?.length ?? 0})`} icon={<Usb size={18} />}>
          {(status?.devices || []).length === 0 ? (
            <Empty>No fiscal device registered for this tenant.</Empty>
          ) : (
            <Table head={<tr><Th>Serial</Th><Th>Profile</Th><Th>Status</Th><Th>Last sequence</Th><Th /></tr>}>
              {status.devices.map((d: any) => (
                <tr key={d.id}>
                  <Td className="font-medium">{d.serialNumber}</Td>
                  <Td>{d.profileCode}</Td>
                  <Td><Badge>{d.status}</Badge></Td>
                  <Td className="tabular-nums">{d.lastSequence}</Td>
                  <Td className="text-end">
                    <button
                      className={dangerButton}
                      onClick={async () => {
                        await call(() => api.retireFiscalDevice(d.id), setError);
                        load();
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          <div className="grid grid-cols-2 gap-2 mt-4">
            <Field label="Profile code">
              <input list="fiscal-profiles" className={inputClass} value={form.profileCode} onChange={(e) => setForm({ ...form, profileCode: e.target.value })} placeholder="DE_TSE" />
            </Field>
            <Field label="Serial number">
              <input className={inputClass} value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} placeholder="KassenSichV-12345" />
            </Field>
            <Field label="Activation code" hint="Stored encrypted; never shown again">
              <input className={inputClass} value={form.activationCode} onChange={(e) => setForm({ ...form, activationCode: e.target.value })} />
            </Field>
            <Field label="Location id (optional)">
              <input className={inputClass} value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} />
            </Field>
            <button className={primaryButton} onClick={registerDevice}>Register device</button>
          </div>
          <datalist id="fiscal-profiles">
            {(profiles?.profiles || []).map((p: any) => (
              <option key={p.code} value={p.code}>{`${p.country} · ${p.regime}`}</option>
            ))}
          </datalist>
        </Card>

        <Card title="Supported regimes" icon={<Receipt size={18} />}>
          <p className="text-sm text-gray-500 mb-3">
            {profiles?.coverage?.countryCount ?? profiles?.profiles?.length ?? 0} markets modelled. Your market: {profiles?.active?.countryCode || 'unknown — default rules apply'}.
          </p>
          <div className="max-h-80 overflow-y-auto -mx-4">
            <Table head={<tr><Th>Code</Th><Th>Country</Th><Th>Regime</Th><Th>Transmission</Th><Th>Retention</Th></tr>}>
              {(profiles?.profiles || []).map((p: any) => (
                <tr key={p.code} className={p.code === profile?.code ? 'bg-blue-50' : undefined}>
                  <Td className="font-medium">{p.code}</Td>
                  <Td>{p.country}</Td>
                  <Td>{p.regime}</Td>
                  <Td>{p.transmission}</Td>
                  <Td>{p.retentionYears} yrs</Td>
                </tr>
              ))}
            </Table>
          </div>
          {profile?.notes && <p className="text-xs text-gray-500 mt-3">{profile.notes}</p>}
          {profiles?.algorithm && <p className="text-xs text-gray-400 mt-1">Seal algorithm: {profiles.algorithm}</p>}
        </Card>
      </div>

      <Card
        title="Default consumption tax by country"
        icon={<Percent size={18} />}
        actions={
          <input
            className={inputClass + ' max-w-xs'}
            placeholder="Search country…"
            value={taxQuery}
            onChange={(e) => setTaxQuery(e.target.value)}
          />
        }
      >
        {tax && (
          <>
            <div className="flex items-center gap-2 flex-wrap mb-3 text-sm">
              <Badge tone="good">
                {tax.active?.profile?.country || tax.active?.countryCode || 'No market set'} · {tax.active?.suggestedRate ?? 0}%
              </Badge>
              <span className="text-gray-500">
                <Globe2 size={13} className="inline -mt-0.5" /> {tax.coverage?.countries ?? 0} markets · {tax.coverage?.vatSystems ?? 0} VAT · {tax.coverage?.gstSystems ?? 0} GST · highest {tax.coverage?.highestRate?.rate ?? 0}% ({tax.coverage?.highestRate?.country})
              </span>
              {tax.active?.countryCode && <span className="text-gray-400">Use this to pre-fill the organisation tax rate.</span>}
            </div>
            <div className="max-h-80 overflow-y-auto -mx-4">
              <Table head={<tr><Th>Country</Th><Th>Regime</Th><Th>Type</Th><Th className="text-end">Standard</Th><Th>Reduced</Th><Th>CCY</Th></tr>}>
                {(tax.profiles || [])
                  .filter((p: any) => !taxQuery || `${p.country} ${p.localName} ${p.countryCode}`.toLowerCase().includes(taxQuery.toLowerCase()))
                  .map((p: any) => (
                    <tr key={p.countryCode} className={p.countryCode === tax.active?.countryCode ? 'bg-blue-50' : undefined}>
                      <Td className="font-medium whitespace-nowrap">{p.country}</Td>
                      <Td className="text-gray-500">{p.localName}</Td>
                      <Td><Badge>{p.type}</Badge></Td>
                      <Td className="text-end tabular-nums">{p.standardRate}%</Td>
                      <Td className="text-gray-500">{p.reducedRates?.length ? p.reducedRates.join(' / ') + '%' : '—'}</Td>
                      <Td className="text-gray-500">{p.currency}</Td>
                    </tr>
                  ))}
              </Table>
            </div>
          </>
        )}
      </Card>

      <Card
        title="Country compliance & data residency"
        icon={<Scale size={18} />}
        actions={
          <input
            className={inputClass + ' max-w-xs'}
            placeholder="Search country…"
            value={compQuery}
            onChange={(e) => setCompQuery(e.target.value)}
          />
        }
      >
        {compliance && (
          <>
            <div className="flex items-center gap-2 flex-wrap mb-3 text-sm">
              <Badge tone="good">
                {compliance.active?.profile?.country || compliance.active?.countryCode || 'No market set'} · {compliance.active?.profile?.privacyLaw || 'local law'}
              </Badge>
              <span className="text-gray-500">
                <Globe2 size={13} className="inline -mt-0.5" /> {compliance.coverage?.markets ?? 0} markets · {compliance.coverage?.mandatoryResidency ?? 0} mandatory in-country · {compliance.coverage?.eInvoiceMandated ?? 0} e-invoice regimes
              </span>
            </div>
            <div className="max-h-80 overflow-y-auto -mx-4">
              <Table head={<tr><Th>Country</Th><Th>Privacy law</Th><Th>Residency</Th><Th>Tax-ID label</Th><Th>e-Invoice</Th></tr>}>
                {(compliance.profiles || [])
                  .filter((p: any) => !compQuery || `${p.country} ${p.privacyLaw} ${p.countryCode}`.toLowerCase().includes(compQuery.toLowerCase()))
                  .map((p: any) => (
                    <tr key={p.countryCode} className={p.countryCode === compliance.active?.countryCode ? 'bg-blue-50' : undefined}>
                      <Td className="font-medium whitespace-nowrap">{p.country}</Td>
                      <Td className="text-gray-600">{p.privacyLaw}</Td>
                      <Td><Badge tone={p.dataResidency === 'MANDATORY_IN_COUNTRY' ? 'bad' : p.dataResidency === 'NONE' ? 'neutral' : 'warn'}>{p.dataResidency}</Badge></Td>
                      <Td className="text-gray-500">{p.taxIdLabel}</Td>
                      <Td className="text-gray-500">{p.eInvoiceFormat || '—'}</Td>
                    </tr>
                  ))}
              </Table>
            </div>
          </>
        )}
      </Card>

      <Card title="Regional payment gateways" icon={<CreditCard size={18} />}>
        <p className="text-sm text-gray-500 mb-3">
          Card-free rails for the markets that run on them. Connect your own credentials and live charges route through the provider’s documented API; until then every call runs in a clearly-labelled simulation.
        </p>
        {(gateways?.gateways || []).length === 0 ? (
          <Empty>No regional gateways available.</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(gateways.gateways || []).map((g: any) => (
              <div key={g.id} className="border rounded-lg p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{g.name}</span>
                  <Badge tone={g.connected && g.connection?.configured ? 'good' : g.connected ? 'warn' : 'neutral'}>
                    {g.connected && g.connection?.configured ? 'CONNECTED' : g.connected ? 'PARTIAL' : 'NOT SET UP'}
                  </Badge>
                </div>
                <p className="text-xs text-gray-500 mt-1">{g.region} · {g.flow === 'redirect' ? 'hosted checkout' : 'handset PIN prompt'}</p>
                <p className="text-xs text-gray-400 mt-1">{g.countries.join(', ')} · {g.currencies.join(', ')}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Fiscal chain — newest documents"
        icon={<Link2 size={18} />}
        actions={
          <select className={inputClass} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Filter: all statuses</option>
            {['SEALED', 'TRANSMITTED', 'PENDING', 'FAILED', 'REJECTED'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        }
      >
        <Table head={<tr><Th>Receipt</Th><Th>Type</Th><Th>Total</Th><Th>VAT</Th><Th>Seq</Th><Th>Status</Th><Th>Sealed</Th><Th /></tr>}>
          {documents.map((d: any) => (
            <tr key={d.id}>
              <Td className="font-medium whitespace-nowrap">{d.receiptNumber}</Td>
              <Td>{d.documentType}</Td>
              <Td><Money value={d.total} currency={d.currency} /></Td>
              <Td><Money value={d.vatTotal} /></Td>
              <Td className="tabular-nums">{d.sequenceNumber}</Td>
              <Td><Badge>{d.status}</Badge></Td>
              <Td className="text-gray-500 whitespace-nowrap">{new Date(d.sealedAt).toLocaleString()}</Td>
              <Td className="text-end">
                <button className={ghostButton} onClick={() => openDocument(d.id)}>Inspect</button>
              </Td>
            </tr>
          ))}
          {documents.length === 0 && (
            <tr>
              <Td className="text-center text-gray-500 py-8" colSpan={8}>Nothing sealed yet — every completed sale is sealed automatically when a regime requires it.</Td>
            </tr>
          )}
        </Table>

        {selected && (
          <div className="mt-4 border rounded p-4 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Badge tone={selected.sealValid ? 'good' : 'bad'}>{selected.sealValid ? 'SEAL VALID' : 'SEAL INVALID'}</Badge>
              <Badge tone={selected.linkValid ? 'good' : 'warn'}>{selected.linkValid ? 'CHAIN LINK OK' : 'CHAIN LINK MISSING'}</Badge>
              <span className="text-gray-500">previous receipt: {selected.previousReceipt || 'none (first)'}</span>
            </div>
            <div className="grid md:grid-cols-2 gap-2 text-xs">
              <div><span className="text-gray-500">Payload hash:</span> <code className="break-all">{selected.document?.payloadHash}</code></div>
              <div><span className="text-gray-500">Seal:</span> <code className="break-all">{selected.document?.signedHash || '—'}</code></div>
              <div><span className="text-gray-500">Previous hash:</span> <code className="break-all">{selected.document?.previousHash || '—'}</code></div>
              <div><span className="text-gray-500">Keep until:</span> {new Date(selected.retentionUntil).toLocaleDateString()} · external ref: {selected.document?.externalRef || '—'}</div>
            </div>
            {selected.qrFields?.length > 0 && (
              <div className="text-xs">
                <span className="text-gray-500">QR fields:</span>
                <ul className="mt-1 space-y-0.5">
                  {selected.qrFields.map((f: any, i: number) => (
                    <li key={i}><code>{f.label || f.tag}</code>: {f.value}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
