import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';

const router = Router();

const poItemSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().positive(),
  unitCost: z.number(),
});

const createPoSchema = z.object({
  supplierId: z.string(),
  locationId: z.string(),
  items: z.array(poItemSchema).min(1),
  notes: z.string().optional(),
});

// GET /api/purchasing/orders - List purchase orders
router.get('/orders', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    // Purchase orders stored as metadata in accounting entries or a simple JSON approach
    // For now, we use a lightweight approach with inventory movements
    const entries = await prisma.accountingEntry.findMany({
      where: {
        organizationId: req.user!.organizationId!,
        referenceType: 'PURCHASE_ORDER',
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: entries });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/purchasing/orders - Create purchase order
router.post('/orders', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const data = createPoSchema.parse(req.body);
    const orgId = req.user!.organizationId!;

    const totalAmount = data.items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0);

    // Record the PO in the organization's own currency (multi-currency support),
    // falling back to USD only when the org has no currency set.
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    const orgCurrency = org?.currency || 'USD';

    // Create accounting entry for the PO
    const entry = await prisma.accountingEntry.create({
      data: {
        organizationId: orgId,
        type: 'EXPENSE',
        referenceType: 'PURCHASE_ORDER',
        amount: totalAmount,
        currency: orgCurrency,
        description: `PO for supplier ${data.supplierId} - ${data.items.length} items`,
        status: 'DRAFT',
        postedAt: new Date(),
      },
    });

    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: 'PURCHASE_ORDER_CREATED',
      resourceType: 'PURCHASE_ORDER',
      resourceId: entry.id,
      newValue: { supplierId: data.supplierId, totalAmount, itemCount: data.items.length },
    });

    res.status(201).json({ success: true, data: entry });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/purchasing/orders/:id/receive - Receive purchase order (update inventory)
router.post('/orders/:id/receive', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const { items } = z.object({
      items: z.array(z.object({
        productId: z.string(),
        quantity: z.number().int().positive(),
        locationId: z.string(),
      })),
    }).parse(req.body);

    const orgId = req.user!.organizationId!;

    // Update inventory for each item
    for (const item of items) {
      // Find or create inventory balance
      let balance = await prisma.inventoryBalance.findFirst({
        where: { productId: item.productId, locationId: item.locationId },
      });

      if (!balance) {
        balance = await prisma.inventoryBalance.create({
          data: { productId: item.productId, locationId: item.locationId, quantity: 0 },
        });
      }

      // Update balance
      await prisma.inventoryBalance.update({
        where: { id: balance.id },
        data: { quantity: { increment: item.quantity } },
      });

      // Create movement record
      await prisma.inventoryMovement.create({
        data: {
          balanceId: balance.id,
          type: 'PURCHASE',
          quantity: item.quantity,
          reference: String(req.params.id),
          performedBy: req.user!.employeeId,
        },
      });
    }

    // Update accounting entry status
    await prisma.accountingEntry.update({
      where: { id: String(req.params.id) },
      data: { status: 'POSTED' },
    });

    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: 'PURCHASE_ORDER_RECEIVED',
      resourceType: 'PURCHASE_ORDER',
      resourceId: String(req.params.id),
    });

    res.json({ success: true, message: 'Purchase order received' });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
