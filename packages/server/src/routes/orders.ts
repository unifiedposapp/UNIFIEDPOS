import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware } from '../middleware/auth.js';
import { validateRequest, handleError, HttpError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { normalizePaymentMethod } from '../data/paymentMethods.js';
import { computeOrderTotals, planGiftCardDeduction, planStoreCreditDeduction } from '../services/moneyMath.js';

const router = Router();

const orderItemSchema = z.object({
  productId: z.string(),
  variantId: z.string().optional(),
  quantity: z.number().int().positive(),
  unitPrice: z.number(),
  discountAmt: z.number().optional(),
  notes: z.string().optional(),
});

const createOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1),
  customerId: z.string().optional(),
  paymentMethod: z.string().optional(),
  amountPaid: z.number().optional(),
  giftCardNumber: z.string().optional(),
  payments: z.array(z.object({
    method: z.string(),
    amount: z.number(),
    giftCardNumber: z.string().optional(),
  })).optional(),
  notes: z.string().optional(),
  status: z.string().optional(),
  couponCode: z.string().optional(),
  channel: z.string().optional(),
  fulfillmentType: z.string().optional(),
  tipAmount: z.number().optional(),
  serviceCharge: z.number().optional(),
});

// GET /api/orders
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { status, search, limit = '50' } = req.query;
    const where: any = { organizationId: req.user!.organizationId };
    
    if (status) where.status = String(status);
    if (search) {
      where.OR = [
        { orderNumber: { contains: String(search) } },
        { customer: { name: { contains: String(search), mode: 'insensitive' } } },
      ];
    }
    
    const orders = await prisma.order.findMany({
      where,
      include: {
        items: true,
        payments: true,
        customer: true,
        employee: { include: { user: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
    });
    
    res.json({ success: true, data: orders });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/orders/held - List held orders (must precede /:id to avoid param capture)
router.get('/held', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orders = await prisma.order.findMany({
      where: { organizationId: req.user!.organizationId, status: 'HELD' },
      include: { items: true, customer: true },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ success: true, data: orders });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/orders/:id
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: String(req.params.id) },
      include: {
        items: true,
        payments: true,
        discounts: true,
        taxes: true,
        fulfillments: true,
        customer: true,
        employee: { include: { user: { select: { name: true } } } },
      },
    });
    
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, data: order });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/orders - Create order
router.post('/', authMiddleware, validateRequest(createOrderSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { items, customerId, paymentMethod, amountPaid, giftCardNumber, payments, notes, status, couponCode, channel, fulfillmentType, tipAmount, serviceCharge } = req.body;
    
    // Get default location for organization
    const location = await prisma.location.findFirst({
      where: { organizationId: req.user!.organizationId },
    });
    
    if (!location) return res.status(400).json({ success: false, message: 'No location configured' });
    
    // Build persisted line items; order-level totals are computed by the pure,
    // unit-tested moneyMath module below (§10/§34).
    const orderItems = items.map((item: any) => {
      const discount = item.discountAmt || 0;
      const lineTotal = item.unitPrice * item.quantity - discount;
      return {
        productId: item.productId,
        variantId: item.variantId,
        productName: '', // Will be filled from product
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountAmt: discount,
        taxAmt: 0,
        totalAmount: lineTotal,
        notes: item.notes,
      };
    });
    
    // Get product names
    const productIds = items.map((i: any) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
    });
    
    const productMap = new Map(products.map(p => [p.id, p]));
    orderItems.forEach((oi: any) => {
      const product = productMap.get(oi.productId);
      if (product) oi.productName = product.name;
    });
    
    // Calculate tax
    const org = await prisma.organization.findUnique({
      where: { id: req.user!.organizationId! },
    });
    const taxRate = Number(org?.taxRate || 0);
    // Pure, unit-tested order math (subtotal → tax → total), rounded to 2dp.
    const { subtotal, taxAmount, total: totalAmount } = computeOrderTotals(items, taxRate);
    
    // Generate order number
    const orderCount = await prisma.order.count({
      where: { organizationId: req.user!.organizationId },
    });
    const orderNumber = `ORD-${Date.now()}-${orderCount + 1}`;
    
    // Create order + settle payment + decrement inventory atomically. The
    // transaction client is named `prisma` to shadow the module import, so every
    // write below runs inside ONE transaction. A thrown HttpError rolls the whole
    // thing back, so the register can never record a payment without deducting
    // stored value or decrementing stock (§34 transactional database rules).
    const orderId = await prisma.$transaction(async (prisma) => {
    const order = await prisma.order.create({
      data: {
        orderNumber,
        organizationId: req.user!.organizationId!,
        locationId: location.id,
        employeeId: req.user!.employeeId,
        customerId,
        subtotal,
        discountAmount: 0,
        taxAmount,
        totalAmount,
        tipAmount: tipAmount || 0,
        serviceCharge: serviceCharge || 0,
        notes,
        status: status || 'DRAFT',
        channel: channel || 'IN_STORE',
        couponCode: couponCode || null,
        fulfillmentType: fulfillmentType || 'PICKUP',
        items: { create: orderItems },
      },
      include: { items: true, payments: true, customer: true },
    });
    
    // If payment provided, process it
    if (payments && payments.length > 0) {
      // Split payments: process each payment method
      for (const pmt of payments) {
        // Fold aliases + upper-case to the canonical catalog id.
        const pmtMethod = normalizePaymentMethod(pmt.method) || String(pmt.method).toUpperCase();
        if (pmtMethod === 'GIFT_CARD') {
          // Deduct from gift card (pure plan → applied inside this transaction).
          const giftCard = await prisma.giftCard.findFirst({
            where: { organizationId: req.user!.organizationId!, cardNumber: pmt.giftCardNumber, status: 'ACTIVE' },
          });
          const gcPlan = giftCard ? planGiftCardDeduction(Number(giftCard.balance), pmt.amount) : null;
          if (!giftCard || !gcPlan || !gcPlan.ok) {
            throw new HttpError(400, 'Insufficient gift card balance');
          }
          await prisma.giftCard.update({
            where: { id: giftCard.id },
            data: { balance: gcPlan.newBalance, lastUsedAt: new Date(), status: gcPlan.status },
          });
        } else if (pmtMethod === 'STORE_CREDIT') {
          // Deduct from store credit (pure plan → applied inside this transaction).
          const credit = await prisma.storeCredit.findFirst({
            where: { organizationId: req.user!.organizationId!, customerId: customerId || '', status: 'ACTIVE' },
          });
          const scPlan = credit
            ? planStoreCreditDeduction([{ id: credit.id, balance: Number(credit.balance) }], pmt.amount)
            : null;
          if (!credit || !scPlan || !scPlan.ok) {
            throw new HttpError(400, 'Insufficient store credit');
          }
          for (const alloc of scPlan.allocations) {
            await prisma.storeCredit.update({
              where: { id: alloc.id },
              data: { balance: alloc.newBalance, lastUsedAt: new Date(), status: alloc.status },
            });
          }
        }

        await prisma.payment.create({
          data: {
            orderId: order.id,
            method: pmtMethod,
            amount: pmt.amount,
            status: 'COMPLETED',
          },
        });

        // Create payment transaction record (§10)
        await prisma.paymentTransaction.create({
          data: {
            organizationId: req.user!.organizationId!,
            paymentId: order.id, // will reference payment after creation
            type: 'CAPTURED',
            amount: pmt.amount,
            status: 'COMPLETED',
          },
        });
      }

      // Update order status
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'PAID' },
      });
    } else if (paymentMethod && amountPaid) {
      // Legacy single payment — normalise to the canonical catalog id.
      const singleMethod = normalizePaymentMethod(paymentMethod) || String(paymentMethod).toUpperCase();

      // Redeem stored-value tenders against their balances before recording the payment.
      if (singleMethod === 'GIFT_CARD') {
        if (!giftCardNumber) {
          throw new HttpError(400, 'Gift card number is required');
        }
        const giftCard = await prisma.giftCard.findFirst({
          where: { organizationId: req.user!.organizationId!, cardNumber: giftCardNumber, status: 'ACTIVE' },
        });
        if (!giftCard) {
          throw new HttpError(404, 'Gift card not found or inactive');
        }
        if (giftCard.expiresAt && giftCard.expiresAt.getTime() < Date.now()) {
          throw new HttpError(400, 'Gift card has expired');
        }
        const gcPlan = planGiftCardDeduction(Number(giftCard.balance), amountPaid);
        if (!gcPlan.ok) {
          throw new HttpError(400, 'Insufficient gift card balance');
        }
        await prisma.giftCard.update({
          where: { id: giftCard.id },
          data: { balance: gcPlan.newBalance, lastUsedAt: new Date(), status: gcPlan.status },
        });
      } else if (singleMethod === 'STORE_CREDIT') {
        if (!customerId) {
          throw new HttpError(400, 'A customer is required to redeem store credit');
        }
        const credits = await prisma.storeCredit.findMany({
          where: { organizationId: req.user!.organizationId!, customerId, status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' }, // FIFO — consume the oldest credit first
        });
        const scPlan = planStoreCreditDeduction(
          credits.map((c) => ({ id: c.id, balance: Number(c.balance) })),
          amountPaid,
        );
        if (!scPlan.ok) {
          if (scPlan.reason === 'NO_CREDIT') {
            throw new HttpError(404, 'No active store credit for this customer');
          }
          throw new HttpError(400, `Insufficient store credit balance (available $${scPlan.available.toFixed(2)})`);
        }
        for (const alloc of scPlan.allocations) {
          await prisma.storeCredit.update({
            where: { id: alloc.id },
            data: { balance: alloc.newBalance, lastUsedAt: new Date(), status: alloc.status },
          });
        }
      }

      await prisma.payment.create({
        data: {
          orderId: order.id,
          method: singleMethod,
          amount: amountPaid,
          status: 'COMPLETED',
        },
      });

      // Create payment transaction record (§10)
      await prisma.paymentTransaction.create({
        data: {
          organizationId: req.user!.organizationId!,
          paymentId: order.id,
          type: 'CAPTURED',
          amount: amountPaid,
          status: 'COMPLETED',
        },
      });

      // Update order status
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'PAID' },
      });
    }
    
    // Update inventory (only if order was paid)
    if (status === 'PAID' || payments || paymentMethod) {
      for (const item of items) {
        const inventory = await prisma.inventoryBalance.findUnique({
          where: {
            productId_locationId: {
              productId: item.productId,
              locationId: location.id,
            },
          },
        });
        
        if (inventory) {
          await prisma.inventoryBalance.update({
            where: { id: inventory.id },
            data: { quantity: { decrement: item.quantity } },
          });
          
          await prisma.inventoryMovement.create({
            data: {
              balanceId: inventory.id,
              type: 'SALE',
              quantity: -item.quantity,
              reference: order.id,
              performedBy: req.user!.employeeId,
            },
          });
        }
      }
      
      // Update customer totals
      if (customerId) {
        const customerOrders = await prisma.order.count({
          where: { customerId, status: { in: ['PAID', 'COMPLETED'] } },
        });
        const customerTotal = await prisma.order.aggregate({
          where: { customerId, status: { in: ['PAID', 'COMPLETED'] } },
          _sum: { totalAmount: true },
        });
        
        await prisma.customer.update({
          where: { id: customerId },
          data: {
            totalOrders: customerOrders,
            totalSpent: Number(customerTotal._sum?.totalAmount || 0),
            averageOrderValue: customerOrders > 0 ? Number(customerTotal._sum?.totalAmount || 0) / customerOrders : 0,
          },
        });
      }
      
      // Audit event
      await createAuditEvent({
        organizationId: req.user!.organizationId!,
        actorId: req.user!.employeeId,
        action: 'ORDER_CREATED',
        resourceType: 'ORDER',
        resourceId: order.id,
        newValue: { orderId: order.id, total: totalAmount, items: items.length },
      });
    }
    
    return order.id;
    }, { timeout: 15000, maxWait: 5000 });

    const result = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, payments: true, customer: true },
    });
    
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/orders/:id/status
router.put('/:id/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.body;
    const order = await prisma.order.update({
      where: { id: String(req.params.id) },
      data: { status },
      include: { items: true, payments: true },
    });
    
    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: `ORDER_${status.toUpperCase()}`,
      resourceType: 'ORDER',
      resourceId: order.id,
    });
    
    res.json({ success: true, data: order });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/orders/:id/cancel
