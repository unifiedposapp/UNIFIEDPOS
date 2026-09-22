// ─── Store mesh: leader election, fencing tokens, merge-safe writes ──────────
// A store with four tills and no cloud link still has to agree on one number:
// whose stock counts, whose sequence wins. Every decision here is deterministic
// (role, then priority, then heartbeat, then id) so two nodes that saw the same
// membership reach the same leader, and a write carries an epoch + sequence so a
// node that missed its own demotion can never commit after the fact.

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import {
  DEFAULT_LEASE_SECONDS,
  DEFAULT_LIVENESS_WINDOW_MS,
  MAX_LEASE_SECONDS,
  MIN_LEASE_SECONDS,
  electLeader,
  claimLeadership,
  acceptWrite,
  fenceToken,
  leaseExpired,
  meshStatus,
  normalizeLease,
  resolveConflict,
  termOf,
  type FenceState,
  type WriteRecord,
} from '../services/mesh.js';

const router = Router();

async function ownedLocation(organizationId: string, locationId: string) {
  return prisma.location.findFirst({ where: { id: locationId, organizationId }, select: { id: true, name: true, isActive: true } });
}

/** Read (and lazily create) the fence row that owns an location's epoch. */
async function fenceFor(organizationId: string, locationId: string) {
  const existing = await prisma.meshFence.findUnique({ where: { organizationId_locationId: { organizationId, locationId } } });
  if (existing) return existing;
  return prisma.meshFence.create({
    data: { organizationId, locationId, epoch: 1, committedSequence: 0, leaseSeconds: DEFAULT_LEASE_SECONDS, reason: 'BOOTSTRAP' },
  });
}

