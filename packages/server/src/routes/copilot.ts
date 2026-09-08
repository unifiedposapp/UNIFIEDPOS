import { Router, Response } from 'express';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';

const router = Router();

// POST /api/copilot/ask - Natural language business question
router.post('/ask', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { question } = req.body;
    const orgId = req.user!.organizationId!;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ success: false, message: 'Question is required' });
    }

    const q = question.toLowerCase();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const weekAgo = new Date(todayStart); weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(todayStart); monthAgo.setDate(monthAgo.getDate() - 30);

    // Pattern matching for common business questions
    let answer = '';
    let metrics: any = {};
    let recommendation = '';
    let action: any = null;

    if (q.includes('yesterday') || q.includes('how did we do')) {
      const orders = await prisma.order.findMany({
        where: { organizationId: orgId, status: { in: ['PAID', 'COMPLETED'] }, createdAt: { gte: yesterdayStart, lt: todayStart } },
      });
      const revenue = orders.reduce((s, o) => s + Number(o.totalAmount), 0);
      const avgTicket = orders.length > 0 ? revenue / orders.length : 0;
      metrics = { orders: orders.length, revenue: Math.round(revenue * 100) / 100, averageTicket: Math.round(avgTicket * 100) / 100 };
      answer = `Yesterday you had ${orders.length} orders totaling $${metrics.revenue} with an average ticket of $${metrics.averageTicket}.`;
      recommendation = orders.length < 10 ? 'Consider running a promotion to drive more traffic.' : 'Strong performance. Focus on customer retention.';
    } else if (q.includes('best sell') || q.includes('top product') || q.includes('best-selling')) {
      const orders = await prisma.order.findMany({
        where: { organizationId: orgId, status: { in: ['PAID', 'COMPLETED'] } },
        include: { items: true },
      });
      const productMap = new Map<string, { name: string; qty: number; revenue: number }>();
      for (const order of orders) {
        for (const item of order.items) {
          const e = productMap.get(item.productId) || { name: item.productName, qty: 0, revenue: 0 };
          e.qty += item.quantity; e.revenue += Number(item.totalAmount);
          productMap.set(item.productId, e);
        }
      }
      const topProducts = Array.from(productMap.entries())
        .map(([id, d]) => ({ productId: id, ...d }))
        .sort((a, b) => b.qty - a.qty).slice(0, 5);
      metrics = { topProducts };
      answer = `Your top-selling products are: ${topProducts.map(p => `${p.name} (${p.qty} sold, $${Math.round(p.revenue * 100) / 100})`).join(', ')}.`;
      recommendation = topProducts.length > 0 ? `Consider promoting ${topProducts[0].name} more aggressively or ensuring adequate stock.` : '';
    } else if (q.includes('underperform') || q.includes('location')) {
      const locations = await prisma.location.findMany({ where: { organizationId: orgId, isActive: true } });
      const locationStats = [];
      for (const loc of locations) {
        const orders = await prisma.order.findMany({
          where: { organizationId: orgId, locationId: loc.id, status: { in: ['PAID', 'COMPLETED'] }, createdAt: { gte: monthAgo } },
        });
        const revenue = orders.reduce((s, o) => s + Number(o.totalAmount), 0);
        locationStats.push({ name: loc.name, orders: orders.length, revenue: Math.round(revenue * 100) / 100 });
      }
      locationStats.sort((a, b) => a.revenue - b.revenue);
      metrics = { locations: locationStats };
      answer = `Location performance (last 30 days): ${locationStats.map(l => `${l.name}: ${l.orders} orders, $${l.revenue}`).join('; ')}.`;
      recommendation = locationStats.length > 1 ? `${locationStats[0].name} is underperforming. Consider investigating staffing, inventory, or local marketing.` : '';
    } else if (q.includes('reorder') || q.includes('reorder') || q.includes('low stock') || q.includes('stock')) {
      const balances = await prisma.inventoryBalance.findMany({
        where: { product: { organizationId: orgId } },
        include: { product: { select: { name: true, sku: true } } },
      });
      const lowItems = balances.filter(b => b.quantity <= b.reorderPoint).map(b => ({
        name: b.product.name, sku: b.product.sku, quantity: b.quantity, reorderPoint: b.reorderPoint,
        suggestedOrder: Math.max(0, b.reorderPoint * 2 - b.quantity),
      }));
      metrics = { itemsToReorder: lowItems.length, items: lowItems };
      answer = `You have ${lowItems.length} items at or below reorder point. ${lowItems.slice(0, 3).map(i => `${i.name} (${i.quantity} left, need ${i.suggestedOrder})`).join(', ')}.`;
      recommendation = lowItems.length > 0 ? 'Create purchase orders for these items to avoid stockouts.' : 'All inventory levels are healthy.';
      action = lowItems.length > 0 ? { type: 'CREATE_PURCHASE_ORDER', items: lowItems } : null;
    } else if (q.includes('customer') && (q.includes('haven') || q.includes('inactive') || q.includes('win-back'))) {
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 45);
      const dormant = await prisma.customer.findMany({
        where: { organizationId: orgId, isActive: true, lastVisitAt: { lt: cutoff } },
        orderBy: { totalSpent: 'desc' },
        take: 20,
      });
      metrics = { dormantCustomers: dormant.length, top: dormant.slice(0, 5).map(c => ({ name: c.name, lastSpent: Number(c.totalSpent), lastVisit: c.lastVisitAt })) };
      answer = `${dormant.length} customers haven't purchased in 45+ days. Top dormant customers by lifetime value: ${dormant.slice(0, 5).map(c => `${c.name} ($${Number(c.totalSpent)})`).join(', ')}.`;
      recommendation = dormant.length > 0 ? 'Send a win-back campaign to re-engage these customers.' : '';
      action = dormant.length > 0 ? { type: 'CREATE_CAMPAIGN', audience: 'DORMANT', count: dormant.length } : null;
    } else if (q.includes('margin') || q.includes('profit')) {
      const orders = await prisma.order.findMany({
        where: { organizationId: orgId, status: { in: ['PAID', 'COMPLETED'] }, createdAt: { gte: monthAgo } },
        include: { items: true },
      });
      let totalRevenue = 0;
      let totalCost = 0;
      for (const order of orders) {
        for (const item of order.items) {
          totalRevenue += Number(item.totalAmount);
          const product = await prisma.product.findUnique({ where: { id: item.productId }, select: { costPrice: true } });
          if (product) totalCost += Number(product.costPrice) * item.quantity;
        }
      }
      const margin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0;
      metrics = { revenue: Math.round(totalRevenue * 100) / 100, cost: Math.round(totalCost * 100) / 100, margin: Math.round(margin * 100) / 100 };
      answer = `Last 30 days: Revenue $${metrics.revenue}, COGS $${metrics.cost}, Gross Margin ${metrics.margin}%.`;
      recommendation = margin < 30 ? 'Margins are below 30%. Review pricing strategy and supplier costs.' : 'Margins look healthy.';
    } else if (q.includes('employee') && (q.includes('need') || q.includes('tomorrow') || q.includes('staff'))) {
      const dayOfWeek = new Date().getDay();
      const recentOrders = await prisma.order.findMany({
        where: { organizationId: orgId, status: { in: ['PAID', 'COMPLETED'] }, createdAt: { gte: weekAgo } },
      });
      const avgDailyOrders = recentOrders.length / 7;
      const ordersPerHour = avgDailyOrders / 10; // assume 10-hour day
      const neededCashiers = Math.ceil(ordersPerHour / 6); // 1 cashier handles ~6 orders/hour
      metrics = { avgDailyOrders: Math.round(avgDailyOrders), ordersPerHour: Math.round(ordersPerHour * 10) / 10, neededCashiers };
      answer = `Based on recent trends, you average ${Math.round(avgDailyOrders)} orders/day. Recommend ${neededCashiers} cashier(s) for tomorrow.`;
      recommendation = dayOfWeek === 5 || dayOfWeek === 6 ? 'Weekend traffic is typically higher. Consider adding 1 more staff member.' : '';
    } else if (q.includes('promote') || q.includes('promotion') || q.includes('this week')) {
      const orders = await prisma.order.findMany({
        where: { organizationId: orgId, status: { in: ['PAID', 'COMPLETED'] }, createdAt: { gte: monthAgo } },
        include: { items: true },
      });
      const productMap = new Map<string, { name: string; qty: number; revenue: number }>();
      for (const order of orders) {
        for (const item of order.items) {
          const e = productMap.get(item.productId) || { name: item.productName, qty: 0, revenue: 0 };
          e.qty += item.quantity; e.revenue += Number(item.totalAmount);
          productMap.set(item.productId, e);
        }
      }
      const highStock = await prisma.inventoryBalance.findMany({
        where: { product: { organizationId: orgId } },
        include: { product: { select: { name: true } } },
      });
      const overstocked = highStock.filter(b => b.quantity > b.reorderPoint * 3).map(b => ({ name: b.product.name, quantity: b.quantity }));
      metrics = { overstockedItems: overstocked.length, items: overstocked };
      answer = `You have ${overstocked.length} items with high inventory. ${overstocked.slice(0, 3).map(i => `${i.name} (${i.quantity} units)`).join(', ')}.`;
      recommendation = overstocked.length > 0 ? 'Consider promoting these overstocked items to reduce inventory costs.' : 'Inventory levels are balanced.';
    } else {
      // Default: provide a summary
      const [orderCount, revenue, customerCount] = await Promise.all([
        prisma.order.count({ where: { organizationId: orgId, status: { in: ['PAID', 'COMPLETED'] }, createdAt: { gte: weekAgo } } }),
        prisma.order.aggregate({ where: { organizationId: orgId, status: { in: ['PAID', 'COMPLETED'] }, createdAt: { gte: weekAgo } }, _sum: { totalAmount: true } }),
        prisma.customer.count({ where: { organizationId: orgId, isActive: true } }),
      ]);
      const weekRevenue = Number(revenue._sum.totalAmount || 0);
      answer = `This week: ${orderCount} orders, $${Math.round(weekRevenue * 100) / 100} revenue, ${customerCount} total customers.`;
      recommendation = 'Try asking: "How did we do yesterday?", "What should I reorder?", or "Which customers haven\'t purchased recently?"';
      metrics = { weekOrders: orderCount, weekRevenue: Math.round(weekRevenue * 100) / 100, totalCustomers: customerCount };
    }

    res.json({
      success: true,
      data: {
        question,
        answer,
        metrics,
        recommendation,
        action,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/copilot/forecast - Sales forecast
router.get('/forecast', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const orders = await prisma.order.findMany({
      where: { organizationId: orgId, status: { in: ['PAID', 'COMPLETED'] }, createdAt: { gte: thirtyDaysAgo } },
      select: { createdAt: true, totalAmount: true },
    });

    // Simple daily average forecast
    const dailyMap = new Map<string, number>();
    for (const o of orders) {
      const d = o.createdAt.toISOString().slice(0, 10);
      dailyMap.set(d, (dailyMap.get(d) || 0) + Number(o.totalAmount));
    }

    const dailyRevenues = Array.from(dailyMap.values());
    const avgDailyRevenue = dailyRevenues.length > 0 ? dailyRevenues.reduce((a, b) => a + b, 0) / dailyRevenues.length : 0;

    // Generate 7-day forecast
    const forecast = [];
    for (let i = 1; i <= 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      const dayOfWeek = date.getDay();
      // Weekend adjustment
      const multiplier = (dayOfWeek === 0 || dayOfWeek === 6) ? 1.2 : 1.0;
      forecast.push({
        date: date.toISOString().slice(0, 10),
        predictedRevenue: Math.round(avgDailyRevenue * multiplier * 100) / 100,
        confidence: 'MEDIUM',
      });
    }

    res.json({
      success: true,
      data: {
        historicalAvg: Math.round(avgDailyRevenue * 100) / 100,
        forecastDays: 7,
        forecast,
        totalPredicted: Math.round(forecast.reduce((s, f) => s + f.predictedRevenue, 0) * 100) / 100,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