router.post('/:id/cancel', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const order = await prisma.order.update({
      where: { id: String(req.params.id) },
      data: { status: 'CANCELLED' },
    });
    
    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: 'ORDER_CANCELLED',
      resourceType: 'ORDER',
      resourceId: order.id,
    });
    
    res.json({ success: true, data: order });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/orders/:id/refund
router.post('/:id/refund', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { amount, reason } = req.body;
    
    const order = await prisma.order.update({
      where: { id: String(req.params.id) },
      data: { 
        status: amount >= Number(req.body.originalTotal) ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      },
    });
    
    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: 'REFUND_CREATED',
      resourceType: 'ORDER',
      resourceId: order.id,
      newValue: { amount, reason },
    });
    
    res.json({ success: true, data: order });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/orders/:id/hold - Hold/suspend order
router.put('/:id/hold', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const order = await prisma.order.update({
      where: { id: String(req.params.id) },
      data: { status: 'HELD' },
    });
    
    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: 'ORDER_HELD',
      resourceType: 'ORDER',
      resourceId: order.id,
    });
    
    res.json({ success: true, data: order });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/orders/:id/recall - Recall held order
router.put('/:id/recall', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: String(req.params.id) } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'HELD') {
      return res.status(400).json({ success: false, message: 'Order is not on hold' });
    }
    
    const updated = await prisma.order.update({
      where: { id: String(req.params.id) },
      data: { status: 'DRAFT' },
    });
    
    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: 'ORDER_RECALLED',
      resourceType: 'ORDER',
      resourceId: order.id,
    });
    
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
