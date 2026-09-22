// ─── STORE MESH: LEADER ELECTION + WRITE FENCING + CONFLICT RESOLUTION ───────
// A store is no longer one till: it is a POS terminal, a tablet on the floor, a
// kitchen display and a self-service kiosk all writing to the same stock count.
// The failure mode that destroys trust is not the network dropping — it is the
// partitioned ex-leader waking up and overwriting committed state with a stale
// write.
//
// Three pure primitives prevent that, and they are all this module is:
//
//   ELECTION   one deterministic leader among live devices, same answer on every
//              node because the tie-breaks are total orders, not timestamps of
//              arrival.
//   FENCING    every write carries (epoch, sequence). A monotonically increasing
//              epoch means a deposed leader's writes are rejected forever — the
//              stale token cannot be forged back into relevance.
//   RESOLUTION stock is merged as deltas against the last common base; everything
//              else is last-writer-wins with a device-id tie-break, so two nodes
//              replaying the same events land on the same value.
import crypto from 'node:crypto';

export const DEFAULT_LEASE_SECONDS = 30;
export const MIN_LEASE_SECONDS = 5;
export const MAX_LEASE_SECONDS = 300;
/** A device that has not been heard from in this long cannot hold the lease. */
export const DEFAULT_LIVENESS_WINDOW_MS = 45_000;
export const DEVICE_ROLE_PRIORITY: Record<string, number> = {
  POS_TERMINAL: 0,
  KIOSK: 1,
  MOBILE: 2,
  KITCHEN_DISPLAY: 3,
};

export interface MeshDevice {
  id: string;
  name?: string | null;
  type?: string | null;
  status?: string | null;
  lastHeartbeatAt?: Date | string | null;
  softwareVersion?: string | null;
  /** Manual preference from the operator; lower wins inside the same role. */
  priority?: number | null;
}

export interface ElectionResult {
  leaderId: string | null;
  quorum: boolean;
  alive: string[];
  unreachable: string[];
  reason: string;
  /** Deterministic term: identical on every node that sees the same inputs. */
  term: number;
}

function timeOf(value: Date | string | null | undefined): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Elect the leader among devices heard from inside the liveness window.
 * Order: role priority, then operator priority, then most recent heartbeat, then
 * lexicographically smallest id — a total order, so no two nodes disagree.
 */
export function electLeader(
  devices: MeshDevice[],
  options: { now?: Date; livenessWindowMs?: number } = {}
): ElectionResult {
  const now = (options.now || new Date()).getTime();
  const window = Math.max(1000, Number(options.livenessWindowMs) || DEFAULT_LIVENESS_WINDOW_MS);
  const alive: MeshDevice[] = [];
  const unreachable: string[] = [];

  for (const device of devices || []) {
    if (!device?.id) continue;
    const seen = timeOf(device.lastHeartbeatAt);
    const retired = String(device.status || '').toUpperCase() === 'RETIRED';
    if (retired) {
      unreachable.push(device.id);
      continue;
    }
    if (seen && now - seen <= window) alive.push(device);
    else unreachable.push(device.id);
  }

  alive.sort((a, b) => {
    const role = (DEVICE_ROLE_PRIORITY[String(a.type || '').toUpperCase()] ?? 9) - (DEVICE_ROLE_PRIORITY[String(b.type || '').toUpperCase()] ?? 9);
    if (role !== 0) return role;
    const prio = (Number(a.priority) || 99) - (Number(b.priority) || 99);
    if (prio !== 0) return prio;
    const seen = timeOf(b.lastHeartbeatAt) - timeOf(a.lastHeartbeatAt);
    if (seen !== 0) return seen;
    return String(a.id).localeCompare(String(b.id));
  });

  const total = alive.length + unreachable.length;
  // A single-node store is always "in quorum" — otherwise an offline terminal
  // would refuse to lead its own till.
  const quorum = total <= 1 ? alive.length > 0 : alive.length > Math.floor(total / 2);

  return {
    leaderId: quorum && alive.length ? alive[0].id : null,
    quorum,
    alive: alive.map((d) => d.id),
    unreachable: unreachable.sort(),
    reason: !alive.length ? 'no-live-devices' : !quorum ? 'no-quorum' : `elected ${alive[0].id}`,
    term: termOf(alive.map((d) => d.id)),
  };
}

