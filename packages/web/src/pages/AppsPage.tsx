import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Boxes, KeyRound, ShieldAlert, Sliders, Plug, Copy } from 'lucide-react';
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
  dangerButton,
  ghostButton,
  inputClass,
  primaryButton,
} from '../components/GlobalUi';

/**
 * Ecosystem (§ apps). Two guarantees drive this screen: an installation can only
 * ever hold scopes its published manifest declares, and a merchant's custom
 * fields are coerced and validated before a single row is written. A high-risk
 * grant returns 428 from the server until it is explicitly acknowledged, so the
 * acknowledgement is shown here as a separate, deliberate click.
 */

/** Non-unwrapping variant: a 428 carries a payload we still need to render. */
async function envelope(fn: () => Promise<any>, setError: (m: string | null) => void): Promise<any> {
  try {
    setError(null);
    return await fn();
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
    return null;
  }
}

export default function AppsPage() {
  const [overview, setOverview] = useState<any>(null);
  const [catalog, setCatalog] = useState<any>(null);
  const [installs, setInstalls] = useState<any>(null);
  const [fields, setFields] = useState<any>(null);
  const [manifest, setManifest] = useState<any>(null);
  const [issued, setIssued] = useState<any>(null);
  const [pendingRisk, setPendingRisk] = useState<any>(null);
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [valuesResult, setValuesResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState({ country: '', category: '', all: 'false' });
  const [editor, setEditor] = useState({ code: '', scopes: [] as string[], available: [] as string[] });
  const [verify, setVerify] = useState({ token: '', appCode: '', requiredScopes: 'read:orders' });
  const [fieldForm, setFieldForm] = useState({
    entity: 'ORDER',
    fieldKey: '',
    label: '',
    dataType: 'TEXT',
    required: false,
    options: '',
    defaultValue: '',
  });
  const [valueForm, setValueForm] = useState({ entityUuid: '', entity: 'ORDER', values: '{"delivery_note": "Leave at reception"}' });

  const load = useCallback(async () => {
    const [o, c, i, f] = await Promise.all([
      call(() => api.getEcosystemOverview(), setError),
      call(
        () =>
          api.getAppCatalog({
            ...(filter.country ? { country: filter.country } : {}),
            ...(filter.all === 'true' ? { all: 'true' } : {}),
          }),
        setError
      ),
      call(() => api.getAppInstallations(), setError),
      call(() => api.getCustomFields(), setError),
    ]);
    setOverview(o);
    setCatalog(c);
    setInstalls(i);
    setFields(f);
  }, [filter.country, filter.all]);

  useEffect(() => {
    load();
  }, [load]);

  const openManifest = async (code: string) => {
    const data = await call(() => api.getAppManifest(code), setError);
    if (data) {
      setManifest(data);
      setEditor({ code, scopes: data.app?.scopes || [], available: data.app?.scopes || [] });
      setPendingRisk(null);
    }
  };

  /** Edit an existing grant: the manifest bounds it, the current scopes tick it. */
  const editGrant = async (installation: any) => {
    const data = await call(() => api.getAppManifest(installation.appCode), setError);
    if (!data) return;
    setManifest(data);
    setEditor({ code: installation.appCode, scopes: installation.scopes || [], available: data.app?.scopes || [] });
    setPendingRisk(null);
  };

  const doInstall = async (acknowledge: boolean) => {
    const code = manifest?.app?.code || editor.code;
    if (!code) {
      setError('Pick an app from the catalog first');
      return;
    }
    const res = await envelope(
      () => api.installApp({ appCode: code, scopes: editor.scopes, acknowledgeScopes: acknowledge || undefined }),
      setError
    );
    if (!res) return;
    if (res.success === false && res.data?.risk) {
      // 428: the grant is high-risk and needs a conscious second click.
      setPendingRisk(res.data);
      setError(null);
      return;
    }
    if (res.success === false) return;
    setPendingRisk(null);
    setIssued(res.data);
    load();
  };

  const toggleScope = (scope: string) =>
    setEditor({ ...editor, scopes: editor.scopes.includes(scope) ? editor.scopes.filter((s) => s !== scope) : [...editor.scopes, scope] });

  const saveScopes = async (code: string) => {
    const data = await call(() => api.updateAppScopes(code, editor.scopes), setError);
    if (data) load();
  };

  const rotate = async (code: string) => {
    const data = await call(() => api.rotateAppToken(code), setError);
    if (data) setIssued({ token: data.token, preview: data.preview, scopes: data.scopes, rotatedFor: code });
  };

  const uninstall = async (code: string) => {
    if (!confirm(`Revoke ${code}'s token? Its installations history and audit trail are kept.`)) return;
    await call(() => api.uninstallApp(code), setError);
    load();
  };

  const runVerify = async () => {
    const res = await envelope(
      () =>
        api.verifyAppToken({
          token: verify.token,
          ...(verify.appCode ? { appCode: verify.appCode } : {}),
          ...(verify.requiredScopes.trim() ? { requiredScopes: verify.requiredScopes.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
        }),
      setError
    );
    if (res?.success) setVerifyResult({ ok: true, ...res.data });
    else setVerifyResult({ ok: false, message: res?.message || 'Token rejected' });
  };

  const saveField = async () => {
    const options = fieldForm.options
      ? fieldForm.options.split(',').map((s) => s.trim()).filter(Boolean)
      : null;
    const data = await call(
      () =>
        api.saveCustomField({
          entity: fieldForm.entity,
          fieldKey: fieldForm.fieldKey || undefined,
          label: fieldForm.label,
          dataType: fieldForm.dataType,
          required: fieldForm.required,
          options,
          defaultValue: fieldForm.defaultValue === '' ? null : fieldForm.defaultValue,
        }),
      setError
    );
    if (data) {
      setFieldForm({ ...fieldForm, fieldKey: '', label: '', options: '', defaultValue: '' });
      const f = await call(() => api.getCustomFields(), setError);
      setFields(f);
    }
  };

  const deactivateField = async (id: string) => {
    await call(() => api.deactivateCustomField(id), setError);
    const f = await call(() => api.getCustomFields(), setError);
    setFields(f);
  };

  const loadValues = async () => {
    if (!valueForm.entityUuid) return;
    const data = await call(() => api.getCustomFieldValues(valueForm.entityUuid, valueForm.entity), setError);
    if (data) setValuesResult(JSON.stringify(data.values, null, 2));
  };

  const saveValues = async () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(valueForm.values);
    } catch {
      setError('Values must be valid JSON');
      return;
    }
    const data = await call(() => api.saveCustomFieldValues({ entityUuid: valueForm.entityUuid, entity: valueForm.entity as any, values: parsed }), setError);
    if (data) setValuesResult(`Saved ${data.saved} value(s) against ${data.entityUuid}`);
  };

  const apps: any[] = catalog?.apps || [];
  const installations: any[] = installs?.installations || [];
  const definitions: any[] = fields?.fields || [];
  const shown = filter.category ? apps.filter((a) => (a.categories || []).includes(filter.category)) : apps;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Partner Ecosystem"
        subtitle="Install third-party apps under scopes their own manifest declares, rotate and revoke their tokens, and extend orders, products and customers with typed custom fields."
        actions={
          <>
            <select className={inputClass} value={filter.all} onChange={(e) => setFilter({ ...filter, all: e.target.value })}>
              <option value="false">My market only</option>
              <option value="true">Whole catalog</option>
            </select>
            <input className={inputClass} placeholder="Market (e.g. BR)" value={filter.country} onChange={(e) => setFilter({ ...filter, country: e.target.value.toUpperCase() })} />
            <button className={ghostButton} onClick={load}>Refresh</button>
          </>
        }
      />
      <ErrorNote message={error} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Installed" value={overview?.installed ?? 0} hint={`${overview?.availableInMarket ?? 0} available in ${overview?.market || 'any'} market`} />
        <Stat label="Catalog size" value={overview?.catalogSize ?? 0} />
        <Stat label="Granted scopes" value={overview?.grantedScopes?.length ?? 0} hint={(overview?.grantedScopes || []).slice(0, 4).join(', ')} />
        <Stat
          label="Highest risk"
          value={overview?.highestRisk?.scope || '—'}
          tone={overview?.highestRisk?.risk === 'HIGH' ? 'bad' : overview?.highestRisk?.risk === 'MEDIUM' ? 'warn' : 'good'}
          hint={overview?.highestRisk?.risk || 'no writes or personal data granted'}
        />
        <Stat label="Custom fields" value={overview?.customFields ?? 0} hint="active definitions" />
      </div>

      <Card
        title={`Catalog (${shown.length})`}
        icon={<Boxes size={18} />}
        actions={
          <select className={inputClass} value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })}>
            <option value="">All categories</option>
            {(catalog?.categories || []).map((c: string) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        }
      >
        <Table head={<tr><Th>App</Th><Th>Publisher</Th><Th>Version</Th><Th>Pricing</Th><Th>Scopes</Th><Th>Risk</Th><Th>State</Th><Th /></tr>}>
          {shown.map((a: any) => (
            <tr key={a.code}>
              <Td className="font-medium">
                {a.name}
                <div className="text-xs text-gray-500 max-w-md">{a.description}</div>
              </Td>
              <Td className="text-xs">{a.publisher}</Td>
              <Td className="text-xs tabular-nums">{a.version}</Td>
              <Td><Badge tone={a.pricing === 'FREE' ? 'good' : 'info'}>{a.pricing}</Badge></Td>
              <Td className="text-xs text-gray-600">{a.scopes.length} declared{a.handlesPersonalData ? ' · personal data' : ''}</Td>
              <Td><Badge tone={a.risk?.risk === 'HIGH' ? 'bad' : a.risk?.risk === 'MEDIUM' ? 'warn' : 'good'}>{a.risk?.risk || 'LOW'}</Badge></Td>
              <Td>{a.installed ? <Badge>{a.installed.status}</Badge> : a.availableInMarket ? <span className="text-xs text-gray-400">not installed</span> : <Badge tone="warn">other markets</Badge>}</Td>
              <Td className="text-end"><button className={ghostButton} onClick={() => openManifest(a.code)}>Manifest</button></Td>
            </tr>
          ))}
          {shown.length === 0 && <tr><Td colSpan={8}><Empty>Nothing matches that filter.</Empty></Td></tr>}
        </Table>
      </Card>

      {manifest && (
        <Card title={`${manifest.app.name} — grant preview`} icon={<ShieldAlert size={18} />}>
          <p className="text-sm text-gray-600 mb-3">
            The token is created for exactly the scopes ticked below, expanded by whatever the scope table implies. Anything outside the published manifest is refused.
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            {(manifest.app.scopes || []).map((s: string) => (
              <label key={s} className={`text-xs border rounded px-2 py-1 cursor-pointer ${editor.scopes.includes(s) ? 'bg-blue-50 border-blue-300' : 'text-gray-500'}`}>
                <input type="checkbox" className="mr-1" checked={editor.scopes.includes(s)} onChange={() => toggleScope(s)} />
                {s}
              </label>
            ))}
          </div>
          <div className="text-xs text-gray-500 mb-3">
            Implied: <code>{(manifest.implied || []).join(', ')}</code> · endpoints <code>{(manifest.app.endpoints || []).join(', ')}</code> · events <code>{(manifest.app.events || []).join(', ')}</code>
            {manifest.app.envKey ? ` · env ${manifest.app.envKey}` : ''}
          </div>
          {pendingRisk && (
            <div className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded px-3 py-2 mb-3">
              <ShieldAlert size={14} className="inline mr-1" />
              This grant includes <strong>{pendingRisk.risk.scope}</strong> ({pendingRisk.risk.reason || 'write, refund or personal-data access'}). The server answered 428 and wrote nothing.
            </div>
          )}
          <button className={pendingRisk ? dangerButton : primaryButton} onClick={() => doInstall(Boolean(pendingRisk))} disabled={!editor.scopes.length}>
            <Plug size={15} /> {pendingRisk ? 'Acknowledge and install' : 'Install'}
          </button>
        </Card>
      )}

      {issued && (
        <Card title={issued.rotatedFor ? `Rotated token — ${issued.rotatedFor}` : 'Token issued — shown once'} icon={<KeyRound size={18} />}>
          <p className="text-sm text-gray-600 mb-2">Only a digest is stored; this is the sole moment the plaintext exists. Copy it now — it cannot be retrieved later.</p>
          <div className="flex items-center gap-2">
            <code className="text-xs bg-gray-50 border rounded px-2 py-1 break-all flex-1">{issued.token}</code>
            <button className={ghostButton} onClick={() => navigator.clipboard?.writeText(issued.token)}><Copy size={14} /></button>
          </div>
          <div className="text-xs text-gray-500 mt-2">preview {issued.preview} · scopes {(issued.scopes || []).join(', ')}</div>
        </Card>
      )}

      <Card title={`Installations (${installations.length})`} icon={<Plug size={18} />}>
        <Table head={<tr><Th>App</Th><Th>Status</Th><Th>Scopes</Th><Th>Risk</Th><Th>Installed</Th><Th /></tr>}>
          {installations.map((i: any) => (
            <tr key={i.id}>
              <Td className="font-medium">{i.appName}<div className="text-xs text-gray-500">{i.appCode} · {i.publisher}</div></Td>
              <Td><Badge>{i.status}</Badge></Td>
              <Td className="text-xs text-gray-600 max-w-sm">{(i.scopes || []).join(', ')}</Td>
              <Td><Badge tone={i.risk?.risk === 'HIGH' ? 'bad' : i.risk?.risk === 'MEDIUM' ? 'warn' : 'good'}>{i.risk?.risk || 'LOW'}</Badge></Td>
              <Td className="text-xs text-gray-500">{i.installedAt ? new Date(i.installedAt).toLocaleDateString() : '—'}</Td>
              <Td className="text-end whitespace-nowrap">
                <button className={ghostButton} onClick={() => editGrant(i)}>Edit grant</button>{' '}
                <button className={ghostButton} onClick={() => rotate(i.appCode)}><KeyRound size={14} /> Rotate</button>{' '}
                <button className={dangerButton} onClick={() => uninstall(i.appCode)}>Uninstall</button>
              </Td>
            </tr>
          ))}
          {installations.length === 0 && <tr><Td colSpan={6}><Empty>No live installations.</Empty></Td></tr>}
        </Table>
        {editor.code && (
          <div className="mt-4 border-t pt-3">
            <div className="text-sm text-gray-600 mb-2">Grant for <code>{editor.code}</code> — narrowing applies immediately, widening must stay inside the manifest:</div>
            <div className="flex flex-wrap gap-2 mb-2">
              {editor.available.map((s: string) => (
                <label key={s} className={`text-xs border rounded px-2 py-1 cursor-pointer ${editor.scopes.includes(s) ? 'bg-blue-50 border-blue-300' : 'text-gray-500'}`}>
                  <input type="checkbox" className="mr-1" checked={editor.scopes.includes(s)} onChange={() => toggleScope(s)} />
                  {s}
                </label>
              ))}
            </div>
            <button className={primaryButton} onClick={() => saveScopes(editor.code)}>Save grant</button>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Token check (as a webhook receiver would)" icon={<KeyRound size={18} />}>
          <div className="space-y-2">
            <Field label="Token" hint="paste a freshly issued or rotated token">
              <input className={inputClass + ' font-mono text-xs'} value={verify.token} onChange={(e) => setVerify({ ...verify, token: e.target.value })} placeholder={issued?.token || 'upos_…'} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="App code (optional)"><input className={inputClass} value={verify.appCode} onChange={(e) => setVerify({ ...verify, appCode: e.target.value })} placeholder={editor.code} /></Field>
              <Field label="Required scopes"><input className={inputClass} value={verify.requiredScopes} onChange={(e) => setVerify({ ...verify, requiredScopes: e.target.value })} /></Field>
            </div>
            <button className={primaryButton} onClick={runVerify} disabled={verify.token.length < 10}>Verify</button>
          </div>
          {verifyResult && (
            <div className="mt-3 text-sm">
              {verifyResult.ok ? (
                <div className="space-y-1">
                  <div><Badge tone="good"> recognised</Badge> {verifyResult.appName} <span className="text-xs text-gray-500">{verifyResult.appCode}</span></div>
                  <div><Badge tone={verifyResult.authorized ? 'good' : 'bad'}>{verifyResult.authorized ? 'AUTHORIZED' : 'INSUFFICIENT'}</Badge> <span className="text-xs text-gray-600">granted {(verifyResult.scopes || []).join(', ')}</span></div>
                </div>
              ) : (
                <div><Badge tone="bad">REJECTED</Badge> <span className="text-xs text-gray-600">{verifyResult.message}</span></div>
              )}
            </div>
          )}
        </Card>

        <Card title="Custom field definitions" icon={<Sliders size={18} />}>
          <Table head={<tr><Th>Key</Th><Th>Label</Th><Th>Type</Th><Th>Entity</Th><Th>Required</Th><Th>State</Th><Th /></tr>}>
            {definitions.map((f: any) => (
              <tr key={f.id}>
                <Td className="font-mono text-xs">{f.fieldKey}</Td>
                <Td>{f.label}</Td>
                <Td><Badge tone="info">{f.dataType}</Badge></Td>
                <Td className="text-xs">{f.entity}</Td>
                <Td>{f.required ? 'yes' : 'no'}</Td>
                <Td><Badge tone={f.active ? 'good' : 'neutral'}>{f.active ? 'ACTIVE' : 'OFF'}</Badge></Td>
                <Td className="text-end">{f.active && <button className={ghostButton} onClick={() => deactivateField(f.id)}>Deactivate</button>}</Td>
              </tr>
            ))}
            {definitions.length === 0 && <tr><Td colSpan={7}><Empty>No custom fields — every document uses only the standard columns.</Empty></Td></tr>}
          </Table>
          <div className="grid md:grid-cols-3 gap-2 mt-4 border-t pt-3">
            <Field label="Entity">
              <select className={inputClass} value={fieldForm.entity} onChange={(e) => setFieldForm({ ...fieldForm, entity: e.target.value })}>
                {(fields?.entities || ['ORDER', 'PRODUCT', 'CUSTOMER']).map((en: string) => <option key={en} value={en}>{en}</option>)}
              </select>
            </Field>
            <Field label="Field key" hint="derived from the label when blank"><input className={inputClass} value={fieldForm.fieldKey} onChange={(e) => setFieldForm({ ...fieldForm, fieldKey: e.target.value })} placeholder="delivery_note" /></Field>
            <Field label="Label"><input className={inputClass} value={fieldForm.label} onChange={(e) => setFieldForm({ ...fieldForm, label: e.target.value })} placeholder="Delivery note" /></Field>
            <Field label="Type">
              <select className={inputClass} value={fieldForm.dataType} onChange={(e) => setFieldForm({ ...fieldForm, dataType: e.target.value })}>
                {(fields?.types || ['TEXT', 'NUMBER', 'BOOL', 'DATE', 'SELECT']).map((t: string) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Options (comma-separated, SELECT)"><input className={inputClass} value={fieldForm.options} onChange={(e) => setFieldForm({ ...fieldForm, options: e.target.value })} placeholder="Urgent,Standard" /></Field>
            <Field label="Default"><input className={inputClass} value={fieldForm.defaultValue} onChange={(e) => setFieldForm({ ...fieldForm, defaultValue: e.target.value })} /></Field>
            <label className="flex items-end gap-2 text-sm pb-2">
              <input type="checkbox" checked={fieldForm.required} onChange={(e) => setFieldForm({ ...fieldForm, required: e.target.checked })} /> Required
            </label>
          </div>
          <button className={primaryButton + ' mt-2'} onClick={saveField} disabled={!fieldForm.label}>Save field</button>
        </Card>
      </div>

      <Card title="Field values on one document" icon={<Sliders size={18} />}>
        <p className="text-sm text-gray-600 mb-2">
          Every value is coerced against its definition before anything is stored; a single bad key rejects the whole payload with 422 and lists what failed.
        </p>
        <div className="grid md:grid-cols-3 gap-2">
          <Field label="Document uuid"><input className={inputClass} value={valueForm.entityUuid} onChange={(e) => setValueForm({ ...valueForm, entityUuid: e.target.value })} placeholder="order / product / customer id" /></Field>
          <Field label="Entity">
            <select className={inputClass} value={valueForm.entity} onChange={(e) => setValueForm({ ...valueForm, entity: e.target.value })}>
              {(fields?.entities || ['ORDER', 'PRODUCT', 'CUSTOMER']).map((en: string) => <option key={en} value={en}>{en}</option>)}
            </select>
          </Field>
          <div className="flex items-end gap-2">
            <button className={ghostButton} onClick={loadValues} disabled={!valueForm.entityUuid}>Load</button>
            <button className={primaryButton} onClick={saveValues} disabled={!valueForm.entityUuid}>Save values</button>
          </div>
        </div>
        <Field label="Values (JSON)">
          <textarea rows={4} className={inputClass + ' font-mono text-xs'} value={valueForm.values} onChange={(e) => setValueForm({ ...valueForm, values: e.target.value })} />
        </Field>
        {valuesResult && <pre className="text-xs bg-gray-50 border rounded p-3 mt-2 whitespace-pre-wrap">{valuesResult}</pre>}
        {fields?.defaults && Object.keys(fields.defaults).length > 0 && (
          <div className="text-xs text-gray-500 mt-2">Defaults applied to new documents: <JsonBox value={fields.defaults} /></div>
        )}
      </Card>
    </div>
  );
}
