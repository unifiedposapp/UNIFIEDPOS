import { Router, Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { planGiftCardDeduction, planStoreCreditDeduction, round2 } from '../services/moneyMath.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// GIFT CARDS (§18)
// ═══════════════════════════════════════════════════════════════

// Gift cards can be purchased / reloaded in denominations up to this ceiling
// (default $1,000). A business can raise or lower it with GIFT_CARD_MAX_AMOUNT.
const GIFT_CARD_MAX = Number(process.env.GIFT_CARD_MAX_AMOUNT || 1000);

// Human-friendly, hard-to-guess card number (uniqueness is verified before insert).
function generateCardNumber(): string {
  const block = (n: number) => crypto.randomInt(0, 10 ** n).toString().padStart(n, '0');
  return `GC-${block(4)}-${block(4)}-${block(4)}`;
}

async function uniqueCardNumber(): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const candidate = generateCardNumber();
    const existing = await prisma.giftCard.findUnique({ where: { cardNumber: candidate } });
    if (!existing) return candidate;
  }
  throw new Error('Could not generate a unique gift card number');
}

// True when a card's expiry date has passed.
function isExpired(card: { expiresAt: Date | null }): boolean {
  return Boolean(card.expiresAt && card.expiresAt.getTime() < Date.now());
}

// GET /api/retail/gift-cards
router.get('/gift-cards', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { status, cardNumber } = req.query;
    const where: any = { organizationId: req.user!.organizationId! };
    if (status) where.status = String(status);
    if (cardNumber) where.cardNumber = { contains: String(cardNumber) };

    const cards = await prisma.giftCard.findMany({
      where,
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: cards });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/retail/gift-cards/lookup?cardNumber=GC-… — check a card by number.
// Used by the POS to validate a card before redeeming it. Registered before
// /:id so the literal "lookup" is never treated as an id.
router.get('/gift-cards/lookup', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const cardNumber = String(req.query.cardNumber || '').trim();
    if (!cardNumber) return res.status(400).json({ success: false, message: 'cardNumber is required' });

    const card = await prisma.giftCard.findFirst({
      where: { organizationId: req.user!.organizationId!, cardNumber },
      include: { customer: true },
    });
    if (!card) return res.status(404).json({ success: false, message: 'Gift card not found' });

    const expired = isExpired(card);
    const balance = Number(card.balance);
    res.json({
      success: true,
      data: {
        id: card.id,
        cardNumber: card.cardNumber,
        balance,
        originalAmount: Number(card.originalAmount),
        status: expired && card.status === 'ACTIVE' ? 'EXPIRED' : card.status,
        expiresAt: card.expiresAt,
        customerName: card.customer?.name || null,
        redeemable: card.status === 'ACTIVE' && !expired && balance > 0,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/retail/gift-cards/:id — a single card
router.get('/gift-cards/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const card = await prisma.giftCard.findFirst({
      where: { id: String(req.params.id), organizationId: req.user!.organizationId! },
      include: { customer: true },
    });
    if (!card) return res.status(404).json({ success: false, message: 'Gift card not found' });
    res.json({ success: true, data: card });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/retail/gift-cards — PURCHASE / sell a gift card (amount capped at GIFT_CARD_MAX).
// The card number is generated automatically unless the caller supplies one.
router.post('/gift-cards', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const { amount, customerId, expiresAt, notes, cardNumber } = z.object({
      amount: z.number().positive().max(GIFT_CARD_MAX, `Gift card amount cannot exceed ${GIFT_CARD_MAX}`),
      customerId: z.string().optional(),
      expiresAt: z.string().optional(),
      notes: z.string().optional(),
      cardNumber: z.string().min(1).optional(),
    }).parse(req.body);

    const finalNumber = cardNumber?.trim() || (await uniqueCardNumber());
    const existing = await prisma.giftCard.findUnique({ where: { cardNumber: finalNumber } });
    if (existing) return res.status(409).json({ success: false, message: 'Card number already exists' });

    const card = await prisma.giftCard.create({
      data: {
        organizationId: req.user!.organizationId!,
        cardNumber: finalNumber,
        balance: amount,
        originalAmount: amount,
        customerId,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        activatedAt: new Date(),
        notes,
        status: 'ACTIVE',
      },
      include: { customer: true },
    });

    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: 'GIFT_CARD_PURCHASED',
      resourceType: 'GIFT_CARD',
      resourceId: card.id,
      newValue: { cardNumber: finalNumber, amount },
    });

    res.status(201).json({ success: true, data: card });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/retail/gift-cards/:id/add-funds — reload a card (total stays ≤ GIFT_CARD_MAX).
router.post('/gift-cards/:id/add-funds', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const { amount } = z.object({ amount: z.number().positive() }).parse(req.body);
    const card = await prisma.giftCard.findFirst({
      where: { id: String(req.params.id), organizationId: req.user!.organizationId! },
    });
    if (!card) return res.status(404).json({ success: false, message: 'Gift card not found' });

    const newBalance = Number(card.balance) + amount;
    if (newBalance > GIFT_CARD_MAX) {
      return res.status(400).json({ success: false, message: `Balance cannot exceed ${GIFT_CARD_MAX}` });
    }

    const updated = await prisma.giftCard.update({
      where: { id: card.id },
      data: { balance: newBalance, status: 'ACTIVE', activatedAt: card.activatedAt || new Date() },
      include: { customer: true },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/retail/gift-cards/:id/activate — (re)activate a card
router.post('/gift-cards/:id/activate', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const card = await prisma.giftCard.findFirst({
      where: { id: String(req.params.id), organizationId: req.user!.organizationId! },
    });
    if (!card) return res.status(404).json({ success: false, message: 'Gift card not found' });

    const updated = await prisma.giftCard.update({
      where: { id: card.id },
      data: { status: 'ACTIVE', activatedAt: card.activatedAt || new Date() },
      include: { customer: true },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/retail/gift-cards/:id/redeem — redeem an amount against a card.
// Deducts the balance and marks the card DEPLETED once it reaches zero.
router.post('/gift-cards/:id/redeem', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { amount } = z.object({ amount: z.number().positive() }).parse(req.body);
    const card = await prisma.giftCard.findFirst({
      where: { id: String(req.params.id), organizationId: req.user!.organizationId! },
    });
    if (!card) return res.status(404).json({ success: false, message: 'Gift card not found' });
    if (card.status !== 'ACTIVE') return res.status(400).json({ success: false, message: `Gift card is ${card.status.toLowerCase()}` });
    if (isExpired(card)) return res.status(400).json({ success: false, message: 'Gift card has expired' });
    // Delegate deduction arithmetic to the tested money-path helper so this
    // endpoint and checkout (orders.ts) share one implementation of the rules.
    const plan = planGiftCardDeduction(Number(card.balance), amount);
    if (!plan.ok) return res.status(400).json({ success: false, message: 'Insufficient gift card balance' });

    const updated = await prisma.giftCard.update({
      where: { id: card.id },
      data: { balance: plan.newBalance, lastUsedAt: new Date(), status: plan.status },
      include: { customer: true },
    });

    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: 'GIFT_CARD_REDEEMED',
      resourceType: 'GIFT_CARD',
      resourceId: card.id,
      newValue: { amount, newBalance: plan.newBalance },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// ═══════════════════════════════════════════════════════════════
// STORE CREDIT (§18)
// ═══════════════════════════════════════════════════════════════

// GET /api/retail/store-credits
router.get('/store-credits', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { customerId, status } = req.query;
    const where: any = { organizationId: req.user!.organizationId! };
    if (customerId) where.customerId = String(customerId);
    if (status) where.status = String(status);

    const credits = await prisma.storeCredit.findMany({
      where,
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: credits });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/retail/store-credits - Issue store credit
router.post('/store-credits', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const { customerId, amount, reason, referenceType, referenceId, expiresAt } = z.object({
      customerId: z.string(),
      amount: z.number().positive(),
      reason: z.string().optional(),
      referenceType: z.string().optional(),
      referenceId: z.string().optional(),
      expiresAt: z.string().optional(),
    }).parse(req.body);

    const credit = await prisma.storeCredit.create({
      data: {
        organizationId: req.user!.organizationId!,
        customerId,
        balance: amount,
        originalAmount: amount,
        reason,
        referenceType,
        referenceId,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        status: 'ACTIVE',
      },
    });

    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: 'STORE_CREDIT_ISSUED',
      resourceType: 'STORE_CREDIT',
      resourceId: credit.id,
      newValue: { customerId, amount, reason },
    });

    res.status(201).json({ success: true, data: credit });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/retail/store-credits/:id/redeem — redeem store credit against a purchase.
// Deducts the balance and marks the credit DEPLETED once it reaches zero.
router.post('/store-credits/:id/redeem', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { amount } = z.object({ amount: z.number().positive() }).parse(req.body);
    const credit = await prisma.storeCredit.findFirst({
      where: { id: String(req.params.id), organizationId: req.user!.organizationId! },
    });
    if (!credit) return res.status(404).json({ success: false, message: 'Store credit not found' });
    if (credit.status !== 'ACTIVE') return res.status(400).json({ success: false, message: `Store credit is ${credit.status.toLowerCase()}` });
    if (credit.expiresAt && credit.expiresAt.getTime() < Date.now()) return res.status(400).json({ success: false, message: 'Store credit has expired' });
    // Single balance → the FIFO planner yields exactly one allocation. Shared
    // with checkout (orders.ts) so stored-value math has one tested source.
    const plan = planStoreCreditDeduction([{ id: credit.id, balance: Number(credit.balance) }], amount);
    if (!plan.ok) return res.status(400).json({ success: false, message: 'Insufficient store credit balance' });
    const alloc = plan.allocations[0];

    const updated = await prisma.storeCredit.update({
      where: { id: credit.id },
      data: { balance: alloc.newBalance, lastUsedAt: new Date(), status: alloc.status },
      include: { customer: true },
    });

    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: 'STORE_CREDIT_REDEEMED',
      resourceType: 'STORE_CREDIT',
      resourceId: credit.id,
      newValue: { amount, newBalance: alloc.newBalance },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// ═══════════════════════════════════════════════════════════════
// LAYAWAY (§18)
// ═══════════════════════════════════════════════════════════════

// GET /api/retail/layaways
router.get('/layaways', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { status, customerId } = req.query;
    const where: any = { organizationId: req.user!.organizationId! };
    if (status) where.status = String(status);
    if (customerId) where.customerId = String(customerId);

    const layaways = await prisma.layaway.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: layaways });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/retail/layaways - Create layaway
router.post('/layaways', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { customerId, items, depositAmount, dueDate, notes } = z.object({
      customerId: z.string(),
      items: z.array(z.object({
        productId: z.string(),
        name: z.string(),
        quantity: z.number().int().positive(),
        price: z.number(),
      })),
      depositAmount: z.number().min(0),
      dueDate: z.string(),
      notes: z.string().optional(),
    }).parse(req.body);

    const totalAmount = round2(items.reduce((sum, i) => sum + i.price * i.quantity, 0));
    const orderCount = await prisma.layaway.count({ where: { organizationId: req.user!.organizationId! } });
    const orderNumber = `LAY-${Date.now()}-${orderCount + 1}`;

    const layaway = await prisma.layaway.create({
      data: {
        organizationId: req.user!.organizationId!,
        customerId,
        orderNumber,
        totalAmount,
        depositAmount,
        paidAmount: depositAmount,
        items,
        dueDate: new Date(dueDate),
        notes,
        status: 'ACTIVE',
      },
    });

    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: 'LAYAWAY_CREATED',
      resourceType: 'LAYAWAY',
      resourceId: layaway.id,
      newValue: { orderNumber, totalAmount, customerId },
    });

    res.status(201).json({ success: true, data: layaway });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/retail/layaways/:id/pay - Make payment on layaway
router.put('/layaways/:id/pay', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { amount } = z.object({ amount: z.number().positive() }).parse(req.body);
    const layaway = await prisma.layaway.findUnique({ where: { id: String(req.params.id) } });
    if (!layaway) return res.status(404).json({ success: false, message: 'Layaway not found' });
    if (layaway.status !== 'ACTIVE') return res.status(400).json({ success: false, message: 'Layaway is not active' });

    const newPaid = Number(layaway.paidAmount) + amount;
    const isComplete = newPaid >= Number(layaway.totalAmount);

    const updated = await prisma.layaway.update({
      where: { id: layaway.id },
      data: {
        paidAmount: newPaid,
        status: isComplete ? 'COMPLETED' : 'ACTIVE',
        completedAt: isComplete ? new Date() : undefined,
      },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/retail/layaways/:id/cancel - Cancel layaway
router.put('/layaways/:id/cancel', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const { cancellationFee } = z.object({ cancellationFee: z.number().min(0).optional() }).parse(req.body);
    const layaway = await prisma.layaway.findUnique({ where: { id: String(req.params.id) } });
    if (!layaway) return res.status(404).json({ success: false, message: 'Layaway not found' });

    const updated = await prisma.layaway.update({
      where: { id: layaway.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationFee: cancellationFee || 0,
      },
    });

    // Issue store credit for paid amount minus cancellation fee
    const refundAmount = Number(layaway.paidAmount) - (cancellationFee || 0);
    if (refundAmount > 0 && layaway.customerId) {
      await prisma.storeCredit.create({
        data: {
          organizationId: req.user!.organizationId!,
          customerId: layaway.customerId,
          balance: refundAmount,
          originalAmount: refundAmount,
          reason: 'LAYAWAY_CANCELLATION',
          referenceType: 'LAYAWAY',
          referenceId: layaway.id,
          status: 'ACTIVE',
        },
      });
    }

    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: 'LAYAWAY_CANCELLED',
      resourceType: 'LAYAWAY',
      resourceId: layaway.id,
      newValue: { cancellationFee, refundAmount },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// ═══════════════════════════════════════════════════════════════
// PURCHASE ORDERS (§18)
// ═══════════════════════════════════════════════════════════════

// GET /api/retail/purchase-orders
router.get('/purchase-orders', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query;
    const where: any = { organizationId: req.user!.organizationId! };
    if (status) where.status = String(status);

    const orders = await prisma.purchaseOrder.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: orders });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/retail/purchase-orders - Create purchase order
router.post('/purchase-orders', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const { supplierId, items, expectedDate, notes } = z.object({
      supplierId: z.string(),
      items: z.array(z.object({
        productId: z.string(),
        quantity: z.number().int().positive(),
        unitCost: z.number(),
      })),
      expectedDate: z.string().optional(),
      notes: z.string().optional(),
    }).parse(req.body);

    const totalAmount = round2(items.reduce((sum, i) => sum + i.unitCost * i.quantity, 0));

    const po = await prisma.purchaseOrder.create({
      data: {
        organizationId: req.user!.organizationId!,
        supplierId,
        items: { create: items },
        totalAmount,
        expectedDate: expectedDate ? new Date(expectedDate) : null,
        notes,
        status: 'DRAFT',
      },
      include: { items: true },
    });

    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: 'PURCHASE_ORDER_CREATED',
      resourceType: 'PURCHASE_ORDER',
      resourceId: po.id,
      newValue: { supplierId, totalAmount },
    });

    res.status(201).json({ success: true, data: po });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/retail/purchase-orders/:id/receive - Receive purchase order
router.put('/purchase-orders/:id/receive', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: String(req.params.id) },
      include: { items: true },
    });
    if (!po) return res.status(404).json({ success: false, message: 'Purchase order not found' });

    // Get default location
    const location = await prisma.location.findFirst({
      where: { organizationId: req.user!.organizationId! },
    });
    if (!location) return res.status(400).json({ success: false, message: 'No location configured' });

    // Update inventory for each item
    for (const item of po.items) {
      const balance = await prisma.inventoryBalance.findUnique({
        where: { productId_locationId: { productId: item.productId, locationId: location.id } },
      });

      if (balance) {
        await prisma.inventoryBalance.update({
          where: { id: balance.id },
          data: { quantity: { increment: item.quantity } },
        });
      } else {
        await prisma.inventoryBalance.create({
          data: {
            productId: item.productId,
            locationId: location.id,
            quantity: item.quantity,
          },
        });
      }

      // Create movement record
      const bal = await prisma.inventoryBalance.findUnique({
        where: { productId_locationId: { productId: item.productId, locationId: location.id } },
      });
      if (bal) {
        await prisma.inventoryMovement.create({
          data: {
            balanceId: bal.id,
            type: 'PURCHASE',
            quantity: item.quantity,
            reference: po.id,
            performedBy: req.user!.employeeId,
          },
        });
      }
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { status: 'RECEIVED', receivedDate: new Date() },
      include: { items: true },
    });

    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: 'PURCHASE_ORDER_RECEIVED',
      resourceType: 'PURCHASE_ORDER',
      resourceId: po.id,
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/retail/purchase-orders/:id/send - Mark PO as sent to supplier
router.put('/purchase-orders/:id/send', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const updated = await prisma.purchaseOrder.update({
      where: { id: String(req.params.id) },
      data: { status: 'SENT' },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// ═══════════════════════════════════════════════════════════════
// EXCHANGES (§18)
// ═══════════════════════════════════════════════════════════════

// POST /api/retail/exchanges - Process exchange
router.post('/exchanges', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { orderId, returnItems, exchangeItems, reason } = z.object({
      orderId: z.string(),
      returnItems: z.array(z.object({
        productId: z.string(),
        quantity: z.number().int().positive(),
      })),
      exchangeItems: z.array(z.object({
        productId: z.string(),
        quantity: z.number().int().positive(),
      })),
      reason: z.string().optional(),
    }).parse(req.body);

    const orgId = req.user!.organizationId!;
    const location = await prisma.location.findFirst({ where: { organizationId: orgId } });
    if (!location) return res.status(400).json({ success: false, message: 'No location configured' });

    // Restore returned items to inventory
    for (const item of returnItems) {
      const balance = await prisma.inventoryBalance.findUnique({
        where: { productId_locationId: { productId: item.productId, locationId: location.id } },
      });
      if (balance) {
        await prisma.inventoryBalance.update({
          where: { id: balance.id },
          data: { quantity: { increment: item.quantity } },
        });
        await prisma.inventoryMovement.create({
          data: {
            balanceId: balance.id,
            type: 'RETURN',
            quantity: item.quantity,
            reference: orderId,
            performedBy: req.user!.employeeId,
          },
        });
      }
    }

    // Deduct exchange items from inventory
    for (const item of exchangeItems) {
      const balance = await prisma.inventoryBalance.findUnique({
        where: { productId_locationId: { productId: item.productId, locationId: location.id } },
      });
      if (balance) {
        await prisma.inventoryBalance.update({
          where: { id: balance.id },
          data: { quantity: { decrement: item.quantity } },
        });
        await prisma.inventoryMovement.create({
          data: {
            balanceId: balance.id,
            type: 'SALE',
            quantity: -item.quantity,
            reference: orderId,
            performedBy: req.user!.employeeId,
          },
        });
      }
    }

    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: 'EXCHANGE_PROCESSED',
      resourceType: 'ORDER',
      resourceId: orderId,
      newValue: { returnItems, exchangeItems, reason },
    });

    res.json({ success: true, data: { message: 'Exchange processed', orderId } });
  } catch (error) {
    handleError(error, res);
  }
});

// ═══════════════════════════════════════════════════════════════
// SUSPENDED CARTS (§6)
// ═══════════════════════════════════════════════════════════════

// GET /api/retail/suspended-carts
router.get('/suspended-carts', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const carts = await prisma.suspendedCart.findMany({
      where: { organizationId: req.user!.organizationId! },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: carts });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/retail/suspended-carts - Suspend a cart
router.post('/suspended-carts', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { reference, items, totalAmount, notes } = z.object({
      reference: z.string(),
      items: z.any(),
      totalAmount: z.number().min(0),
      notes: z.string().optional(),
    }).parse(req.body);

    const cart = await prisma.suspendedCart.create({
      data: {
        organizationId: req.user!.organizationId!,
        employeeId: req.user!.employeeId,
        reference,
        items,
        totalAmount,
        notes,
      },
    });
    res.status(201).json({ success: true, data: cart });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/retail/suspended-carts/:id - Resume and remove suspended cart
router.delete('/suspended-carts/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const cart = await prisma.suspendedCart.delete({
      where: { id: String(req.params.id) },
    });
    res.json({ success: true, data: cart });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
