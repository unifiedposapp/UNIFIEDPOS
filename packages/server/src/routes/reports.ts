import { Router, Response } from 'express';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';

const router = Router();

// GET /api/reports/today - Today's snapshot
router.get('/today', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const lastWeekStart = new Date(todayStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);

    const [todayOrders, yesterdayOrders, lastWeekOrders, todayCustomers, refunds, lowStock] = await Promise.all([
      prisma.order.findMany({
        where: { organizationId: orgId, status: { in: ['PAID', 'COMPLETED'] }, createdAt: { gte: todayStart } },
        include: { items: true, payments: true },
      }),
      prisma.order.findMany({
        where: { organizationId: orgId, status: { in: ['PAID', 'COMPLETED'] }, createdAt: { gte: yesterdayStart, lt: todayStart } },
        select: { totalAmount: true },
      }),
      prisma.order.findMany({
        where: { organizationId: orgId, status: { in: ['PAID', 'COMPLETED'] }, createdAt: { gte: lastWeekStart, lt: todayStart } },
        select: { totalAmount: true },
      }),
      prisma.order.count({
        where: { organizationId: orgId, status: { in: ['PAID', 'COMPLETED'] }, createdAt: { gte: todayStart }, customerId: { not: null } },
      }),
      prisma.refund.count({ where: { organizationId: orgId, createdAt: { gte: todayStart } } }),
      prisma.inventoryBalance.findMany({
        where: { product: { organizationId: orgId } },
        include: { product: { select: { name: true } } },
      }),
    ]);

    const totalRevenue = todayOrders.reduce((s, o) => s + Number(o.totalAmount), 0);
    const totalTax = todayOrders.reduce((s, o) => s + Number(o.taxAmount), 0);
    const totalDiscount = todayOrders.reduce((s, o) => s + Number(o.discountAmount), 0);
    const avgTicket = todayOrders.length > 0 ? totalRevenue / todayOrders.length : 0;
    const yesterdayRevenue = yesterdayOrders.reduce((s, o) => s + Number(o.totalAmount), 0);
    const lastWeekRevenue = lastWeekOrders.reduce((s, o) => s + Number(o.totalAmount), 0);

    // Gross margin calculation
    let totalCost = 0;
    for (const order of todayOrders) {
      for (const item of order.items) {
        const product = await prisma.product.findUnique({ where: { id: item.productId }, select: { costPrice: true } });
        if (product) totalCost += Number(product.costPrice) * item.quantity;
      }
    }
    const grossMargin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0;

    const riskItems = lowStock.filter(b => b.quantity <= b.reorderPoint);

    res.json({
      success: true,
      data: {
        sales: totalRevenue,
        orders: todayOrders.length,
        averageTicket: avgTicket,
        grossMargin: Math.round(grossMargin * 100) / 100,
        customers: todayCustomers,
        returns: refunds,
        tax: totalTax,
        discounts: totalDiscount,
        vsYesterday: { revenue: yesterdayRevenue, change: yesterdayRevenue > 0 ? ((totalRevenue - yesterdayRevenue) / yesterdayRevenue) * 100 : 0 },
        vsLastWeek: { revenue: lastWeekRevenue, change: lastWeekRevenue > 0 ? ((totalRevenue - lastWeekRevenue) / lastWeekRevenue) * 100 : 0 },
        inventoryRisk: riskItems.length,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/reports/sales
router.get('/sales', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const where: any = { organizationId: req.user!.organizationId, status: { in: ['COMPLETED', 'PAID'] } };
    if (startDate || endDate) { where.createdAt = {}; if (startDate) where.createdAt.gte = new Date(String(startDate)); if (endDate) where.createdAt.lte = new Date(String(endDate)); }

    const orders = await prisma.order.findMany({ where, include: { items: true, payments: true }, orderBy: { createdAt: 'desc' } });

    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((s, o) => s + Number(o.totalAmount), 0);
    const totalTax = orders.reduce((s, o) => s + Number(o.taxAmount), 0);
    const totalDiscount = orders.reduce((s, o) => s + Number(o.discountAmount), 0);
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const productSales = new Map<string, { qty: number; rev: number; name: string }>();
    for (const order of orders) {
      for (const item of order.items) {
        const e = productSales.get(item.productId) || { qty: 0, rev: 0, name: item.productName };
        e.qty += item.quantity; e.rev += Number(item.totalAmount);
        productSales.set(item.productId, e);
      }
    }
    const topProducts = Array.from(productSales.entries()).map(([id, d]) => ({ productId: id, productName: d.name, quantitySold: d.qty, revenue: d.rev })).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

    const paymentBreakdown = new Map<string, { count: number; total: number }>();
    for (const order of orders) {
      for (const p of order.payments) {
        const e = paymentBreakdown.get(p.method) || { count: 0, total: 0 };
        e.count++; e.total += Number(p.amount);
        paymentBreakdown.set(p.method, e);
      }
    }

    res.json({ success: true, data: { totalOrders, totalRevenue, totalTax, totalDiscount, averageOrderValue, topProducts, paymentBreakdown: Array.from(paymentBreakdown.entries()).map(([m, d]) => ({ method: m, count: d.count, total: d.total })) } });
  } catch (error) { handleError(error, res); }
});

// GET /api/reports/daily
router.get('/daily', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { days = '30' } = req.query;
    const since = new Date(); since.setDate(since.getDate() - Number(days));
    const orders = await prisma.order.findMany({ where: { organizationId: req.user!.organizationId, status: { in: ['COMPLETED', 'PAID'] }, createdAt: { gte: since } }, select: { createdAt: true, totalAmount: true, taxAmount: true } });

    const dailyMap = new Map<string, { orders: number; revenue: number; tax: number }>();
    for (const o of orders) {
      const d = o.createdAt.toISOString().slice(0, 10);
      const e = dailyMap.get(d) || { orders: 0, revenue: 0, tax: 0 };
      e.orders++; e.revenue += Number(o.totalAmount); e.tax += Number(o.taxAmount);
      dailyMap.set(d, e);
    }
    res.json({ success: true, data: Array.from(dailyMap.entries()).map(([date, d]) => ({ date, totalOrders: d.orders, totalRevenue: d.revenue, totalTax: d.tax })).sort((a, b) => a.date.localeCompare(b.date)) });
  } catch (error) { handleError(error, res); }
});