/** Hash of the sorted live-membership set: changes exactly when membership does. */
export function termOf(aliveIds: string[]): number {
  const joined = [...aliveIds].sort().join(',');
  if (!joined) return 0;
  const digest = crypto.createHash('sha256').update(joined).digest();
  return digest.readUInt32BE(0) % 2_000_000_000;
}

export interface FenceState {
  epoch: number;
  leaderDeviceId: string | null;
  committedSequence: number;
  leaseSeconds?: number;
  lastCommitAt?: Date | string | null;
}

export type WriteDecision =
  | { accept: true; nextSequence: number }
  | { accept: false; code: 'STALE_EPOCH' | 'FUTURE_EPOCH' | 'STALE_LEADER' | 'STALE_SEQUENCE'; message: string };

/**
 * Fencing check. Epoch is authoritative: a writer from an older epoch has been
 * superseded and can never re-commit, no matter how fresh its sequence looks -
 * and a writer claiming a *newer* epoch than the fence has reached is lying about
 * its mandate, because epochs only advance through a granted lease takeover.
 */
export function acceptWrite(fence: FenceState, write: { epoch: number; sequence: number; deviceId?: string | null }): WriteDecision {
  const epoch = Math.trunc(Number(write?.epoch) || 0);
  const current = Math.trunc(Number(fence?.epoch) || 1);
  if (epoch < current) return { accept: false, code: 'STALE_EPOCH', message: `epoch ${epoch} is fenced by epoch ${current}` };
  if (epoch > current) return { accept: false, code: 'FUTURE_EPOCH', message: `epoch ${epoch} was never granted (current ${current})` };
  if (write?.deviceId && fence?.leaderDeviceId && String(write.deviceId) !== String(fence.leaderDeviceId)) {
    return { accept: false, code: 'STALE_LEADER', message: `${write.deviceId} is not the holder of epoch ${current}` };
  }
  const sequence = Math.trunc(Number(write?.sequence) || 0);
  const committed = Math.trunc(Number(fence?.committedSequence) || 0);
  if (sequence > 0 && sequence <= committed) {
    return { accept: false, code: 'STALE_SEQUENCE', message: `sequence ${sequence} already committed (through ${committed})` };
  }
  return { accept: true, nextSequence: Math.max(sequence, committed + 1) };
}

/**
 * Ask to lead. Grants a new epoch when the caller already holds a valid lease,
 * otherwise (different device, or lease expired) takes over at epoch+1 — which
 * is exactly what fences the previous leader out.
 */
export function claimLeadership(
  fence: FenceState,
  claim: { deviceId: string; epoch?: number | null; now?: Date },
  options: { leaseSeconds?: number } = {}
): { granted: boolean; fence: FenceState; reason: string } {
  const now = claim.now || new Date();
  const leaseSeconds = normalizeLease(options.leaseSeconds ?? fence.leaseSeconds);
  const holder = String(fence?.leaderDeviceId || '');
  const heldAt = timeOf(fence?.lastCommitAt);
  const leaseLive = holder === String(claim.deviceId) && heldAt > 0 && now.getTime() - heldAt <= leaseSeconds * 1000;

  if (leaseLive) {
    return {
      granted: true,
      fence: { ...fence, leaderDeviceId: holder, epoch: Math.trunc(Number(fence.epoch) || 1), leaseSeconds, lastCommitAt: now },
      reason: 'lease-renewed',
    };
  }

  const previous = holder;
  return {
    granted: true,
    fence: {
      epoch: Math.trunc(Number(fence?.epoch) || 1) + 1,
      leaderDeviceId: String(claim.deviceId),
      committedSequence: Math.trunc(Number(fence?.committedSequence) || 0),
      leaseSeconds,
      lastCommitAt: now,
    },
    reason: previous ? `takeover-from-${previous}` : 'bootstrap',
  };
}