// GET /api/mesh/status - every location this tenant runs, with its lease position
router.get('/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const [locations, devices, fences] = await Promise.all([
      prisma.location.findMany({ where: { organizationId, isActive: true }, select: { id: true, name: true }, take: 200 }),
      prisma.device.findMany({ where: { organizationId }, select: { id: true, name: true, type: true, status: true, lastHeartbeatAt: true, locationId: true, softwareVersion: true }, take: 2000 }),
      prisma.meshFence.findMany({ where: { organizationId }, take: 500 }),
    ]);
    const fenceByLocation = new Map(fences.map((f) => [f.locationId, f]));
    const now = new Date();
    const rows = locations.map((location) => {
      const live = devices.filter((d) => d.locationId === location.id);
      const fence = fenceByLocation.get(location.id);
      const state: FenceState = {
        epoch: fence?.epoch ?? 1,
        leaderDeviceId: fence?.leaderDeviceId ?? null,
        committedSequence: fence?.committedSequence ?? 0,
        leaseSeconds: fence?.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
        lastCommitAt: fence?.lastCommitAt ?? null,
      };
      const status = meshStatus(live, state, now);
      return {
        locationId: location.id,
        locationName: location.name,
        devices: live.map((d) => ({ id: d.id, name: d.name, type: d.type, status: d.status, lastHeartbeatAt: d.lastHeartbeatAt, softwareVersion: d.softwareVersion })),
        fence: { ...state, token: fenceToken(location.id, state), expiresAt: status.leaseExpiresAt, stale: leaseExpired(state, now) },
        status,
        electedLeader: electLeader(live, { now }).leaderId,
        term: termOf(electLeader(live, { now }).alive),
      };
    });
    res.json({
      success: true,
      data: {
        locations: rows,
        health: rows.some((r) => r.status.health === 'ISOLATED') ? 'ISOLATED' : rows.some((r) => r.status.health === 'DEGRADED') ? 'DEGRADED' : 'HEALTHY',
        livenessWindowMs: DEFAULT_LIVENESS_WINDOW_MS,
        leaseBounds: { min: MIN_LEASE_SECONDS, max: MAX_LEASE_SECONDS, default: DEFAULT_LEASE_SECONDS },
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/mesh/locations/:locationId - one store, in depth
router.get('/locations/:locationId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const location = await ownedLocation(organizationId, String(req.params.locationId));
    if (!location) return res.status(404).json({ success: false, message: 'Location not found' });
    const [devices, fence] = await Promise.all([
      prisma.device.findMany({ where: { organizationId, locationId: location.id }, select: { id: true, name: true, type: true, status: true, lastHeartbeatAt: true, softwareVersion: true } }),
      fenceFor(organizationId, location.id),
    ]);
    const state: FenceState = { epoch: fence.epoch, leaderDeviceId: fence.leaderDeviceId, committedSequence: fence.committedSequence, leaseSeconds: fence.leaseSeconds, lastCommitAt: fence.lastCommitAt };
    const election = electLeader(devices);
    res.json({
      success: true,
      data: {
        location,
        devices,
        fence: { ...fence, token: fenceToken(location.id, state), leaseExpired: leaseExpired(state) },
        election,
        status: meshStatus(devices, state),
        wouldOverwrite: Boolean(election.leaderId && fence.leaderDeviceId && election.leaderId !== fence.leaderDeviceId),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

const claimSchema = z.object({
  deviceId: z.string().min(3).max(64),
  epoch: z.number().int().min(0).max(2_000_000_000).optional().nullable(),
  leaseSeconds: z.number().int().min(MIN_LEASE_SECONDS).max(MAX_LEASE_SECONDS).optional(),
  reason: z.enum(['BOOTSTRAP', 'HEARTBEAT_TIMEOUT', 'MANUAL_FAILOVER', 'RENEWED']).optional(),
});

// POST /api/mesh/locations/:locationId/claim - ask for (or renew) the lease
router.post('/locations/:locationId/claim', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(claimSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const location = await ownedLocation(organizationId, String(req.params.locationId));
    if (!location) return res.status(404).json({ success: false, message: 'Location not found' });
    const body = req.body as z.infer<typeof claimSchema>;
    const device = await prisma.device.findFirst({ where: { id: body.deviceId, organizationId }, select: { id: true, locationId: true, status: true } });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    if (device.locationId && device.locationId !== location.id) return res.status(400).json({ success: false, message: 'That device is registered to a different location' });

    const fence = await fenceFor(organizationId, location.id);
    const state: FenceState = { epoch: fence.epoch, leaderDeviceId: fence.leaderDeviceId, committedSequence: fence.committedSequence, leaseSeconds: fence.leaseSeconds, lastCommitAt: fence.lastCommitAt };
    const outcome = claimLeadership(state, { deviceId: body.deviceId, epoch: body.epoch ?? null }, { leaseSeconds: body.leaseSeconds });
    if (!outcome.granted) return res.status(409).json({ success: false, message: outcome.reason, data: outcome });

    const updated = await prisma.meshFence.update({
      where: { id: fence.id },
      data: {
        epoch: outcome.fence.epoch,
        leaderDeviceId: outcome.fence.leaderDeviceId,
        previousLeaderId: state.leaderDeviceId && state.leaderDeviceId !== outcome.fence.leaderDeviceId ? state.leaderDeviceId : fence.previousLeaderId,
        leaseSeconds: normalizeLease(outcome.fence.leaseSeconds),
        lastCommitAt: outcome.fence.lastCommitAt || new Date(),
        reason: body.reason || (outcome.fence.epoch > fence.epoch ? 'MANUAL_FAILOVER' : 'RENEWED'),
      },
    });
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'MESH_LEASE_CLAIMED',
      resourceType: 'MESH_FENCE',
      resourceId: updated.id,
      previousValue: { leader: state.leaderDeviceId, epoch: state.epoch },
      newValue: { leader: outcome.fence.leaderDeviceId, epoch: outcome.fence.epoch, reason: outcome.reason },
    });
    res.json({
      success: true,
      data: {
        granted: true,
        fence: { ...updated, token: fenceToken(location.id, outcome.fence) },
        reason: outcome.reason,
        steppedDownFrom: state.leaderDeviceId && state.leaderDeviceId !== outcome.fence.leaderDeviceId ? state.leaderDeviceId : null,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

const heartbeatSchema = z.object({ deviceId: z.string().min(3).max(64) });

// POST /api/mesh/locations/:locationId/heartbeat - liveness, and a free election view
router.post('/locations/:locationId/heartbeat', authMiddleware, validateRequest(heartbeatSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const location = await ownedLocation(organizationId, String(req.params.locationId));
    if (!location) return res.status(404).json({ success: false, message: 'Location not found' });
    const deviceId = String((req.body as z.infer<typeof heartbeatSchema>).deviceId);
    const device = await prisma.device.findFirst({ where: { id: deviceId, organizationId }, select: { id: true, locationId: true } });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    const now = new Date();
    await prisma.device.update({ where: { id: device.id }, data: { lastHeartbeatAt: now, status: 'ONLINE', ...(device.locationId ? {} : { locationId: location.id }) } });

    const [devices, fence] = await Promise.all([
      prisma.device.findMany({ where: { organizationId, locationId: location.id }, select: { id: true, name: true, type: true, status: true, lastHeartbeatAt: true } }),
      fenceFor(organizationId, location.id),
    ]);
    const state: FenceState = { epoch: fence.epoch, leaderDeviceId: fence.leaderDeviceId, committedSequence: fence.committedSequence, leaseSeconds: fence.leaseSeconds, lastCommitAt: fence.lastCommitAt };
    const election = electLeader(devices, { now });
    res.json({
      success: true,
      data: {
        now,
        isLeader: fence.leaderDeviceId === device.id,
        leaderId: election.leaderId,
        // The token a device must echo on writes; a demoted leader sees its own
        // epoch fall behind here and stops committing instead of corrupting stock.
        token: fence.leaderDeviceId === device.id ? fenceToken(location.id, state) : null,
        quorum: election.quorum,
        liveCount: election.alive.length,
        downCount: election.unreachable.length,
        leaseExpired: leaseExpired(state, now),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

const commitSchema = z.object({
  deviceId: z.string().min(3).max(64),
  epoch: z.number().int().min(1).max(2_000_000_000),
  sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

// POST /api/mesh/locations/:locationId/commit - the fenced-write gate
router.post('/locations/:locationId/commit', authMiddleware, validateRequest(commitSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const location = await ownedLocation(organizationId, String(req.params.locationId));
    if (!location) return res.status(404).json({ success: false, message: 'Location not found' });
    const body = req.body as z.infer<typeof commitSchema>;
    const fence = await fenceFor(organizationId, location.id);
    const state: FenceState = { epoch: fence.epoch, leaderDeviceId: fence.leaderDeviceId, committedSequence: fence.committedSequence, leaseSeconds: fence.leaseSeconds, lastCommitAt: fence.lastCommitAt };
    const decision = acceptWrite(state, { epoch: body.epoch, sequence: body.sequence, deviceId: body.deviceId });
    if (!decision.accept) {
      return res.status(409).json({ success: false, message: decision.message, data: { code: decision.code, currentEpoch: state.epoch, committedSequence: state.committedSequence } });
    }
    const updated = await prisma.meshFence.update({
      where: { id: fence.id },
      data: { committedSequence: decision.nextSequence, lastCommitAt: new Date(), leaseSeconds: state.leaseSeconds },
    });
    res.json({
      success: true,
      data: {
        accepted: true,
        sequence: decision.nextSequence,
        token: fenceToken(location.id, { epoch: updated.epoch, leaderDeviceId: updated.leaderDeviceId, committedSequence: updated.committedSequence, leaseSeconds: updated.leaseSeconds, lastCommitAt: updated.lastCommitAt }),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

const conflictSchema = z.object({
  base: z.number(),
  writes: z
    .array(
      z.object({
        deviceId: z.string().min(1).max(64),
        deviceTimestamp: z.string().datetime(),
        delta: z.number().optional().nullable(),
        value: z.number().optional().nullable(),
        epoch: z.number().int().optional().nullable(),
      })
    )
    .min(1)
    .max(200),
});

// POST /api/mesh/conflicts/resolve - show what a merge would produce, change nothing
router.post('/conflicts/resolve', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(conflictSchema), async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as z.infer<typeof conflictSchema>;
    const writes = body.writes as WriteRecord[];
    const outcome = resolveConflict(body.base, writes);
    res.json({
      success: true,
      data: {
        ...outcome,
        base: body.base,
        // Deltas accumulate because two tills really did sell two units; a blind
        // overwrite would silently delete one of those sales.
        explanation:
          outcome.strategy === 'DELTA_MERGE'
            ? `All ${writes.length} writes were deltas, so they were summed onto the base.`
            : outcome.strategy === 'LAST_WRITE_WIN'
              ? `${outcome.losers} competing absolute write(s) lost to the newest, tie-broken by device id.`
              : 'No usable writes were supplied; the base stands.',
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/mesh/reconcile - devices the mesh believes are down or behind
router.get('/reconcile', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    // Device and Location are separate tenants-safe tables with no relation, so
    // the names are joined in memory rather than through an include.
    const [devices, locations] = await Promise.all([
      prisma.device.findMany({
        where: { organizationId, status: { not: 'RETIRED' } },
        select: { id: true, name: true, type: true, status: true, lastHeartbeatAt: true, lastSyncAt: true, locationId: true },
        take: 2000,
      }),
      prisma.location.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    ]);
    const locationNames = new Map(locations.map((l) => [l.id, l.name]));
    const windowMs = Math.max(1000, Number(req.query.windowMs) || DEFAULT_LIVENESS_WINDOW_MS);
    const now = new Date();
    const staleAfter = Math.max(0, Number(req.query.staleMinutes) || 15) * 60_000;
    const quiet = devices.filter((d) => !d.lastHeartbeatAt || now.getTime() - new Date(d.lastHeartbeatAt).getTime() > staleAfter);
    res.json({
      success: true,
      data: {
        total: devices.length,
        windowMs,
        staleMinutes: staleAfter / 60_000,
        quiet: quiet.slice(0, 200).map((d) => ({
          id: d.id,
          name: d.name,
          type: d.type,
          locationId: d.locationId || null,
          locationName: d.locationId ? locationNames.get(d.locationId) || null : null,
          lastHeartbeatAt: d.lastHeartbeatAt,
          lastSyncAt: d.lastSyncAt,
          silentForMinutes: d.lastHeartbeatAt ? Math.round((now.getTime() - new Date(d.lastHeartbeatAt).getTime()) / 60_000) : null,
        })),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
