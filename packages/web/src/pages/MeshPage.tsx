import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Network, Crown, Activity, GitMerge, LockKeyhole, AlertTriangle } from 'lucide-react';
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
  ghostButton,
  inputClass,
  primaryButton,
} from '../components/GlobalUi';

/**
 * Store mesh (§ mesh). One device per location holds a lease and is the leader;
 * every write carries the epoch it was issued under, so a partitioned ex-leader
 * can never overwrite committed state with a stale write. This screen lets an
 * operator see the leases, force a failover, and rehearse a merge before any
 * data is touched.
 */
const SAMPLE_WRITES = JSON.stringify(
  [
    { deviceId: 'till-1', deviceTimestamp: new Date(Date.now() - 60_000).toISOString(), delta: -1 },
    { deviceId: 'till-2', deviceTimestamp: new Date().toISOString(), delta: -2 },
  ],
  null,
  2
);

export default function MeshPage() {
  const [status, setStatus] = useState<any>(null);
  const [reconcile, setReconcile] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [merge, setMerge] = useState<any>(null);
  const [commitResult, setCommitResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claim, setClaim] = useState({ deviceId: '', leaseSeconds: '30', reason: 'MANUAL_FAILOVER' });
  const [commit, setCommit] = useState({ deviceId: '', epoch: '1', sequence: '1' });
  const [conflict, setConflict] = useState({ base: '50', writes: SAMPLE_WRITES });

  const load = useCallback(async () => {
    const [s, r] = await Promise.all([call(() => api.getMeshStatus(), setError), call(() => api.getMeshReconciliation(), setError)]);
    setStatus(s);
    setReconcile(r);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openLocation = async (locationId: string) => {
    const data = await call(() => api.getMeshLocation(locationId), setError);
    setDetail(data);
    setClaim({ ...claim, deviceId: claim.deviceId || data?.election?.leaderId || '' });
    setCommit({ ...commit, epoch: String(data?.fence?.epoch ?? 1), sequence: String((data?.fence?.committedSequence ?? 0) + 1) });
  };

  const doClaim = async () => {
    if (!detail?.location?.id || !claim.deviceId) return;
    await call(
      () => api.claimMeshLeadership(detail.location.id, { deviceId: claim.deviceId, leaseSeconds: Number(claim.leaseSeconds) || undefined, reason: claim.reason as any }),
      setError
    );
    openLocation(detail.location.id);
    load();
  };

  const heartbeat = async () => {
    if (!detail?.location?.id || !claim.deviceId) return;
    await call(() => api.sendMeshHeartbeat(detail.location.id, claim.deviceId), setError);
    openLocation(detail.location.id);
    load();
  };

  const tryCommit = async (stale: boolean) => {
    if (!detail?.location?.id) return;
    const epoch = stale ? Math.max(1, Number(commit.epoch) - 1) : Number(commit.epoch);
    setError(null);
    const data = await call(
      () => api.commitMeshWrite(detail.location.id, { deviceId: commit.deviceId || claim.deviceId, epoch, sequence: Number(commit.sequence) }),
      setError
    );
    setCommitResult(data ? `Accepted as sequence ${data.sequence}` : 'Refused — the write was fenced off (see the error above)');
    openLocation(detail.location.id);
  };

  const runMerge = async () => {
    let writes: unknown;
    try {
      writes = JSON.parse(conflict.writes);
    } catch {
      setError('Writes must be valid JSON');
      return;
    }
    const data = await call(() => api.resolveMeshConflict({ base: Number(conflict.base), writes: writes as any }), setError);
    setMerge(data);
  };

  const locations: any[] = status?.locations || [];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Store Mesh"
        subtitle="Which device owns a location's state, how long its lease runs, and what happens when two of them disagree while offline."
        actions={<button className={ghostButton} onClick={load}>Refresh</button>}
      />
      <ErrorNote message={error} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Mesh health" value={status?.health || '—'} tone={status?.health === 'HEALTHY' ? 'good' : status?.health === 'DEGRADED' ? 'warn' : 'bad'} hint={`liveness window ${Math.round((status?.livenessWindowMs || 0) / 1000)}s`} />
        <Stat label="Locations" value={locations.length} />
        <Stat label="Stale leases" value={locations.filter((l) => l.fence?.stale).length} tone={locations.some((l) => l.fence?.stale) ? 'warn' : 'good'} hint="leader whose lease has expired" />
        <Stat label="Quiet devices" value={reconcile?.quiet?.length ?? 0} hint={`no heartbeat for ${reconcile?.staleMinutes ?? 15}+ min`} tone={reconcile?.quiet?.length ? 'warn' : 'good'} />
      </div>

      <Card title="Locations" icon={<Network size={18} />}>
        <Table head={<tr><Th>Location</Th><Th>Devices</Th><Th>Leader (lease)</Th><Th>Elected now</Th><Th>Epoch / sequence</Th><Th>Health</Th><Th /></tr>}>
          {locations.map((l: any) => {
            const mismatch = l.electedLeader && l.fence?.leaderDeviceId && l.electedLeader !== l.fence.leaderDeviceId;
            return (
              <tr key={l.locationId}>
                <Td className="font-medium">{l.locationName}</Td>
                <Td className="text-xs text-gray-600">{l.devices.map((d: any) => d.name).join(', ')}</Td>
                <Td className="text-xs">
                  {l.fence?.leaderDeviceId ? (
                    <span className={l.fence.stale ? 'text-rose-600' : 'text-emerald-700'}>
                      {l.devices.find((d: any) => d.id === l.fence.leaderDeviceId)?.name || l.fence.leaderDeviceId}
                      {l.fence.stale ? ' (lease expired)' : ''}
                    </span>
                  ) : (
                    <span className="text-gray-400">none claimed</span>
                  )}
                </Td>
                <Td className="text-xs">
                  {mismatch ? (
                    <span className="text-amber-700 flex items-center gap-1"><AlertTriangle size={13} /> election points elsewhere</span>
                  ) : (
                    <span className="text-gray-500">{l.devices.find((d: any) => d.id === l.electedLeader)?.name || '—'}</span>
                  )}
                </Td>
                <Td className="tabular-nums text-xs">e{l.fence?.epoch} / s{l.fence?.committedSequence}</Td>
                <Td><Badge>{l.status?.health}</Badge></Td>
                <Td className="text-end"><button className={ghostButton} onClick={() => openLocation(l.locationId)}>Manage</button></Td>
              </tr>
            );
          })}
          {locations.length === 0 && <tr><Td colSpan={7}><Empty>No active locations for this tenant.</Empty></Td></tr>}
        </Table>
      </Card>

      {detail && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={`${detail.location?.name} — lease`} icon={<Crown size={18} />}>
            <div className="text-sm space-y-1">
              <div><span className="text-gray-500">Leader:</span> {detail.devices.find((d: any) => d.id === detail.fence?.leaderDeviceId)?.name || 'none'}</div>
              <div><span className="text-gray-500">Epoch:</span> {detail.fence?.epoch} · committed sequence {detail.fence?.committedSequence}</div>
              <div><span className="text-gray-500">Reason:</span> {detail.fence?.reason || '—'} · lease {detail.fence?.leaseSeconds}s {detail.fence?.leaseExpired ? <Badge tone="bad">EXPIRED</Badge> : <Badge tone="good">HELD</Badge>}</div>
              <div className="text-xs text-gray-500">Fencing token: <code className="break-all">{String(detail.fence?.token).slice(0, 48)}…</code></div>
              {detail.wouldOverwrite && (
                <div className="text-amber-700 text-sm mt-2 flex items-center gap-1">
                  <AlertTriangle size={14} /> The elected leader differs from the lease holder; writes from the holder would be fenced off after the next failover.
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-4">
              <Field label="Device">
                <select className={inputClass} value={claim.deviceId} onChange={(e) => setClaim({ ...claim, deviceId: e.target.value })}>
                  <option value="">select…</option>
                  {detail.devices.map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name} ({d.status})</option>
                  ))}
                </select>
              </Field>
              <Field label="Lease seconds">
                <input className={inputClass} value={claim.leaseSeconds} onChange={(e) => setClaim({ ...claim, leaseSeconds: e.target.value })} />
              </Field>
              <Field label="Reason">
                <select className={inputClass} value={claim.reason} onChange={(e) => setClaim({ ...claim, reason: e.target.value })}>
                  {['RENEWED', 'MANUAL_FAILOVER', 'HEARTBEAT_TIMEOUT', 'BOOTSTRAP'].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
              <div className="flex items-end gap-2">
                <button className={primaryButton} onClick={doClaim}><Crown size={15} /> Claim lease</button>
                <button className={ghostButton} onClick={heartbeat}><Activity size={15} /> Heartbeat</button>
              </div>
            </div>
          </Card>

          <Card title="Fenced-write gate" icon={<LockKeyhole size={18} />}>
            <p className="text-sm text-gray-600 mb-2">
              Submit a write as if a device were committing it. A stale epoch or a replayed sequence is refused with 409 and the ledger does not move.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Device id"><input className={inputClass} value={commit.deviceId} onChange={(e) => setCommit({ ...commit, deviceId: e.target.value })} placeholder={claim.deviceId} /></Field>
              <Field label="Epoch"><input className={inputClass} value={commit.epoch} onChange={(e) => setCommit({ ...commit, epoch: e.target.value })} /></Field>
              <Field label="Sequence"><input className={inputClass} value={commit.sequence} onChange={(e) => setCommit({ ...commit, sequence: e.target.value })} /></Field>
            </div>
            <div className="flex gap-2 mt-2">
              <button className={primaryButton} onClick={() => tryCommit(false)}>Commit as leader</button>
              <button className={ghostButton} onClick={() => tryCommit(true)}>Replay with a stale epoch</button>
            </div>
            {commitResult && <p className="text-sm mt-2 text-gray-700">{commitResult}</p>}

            <div className="mt-4 border-t pt-3">
              <div className="text-sm text-gray-500 mb-1">Devices in this location</div>
              <Table head={<tr><Th>Device</Th><Th>Type</Th><Th>Status</Th><Th>Last heartbeat</Th></tr>}>
                {(detail.devices || []).map((d: any) => (
                  <tr key={d.id}>
                    <Td className="font-medium">{d.name}</Td>
                    <Td>{d.type}</Td>
                    <Td><Badge>{d.status}</Badge></Td>
                    <Td className="text-xs text-gray-500">{d.lastHeartbeatAt ? new Date(d.lastHeartbeatAt).toLocaleString() : 'never'}</Td>
                  </tr>
                ))}
              </Table>
            </div>
          </Card>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Conflict rehearsal" icon={<GitMerge size={18} />}>
          <p className="text-sm text-gray-600 mb-2">
            Two tills sold stock while offline. Deltas are summed — an absolute value would overwrite and silently delete a sale. Nothing here is written.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Base quantity"><input className={inputClass} value={conflict.base} onChange={(e) => setConflict({ ...conflict, base: e.target.value })} /></Field>
          </div>
          <Field label="Competing writes (JSON)">
            <textarea rows={7} className={inputClass + ' font-mono text-xs'} value={conflict.writes} onChange={(e) => setConflict({ ...conflict, writes: e.target.value })} />
          </Field>
          <button className={primaryButton + ' mt-2'} onClick={runMerge}><GitMerge size={15} /> Resolve</button>
          {merge && (
            <div className="mt-3 text-sm space-y-2">
              <div className="flex items-center gap-2">
                <Badge tone="info">{merge.strategy}</Badge>
                <span>{Number(merge.base)} → <strong>{merge.value}</strong></span>
                <span className="text-gray-500">{merge.losers} write(s) lost</span>
              </div>
              <p className="text-xs text-gray-600">{merge.explanation}</p>
            </div>
          )}
        </Card>

        <Card title={`Quiet devices (${reconcile?.quiet?.length ?? 0})`} icon={<Activity size={18} />}>
          <Table head={<tr><Th>Device</Th><Th>Location</Th><Th>Last heartbeat</Th><Th>Silent for</Th></tr>}>
            {(reconcile?.quiet || []).slice(0, 20).map((d: any) => (
              <tr key={d.id}>
                <Td className="font-medium">{d.name} <span className="text-xs text-gray-500">{d.type}</span></Td>
                <Td className="text-gray-600">{d.locationName || 'unassigned'}</Td>
                <Td className="text-xs text-gray-500">{d.lastHeartbeatAt ? new Date(d.lastHeartbeatAt).toLocaleString() : 'never'}</Td>
                <Td className={d.silentForMinutes == null ? 'text-rose-600' : 'tabular-nums'}>{d.silentForMinutes == null ? 'never seen' : `${d.silentForMinutes} min`}</Td>
              </tr>
            ))}
            {(reconcile?.quiet || []).length === 0 && <tr><Td colSpan={4}><Empty>Every device has checked in recently.</Empty></Td></tr>}
          </Table>
          {reconcile && <p className="text-xs text-gray-500 mt-2">{reconcile.total} devices tracked; window {Math.round(reconcile.windowMs / 1000)}s, stale after {reconcile.staleMinutes} min.</p>}
        </Card>
      </div>

      {detail && <JsonBox value={{ location: detail.location, fence: detail.fence, election: detail.election, status: detail.status }} />}
    </div>
  );
}
