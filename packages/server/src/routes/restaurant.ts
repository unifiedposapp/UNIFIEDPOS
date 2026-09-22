import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';

const router = Router();

const tableSchema = z.object({
  number: z.number().int().positive(),
  name: z.string().optional(),
  capacity: z.number().int().positive().default(4),
  section: z.string().optional(),
  notes: z.string().optional(),
  // Identity color; the palette itself lives on the client, so we only guard length.
  color: z.string().max(24).optional().nullable(),
});

// GET /api/restaurant/tables
router.get('/tables', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const tables = await prisma.restaurantTable.findMany({
      where: { organizationId: req.user!.organizationId! },
      orderBy: [{ section: 'asc' }, { number: 'asc' }],
    });
    res.json({ success: true, data: tables });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/restaurant/tables
router.post('/tables', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const data = tableSchema.parse(req.body);
    const table = await prisma.restaurantTable.create({
      data: { ...data, organizationId: req.user!.organizationId! },
    });
    res.status(201).json({ success: true, data: table });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/restaurant/tables/:id
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const data = tableSchema.partial().parse(req.body);
    const id = String(req.params.id);
    // Scope the write to the caller's organization so table ids from other
    // tenants simply 404 instead of being mutated.
    const updated = await prisma.restaurantTable.updateMany({
      where: { id, organizationId: req.user!.organizationId! },
      data,
    });
    if (!updated.count) return res.status(404).json({ success: false, message: 'Table not found' });
    const table = await prisma.restaurantTable.findUnique({ where: { id } });
    res.json({ success: true, data: table });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/restaurant/tables/:id/status
router.put('/:id/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { status } = z.object({ status: z.enum(['AVAILABLE', 'OCCUPIED', 'RESERVED', 'DIRTY']) }).parse(req.body);
    const id = String(req.params.id);
    const updated = await prisma.restaurantTable.updateMany({
      where: { id, organizationId: req.user!.organizationId! },
      data: { status },
    });
    if (!updated.count) return res.status(404).json({ success: false, message: 'Table not found' });
    const table = await prisma.restaurantTable.findUnique({ where: { id } });
    res.json({ success: true, data: table });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/restaurant/tables/:id
router.delete('/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const deleted = await prisma.restaurantTable.deleteMany({
      where: { id: String(req.params.id), organizationId: req.user!.organizationId! },
    });
    if (!deleted.count) return res.status(404).json({ success: false, message: 'Table not found' });
    res.json({ success: true, message: 'Table deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/restaurant/overview - Floor plan overview
router.get('/overview', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const tables = await prisma.restaurantTable.findMany({
      where: { organizationId: req.user!.organizationId! },
      orderBy: [{ section: 'asc' }, { number: 'asc' }],
    });

    const summary = {
      total: tables.length,
      available: tables.filter(t => t.status === 'AVAILABLE').length,
      occupied: tables.filter(t => t.status === 'OCCUPIED').length,
      reserved: tables.filter(t => t.status === 'RESERVED').length,
      dirty: tables.filter(t => t.status === 'DIRTY').length,
      sections: [...new Set(tables.map(t => t.section).filter(Boolean))],
    };

    res.json({ success: true, data: { tables, summary } });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Reservations ────────────────────────────────────────────

const reservationSchema = z.object({
  tableId: z.string().uuid().optional().or(z.literal('')),
  customerName: z.string().min(1),
  customerPhone: z.string().optional(),
  customerEmail: z.string().optional(),
  partySize: z.number().int().positive().default(2),
  reservationTime: z.string(),
  durationMinutes: z.number().int().positive().default(90),
  notes: z.string().optional(),
});

// GET /api/restaurant/reservations
router.get('/reservations', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { date } = req.query;
    const where: any = { organizationId: req.user!.organizationId };
    if (date) {
      const start = new Date(String(date));
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      where.reservationTime = { gte: start, lt: end };
    }
    const reservations = await prisma.reservation.findMany({
      where,
      orderBy: { reservationTime: 'asc' },
    });
    res.json({ success: true, data: reservations });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/restaurant/reservations
router.post('/reservations', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const data = reservationSchema.parse(req.body);
    const reservation = await prisma.reservation.create({
      data: {
        ...data,
        tableId: data.tableId || null,
        organizationId: req.user!.organizationId!,
        reservationTime: new Date(data.reservationTime),
      },
    });
    res.status(201).json({ success: true, data: reservation });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/restaurant/reservations/:id/status
router.put('/reservations/:id/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { status } = z.object({ status: z.enum(['PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']) }).parse(req.body);
    const reservation = await prisma.reservation.update({
      where: { id: String(req.params.id) },
      data: { status },
    });
    res.json({ success: true, data: reservation });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/restaurant/reservations/:id
router.delete('/reservations/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.reservation.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true, message: 'Reservation deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Waitlist ────────────────────────────────────────────────

const waitlistSchema = z.object({
  customerName: z.string().min(1),
  customerPhone: z.string().optional(),
  partySize: z.number().int().positive().default(2),
});

// GET /api/restaurant/waitlist
router.get('/waitlist', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const entries = await prisma.waitlistEntry.findMany({
      where: { organizationId: req.user!.organizationId, status: 'WAITING' },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: entries });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/restaurant/waitlist
router.post('/waitlist', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const data = waitlistSchema.parse(req.body);
    const entry = await prisma.waitlistEntry.create({
      data: { ...data, organizationId: req.user!.organizationId! },
    });
    res.status(201).json({ success: true, data: entry });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/restaurant/waitlist/:id/status
router.put('/waitlist/:id/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { status } = z.object({ status: z.enum(['WAITING', 'NOTIFIED', 'SEATED', 'CANCELLED']) }).parse(req.body);
    const data: any = { status };
    if (status === 'NOTIFIED') data.notifiedAt = new Date();
    if (status === 'SEATED') data.seatedAt = new Date();
    
    const entry = await prisma.waitlistEntry.update({
      where: { id: String(req.params.id) },
      data,
    });
    res.json({ success: true, data: entry });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Table Transfers (§17) ──────────────────────────────────

// POST /api/restaurant/tables/:id/transfer - Transfer table to another table
router.post('/tables/:id/transfer', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { targetTableId } = z.object({ targetTableId: z.string() }).parse(req.body);
    const orgId = req.user!.organizationId!;

    const sourceTable = await prisma.restaurantTable.findFirst({
      where: { id: String(req.params.id), organizationId: orgId },
    });
    const targetTable = await prisma.restaurantTable.findFirst({
      where: { id: targetTableId, organizationId: orgId },
    });

    if (!sourceTable || !targetTable) {
      return res.status(404).json({ success: false, message: 'Table not found' });
    }
    if (targetTable.status !== 'AVAILABLE') {
      return res.status(400).json({ success: false, message: 'Target table is not available' });
    }

    // Transfer: mark source as DIRTY, target as OCCUPIED
    await prisma.$transaction([
      prisma.restaurantTable.update({
        where: { id: sourceTable.id },
        data: { status: 'DIRTY' },
      }),
      prisma.restaurantTable.update({
        where: { id: targetTable.id },
        data: { status: 'OCCUPIED' },
      }),
    ]);

    res.json({
      success: true,
      data: { from: sourceTable, to: { ...targetTable, status: 'OCCUPIED' } },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Kitchen Orders / Course Management (§17) ────────────────

// GET /api/restaurant/kitchen - Kitchen display
router.get('/kitchen', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query;
    const where: any = { organizationId: req.user!.organizationId! };
    if (status) where.status = String(status);
    else where.status = { in: ['RECEIVED', 'PREPARING'] };

    const orders = await prisma.kitchenOrder.findMany({
      where,
      include: { items: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    res.json({ success: true, data: orders });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/restaurant/kitchen - Send order to kitchen
router.post('/kitchen', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { orderId, tableId, items, course, priority, notes } = z.object({
      orderId: z.string(),
      tableId: z.string().optional(),
      items: z.array(z.object({
        productId: z.string(),
        productName: z.string(),
        quantity: z.number().int().positive(),
        modifiers: z.any().optional(),
        notes: z.string().optional(),
      })),
      course: z.number().int().default(1),
      priority: z.number().int().default(0),
      notes: z.string().optional(),
    }).parse(req.body);

    const kitchenOrder = await prisma.kitchenOrder.create({
      data: {
        organizationId: req.user!.organizationId!,
        orderId,
        tableId,
        course,
        priority,
        notes,
        status: 'RECEIVED',
        items: {
          create: items.map(i => ({
            productId: i.productId,
            productName: i.productName,
            quantity: i.quantity,
            modifiers: i.modifiers,
            notes: i.notes,
            status: 'PENDING',
          })),
        },
      },
      include: { items: true },
    });

    res.status(201).json({ success: true, data: kitchenOrder });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/restaurant/kitchen/:id/status - Update kitchen order status
router.put('/kitchen/:id/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { status } = z.object({
      status: z.enum(['RECEIVED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED']),
    }).parse(req.body);

    const data: any = { status };
    if (status === 'READY') data.readyAt = new Date();
    if (status === 'SERVED') data.servedAt = new Date();

    const order = await prisma.kitchenOrder.update({
      where: { id: String(req.params.id) },
      data,
      include: { items: true },
    });
    res.json({ success: true, data: order });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/restaurant/kitchen/:id/items/:itemId - Update item status
router.put('/kitchen/:id/items/:itemId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { status } = z.object({
      status: z.enum(['PENDING', 'PREPARING', 'READY', 'CANCELLED']),
    }).parse(req.body);

    const item = await prisma.kitchenOrderItem.update({
      where: { id: String(req.params.itemId) },
      data: { status },
    });
    res.json({ success: true, data: item });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Split Checks (§17) ──────────────────────────────────────

// POST /api/restaurant/orders/:id/split - Split an order into multiple checks
router.post('/orders/:id/split', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { splits } = z.object({
      splits: z.array(z.object({
        splitNumber: z.number().int().positive(),
        items: z.array(z.object({
          orderItemId: z.string(),
          quantity: z.number().int().positive(),
          amount: z.number(),
        })),
        amount: z.number(),
      })),
    }).parse(req.body);

    const created = [];
    for (const split of splits) {
      const orderSplit = await prisma.orderSplit.create({
        data: {
          orderId: String(req.params.id),
          splitNumber: split.splitNumber,
          amount: split.amount,
          items: split.items,
          status: 'PENDING',
        },
      });
      created.push(orderSplit);
    }

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/restaurant/orders/:id/splits - Get splits for an order
router.get('/orders/:id/splits', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const splits = await prisma.orderSplit.findMany({
      where: { orderId: String(req.params.id) },
      orderBy: { splitNumber: 'asc' },
    });
    res.json({ success: true, data: splits });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Menu Management (§17) ───────────────────────────────────

// GET /api/restaurant/menu/categories
router.get('/menu/categories', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const categories = await prisma.menuCategory.findMany({
      where: { organizationId: req.user!.organizationId! },
      include: { items: true },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: categories });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/restaurant/menu/categories
router.post('/menu/categories', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, sortOrder, displayTime } = z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      sortOrder: z.number().int().default(0),
      displayTime: z.string().optional(),
    }).parse(req.body);

    const category = await prisma.menuCategory.create({
      data: {
        organizationId: req.user!.organizationId!,
        name,
        description,
        sortOrder,
        displayTime,
      },
    });
    res.status(201).json({ success: true, data: category });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/restaurant/menu/categories/:id/items - Add product to menu category
router.post('/menu/categories/:id/items', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const { productId, displayPrice, sortOrder } = z.object({
      productId: z.string(),
      displayPrice: z.number().optional(),
      sortOrder: z.number().int().default(0),
    }).parse(req.body);

    const item = await prisma.menuCategoryItem.create({
      data: {
        categoryId: String(req.params.id),
        productId,
        displayPrice,
        sortOrder,
      },
    });
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/restaurant/menu/categories/:id/items/:itemId
router.put('/menu/categories/:id/items/:itemId', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const { displayPrice, sortOrder, isAvailable } = z.object({
      displayPrice: z.number().optional(),
      sortOrder: z.number().int().optional(),
      isAvailable: z.boolean().optional(),
    }).parse(req.body);

    const item = await prisma.menuCategoryItem.update({
      where: { id: String(req.params.itemId) },
      data: { displayPrice, sortOrder, isAvailable },
    });
    res.json({ success: true, data: item });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
