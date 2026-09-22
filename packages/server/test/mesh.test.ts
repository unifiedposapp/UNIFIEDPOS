import { describe, it, expect } from 'vitest';
import {
  electLeader,
  termOf,
  acceptWrite,
  claimLeadership,
  normalizeLease,
  leaseExpired,
  fenceToken,
  resolveConflict,
  meshStatus,
  DEFAULT_LEASE_SECONDS,
  DEFAULT_LIVENESS_WINDOW_MS,
  MIN_LEASE_SECONDS,
  MAX_LEASE_SECONDS,
  type MeshDevice,
  type FenceState,
} from '../src/services/mesh';

const NOW = new Date('2026-05-05T12:00:00Z');
/** Heartbeat ages in seconds, because the liveness window is 45 s. */
const fresh = (seconds = 0) => new Date(NOW.getTime() - seconds * 1000).toISOString();

const till1: MeshDevice = { id: 'till-1', type: 'POS_TERMINAL', lastHeartbeatAt: fresh(10) };
const till2: MeshDevice = { id: 'till-2', type: 'POS_TERMINAL', lastHeartbeatAt: fresh(20) };
const tablet: MeshDevice = { id: 'tab-1', type: 'MOBILE', lastHeartbeatAt: fresh(10) };
const kitchen: MeshDevice = { id: 'kds-1', type: 'KITCHEN_DISPLAY', lastHeartbeatAt: fresh(10) };
/** Silent for two minutes: outside the window, so it cannot lead or be counted. */
const dead: MeshDevice = { id: 'till-9', type: 'POS_TERMINAL', lastHeartbeatAt: fresh(120) };

const fence = (overrides: Partial<FenceState> = {}): FenceState => ({
  epoch: 3,
  leaderDeviceId: 'till-1',
  committedSequence: 12,
  leaseSeconds: 30,
  lastCommitAt: NOW,
  ...overrides,
});

describe('leader election', () => {
  it('prefers the terminal role over mobile and kitchen displays', () => {
    const result = electLeader([kitchen, tablet, till2, till1], { now: NOW });
    expect(result.leaderId).toBe('till-1'); // same role as till-2, most recent heartbeat wins
    expect(result.alive).toHaveLength(4);
  });

  it('is deterministic: the same membership yields the same leader in any input order', () => {
    const a = electLeader([till1, till2, tablet], { now: NOW }).leaderId;
    const b = electLeader([tablet, till2, till1], { now: NOW }).leaderId;
    expect(a).toBe(b);
  });

  it('excludes silent and retired devices from the candidate set', () => {
    const result = electLeader([till1, dead], { now: NOW });
    expect(result.alive).toEqual(['till-1']);
    expect(result.unreachable).toEqual(['till-9']);
    const retired = electLeader([{ ...till1 }, { ...till2, status: 'RETIRED' }], { now: NOW });
    expect(retired.unreachable).toContain('till-2');
  });

  it('requires a quorum in a multi-device store but never blocks a lone till', () => {
    const lone = electLeader([till1], { now: NOW });
    expect(lone.quorum).toBe(true);
    expect(lone.leaderId).toBe('till-1');

    const three = electLeader([till1, till2, tablet], { now: NOW });
    expect(three.quorum).toBe(true);
    const split = electLeader([till1, { ...till2, lastHeartbeatAt: fresh(600) }, { ...tablet, lastHeartbeatAt: fresh(600) }], { now: NOW });
    expect(split.quorum).toBe(false);
    expect(split.leaderId).toBeNull();
    expect(split.reason).toBe('no-quorum');
  });

  it('reports no leader at all when nothing is live', () => {
    const result = electLeader([dead], { now: NOW });
    expect(result.leaderId).toBeNull();
    expect(result.reason).toBe('no-live-devices');
  });

  it('produces a term that changes only with membership', () => {
    const one = termOf(['a', 'b']);
    expect(termOf(['b', 'a'])).toBe(one);
    expect(termOf(['a', 'b', 'c'])).not.toBe(one);
    expect(termOf([])).toBe(0);
  });
});

