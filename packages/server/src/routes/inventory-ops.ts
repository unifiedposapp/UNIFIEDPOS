import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { emitEvent } from '../services/eventBus.js';

const router = Router();

const transferSchema = z.object({
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  notes: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive(),
  })).min(1),
});

const receiveTransferSchema = z.object({
  items: z.array(z.object({
    productId: z.string().uuid(),
    receivedQty: z.number().int().min(0),
  })),
});

const stockCountSchema = z.object({
  locationId: z.string().uuid(),
  notes: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    expected: z.number().int(),
    counted: z.number().int(),
  })).min(1),
});

const adjustmentSchema = z.object({
  productId: z.string().uuid(),
  locationId: z.string().uuid(),
  quantity: z.number().int(),
  type: z.string(), // ADJUSTMENT, DAMAGED, RETURN, QUARANTINED
  notes: z.string().optional(),
});

// ─── Stock Transfers ─────────────────────────────────────────

// GET /api/inventory-ops/transfers
router.get('/transfers', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const transfers = await prisma.stockTransfer.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: transfers });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/inventory-ops/transfers - Create transfer
router.post('/transfers', authMiddleware, validateRequest(transferSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { fromLocationId, toLocationId, notes, items } = req.body;
    const orgId = req.user!.organizationId!;

    if (fromLocationId === toLocationId) {
      return res.status(400).json({ success: false, message: 'Cannot transfer to same location' });
    }

    const transfer = await prisma.stockTransfer.create({
      data: {
        organizationId: orgId,
        fromLocationId,
        toLocationId,
        notes,
        transferredBy: req.user!.employeeId,
        status: 'IN_TRANSIT',
        transferredAt: new Date(),
        items: {
          create: items.map((item: any) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
        },
      },
      include: { items: true },
    });

    // Decrement source location inventory
    for (const item of items) {
      const balance = await prisma.inventoryBalance.findUnique({
        where: { productId_locationId: { productId: item.productId, locationId: fromLocationId } },
      });

      if (balance) {
        await prisma.inventoryBalance.update({
          where: { id: balance.id },
          data: { quantity: { decrement: item.quantity } },
        });
        await prisma.inventoryMovement.create({
          data: {
            balanceId: balance.id,
            type: 'TRANSFER_OUT',
            quantity: -item.quantity,
            reference: transfer.id,
            performedBy: req.user!.employeeId,
          },
        });
      }
    }

    await emitEvent({
      organizationId: orgId,
      event: 'inventory.transfer_created',
      data: { transferId: transfer.id, fromLocationId, toLocationId, itemCount: items.length },
    });

    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: 'STOCK_TRANSFER_CREATED',
      resourceType: 'INVENTORY',
      resourceId: transfer.id,
      newValue: { fromLocationId, toLocationId, items: items.length },
    });

    res.status(201).json({ success: true, data: transfer });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/inventory-ops/transfers/:id/receive - Receive transfer
router.post('/transfers/:id/receive', authMiddleware, validateRequest(receiveTransferSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { items } = req.body;
    const orgId = req.user!.organizationId!;
    const transferId = String(req.params.id);

    const transfer = await prisma.stockTransfer.findUnique({
      where: { id: transferId },
      include: { items: true },
    });

    if (!transfer) return res.status(404).json({ success: false, message: 'Transfer not found' });
    if (transfer.status === 'RECEIVED') {
      return res.status(400).json({ success: false, message: 'Transfer already received' });
    }

    // Increment destination location inventory
    for (const item of items) {
      const transferItem = transfer.items.find(ti => ti.productId === item.productId);
      if (!transferItem) continue;

      const receivedQty = Math.min(item.receivedQty, transferItem.quantity);

      // Find or create balance at destination
      let balance = await prisma.inventoryBalance.findUnique({
        where: { productId_locationId: { productId: item.productId, locationId: transfer.toLocationId } },
      });

      if (!balance) {
        balance = await prisma.inventoryBalance.create({
          data: {
            productId: item.productId,
            locationId: transfer.toLocationId,
            quantity: receivedQty,
          },
        });
      } else {
        await prisma.inventoryBalance.update({
          where: { id: balance.id },
          data: { quantity: { increment: receivedQty } },
        });
      }

      await prisma.inventoryMovement.create({
        data: {
          balanceId: balance.id,
          type: 'TRANSFER_IN',
          quantity: receivedQty,
          reference: transferId,
          performedBy: req.user!.employeeId,
        },
      });

      // Update transfer item received qty
      await prisma.stockTransferItem.updateMany({
        where: { transferId, productId: item.productId },
        data: { receivedQty },
      });
    }

    const updated = await prisma.stockTransfer.update({
      where: { id: transferId },
      data: { status: 'RECEIVED', receivedAt: new Date(), receivedBy: req.user!.employeeId },
      include: { items: true },
    });

    await emitEvent({
      organizationId: orgId,
      event: 'inventory.transfer_received',
      data: { transferId, toLocationId: transfer.toLocationId },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Stock Counts (Cycle Counts) ─────────────────────────────

// GET /api/inventory-ops/counts
router.get('/counts', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const counts = await prisma.stockCount.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: counts });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/inventory-ops/counts - Create and complete stock count
router.post('/counts', authMiddleware, validateRequest(stockCountSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { locationId, notes, items } = req.body;
    const orgId = req.user!.organizationId!;

    const count = await prisma.stockCount.create({
      data: {
        organizationId: orgId,
        locationId,
        notes,
        countedBy: req.user!.employeeId,
        status: 'COMPLETED',
        countedAt: new Date(),
        items: {
          create: items.map((item: any) => ({
            productId: item.productId,
            expected: item.expected,
            counted: item.counted,
            variance: item.counted - item.expected,
          })),
        },
      },
      include: { items: true },
    });

    // Apply adjustments for variances
    for (const item of items) {
      const variance = item.counted - item.expected;
      if (variance !== 0) {
        const balance = await prisma.inventoryBalance.findUnique({
          where: { productId_locationId: { productId: item.productId, locationId } },
        });

        if (balance) {
          await prisma.inventoryBalance.update({
            where: { id: balance.id },
            data: { quantity: variance > 0 ? { increment: variance } : { decrement: Math.abs(variance) } },
          });
          await prisma.inventoryMovement.create({
            data: {
              balanceId: balance.id,
              type: 'COUNT',
              quantity: variance,
              reference: count.id,
              notes: `Cycle count adjustment: expected ${item.expected}, counted ${item.counted}`,
              performedBy: req.user!.employeeId,
            },
          });
        }
      }
    }

    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: 'STOCK_COUNT_COMPLETED',
      resourceType: 'INVENTORY',
      resourceId: count.id,
      newValue: { locationId, itemCount: items.length },
    });

    res.status(201).json({ success: true, data: count });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Stock Adjustments ───────────────────────────────────────

// POST /api/inventory-ops/adjust - Manual stock adjustment
router.post('/adjust', authMiddleware, validateRequest(adjustmentSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { productId, locationId, quantity, type, notes } = req.body;
    const orgId = req.user!.organizationId!;

    let balance = await prisma.inventoryBalance.findUnique({
      where: { productId_locationId: { productId, locationId } },
    });

    if (!balance) {
      balance = await prisma.inventoryBalance.create({
        data: {
          productId,
          locationId,
          quantity: quantity > 0 ? quantity : 0,
          damaged: type === 'DAMAGED' ? Math.abs(quantity) : 0,
        },
      });
    } else {
      const updateData: any = {};

      if (type === 'DAMAGED') {
        updateData.damaged = { increment: Math.abs(quantity) };
        updateData.quantity = { decrement: Math.abs(quantity) };
      } else if (type === 'RETURN') {
        updateData.quantity = { increment: Math.abs(quantity) };
      } else {
        // ADJUSTMENT or QUARANTINED
        if (quantity > 0) {
          updateData.quantity = { increment: quantity };
        } else {
          updateData.quantity = { decrement: Math.abs(quantity) };
        }
      }

      await prisma.inventoryBalance.update({
        where: { id: balance.id },
        data: updateData,
      });
    }

    const movement = await prisma.inventoryMovement.create({
      data: {
        balanceId: balance.id,
        type,
        quantity,
        notes,
        performedBy: req.user!.employeeId,
      },
    });

    await emitEvent({
      organizationId: orgId,
      event: 'inventory.changed',
      data: { productId, locationId, quantity, type },
    });

    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: 'INVENTORY_ADJUSTED',
      resourceType: 'INVENTORY',
      resourceId: productId,
      newValue: { locationId, quantity, type, notes },
    });

    res.json({ success: true, data: { movement, balanceId: balance.id } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/inventory-ops/movements - List inventory movements
router.get('/movements', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { type, productId, locationId, limit = '100' } = req.query;
    const where: any = {
      balance: {
        product: { organizationId: req.user!.organizationId },
      },
    };

    if (type) where.type = String(type);
    if (productId) where.balance = { ...where.balance, productId: String(productId) };
    if (locationId) where.balance = { ...where.balance, locationId: String(locationId) };

    const movements = await prisma.inventoryMovement.findMany({
      where,
      include: {
        balance: {
          include: {
            product: { select: { name: true, sku: true } },
            location: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
    });

    res.json({ success: true, data: movements });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Batch / Lot Tracking + Expiration (§12) ─────────────────

const batchSchema = z.object({
  productId: z.string().uuid(),
  locationId: z.string().uuid(),
  batchNumber: z.string().min(1),
  quantity: z.number().int().positive(),
  expirationDate: z.string().optional(), // ISO date (perishables)
  unitCost: z.number().nonnegative().optional(),
  supplierId: z.string().uuid().optional(),
});

const batchConsumeSchema = z.object({
  quantity: z.number().int().positive(),
  notes: z.string().optional(),
});

const batchStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'EXPIRED', 'DEPLETED', 'RECALLED']),
});

const serialCreateSchema = z.object({
  productId: z.string().uuid(),
  serials: z.array(z.string().min(1)).min(1),
  batchId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
});

const serialStatusSchema = z.object({
  status: z.enum(['IN_STOCK', 'RESERVED', 'SOLD', 'RETURNED', 'DEFECTIVE', 'IN_REPAIR']),
  soldOrderItemId: z.string().optional(),
});

// GET /api/inventory-ops/batches?productId=&locationId=&status=&expiringDays=30
router.get('/batches', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const where: any = { organizationId: orgId };
    if (req.query.productId) where.productId = String(req.query.productId);
    if (req.query.locationId) where.locationId = String(req.query.locationId);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.expiringDays) {
      const horizon = new Date(Date.now() + Number(req.query.expiringDays) * 86400000);
      where.expirationDate = { not: null, lte: horizon };
    }
    const batches = await prisma.inventoryBatch.findMany({
      where,
      include: { product: { select: { name: true, sku: true } }, location: { select: { name: true } } },
      orderBy: [{ expirationDate: 'asc' }, { createdAt: 'desc' }],
    });
    res.json({ success: true, data: batches });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/inventory-ops/batches — receive a lot; increments on-hand balance
router.post('/batches', authMiddleware, validateRequest(batchSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { productId, locationId, batchNumber, quantity, expirationDate, unitCost, supplierId } = req.body;

    const batch = await prisma.inventoryBatch.upsert({
      where: { organizationId_productId_batchNumber: { organizationId: orgId, productId, batchNumber } },
      create: {
        organizationId: orgId, productId, locationId, batchNumber,
        quantity, remaining: quantity,
        expirationDate: expirationDate ? new Date(expirationDate) : null,
        unitCost: unitCost ?? undefined,
        supplierId: supplierId ?? undefined,
      },
      update: { quantity: { increment: quantity }, remaining: { increment: quantity } },
    });

    // Reflect the received lot in the on-hand balance + immutable movement (§12/§34)
    const balance = await prisma.inventoryBalance.upsert({
      where: { productId_locationId: { productId, locationId } },
      create: { productId, locationId, quantity },
      update: { quantity: { increment: quantity } },
    });
    await prisma.inventoryMovement.create({
      data: { balanceId: balance.id, type: 'PURCHASE', quantity, reference: batch.id, notes: `Batch ${batchNumber} received`, performedBy: req.user!.employeeId },
    });

    await createAuditEvent({
      organizationId: orgId, actorId: req.user!.employeeId, action: 'INVENTORY_BATCH_RECEIVED',
      resourceType: 'INVENTORY', resourceId: productId, newValue: { batchNumber, quantity, expirationDate },
    });

    res.status(201).json({ success: true, data: batch });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/inventory-ops/batches/:id/consume — draw down a lot (FIFO usage/sale)
router.post('/batches/:id/consume', authMiddleware, validateRequest(batchConsumeSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { quantity, notes } = req.body;
    const batch = await prisma.inventoryBatch.findFirst({ where: { id: String(req.params.id), organizationId: orgId } });
    if (!batch) { res.status(404).json({ success: false, error: 'Batch not found' }); return; }
    if (batch.remaining < quantity) { res.status(400).json({ success: false, error: `Only ${batch.remaining} units remain in this batch` }); return; }

    const newRemaining = batch.remaining - quantity;
    const updated = await prisma.inventoryBatch.update({
      where: { id: batch.id },
      data: { remaining: newRemaining, status: newRemaining === 0 ? 'DEPLETED' : batch.status },
    });

    const balance = await prisma.inventoryBalance.findUnique({ where: { productId_locationId: { productId: batch.productId, locationId: batch.locationId } } });
    if (balance) {
      await prisma.inventoryBalance.update({ where: { id: balance.id }, data: { quantity: { decrement: quantity } } });
      await prisma.inventoryMovement.create({ data: { balanceId: balance.id, type: 'SALE', quantity: -quantity, reference: batch.id, notes: notes || `Consumed from batch ${batch.batchNumber}`, performedBy: req.user!.employeeId } });
      await emitEvent({ organizationId: orgId, event: 'inventory.changed', data: { productId: batch.productId, locationId: batch.locationId, quantity: balance.quantity - quantity, type: 'BATCH_CONSUME' } });
    }

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/inventory-ops/batches/:id/status — mark EXPIRED / RECALLED / etc.
router.post('/batches/:id/status', authMiddleware, validateRequest(batchStatusSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const batch = await prisma.inventoryBatch.findFirst({ where: { id: String(req.params.id), organizationId: orgId } });
    if (!batch) { res.status(404).json({ success: false, error: 'Batch not found' }); return; }
    const updated = await prisma.inventoryBatch.update({ where: { id: batch.id }, data: { status: req.body.status } });
    await createAuditEvent({ organizationId: orgId, actorId: req.user!.employeeId, action: 'INVENTORY_BATCH_STATUS', resourceType: 'INVENTORY', resourceId: batch.productId, newValue: { batchId: batch.id, status: req.body.status } });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Serial Number Tracking (§12) ────────────────────────────

// GET /api/inventory-ops/serials?productId=&status=
router.get('/serials', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const where: any = { organizationId: orgId };
    if (req.query.productId) where.productId = String(req.query.productId);
    if (req.query.status) where.status = String(req.query.status);
    const serials = await prisma.serialNumber.findMany({
      where,
      include: { product: { select: { name: true, sku: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    res.json({ success: true, data: serials });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/inventory-ops/serials — register serials for a serialized product
router.post('/serials', authMiddleware, validateRequest(serialCreateSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { productId, serials, batchId, locationId } = req.body;
    const created = [];
    for (const serial of serials) {
      const record = await prisma.serialNumber.upsert({
        where: { organizationId_productId_serial: { organizationId: orgId, productId, serial } },
        create: { organizationId: orgId, productId, serial, batchId: batchId ?? undefined, locationId: locationId ?? undefined },
        update: { batchId: batchId ?? undefined, locationId: locationId ?? undefined },
      });
      created.push(record);
    }
    res.status(201).json({ success: true, data: { created: created.length, serials: created } });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/inventory-ops/serials/:id/status
router.put('/serials/:id/status', authMiddleware, validateRequest(serialStatusSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const serial = await prisma.serialNumber.findFirst({ where: { id: String(req.params.id), organizationId: orgId } });
    if (!serial) { res.status(404).json({ success: false, error: 'Serial not found' }); return; }
    const updated = await prisma.serialNumber.update({
      where: { id: serial.id },
      data: { status: req.body.status, soldOrderItemId: req.body.soldOrderItemId ?? serial.soldOrderItemId },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
