import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useRealtime } from '../hooks/useRealtime';
import {
  Truck,
  Plug,
  Wifi,
  Trash2,
  RefreshCw,
  Send,
  Radar,
  Link2,
  ChevronDown,
  ChevronUp,
  Zap,
  Globe2,
  AlertTriangle,
} from 'lucide-react';

// ─── Delivery channels ──────────────────────────────────────────────────────
// One place to wire the shop to a courier network and then watch orders move.
// A connection is a dispatch endpoint plus an HMAC shared secret: the platform
// pushes a signed job when an order needs a rider, and the partner calls back
// on /api/delivery/webhooks/<provider> with status changes. Nothing here
// invents a partner's API — an unconfigured channel dispatches in a clearly
// labelled simulation so the flow can be rehearsed before credentials arrive.

const STATUS_TONES: Record<string, string> = {
  PENDING: 'bg-ink-100 text-ink-600',
  PREPARING: 'bg-amber-100 text-amber-700',
  READY: 'bg-sky-100 text-sky-700',
  OUT_FOR_DELIVERY: 'bg-violet-100 text-violet-700',
  SHIPPED: 'bg-violet-100 text-violet-700',
  DELIVERED: 'bg-emerald-100 text-emerald-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-rose-100 text-rose-600',
  FAILED: 'bg-rose-100 text-rose-600',
};

interface Connection {
  id: string;
  provider: string;
  name: string;
  status: string;
  config: { dispatchUrl: string | null; statusUrlTemplate: string | null; autoDispatch: boolean };
  hasApiKey: boolean;
  hasWebhookSecret: boolean;
  errorMessage: string | null;
  lastSyncAt: string | null;
}

const blankDraft = {
  provider: 'generic',
  name: '',
  dispatchUrl: '',
  statusUrlTemplate: '',
  apiKey: '',
  webhookSecret: '',
  autoDispatch: false,
  active: true,
};

/** Bucket the flat catalog by its `region`, preserving first-seen order. */
function groupChannelsByRegion(channels: any[]): [string, any[]][] {
  const order: string[] = [];
  const buckets: Record<string, any[]> = {};
  for (const c of channels) {
    const region = c.region || 'Other';
    if (!buckets[region]) {
      buckets[region] = [];
      order.push(region);
    }
    buckets[region].push(c);
  }
  return order.map((region) => [region, buckets[region]] as [string, any[]]);
}