describe('write fencing', () => {
  it('accepts the current leader writing the next sequence', () => {
    expect(acceptWrite(fence(), { epoch: 3, sequence: 13, deviceId: 'till-1' })).toEqual({ accept: true, nextSequence: 13 });
  });

  it('refuses a partitioned ex-leader no matter how fresh its sequence looks', () => {
    const decision = acceptWrite(fence(), { epoch: 2, sequence: 9_999, deviceId: 'till-1' });
    expect(decision.accept).toBe(false);
    expect(!decision.accept && decision.code).toBe('STALE_EPOCH');
  });

  it('refuses a device inventing an epoch it was never granted', () => {
    // Epochs only advance through a lease takeover, so a write bearing a future
    // epoch has no mandate behind it and must not be committed.
    const decision = acceptWrite(fence(), { epoch: 999, sequence: 13, deviceId: 'till-1' });
    expect(decision.accept).toBe(false);
    expect(!decision.accept && decision.code).toBe('FUTURE_EPOCH');
  });

  it('refuses a device that does not hold the lease', () => {
    const decision = acceptWrite(fence(), { epoch: 3, sequence: 13, deviceId: 'till-2' });
    expect(decision.accept).toBe(false);
    expect(!decision.accept && decision.code).toBe('STALE_LEADER');
  });

  it('refuses a replayed sequence', () => {
    const decision = acceptWrite(fence(), { epoch: 3, sequence: 12, deviceId: 'till-1' });
    expect(decision.accept).toBe(false);
    expect(!decision.accept && decision.code).toBe('STALE_SEQUENCE');
  });

  it('never lets the ledger move backwards on an out-of-order commit', () => {
    expect(acceptWrite(fence(), { epoch: 3, sequence: 0, deviceId: 'till-1' })).toEqual({ accept: true, nextSequence: 13 });
    expect(acceptWrite(fence({ committedSequence: 0 }), { epoch: 3, sequence: 5, deviceId: 'till-1' })).toEqual({ accept: true, nextSequence: 5 });
  });
});

describe('leases', () => {
  it('renews in place and takes over with a bumped epoch', () => {
    const current = fence();
    const renewed = claimLeadership(current, { deviceId: 'till-1', now: NOW });
    expect(renewed.reason).toBe('lease-renewed');
    expect(renewed.fence.epoch).toBe(3);

    const takeover = claimLeadership(current, { deviceId: 'till-2', now: NOW });
    expect(takeover.fence.epoch).toBe(4);
    expect(takeover.fence.leaderDeviceId).toBe('till-2');
    expect(takeover.reason).toBe('takeover-from-till-1');
  });

  it('a holder whose lease expired is fenced out by its own takeover', () => {
    const stale = fence({ lastCommitAt: new Date(NOW.getTime() - 120_000) });
    const self = claimLeadership(stale, { deviceId: 'till-1', now: NOW });
    expect(self.fence.epoch).toBe(4);
    expect(self.reason).toContain('takeover');
    // Anything the old epoch was still writing is now refused.
    expect(acceptWrite(self.fence, { epoch: 3, sequence: 99, deviceId: 'till-1' }).accept).toBe(false);
  });

  it('bootstraps an empty fence', () => {
    const boot = claimLeadership({ epoch: 1, leaderDeviceId: null, committedSequence: 0 }, { deviceId: 'kiosk-1', now: NOW });
    expect(boot.reason).toBe('bootstrap');
    expect(boot.fence.leaderDeviceId).toBe('kiosk-1');
  });

  it('clamps the lease into a usable window', () => {
    expect(normalizeLease(undefined)).toBe(DEFAULT_LEASE_SECONDS);
    expect(normalizeLease(1)).toBe(MIN_LEASE_SECONDS);
    expect(normalizeLease(9999)).toBe(MAX_LEASE_SECONDS);
    expect(normalizeLease('45')).toBe(45);
  });

  it('knows when a lease has run out', () => {
    expect(leaseExpired(fence(), NOW)).toBe(false);
    expect(leaseExpired(fence({ lastCommitAt: new Date(NOW.getTime() - 31_000) }), NOW)).toBe(true);
    expect(leaseExpired(fence({ lastCommitAt: null }), NOW)).toBe(true);
  });

  it('mints a token that carries the epoch it authorises', () => {
    expect(fenceToken('loc-1', fence())).toBe('loc-1:3:12');
  });
});

