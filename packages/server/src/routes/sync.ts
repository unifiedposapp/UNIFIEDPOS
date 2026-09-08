import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { recordSync } from '../services/observability.js';

const router = Router();

// ══════════════════════════════════════════════════════════════
// OFFLINE-FIRST SYNC ENGINE (§25) + OFFLINE TRANSACTION PROTOCOL (§26)
//
// Every locally created transaction carries an immutable client-generated
// transactionId plus deviceId and sequenceNo. On sync the server dedupes on
// (organizationId, transactionId): an already-seen id returns its original
// result instead of re-processing, preventing duplicates after a retry.
// ══════════════════════════════════════════════════════════════

const transactionSchema = z.object({
  transactionId: z.string().min(1),
  deviceId: z.string().min(1),
  sequenceNo: z.number().int(),
  type: z.string().min(1),
  deviceTimestamp: z.string().or(z.number()),
  payload: z.record(z.any()).optional().default({}),
});

const syncBatchSchema = z.object({
  transactions: z.array(transactionSchema).min(1),
});

// Process a single offline transaction. Returns an acknowledgement result.
// INVENTORY_ADJUSTMENT is applied to live balances; other types are durably
// recorded and acknowledged so the originating device can clear its queue.
async function processTransaction(tx: z.infer<typeof transactionSchema>): Promise<Record<string, any>> {
  const payload: any = tx.payload || {};

  if (tx.type === 'INVENTORY_ADJUSTMENT' && payload.productId && payload.locationId) {
    const delta = Number(payload.quantity || 0);
    const balance = await prisma.inventoryBalance.upsert({
      where: { productId_locationId: { productId: payload.productId, locationId: payload.locationId } },
      create: { productId: payload.productId, locationId: payload.locationId, quantity: delta },
      update: { quantity: { increment: delta } },
    });
    await prisma.inventoryMovement.create({
      data: {
        balanceId: balance.id,
        type: 'ADJUSTMENT',
        quantity: delta,
        reference: tx.transactionId,
        notes: payload.notes || 'Offline sync adjustment',
      },
    });
    return { applied: true, newQuantity: balance.quantity };
  }

  return { applied: true, acknowledged: true };
}

// POST /api/sync/transactions — batch ingest from a device (§26)
router.post('/transactions', authMiddleware, validateRequest(syncBatchSchema), async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId!;
  const results: any[] = [];
  let accepted = 0;
  let duplicates = 0;
  let failed = 0;

  for (const tx of req.body.transactions) {
    // Dedupe: already-seen transactionId returns its original result (§26)
    const existing = await prisma.syncTransaction.findUnique({
      where: { organizationId_transactionId: { organizationId: orgId, transactionId: tx.transactionId } },
    });
    if (existing) {
      duplicates++;
      results.push({ transactionId: tx.transactionId, status: 'DUPLICATE', result: existing.result });
      continue;
    }

    try {
      const result = await processTransaction(tx);
      await prisma.syncTransaction.create({
        data: {
          organizationId: orgId,
          deviceId: tx.deviceId,
          transactionId: tx.transactionId,
          sequenceNo: tx.sequenceNo,
          type: tx.type,
          payload: tx.payload as any,
          status: 'SYNCED',
          deviceTimestamp: new Date(tx.deviceTimestamp),
          result: result as any,
        },
      });
      accepted++;
      results.push({ transactionId: tx.transactionId, status: 'SYNCED', result });
    } catch (error: any) {
      failed++;
      // Persist the failure so it surfaces in the conflicts view for resolution.
      await prisma.syncTransaction.create({
        data: {
          organizationId: orgId,
          deviceId: tx.deviceId,
          transactionId: tx.transactionId,
          sequenceNo: tx.sequenceNo,
          type: tx.type,
          payload: tx.payload as any,
          status: 'CONFLICT',
          deviceTimestamp: new Date(tx.deviceTimestamp),
          conflictReason: error?.message || 'Processing failed',
        },
      }).catch(() => undefined);
      results.push({ transactionId: tx.transactionId, status: 'CONFLICT', error: error?.message });
    }
  }

  // Feed the offline-sync counters so /api/metrics + alert thresholds reflect
  // real device sync health (§39).
  recordSync('received', req.body.transactions.length);
  if (accepted > 0) recordSync('applied', accepted);
  if (failed > 0) recordSync('failed', failed);

  res.json({ success: true, data: { accepted, duplicates, failed, results } });
});

// GET /api/sync/transactions — recent sync history
router.get('/transactions', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId, status } = req.query;
    const where: any = { organizationId: req.user!.organizationId };
    if (deviceId) where.deviceId = String(deviceId);
    if (status) where.status = String(status);
    const transactions = await prisma.syncTransaction.findMany({
      where,
      orderBy: { syncedAt: 'desc' },
      take: 200,
    });
    res.json({ success: true, data: transactions });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/sync/status — per-device sync health + queue counters (§39 offline duration)
router.get('/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const [total, synced, duplicates, conflicts, devices] = await Promise.all([
      prisma.syncTransaction.count({ where: { organizationId: orgId } }),
      prisma.syncTransaction.count({ where: { organizationId: orgId, status: 'SYNCED' } }),
      prisma.syncTransaction.count({ where: { organizationId: orgId, status: 'DUPLICATE' } }),
      prisma.syncTransaction.count({ where: { organizationId: orgId, status: { in: ['CONFLICT', 'FAILED'] } } }),
      prisma.syncTransaction.groupBy({
        by: ['deviceId'],
        where: { organizationId: orgId },
        _count: { _all: true },
        _max: { syncedAt: true },
      }),
    ]);

    // Enrich with device records where they exist
    const deviceList = await Promise.all(
      devices.map(async (d) => {
        const device = await prisma.device.findFirst({ where: { organizationId: orgId, id: d.deviceId } });
        return {
          deviceId: d.deviceId,
          deviceName: device?.name || 'Unknown device',
          status: device?.status || 'UNKNOWN',
          transactionCount: d._count._all,
          lastSyncAt: d._max.syncedAt,
        };
      }),
    );

    res.json({
      success: true,
      data: { total, synced, duplicates, conflicts, devices: deviceList },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/sync/conflicts — transactions needing resolution
router.get('/conflicts', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const conflicts = await prisma.syncTransaction.findMany({
      where: { organizationId: req.user!.organizationId, status: { in: ['CONFLICT', 'FAILED'] } },
      orderBy: { syncedAt: 'desc' },
    });
    res.json({ success: true, data: conflicts });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/sync/conflicts/:id/resolve — mark a conflicted transaction resolved
router.post('/conflicts/:id/resolve', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const updated = await prisma.syncTransaction.update({
      where: { id: String(req.params.id) },
      data: { status: 'SYNCED', conflictReason: null, result: { manuallyResolved: true, by: req.user!.id } as any },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