export default function DeliveryPage() {
  const [channels, setChannels] = useState<any[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [queue, setQueue] = useState<any[]>([]);
  const [overview, setOverview] = useState<any>(null);
  const [draft, setDraft] = useState<any>(blankDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [pingResult, setPingResult] = useState<any>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [ch, conn, q, ov] = await Promise.all([
      api.getDeliveryChannels(),
      api.getDeliveryConnections(),
      api.getDeliveryQueue(),
      api.getDeliveryOverview(),
    ]);
    setChannels(ch.data || []);
    setConnections(conn.data || []);
    setQueue(q.data || []);
    setOverview(ov.data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  // A courier callback should update the board without a refresh.
  useRealtime(() => {
    load();
  });

  const startConnect = (provider: string) => {
    const channel = channels.find((c) => c.provider === provider);
    const existing = connections.find((c) => c.provider === provider);
    setEditingId(existing?.id ?? null);
    setDraft({
      provider,
      name: existing?.name || channel?.name || '',
      dispatchUrl: existing?.config?.dispatchUrl || '',
      statusUrlTemplate: existing?.config?.statusUrlTemplate || '',
      // Secrets are write-only: a stored value shows as a badge, and leaving the
      // box empty means "keep what is there".
      apiKey: '',
      webhookSecret: '',
      autoDispatch: Boolean(existing?.config?.autoDispatch),
      active: existing?.status !== 'DISCONNECTED',
    });
    setPingResult(null);
    setShowForm(true);
  };

  const save = async () => {
    setBusy(true);
    setNotice('');
    try {
      const payload: any = {
        provider: draft.provider,
        name: draft.name || undefined,
        active: draft.active,
        config: {
          dispatchUrl: draft.dispatchUrl || null,
          statusUrlTemplate: draft.statusUrlTemplate || null,
          autoDispatch: draft.autoDispatch,
        },
      };
      // Only send a secret the operator actually typed, so saving the form never
      // wipes a stored credential.
      if (draft.apiKey) payload.credentials = { ...payload.credentials, apiKey: draft.apiKey };
      if (draft.webhookSecret) payload.credentials = { ...payload.credentials, webhookSecret: draft.webhookSecret };
      await api.connectDeliveryChannel(payload);
      setShowForm(false);
      setEditingId(null);
      setDraft(blankDraft);
      await load();
      setNotice('Channel saved.');
    } catch (e: any) {
      setNotice(e?.message || 'Could not save the channel.');
    } finally {
      setBusy(false);
    }
  };

  const ping = async (id: string) => {
    setBusy(true);
    setNotice('');
    try {
      const res = await api.pingDeliveryChannel(id);
      setPingResult(res.data);
      setEditingId(id);
      await load();
    } catch (e: any) {
      setNotice(e?.message || 'The handshake test failed.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (row: Connection) => {
    if (!confirm(`Disconnect ${row.name}? Orders already sent to this channel keep their history.`)) return;
    await api.disconnectDeliveryChannel(row.id);
    load();
  };

  const dispatch = async (orderId: string) => {
    setBusy(true);
    setNotice('');
    try {
      const res = await api.dispatchToChannel(orderId);
      setNotice(
        `${orderId.slice(0, 8)} handed to ${res.data?.provider} — ${res.data?.externalId}${res.data?.simulated ? ' (simulated: no dispatch endpoint configured)' : ''}`
      );
      await load();
    } catch (e: any) {
      setNotice(e?.message || 'Dispatch failed.');
    } finally {
      setBusy(false);
    }
  };

  const track = async (orderId: string) => {
    setBusy(true);
    setNotice('');
    try {
      const res = await api.trackDelivery(orderId);
      setNotice(`${orderId.slice(0, 8)} is ${res.data?.status}${res.data?.courier ? ` with ${res.data.courier}` : ''}${res.data?.etaMinutes ? `, ETA ${res.data.etaMinutes} min` : ''}`);
      await load();
    } catch (e: any) {
      setNotice(e?.message || 'Could not read the tracking status.');
    } finally {
      setBusy(false);
    }
  };

  const webhookBase = `${window.location.origin}/api/delivery/webhooks`;

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink-900">
            <Truck size={22} className="text-gold-500" /> Delivery channels
          </h1>
          <p className="text-sm text-ink-400">Hand delivery orders to a courier network and follow them to the door.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-600 hover:bg-ink-50">
            <RefreshCw size={15} /> Refresh
          </button>
          <button
            onClick={() => {
              startConnect(draft.provider === 'generic' && !showForm ? 'generic' : draft.provider);
              setEditingId(null);
              setShowForm(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800"
          >
            <Plug size={16} /> Connect a channel
          </button>
        </div>
      </header>

      {overview && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Connected channels" value={overview.connections?.length ?? 0} />
          <Stat label="Dispatched (30d)" value={overview.dispatched} />
          <Stat label="Awaiting dispatch" value={overview.awaitingDispatch} />
          <Stat label="Delivered (30d)" value={overview.delivered} />
          <Stat label="Avg delivery" value={overview.averageDeliveryMinutes != null ? `${overview.averageDeliveryMinutes} min` : '—'} />
        </div>
      )}

      {notice && <div className="rounded-lg border border-gold-200 bg-gold-50 px-3 py-2 text-sm text-ink-700">{notice}</div>}

      {showForm && (
        <div className="space-y-4 rounded-xl border border-ink-200 bg-white p-4">
          <h2 className="font-semibold text-ink-900">{editingId ? 'Update channel wiring' : 'Connect a delivery channel'}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Channel">
              <select
                value={draft.provider}
                onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
                className={inputCls}
                disabled={Boolean(editingId)}
              >
                {channels.map((c) => (
                  <option key={c.provider} value={c.provider}>
                    {c.name} · {c.markets}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Display name">
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={channels.find((c) => c.provider === draft.provider)?.name} className={inputCls} />
            </Field>
            <Field label="Dispatch endpoint (where orders are pushed)">
              <input value={draft.dispatchUrl} onChange={(e) => setDraft({ ...draft, dispatchUrl: e.target.value })} placeholder="https://api.partner.com/v1/jobs" className={inputCls} />
            </Field>
            <Field label="Status lookup template ({id} = job id)">
              <input value={draft.statusUrlTemplate} onChange={(e) => setDraft({ ...draft, statusUrlTemplate: e.target.value })} placeholder="https://api.partner.com/v1/jobs/{id}" className={inputCls} />
            </Field>
            <Field label={connections.find((c) => c.provider === draft.provider)?.hasApiKey ? 'API key (stored — leave blank to keep)' : 'API key'}>
              <input value={draft.apiKey} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} type="password" autoComplete="off" placeholder={draft.apiKey ? '••••••' : 'optional'} className={inputCls} />
            </Field>
            <Field label={connections.find((c) => c.provider === draft.provider)?.hasWebhookSecret ? 'Webhook secret (stored — leave blank to keep)' : 'Webhook signing secret'}>
              <input value={draft.webhookSecret} onChange={(e) => setDraft({ ...draft, webhookSecret: e.target.value })} type="password" autoComplete="off" placeholder={draft.webhookSecret ? '••••••' : 'shared secret for HMAC verification'} className={inputCls} />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-5">
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" checked={draft.autoDispatch} onChange={(e) => setDraft({ ...draft, autoDispatch: e.target.checked })} />
              Dispatch new delivery orders automatically
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
              Enabled
            </label>
          </div>

          <div className="rounded-lg bg-ink-50 p-3 text-xs leading-relaxed text-ink-500">
            Give your partner this callback URL and the shared secret:
            <div className="mt-1 flex items-center gap-1 font-mono text-[11px] text-ink-700">
              POST {webhookBase}/{draft.provider || '<provider>'}
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(`${webhookBase}/${draft.provider}`);
                  setNotice('Callback URL copied.');
                }}
                className="rounded border border-ink-200 bg-white px-1.5 py-0.5 hover:bg-ink-100"
              >
                <Link2 size={11} className="inline" /> copy
              </button>
            </div>
            <div className="mt-1">
              Sign each callback with <code className="font-mono">x-dispatch-signature: v1=HMAC-SHA256(secret, "&lt;x-dispatch-timestamp&gt;.&lt;raw body&gt;")</code>; deliveries older than 5 minutes are rejected.
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-gold-400 disabled:opacity-50">
              {editingId ? 'Save changes' : 'Connect channel'}
            </button>
            <button
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
                setDraft(blankDraft);
                setPingResult(null);
              }}
              className="rounded-lg border border-ink-200 px-4 py-2 text-sm text-ink-600 hover:bg-ink-50"
            >
              Close
            </button>
          </div>

          {pingResult && (
            <div className={`rounded-lg border p-3 text-sm ${pingResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
              <div className="flex items-center gap-2 font-medium">
                {pingResult.ok ? <Wifi size={15} /> : <AlertTriangle size={15} />}
                {pingResult.ok ? 'Handshake OK' : 'Handshake failed'} · {pingResult.latencyMs} ms
                {pingResult.simulated ? ' · simulated (no dispatch endpoint configured)' : ''}
              </div>
              {pingResult.error && <div className="mt-1 text-xs">{pingResult.error}</div>}
              {pingResult.signatureHeaderPreview && (
                <div className="mt-2 text-[11px] text-ink-500">
                  Expected callback header shape: <span className="font-mono">{JSON.stringify(pingResult.signatureHeaderPreview)}</span>
                </div>
              )}
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] uppercase tracking-wide text-ink-400">Payload the partner receives</summary>
                <pre className="mt-1 max-h-52 overflow-auto rounded bg-white p-2 text-[11px] leading-relaxed">{JSON.stringify(pingResult.sampleRequest, null, 2)}</pre>
              </details>
            </div>
          )}
        </div>
      )}

      {/* Connected channels */}
      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-ink-900">Your connections</h2>
        {!connections.length && (
          <div className="rounded-xl border border-dashed border-ink-200 p-8 text-center text-sm text-ink-400">
            No channel wired yet. Pick one below — an unconfigured channel still rehearses the whole flow in simulation.
          </div>
        )}
        {connections.map((row) => (
          <div key={row.id} className="rounded-xl border border-ink-100 bg-white p-4 shadow-luxe-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate font-semibold text-ink-900">{row.name}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${row.status === 'CONNECTED' ? 'bg-emerald-100 text-emerald-700' : row.status === 'ERROR' ? 'bg-rose-100 text-rose-600' : 'bg-ink-100 text-ink-500'}`}>
                    {row.status}
                  </span>
                  {row.config.autoDispatch && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700">auto</span>}
                </div>
                <div className="mt-1 space-y-0.5 text-xs text-ink-500">
                  <div>
                    Dispatch: <span className="font-mono">{row.config.dispatchUrl || 'not set — dispatches are simulated'}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge on={row.hasApiKey} label="API key" />
                    <Badge on={row.hasWebhookSecret} label="webhook secret" />
                    {row.lastSyncAt && <span>last contact {new Date(row.lastSyncAt).toLocaleString()}</span>}
                  </div>
                  {row.errorMessage && <div className="text-rose-600">{row.errorMessage}</div>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => startConnect(row.provider)} className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-50">
                  Edit
                </button>
                <button onClick={() => ping(row.id)} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-50 disabled:opacity-50">
                  <Zap size={12} /> Test handshake
                </button>
                <button onClick={() => disconnect(row)} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50">
                  <Trash2 size={12} /> Disconnect
                </button>
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Catalog */}
      <section className="space-y-5">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink-900">Available channels</h2>
          <p className="text-sm text-ink-400">
            {channels.length} courier networks across {groupChannelsByRegion(channels).length} regions - every part of the world is covered.
          </p>
        </div>
        {groupChannelsByRegion(channels).map(([region, list]) => (
          <div key={region} className="space-y-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-400">
              <Globe2 size={13} className="text-gold-500" /> {region}
              <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-500">{list.length}</span>
            </h3>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {list.map((c) => (
                <div key={c.provider} className={`rounded-xl border p-4 ${c.connected ? 'border-emerald-200 bg-emerald-50/40' : 'border-ink-100 bg-white'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold text-ink-900">{c.name}</h3>
                    {c.connected && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">connected</span>}
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-ink-400">{c.markets}</div>
                  <p className="mt-2 text-xs leading-relaxed text-ink-500">{c.blurb}</p>
                  <button
                    onClick={() => startConnect(c.provider)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
                  >
                    <Plug size={12} /> {c.connected ? 'Reconfigure' : 'Connect'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Dispatch queue */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink-900">Delivery queue ({queue.length})</h2>
          {overview?.onTimeRate != null && <span className="text-xs text-ink-500">{overview.onTimeRate}% delivered in the last {overview.windowDays} days</span>}
        </div>
        <div className="overflow-hidden rounded-xl border border-ink-100 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-start text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-3 py-2 text-start font-medium">Order</th>
                <th className="px-3 py-2 text-start font-medium">Drop-off</th>
                <th className="px-3 py-2 text-start font-medium">Status</th>
                <th className="px-3 py-2 text-end font-medium">Total</th>
                <th className="px-3 py-2 text-end font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((row) => (
                <Fragment key={row.orderId}>
                  <tr className="border-b border-ink-50 last:border-0">
                  <td className="px-3 py-2 text-start align-top">
                    <button onClick={() => setExpanded(expanded === row.orderId ? null : row.orderId)} className="flex items-center gap-1 font-medium text-ink-900 hover:underline">
                      {expanded === row.orderId ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {row.orderNumber}
                    </button>
                    <div className="ms-5 text-[11px] text-ink-400">
                      {new Date(row.placedAt).toLocaleString()} · {row.itemCount} items · {row.channel}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-ink-600">
                    <div>{row.customer || '—'}</div>
                    <div className="text-ink-400">{row.address || 'no address on file'}</div>
                    {row.phone && <div className="text-ink-400">{row.phone}</div>}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONES[row.deliveryStatus] || 'bg-ink-100 text-ink-600'}`}>{row.deliveryStatus}</span>
                    <div className="mt-1 text-[11px] text-ink-400">
                      {row.provider ? `${row.provider}${row.externalId ? ` · ${row.externalId}` : ''}` : 'not dispatched'}
                      {row.etaMinutes ? ` · ETA ${row.etaMinutes}m` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-end align-top font-mono text-ink-900">{money(row.totalAmount, row.currency)}</td>
                  <td className="px-3 py-2 text-end align-top whitespace-nowrap">
                    {!row.externalId && (
                      <button onClick={() => dispatch(row.orderId)} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-ink-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-ink-800 disabled:opacity-50">
                        <Send size={12} /> Dispatch
                      </button>
                    )}
                    {row.externalId && (
                      <button onClick={() => track(row.orderId)} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs text-ink-700 hover:bg-ink-50 disabled:opacity-50">
                        <Radar size={12} /> Track
                      </button>
                    )}
                  </td>
                </tr>
                  {expanded === row.orderId && (
                    <tr className="bg-ink-50/60">
                      <td colSpan={5} className="px-6 py-3 text-xs text-ink-600">
                        {row.orderId} · last update {new Date(row.dispatchedAt).toLocaleString()} · location {row.locationName || '—'}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {!queue.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-ink-400">
                    No delivery orders are waiting. Orders from the storefront or POS with a DELIVERY fulfilment land here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {overview?.byProvider?.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold text-ink-900">Performance by channel</h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {overview.byProvider.map((p: any) => (
              <div key={p.carrier} className="rounded-xl border border-ink-100 bg-white p-4">
                <div className="font-semibold text-ink-900">{p.carrier}</div>
                <div className="mt-1 text-xs text-ink-500">
                  {p.dispatched} dispatched · {p.delivered} delivered
                  {p.averageMinutes != null ? ` · avg ${p.averageMinutes} min door to door` : ''}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-400 disabled:bg-ink-50';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-400">{label}</span>
      {children}
    </label>
  );
}

function Badge({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] ${on ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-50 text-ink-400'}`}>
      {on ? `${label} stored` : `no ${label}`}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-ink-100 bg-white p-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-400">{label}</div>
      <div className="font-display text-xl font-semibold text-ink-900">{value}</div>
    </div>
  );
}

function money(value: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value) || 0);
  } catch {
    return `$${(Number(value) || 0).toFixed(2)}`;
  }
}