describe('conflict resolution', () => {
  it('sums concurrent deltas instead of overwriting a sale away', () => {
    const merged = resolveConflict(50, [
      { deviceId: 'till-1', deviceTimestamp: fresh(1), delta: -1 },
      { deviceId: 'till-2', deviceTimestamp: fresh(2), delta: -2 },
    ]);
    expect(merged).toEqual({ value: 47, strategy: 'DELTA_MERGE', losers: 0 });
  });

  it('applies last-writer-wins only for absolute values, tie-broken by device id', () => {
    const merged = resolveConflict(50, [
      { deviceId: 'till-1', deviceTimestamp: fresh(1), value: 40 },
      { deviceId: 'till-2', deviceTimestamp: fresh(1), value: 41 },
    ]);
    expect(merged.strategy).toBe('LAST_WRITE_WIN');
    expect(merged.value).toBe(41);
    expect(merged.losers).toBe(1);
  });

  it('adds the deltas on top of the winning absolute value', () => {
    const merged = resolveConflict(50, [
      { deviceId: 'till-1', deviceTimestamp: fresh(5), value: 40 },
      { deviceId: 'till-2', deviceTimestamp: fresh(1), delta: -3 },
    ]);
    expect(merged.strategy).toBe('LAST_WRITE_WIN');
    expect(merged.value).toBe(37);
  });

  it('is a no-op with nothing to merge', () => {
    expect(resolveConflict(50, [])).toEqual({ value: 50, strategy: 'NO_OP', losers: 0 });
    expect(resolveConflict(50, [null as never, { deviceId: 'x', deviceTimestamp: fresh(1) } as never])).toEqual({ value: 50, strategy: 'NO_OP', losers: 0 });
  });

  it('keeps two decimals on a fractional merge', () => {
    expect(resolveConflict(10, [{ deviceId: 'a', deviceTimestamp: fresh(1), delta: 0.111 }, { deviceId: 'b', deviceTimestamp: fresh(1), delta: 0.222 }]).value).toBe(10.33);
  });
});

describe('status roll-up', () => {
  it('is healthy only when everything is live and in quorum', () => {
    expect(meshStatus([till1, till2], fence(), NOW).health).toBe('HEALTHY');
    // One till down out of four still leaves a majority, so the store degrades
    // rather than stops.
    expect(meshStatus([till1, till2, tablet, dead], fence(), NOW).health).toBe('DEGRADED');
    expect(meshStatus([till1, dead, { ...tablet, lastHeartbeatAt: fresh(600) }], fence(), NOW).health).toBe('ISOLATED');
    // A two-node mesh has no majority without both nodes: that is the honest
    // reading of "isolated", not a label to smooth over.
    expect(meshStatus([till1, dead], fence(), NOW).health).toBe('ISOLATED');
  });

  it('publishes the lease expiry the UI counts down from', () => {
    const status = meshStatus([till1], fence(), NOW);
    expect(status.leaseExpiresAt?.getTime()).toBe(NOW.getTime() + DEFAULT_LEASE_SECONDS * 1000);
    expect(status.term).toBe(termOf(['till-1']));
    expect(status.liveCount).toBe(1);
    expect(status.downCount).toBe(0);
  });

  it('has no lease to advertise before anyone claims one', () => {
    expect(meshStatus([till1], { epoch: 1, leaderDeviceId: null, committedSequence: 0 }, NOW).leaseExpiresAt).toBeNull();
  });

  it('uses the injected liveness window', () => {
    const wide = meshStatus([till1, dead], fence(), NOW, 60 * 60_000);
    expect(wide.health).toBe('HEALTHY');
    expect(DEFAULT_LIVENESS_WINDOW_MS).toBe(45_000);
  });
});
