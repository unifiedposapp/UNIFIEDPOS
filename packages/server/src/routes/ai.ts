import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';

const router = Router();

// GET /api/ai/insights - Business intelligence insights
router.get('/insights', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;

    // Get key metrics
    const [
      totalOrders,
      todayOrders,
      totalRevenue,
      todayRevenue,
      topProducts,
      lowStockItems,
      customerCount,
      avgOrderValue,
    ] = await Promise.all([
      prisma.order.count({ where: { organizationId: orgId, status: { in: ['PAID', 'COMPLETED'] } } }),
      prisma.order.count({
        where: {
          organizationId: orgId,
          status: { in: ['PAID', 'COMPLETED'] },
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
      prisma.order.aggregate({
        where: { organizationId: orgId, status: { in: ['PAID', 'COMPLETED'] } },
        _sum: { totalAmount: true },
      }),
      prisma.order.aggregate({
        where: {
          organizationId: orgId,
          status: { in: ['PAID', 'COMPLETED'] },
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
        _sum: { totalAmount: true },
      }),
      prisma.orderItem.groupBy({
        by: ['productName'],
        where: { order: { organizationId: orgId, status: { in: ['PAID', 'COMPLETED'] } } },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      }),
      prisma.inventoryBalance.findMany({
        where: { product: { organizationId: orgId } },
        include: { product: { select: { name: true } } },
        take: 10,
      }),
      prisma.customer.count({ where: { organizationId: orgId } }),
      prisma.order.aggregate({
        where: { organizationId: orgId, status: { in: ['PAID', 'COMPLETED'] } },
        _avg: { totalAmount: true },
      }),
    ]);

    // Generate insights
    const insights = [];

    // Revenue insight
    if (Number(todayRevenue._sum?.totalAmount || 0) > 0) {
      insights.push({
        type: 'REVENUE',
        priority: 'HIGH',
        title: "Today's Revenue",
        message: `You've made $${Number(todayRevenue._sum.totalAmount).toFixed(2)} so far today from ${todayOrders} orders.`,
      });
    }

    // Low stock warning
    if (lowStockItems.length > 0) {
      insights.push({
        type: 'INVENTORY',
        priority: 'HIGH',
        title: 'Low Stock Alert',
        message: `${lowStockItems.length} items are at or below reorder point. Consider restocking: ${lowStockItems.map(i => i.product.name).join(', ')}.`,
      });
    }

    // Top product insight
    if (topProducts.length > 0) {
      insights.push({
        type: 'SALES',
        priority: 'MEDIUM',
        title: 'Best Seller',
        message: `"${topProducts[0].productName}" is your top seller with ${topProducts[0]._sum.quantity} units sold.`,
      });
    }

    // Customer growth
    if (customerCount > 0) {
      insights.push({
        type: 'CUSTOMER',
        priority: 'LOW',
        title: 'Customer Base',
        message: `You have ${customerCount} registered customers with an average order value of $${Number(avgOrderValue._avg?.totalAmount || 0).toFixed(2)}.`,
      });
    }

    // Overall performance
    insights.push({
      type: 'PERFORMANCE',
      priority: 'MEDIUM',
      title: 'Overall Performance',
      message: `Total revenue: $${Number(totalRevenue._sum?.totalAmount || 0).toFixed(2)} from ${totalOrders} orders. Average order: $${Number(avgOrderValue._avg?.totalAmount || 0).toFixed(2)}.`,
    });

    res.json({
      success: true,
      data: {
        metrics: {
          totalOrders,
          todayOrders,
          totalRevenue: Number(totalRevenue._sum?.totalAmount || 0),
          todayRevenue: Number(todayRevenue._sum?.totalAmount || 0),
          customerCount,
          avgOrderValue: Number(avgOrderValue._avg?.totalAmount || 0),
          lowStockCount: lowStockItems.length,
        },
        insights,
        topProducts: topProducts.map(p => ({ name: p.productName, quantity: p._sum.quantity })),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// ═══════════════════════════════════════════════════════════════
// AI-THAT-ACTS — actionable suggestions with one-click apply
//
// Suggestions are not merely advisory: each carries a concrete action. The
// reorder suggestion can be applied in one click to create a real DRAFT
// purchase order (POST /reorder/apply), closing the loop from insight to action.
// ═══════════════════════════════════════════════════════════════

interface ReorderItem {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  reorderPoint: number;
  suggestedOrder: number;
  unitCost: number;
}

// Items at or below their reorder point, with a suggested order quantity
// (top up to 2x the reorder point) and the product's cost price.
async function computeReorderItems(orgId: string): Promise<ReorderItem[]> {
  const balances = await prisma.inventoryBalance.findMany({
    where: { product: { organizationId: orgId } },
    include: { product: { select: { name: true, sku: true, costPrice: true } } },
  });
  return balances
    .filter((b) => b.quantity <= b.reorderPoint)
    .map((b) => ({
      productId: b.productId,
      name: b.product.name,
      sku: b.product.sku,
      quantity: b.quantity,
      reorderPoint: b.reorderPoint,
      suggestedOrder: Math.max(1, Math.ceil(b.reorderPoint * 2 - b.quantity)),
      unitCost: Number(b.product.costPrice || 0),
    }));
}

// GET /api/ai/suggestions - Actionable suggestions (reorder/staffing/win-back)
router.get('/suggestions', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const cutoff45 = new Date(); cutoff45.setDate(cutoff45.getDate() - 45);

    const reorderItems = await computeReorderItems(orgId);
    const [recentOrders, dormantCount] = await Promise.all([
      prisma.order.count({ where: { organizationId: orgId, status: { in: ['PAID', 'COMPLETED'] }, createdAt: { gte: weekAgo } } }),
      prisma.customer.count({ where: { organizationId: orgId, isActive: true, lastVisitAt: { lt: cutoff45 } } }),
    ]);

    const avgDailyOrders = recentOrders / 7;
    // ~6 orders/hour/cashier over a 10-hour day.
    const neededCashiers = Math.max(1, Math.ceil(avgDailyOrders / 10 / 6));
    const estReorderCost = reorderItems.reduce((s, i) => s + i.suggestedOrder * i.unitCost, 0);

    const suggestions: any[] = [];

    if (reorderItems.length > 0) {
      suggestions.push({
        id: 'reorder',
        type: 'REORDER',
        severity: 'HIGH',
        actionable: true,
        title: `Restock ${reorderItems.length} low-stock item${reorderItems.length === 1 ? '' : 's'}`,
        rationale: `${reorderItems.length} item(s) are at or below their reorder point.`,
        impact: { estCost: Math.round(estReorderCost * 100) / 100, itemCount: reorderItems.length },
        applyEndpoint: '/api/ai/reorder/apply',
        items: reorderItems,
      });
    }

    suggestions.push({
      id: 'staffing',
      type: 'STAFFING',
      severity: avgDailyOrders > 40 ? 'MEDIUM' : 'LOW',
      actionable: false,
      title: `Schedule ~${neededCashiers} cashier${neededCashiers === 1 ? '' : 's'} for tomorrow`,
      rationale: `You averaged ${Math.round(avgDailyOrders)} orders/day over the last 7 days.`,
      impact: { avgDailyOrders: Math.round(avgDailyOrders), neededCashiers },
    });

    if (dormantCount > 0) {
      suggestions.push({
        id: 'winback',
        type: 'WIN_BACK',
        severity: 'MEDIUM',
        actionable: false,
        title: `Win back ${dormantCount} dormant customer${dormantCount === 1 ? '' : 's'}`,
        rationale: `${dormantCount} active customer(s) haven't visited in 45+ days.`,
        impact: { dormantCustomers: dormantCount },
      });
    }

    res.json({ success: true, data: { suggestions, generatedAt: new Date().toISOString() } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/ai/reorder/apply - One-click apply: create a DRAFT purchase order
router.post('/reorder/apply', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const body = z.object({
      supplierId: z.string().optional(),
      items: z.array(z.object({
        productId: z.string(),
        quantity: z.number().int().positive(),
        unitCost: z.number().nonnegative().optional(),
      })).optional(),
      expectedDate: z.string().optional(),
      notes: z.string().optional(),
    }).parse(req.body || {});

    // Use caller-provided items, otherwise recompute the low-stock set server-side
    // so the action stays correct even if the client sends a stale suggestion.
    let items: { productId: string; quantity: number; unitCost?: number }[];
    if (body.items && body.items.length > 0) {
      items = body.items;
    } else {
      const suggested = await computeReorderItems(orgId);
      items = suggested.map((i) => ({ productId: i.productId, quantity: i.suggestedOrder, unitCost: i.unitCost }));
    }
    if (items.length === 0) {
      return res.status(400).json({ success: false, message: 'Nothing to reorder — all inventory is above its reorder point.' });
    }

    // Resolve a supplier: explicit id wins, else the org's first active supplier.
    let supplierId = body.supplierId;
    if (!supplierId) {
      const supplier = await prisma.supplier.findFirst({ where: { organizationId: orgId, isActive: true }, orderBy: { createdAt: 'asc' } });
      supplierId = supplier?.id;
    }
    if (!supplierId) {
      return res.status(400).json({ success: false, message: 'No supplier available. Add a supplier or pass supplierId to create the purchase order.' });
    }

    // Fill any missing unit costs from the product's cost price.
    const products = await prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId) } }, select: { id: true, costPrice: true } });
    const costMap = new Map(products.map((p) => [p.id, Number(p.costPrice || 0)]));
    const poItems = items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitCost: i.unitCost ?? costMap.get(i.productId) ?? 0 }));
    const totalAmount = poItems.reduce((s, i) => s + i.unitCost * i.quantity, 0);

    const po = await prisma.purchaseOrder.create({
      data: {
        organizationId: orgId,
        supplierId,
        items: { create: poItems },
        totalAmount,
        expectedDate: body.expectedDate ? new Date(body.expectedDate) : null,
        notes: body.notes || 'Auto-generated from AI reorder suggestion',
        status: 'DRAFT',
      },
      include: { items: true },
    });

    await createAuditEvent({
      organizationId: orgId,
      actorId: req.user!.employeeId,
      action: 'PURCHASE_ORDER_CREATED',
      resourceType: 'PURCHASE_ORDER',
      resourceId: po.id,
      newValue: { supplierId, totalAmount, source: 'AI_REORDER', itemCount: poItems.length },
    });

    res.status(201).json({ success: true, data: po });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
