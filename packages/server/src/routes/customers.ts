import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { emitEvent } from '../services/eventBus.js';

const router = Router();

const customerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  birthday: z.string().optional(),
  marketingOptIn: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

// GET /api/customers
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { search, page = '1', pageSize = '20' } = req.query;
    const where: any = { organizationId: req.user!.organizationId };

    if (search) {
      where.OR = [
        { name: { contains: String(search), mode: 'insensitive' } },
        { email: { contains: String(search), mode: 'insensitive' } },
        { phone: { contains: String(search), mode: 'insensitive' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(pageSize);
    const [customers, total] = await Promise.all([
      prisma.customer.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: Number(pageSize) }),
      prisma.customer.count({ where }),
    ]);

    res.json({ success: true, data: { items: customers, total, page: Number(page), pageSize: Number(pageSize), totalPages: Math.ceil(total / Number(pageSize)) } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/customers/:id
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const customer = await prisma.customer.findFirst({
      where: { id: String(req.params.id), organizationId: req.user!.organizationId! },
      include: {
        orders: { orderBy: { createdAt: 'desc' }, take: 20, include: { items: true, payments: true } },
        loyaltyTransactions: { orderBy: { createdAt: 'desc' }, take: 20 },
        refunds: true,
        invoices: true,
      },
    });
    if (!customer) { res.status(404).json({ success: false, message: 'Customer not found' }); return; }

    // Calculate Customer 360 metrics
    const paidOrders = customer.orders.filter(o => ['PAID', 'COMPLETED'].includes(o.status));
    const totalSpent = paidOrders.reduce((s, o) => s + Number(o.totalAmount), 0);
    const avgOrderValue = paidOrders.length > 0 ? totalSpent / paidOrders.length : 0;

    // Favorite products
    const productFreq = new Map<string, { name: string; count: number }>();
    for (const order of paidOrders) {
      for (const item of order.items) {
        const e = productFreq.get(item.productId) || { name: item.productName, count: 0 };
        e.count += item.quantity;
        productFreq.set(item.productId, e);
      }
    }
    const favoriteProducts = Array.from(productFreq.entries())
      .map(([id, d]) => ({ productId: id, name: d.name, purchaseCount: d.count }))
      .sort((a, b) => b.purchaseCount - a.purchaseCount).slice(0, 5);

    // Visit frequency (orders per month)
    const firstOrder = paidOrders.length > 0 ? paidOrders[paidOrders.length - 1].createdAt : null;
    const monthsSinceFirst = firstOrder ? Math.max(1, (Date.now() - new Date(firstOrder).getTime()) / (30 * 24 * 60 * 60 * 1000)) : 0;
    const visitFrequency = monthsSinceFirst > 0 ? paidOrders.length / monthsSinceFirst : 0;

    // Refund behavior
    const refundCount = customer.refunds.length;
    const refundRate = paidOrders.length > 0 ? (refundCount / paidOrders.length) * 100 : 0;

    const profile360 = {
      totalSpent: Math.round(totalSpent * 100) / 100,
      totalOrders: paidOrders.length,
      averageOrderValue: Math.round(avgOrderValue * 100) / 100,
      visitFrequency: Math.round(visitFrequency * 10) / 10,
      favoriteProducts,
      lastVisitAt: paidOrders.length > 0 ? paidOrders[0].createdAt : null,
      customerSince: customer.createdAt,
      refundBehavior: { refundCount, refundRate: Math.round(refundRate * 100) / 100 },
      loyaltyPoints: customer.loyaltyPoints,
      tags: customer.tags,
      marketingOptIn: customer.marketingOptIn,
    };

    res.json({ success: true, data: { ...customer, profile360 } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/customers
router.post('/', authMiddleware, validateRequest(customerSchema), async (req: AuthRequest, res: Response) => {
  try {
    const data: any = { ...req.body };
    if (data.birthday) data.birthday = new Date(data.birthday);
    const customer = await prisma.customer.create({
      data: { ...data, organizationId: req.user!.organizationId! },
    });
    await emitEvent({ organizationId: req.user!.organizationId!, event: 'customer.created', data: { id: customer.id, name: customer.name } });
    await createAuditEvent({ organizationId: req.user!.organizationId!, actorId: req.user!.employeeId, action: 'CUSTOMER_CREATED', resourceType: 'CUSTOMER', resourceId: customer.id, newValue: { name: customer.name } });
    res.status(201).json({ success: true, data: customer });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/customers/:id
router.put('/:id', authMiddleware, validateRequest(customerSchema.partial()), async (req: AuthRequest, res: Response) => {
  try {
    const data: any = { ...req.body };
    if (data.birthday) data.birthday = new Date(data.birthday);
    const customer = await prisma.customer.update({ where: { id: String(req.params.id) }, data });
    await emitEvent({ organizationId: req.user!.organizationId!, event: 'customer.updated', data: { id: customer.id } });
    res.json({ success: true, data: customer });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/customers/:id
router.delete('/:id', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.customer.update({ where: { id: String(req.params.id) }, data: { isActive: false } });
    res.json({ success: true, message: 'Customer deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