export function normalizeLease(value: unknown): number {
  const n = Math.trunc(Number(value) || 0);
  if (!n) return DEFAULT_LEASE_SECONDS;
  return Math.max(MIN_LEASE_SECONDS, Math.min(MAX_LEASE_SECONDS, n));
}

export function leaseExpired(fence: FenceState, now: Date = new Date()): boolean {
  const at = timeOf(fence?.lastCommitAt);
  if (!at) return true;
  return now.getTime() - at > normalizeLease(fence?.leaseSeconds) * 1000;
}

/** The token a client echoes on every write. */
export function fenceToken(locationId: string, fence: FenceState): string {
  return `${locationId}:${Math.trunc(Number(fence?.epoch) || 1)}:${Math.trunc(Number(fence?.committedSequence) || 0)}`;
}

export interface WriteRecord {
  deviceId: string;
  deviceTimestamp: Date | string;
  /** Applied to the base as a delta instead of a blind overwrite when present. */
  delta?: number | null;
  value?: number | string | null;
  epoch?: number | null;
}

/**
 * Reconcile concurrent writes to one field.
 *  - numeric deltas merge additively (two tills each sold one unit: −2, not −1)
 *  - absolute values are last-writer-wins, tie-broken by device id
 */
export function resolveConflict(base: number, writes: WriteRecord[]): { value: number; strategy: 'DELTA_MERGE' | 'LAST_WRITE_WIN' | 'NO_OP'; losers: number } {
  const valid = (writes || []).filter((w) => w && (w.delta != null || w.value != null));
  if (!valid.length) return { value: Number(base) || 0, strategy: 'NO_OP', losers: 0 };

  const allDeltas = valid.every((w) => w.delta != null);
  if (allDeltas) {
    const sum = valid.reduce((acc, w) => acc + (Number(w.delta) || 0), 0);
    return { value: Math.round(((Number(base) || 0) + sum) * 100) / 100, strategy: 'DELTA_MERGE', losers: 0 };
  }

  const absolute = valid.filter((w) => w.delta == null);
  const ordered = [...absolute].sort((a, b) => {
    const t = timeOf(b.deviceTimestamp) - timeOf(a.deviceTimestamp);
    if (t !== 0) return t;
    return String(b.deviceId).localeCompare(String(a.deviceId));
  });
  const winner = ordered[0];
  const deltas = valid.filter((w) => w.delta != null).reduce((acc, w) => acc + (Number(w.delta) || 0), 0);
  return {
    value: Math.round(((Number(winner.value) || 0) + deltas) * 100) / 100,
    strategy: 'LAST_WRITE_WIN',
    losers: Math.max(0, absolute.length - 1),
  };
}

export interface MeshStatus {
  leaderId: string | null;
  quorum: boolean;
  term: number;
  liveCount: number;
  downCount: number;
  leaseExpiresAt: Date | null;
  health: 'HEALTHY' | 'DEGRADED' | 'ISOLATED';
}

/** One glanceable answer for the store-mesh screen. */
export function meshStatus(devices: MeshDevice[], fence: FenceState, now: Date = new Date(), windowMs?: number): MeshStatus {
  const election = electLeader(devices, { now, livenessWindowMs: windowMs });
  const heldAt = timeOf(fence?.lastCommitAt);
  const leaseExpiresAt = heldAt && fence?.leaderDeviceId ? new Date(heldAt + normalizeLease(fence.leaseSeconds) * 1000) : null;
  const health: MeshStatus['health'] = !election.quorum ? 'ISOLATED' : election.unreachable.length ? 'DEGRADED' : 'HEALTHY';
  return {
    leaderId: election.leaderId,
    quorum: election.quorum,
    term: election.term,
    liveCount: election.alive.length,
    downCount: election.unreachable.length,
    leaseExpiresAt,
    health,
  };
}
