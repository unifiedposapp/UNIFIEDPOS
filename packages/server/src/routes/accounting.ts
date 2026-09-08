import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';

const router = Router();

// GET /api/accounting/entries
router.get('/entries', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { type, status, startDate, endDate, page = '1', pageSize = '50' } = req.query;
    const where: any = { organizationId: req.user!.organizationId! };

    if (type) where.type = String(type);
    if (status) where.status = String(status);
    if (startDate || endDate) {
      where.postedAt = {};
      if (startDate) where.postedAt.gte = new Date(String(startDate));
      if (endDate) where.postedAt.lte = new Date(String(endDate));
    }

    const [entries, total] = await Promise.all([
      prisma.accountingEntry.findMany({
        where,
        orderBy: { postedAt: 'desc' },
        skip: (Number(page) - 1) * Number(pageSize),
        take: Number(pageSize),
      }),
      prisma.accountingEntry.count({ where }),
    ]);

    res.json({ success: true, data: entries, meta: { total, page: Number(page), pageSize: Number(pageSize) } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/accounting/entries
router.post('/entries', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { type, referenceType, referenceId, amount, currency, description, status } = z.object({
      type: z.enum(['PAYMENT', 'REFUND', 'EXPENSE', 'ADJUSTMENT', 'TRANSFER']),
      referenceType: z.string().default('MANUAL'),
      referenceId: z.string().optional(),
      amount: z.number(),
      currency: z.string().default('USD'),
      description: z.string().optional(),
      status: z.enum(['DRAFT', 'POSTED']).default('POSTED'),
    }).parse(req.body);

    const entry = await prisma.accountingEntry.create({
      data: {
        organizationId: req.user!.organizationId!,
        type,
        referenceType,
        referenceId,
        amount,
        currency,
        description,
        status,
        postedAt: new Date(),
      },
    });
    res.status(201).json({ success: true, data: entry });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/accounting/entries/:id/reconcile
router.put('/:id/reconcile', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const entry = await prisma.accountingEntry.findUnique({ where: { id: String(req.params.id) } });
    if (!entry) return res.status(404).json({ success: false, message: 'Entry not found' });

    // §34: Immutable financial records - cannot modify RECONCILED entries
    if (entry.status === 'RECONCILED') {
      return res.status(403).json({
        success: false,
        message: 'Cannot modify reconciled entries. Create a corrective entry instead.',
      });
    }

    const updated = await prisma.accountingEntry.update({
      where: { id: String(req.params.id) },
      data: { status: 'RECONCILED', reconciledAt: new Date() },
    });

    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: 'ENTRY_RECONCILED',
      resourceType: 'ACCOUNTING_ENTRY',
      resourceId: entry.id,
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/accounting/entries/:id/void - Void an entry (§34 immutability)
router.post('/:id/void', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const entry = await prisma.accountingEntry.findUnique({ where: { id: String(req.params.id) } });
    if (!entry) return res.status(404).json({ success: false, message: 'Entry not found' });

    // §34: Cannot void RECONCILED entries directly - must create corrective event
    if (entry.status === 'RECONCILED') {
      return res.status(403).json({
        success: false,
        message: 'Cannot void reconciled entries. Create a corrective entry instead.',
      });
    }

    const voided = await prisma.accountingEntry.update({
      where: { id: entry.id },
      data: { status: 'VOIDED' },
    });

    // Create corrective entry
    const corrective = await prisma.accountingEntry.create({
      data: {
        organizationId: entry.organizationId,
        type: 'ADJUSTMENT',
        referenceType: 'CORRECTION',
        referenceId: entry.id,
        amount: -entry.amount,
        currency: entry.currency,
        description: `Corrective entry for voided ${entry.type} #${entry.id}`,
        status: 'POSTED',
        postedAt: new Date(),
      },
    });

    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: 'ENTRY_VOIDED',
      resourceType: 'ACCOUNTING_ENTRY',
      resourceId: entry.id,
      newValue: { correctiveEntryId: corrective.id },
    });

    res.json({ success: true, data: { voided, corrective } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/accounting/summary - Financial summary
router.get('/summary', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { startDate, endDate } = req.query;

    const where: any = { organizationId: orgId, status: { in: ['POSTED', 'RECONCILED'] } };
    if (startDate || endDate) {
      where.postedAt = {};
      if (startDate) where.postedAt.gte = new Date(String(startDate));
      if (endDate) where.postedAt.lte = new Date(String(endDate));
    }

    const entries = await prisma.accountingEntry.findMany({ where });

    const totalIncome = entries
      .filter(e => e.type === 'PAYMENT')
      .reduce((sum, e) => sum + Number(e.amount), 0);
    const totalRefunds = entries
      .filter(e => e.type === 'REFUND')
      .reduce((sum, e) => sum + Number(e.amount), 0);
    const totalExpenses = entries
      .filter(e => e.type === 'EXPENSE')
      .reduce((sum, e) => sum + Number(e.amount), 0);

    res.json({
      success: true,
      data: {
        totalIncome,
        totalRefunds,
        totalExpenses,
        netRevenue: totalIncome - totalRefunds - totalExpenses,
        entryCount: entries.length,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Daily Reconciliation (§31) ──────────────────────────────

// POST /api/accounting/reconcile/daily - Generate daily reconciliation
router.post('/reconcile/daily', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const { date } = z.object({ date: z.string() }).parse(req.body);
    const orgId = req.user!.organizationId!;

    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    // Calculate totals from orders
    const orders = await prisma.order.findMany({
      where: {
        organizationId: orgId,
        status: { in: ['PAID', 'COMPLETED'] },
        createdAt: { gte: dayStart, lt: dayEnd },
      },
      select: { totalAmount: true, payments: { select: { amount: true, method: true } } },
    });

    const totalSales = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
    const totalPayments = orders.reduce(
      (sum, o) => sum + o.payments.reduce((s, p) => s + Number(p.amount), 0), 0
    );

    // Calculate refunds
    const refunds = await prisma.refund.findMany({
      where: {
        organizationId: orgId,
        status: 'PROCESSED',
        createdAt: { gte: dayStart, lt: dayEnd },
      },
      select: { amount: true },
    });
    const totalRefunds = refunds.reduce((sum, r) => sum + Number(r.amount), 0);

    const expectedBalance = totalSales - totalRefunds;

    // Check for existing reconciliation
    const existing = await prisma.reconciliation.findUnique({
      where: { organizationId_date: { organizationId: orgId, date: dayStart } },
    });

    if (existing) {
      const updated = await prisma.reconciliation.update({
        where: { id: existing.id },
        data: {
          totalSales,
          totalPayments,
          totalRefunds,
          expectedBalance,
          status: 'PENDING',
        },
      });
      return res.json({ success: true, data: updated, message: 'Reconciliation updated' });
    }

    const reconciliation = await prisma.reconciliation.create({
      data: {
        organizationId: orgId,
        date: dayStart,
        totalSales,
        totalPayments,
        totalRefunds,
        expectedBalance,
        status: 'PENDING',
      },
    });

    res.status(201).json({ success: true, data: reconciliation });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/accounting/reconcile/:id/confirm - Confirm reconciliation with actual balance
router.put('/reconcile/:id/confirm', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const { actualBalance, notes } = z.object({
      actualBalance: z.number(),
      notes: z.string().optional(),
    }).parse(req.body);

    const recon = await prisma.reconciliation.findUnique({ where: { id: String(req.params.id) } });
    if (!recon) return res.status(404).json({ success: false, message: 'Reconciliation not found' });

    const variance = actualBalance - Number(recon.expectedBalance);
    const status = Math.abs(variance) < 0.01 ? 'RECONCILED' : 'DISCREPANCY';

    const updated = await prisma.reconciliation.update({
      where: { id: recon.id },
      data: {
        actualBalance,
        variance,
        status,
        reconciledBy: req.user!.employeeId,
        reconciledAt: new Date(),
        notes,
      },
    });

    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: 'RECONCILIATION_CONFIRMED',
      resourceType: 'RECONCILIATION',
      resourceId: recon.id,
      newValue: { actualBalance, variance, status },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/accounting/reconcile/history - Get reconciliation history
router.get('/reconcile/history', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate, status } = req.query;
    const where: any = { organizationId: req.user!.organizationId! };
    if (status) where.status = String(status);
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(String(startDate));
      if (endDate) where.date.lte = new Date(String(endDate));
    }

    const reconciliations = await prisma.reconciliation.findMany({
      where,
      orderBy: { date: 'desc' },
      take: 90,
    });
    res.json({ success: true, data: reconciliations });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Tax Reporting (§31) ─────────────────────────────────────

// GET /api/accounting/tax-report - Tax report for a period
router.get('/tax-report', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const orgId = req.user!.organizationId!;

    const where: any = { organizationId: orgId, status: { in: ['PAID', 'COMPLETED'] } };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(String(startDate));
      if (endDate) where.createdAt.lte = new Date(String(endDate));
    }

    const orders = await prisma.order.findMany({
      where,
      select: { subtotal: true, taxAmount: true, totalAmount: true, discounts: true },
    });

    const totalRevenue = orders.reduce((sum, o) => sum + Number(o.subtotal), 0);
    const totalTax = orders.reduce((sum, o) => sum + Number(o.taxAmount), 0);
    const totalDiscounts = orders.reduce(
      (sum, o) => sum + o.discounts.reduce((s, d) => s + Number(d.value), 0), 0
    );
    const totalGross = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);

    // Get org tax rate
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    const taxRate = Number(org?.taxRate || 0);

    res.json({
      success: true,
      data: {
        period: { startDate, endDate },
        totalRevenue,
        totalDiscounts,
        taxableRevenue: totalRevenue - totalDiscounts,
        taxRate,
        totalTaxCollected: totalTax,
        totalGross,
        orderCount: orders.length,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── COGS & Profit Margins (§31) ─────────────────────────────

// GET /api/accounting/cogs - Cost of Goods Sold report
router.get('/cogs', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const orgId = req.user!.organizationId!;

    const where: any = { organizationId: orgId, status: { in: ['PAID', 'COMPLETED'] } };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(String(startDate));
      if (endDate) where.createdAt.lte = new Date(String(endDate));
    }

    const orders = await prisma.order.findMany({
      where,
      include: { items: { include: { product: true } } },
    });

    let totalRevenue = 0;
    let totalCOGS = 0;
    const byProduct: Record<string, { name: string; revenue: number; cost: number; quantity: number }> = {};

    for (const order of orders) {
      for (const item of order.items) {
        const revenue = Number(item.totalAmount);
        const cost = Number(item.product.costPrice) * item.quantity;
        totalRevenue += revenue;
        totalCOGS += cost;

        if (!byProduct[item.productId]) {
          byProduct[item.productId] = { name: item.productName, revenue: 0, cost: 0, quantity: 0 };
        }
        byProduct[item.productId].revenue += revenue;
        byProduct[item.productId].cost += cost;
        byProduct[item.productId].quantity += item.quantity;
      }
    }

    const grossProfit = totalRevenue - totalCOGS;
    const marginPercent = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    const productBreakdown = Object.entries(byProduct).map(([id, data]) => ({
      productId: id,
      ...data,
      margin: data.revenue - data.cost,
      marginPercent: data.revenue > 0 ? ((data.revenue - data.cost) / data.revenue) * 100 : 0,
    })).sort((a, b) => b.margin - a.margin);

    res.json({
      success: true,
      data: {
        totalRevenue,
        totalCOGS,
        grossProfit,
        marginPercent,
        productBreakdown,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Expense Management (§31) ────────────────────────────────

// GET /api/accounting/expenses
router.get('/expenses', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { category, status, startDate, endDate } = req.query;
    const where: any = { organizationId: req.user!.organizationId! };
    if (category) where.category = String(category);
    if (status) where.status = String(status);
    if (startDate || endDate) {
      where.incurredAt = {};
      if (startDate) where.incurredAt.gte = new Date(String(startDate));
      if (endDate) where.incurredAt.lte = new Date(String(endDate));
    }

    const expenses = await prisma.expense.findMany({
      where,
      orderBy: { incurredAt: 'desc' },
    });

    const byCategory = expenses.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + Number(e.amount);
      return acc;
    }, {} as Record<string, number>);

    res.json({
      success: true,
      data: {
        items: expenses,
        total: expenses.reduce((sum, e) => sum + Number(e.amount), 0),
        byCategory,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/accounting/expenses
router.post('/expenses', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const { category, vendor, amount, description, receiptUrl, incurredAt } = z.object({
      category: z.enum(['RENT', 'UTILITIES', 'PAYROLL', 'SUPPLIES', 'MAINTENANCE', 'MARKETING', 'OTHER']),
      vendor: z.string().optional(),
      amount: z.number().positive(),
      description: z.string().optional(),
      receiptUrl: z.string().optional(),
      incurredAt: z.string().optional(),
    }).parse(req.body);

    const expense = await prisma.expense.create({
      data: {
        organizationId: req.user!.organizationId!,
        category,
        vendor,
        amount,
        description,
        receiptUrl,
        incurredAt: incurredAt ? new Date(incurredAt) : new Date(),
        status: 'PENDING',
      },
    });

    // Also create an accounting entry
    await prisma.accountingEntry.create({
      data: {
        organizationId: req.user!.organizationId!,
        type: 'EXPENSE',
        referenceType: 'EXPENSE',
        referenceId: expense.id,
        amount,
        description: `${category}: ${description || vendor || ''}`,
        status: 'POSTED',
        postedAt: new Date(),
      },
    });

    res.status(201).json({ success: true, data: expense });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/accounting/expenses/:id/approve
router.put('/expenses/:id/approve', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const expense = await prisma.expense.update({
      where: { id: String(req.params.id) },
      data: { status: 'APPROVED', approvedBy: req.user!.employeeId },
    });
    res.json({ success: true, data: expense });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Invoice Management (§31) ────────────────────────────────

// GET /api/accounting/invoices
router.get('/invoices', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { status, customerId } = req.query;
    const where: any = { organizationId: req.user!.organizationId! };
    if (status) where.status = String(status);
    if (customerId) where.customerId = String(customerId);

    const invoices = await prisma.invoice.findMany({
      where,
      include: { customer: true, order: true },
      orderBy: { createdAt: 'desc' },
    });

    // Calculate aging
    const now = new Date();
    const withAging = invoices.map(inv => {
      const daysOverdue = inv.dueDate && inv.status !== 'PAID' && inv.status !== 'CANCELLED'
        ? Math.max(0, Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000))
        : 0;
      return { ...inv, daysOverdue };
    });

    res.json({ success: true, data: withAging });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/accounting/invoices
router.post('/invoices', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const { customerId, orderId, amount, taxAmount, dueDate, notes } = z.object({
      customerId: z.string().optional(),
      orderId: z.string().optional(),
      amount: z.number().positive(),
      taxAmount: z.number().min(0).default(0),
      dueDate: z.string().optional(),
      notes: z.string().optional(),
    }).parse(req.body);

    const invCount = await prisma.invoice.count({ where: { organizationId: req.user!.organizationId! } });
    const invoiceNumber = `INV-${Date.now()}-${invCount + 1}`;

    const invoice = await prisma.invoice.create({
      data: {
        organizationId: req.user!.organizationId!,
        invoiceNumber,
        customerId,
        orderId,
        amount,
        taxAmount,
        totalAmount: amount + taxAmount,
        dueDate: dueDate ? new Date(dueDate) : null,
        notes,
        status: 'DRAFT',
      },
    });

    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/accounting/invoices/:id/status
router.put('/invoices/:id/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { status } = z.object({ status: z.enum(['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED']) }).parse(req.body);
    const data: any = { status };
    if (status === 'PAID') data.paidAt = new Date();

    const invoice = await prisma.invoice.update({
      where: { id: String(req.params.id) },
      data,
    });
    res.json({ success: true, data: invoice });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Profit & Loss Report (§31) ──────────────────────────────

// GET /api/accounting/pnl - Profit and Loss statement
router.get('/pnl', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const orgId = req.user!.organizationId!;

    const entryWhere: any = { organizationId: orgId, status: { in: ['POSTED', 'RECONCILED'] } };
    if (startDate || endDate) {
      entryWhere.postedAt = {};
      if (startDate) entryWhere.postedAt.gte = new Date(String(startDate));
      if (endDate) entryWhere.postedAt.lte = new Date(String(endDate));
    }

    const entries = await prisma.accountingEntry.findMany({ where: entryWhere });
    const expenses = await prisma.expense.findMany({
      where: {
        organizationId: orgId,
        status: { in: ['APPROVED', 'PAID'] },
        ...(startDate || endDate ? {
          incurredAt: {
            ...(startDate ? { gte: new Date(String(startDate)) } : {}),
            ...(endDate ? { lte: new Date(String(endDate)) } : {}),
          },
        } : {}),
      },
    });

    const revenue = entries
      .filter(e => e.type === 'PAYMENT')
      .reduce((sum, e) => sum + Number(e.amount), 0);
    const refunds = entries
      .filter(e => e.type === 'REFUND')
      .reduce((sum, e) => sum + Number(e.amount), 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

    // Get COGS
    const orderWhere: any = { organizationId: orgId, status: { in: ['PAID', 'COMPLETED'] } };
    if (startDate || endDate) {
      orderWhere.createdAt = {};
      if (startDate) orderWhere.createdAt.gte = new Date(String(startDate));
      if (endDate) orderWhere.createdAt.lte = new Date(String(endDate));
    }
    const orders = await prisma.order.findMany({
      where: orderWhere,
      include: { items: { include: { product: true } } },
    });
    const cogs = orders.reduce((sum, o) =>
      sum + o.items.reduce((s, i) => s + Number(i.product.costPrice) * i.quantity, 0), 0
    );

    const grossProfit = revenue - refunds - cogs;
    const netProfit = grossProfit - totalExpenses;

    res.json({
      success: true,
      data: {
        period: { startDate, endDate },
        revenue,
        refunds,
        cogs,
        grossProfit,
        grossMargin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
        expenses: totalExpenses,
        netProfit,
        netMargin: revenue > 0 ? (netProfit / revenue) * 100 : 0,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