// GET /api/reports/drilldown - Drill-down hierarchy
router.get('/drilldown', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { level, id } = req.query; // level: company, location, register, employee, product

    const baseWhere = { organizationId: orgId, status: { in: ['PAID', 'COMPLETED'] } };

    if (level === 'location' && id) {
      const orders = await prisma.order.findMany({
        where: { ...baseWhere, locationId: String(id) },
        include: { items: true, payments: true, employee: { include: { user: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
      });
      const total = orders.reduce((s, o) => s + Number(o.totalAmount), 0);
      res.json({ success: true, data: { level: 'location', orderCount: orders.length, revenue: total, orders: orders.slice(0, 50) } });
      return;
    }

    if (level === 'register' && id) {
      const orders = await prisma.order.findMany({
        where: { ...baseWhere, registerId: String(id) },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
      });
      const total = orders.reduce((s, o) => s + Number(o.totalAmount), 0);
      res.json({ success: true, data: { level: 'register', orderCount: orders.length, revenue: total, orders: orders.slice(0, 50) } });
      return;
    }

    if (level === 'employee' && id) {
      const orders = await prisma.order.findMany({
        where: { ...baseWhere, employeeId: String(id) },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
      });
      const total = orders.reduce((s, o) => s + Number(o.totalAmount), 0);
      res.json({ success: true, data: { level: 'employee', orderCount: orders.length, revenue: total, orders: orders.slice(0, 50) } });
      return;
    }

    if (level === 'product' && id) {
      const orders = await prisma.order.findMany({
        where: { ...baseWhere, items: { some: { productId: String(id) } } },
        include: { items: { where: { productId: String(id) } } },
        orderBy: { createdAt: 'desc' },
      });
      const totalQty = orders.reduce((s, o) => s + o.items.reduce((is, i) => is + i.quantity, 0), 0);
      const totalRev = orders.reduce((s, o) => s + o.items.reduce((is, i) => is + Number(i.totalAmount), 0), 0);
      res.json({ success: true, data: { level: 'product', totalSold: totalQty, revenue: totalRev, orderCount: orders.length } });
      return;
    }

    // Default: company-wide summary by location
    const locations = await prisma.location.findMany({ where: { organizationId: orgId, isActive: true } });
    const locationStats = [];
    for (const loc of locations) {
      const orders = await prisma.order.findMany({ where: { ...baseWhere, locationId: loc.id } });
      const revenue = orders.reduce((s, o) => s + Number(o.totalAmount), 0);
      locationStats.push({ locationId: loc.id, name: loc.name, orders: orders.length, revenue });
    }

    res.json({ success: true, data: { level: 'company', locations: locationStats } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/reports/labor - Labor report
router.get('/labor', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { startDate, endDate } = req.query;

    const timeWhere: any = { employee: { organizationId: orgId } };
    if (startDate || endDate) {
      timeWhere.clockIn = {};
      if (startDate) timeWhere.clockIn.gte = new Date(String(startDate));
      if (endDate) timeWhere.clockIn.lte = new Date(String(endDate));
    }

    const timeEntries = await prisma.timeEntry.findMany({
      where: timeWhere,
      include: { employee: { include: { user: { select: { name: true } } } } },
      orderBy: { clockIn: 'desc' },
    });

    let totalHours = 0;
    let totalCost = 0;
    const byEmployee = new Map<string, { name: string; hours: number; cost: number; entries: number }>();

    for (const entry of timeEntries) {
      const hours = entry.clockOut
        ? (new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime()) / (1000 * 60 * 60)
        : (Date.now() - new Date(entry.clockIn).getTime()) / (1000 * 60 * 60);
      const rate = Number(entry.employee.hourlyRate || 0);
      const cost = hours * rate;
      totalHours += hours;
      totalCost += cost;

      const empId = entry.employeeId;
      const existing = byEmployee.get(empId) || { name: entry.employee.user.name, hours: 0, cost: 0, entries: 0 };
      existing.hours += hours;
      existing.cost += cost;
      existing.entries++;
      byEmployee.set(empId, existing);
    }

    res.json({
      success: true,
      data: {
        totalHours: Math.round(totalHours * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
        employeeCount: byEmployee.size,
        byEmployee: Array.from(byEmployee.entries()).map(([id, d]) => ({
          employeeId: id,
          name: d.name,
          hours: Math.round(d.hours * 100) / 100,
          cost: Math.round(d.cost * 100) / 100,
          shifts: d.entries,
        })),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/reports/inventory - Inventory valuation report
router.get('/inventory', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const balances = await prisma.inventoryBalance.findMany({
      where: { product: { organizationId: orgId } },
      include: { product: { select: { name: true, costPrice: true, price: true, sku: true } } },
    });

    let totalQuantity = 0;
    let totalValueAtCost = 0;
    let totalValueAtRetail = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    const items = balances.map(b => {
      const costValue = Number(b.product.costPrice) * b.quantity;
      const retailValue = Number(b.product.price) * b.quantity;
      totalQuantity += b.quantity;
      totalValueAtCost += costValue;
      totalValueAtRetail += retailValue;
      if (b.quantity <= b.reorderPoint) lowStockCount++;
      if (b.quantity === 0) outOfStockCount++;

      return {
        productId: b.productId,
        sku: b.product.sku,
        productName: b.product.name,
        quantity: b.quantity,
        costPrice: Number(b.product.costPrice),
        retailPrice: Number(b.product.price),
        costValue: Math.round(costValue * 100) / 100,
        retailValue: Math.round(retailValue * 100) / 100,
        reorderPoint: b.reorderPoint,
        status: b.quantity === 0 ? 'OUT_OF_STOCK' : b.quantity <= b.reorderPoint ? 'LOW_STOCK' : 'OK',
      };
    });

    res.json({
      success: true,
      data: {
        summary: {
          totalItems: items.length,
          totalQuantity,
          totalValueAtCost: Math.round(totalValueAtCost * 100) / 100,
          totalValueAtRetail: Math.round(totalValueAtRetail * 100) / 100,
          potentialMargin: Math.round((totalValueAtRetail - totalValueAtCost) * 100) / 100,
          lowStockCount,
          outOfStockCount,
        },
        items,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
