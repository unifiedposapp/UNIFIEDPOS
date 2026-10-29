/**
 * Promotion engine surface (§19 depth).
 *
 * `routes/marketing.ts` owns promotion CRUD; this module owns the thing the
 * register actually needs at the till:
 *
 *   GET  /promotions/active  — which promotions may fire right now
 *   POST /promotions/plan    — dry-run the basket and get the discount
 *   POST /promotions/apply/:orderId — commit the plan onto a real order
 *
 * All of the arithmetic lives in `services/promotions.ts` (priority, stacking,
 * BOGO/mix-and-match, qty breaks, daypart, channel) so the answer the register
 * previews is byte-for-byte the answer it stores.
 *
 * Mounted after `marketingRoutes` on the same `/marketing` base: marketing owns
 * `/promotions/:id`, this owns `/promotions/active|plan|apply`. Express falls
 * through, and no path shape collides.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { round2 } from '../services/moneyMath.js';
import { isActive, planPromotions, type AppliedPromotion, type PromotionLike } from '../services/promotions.js';

const router = Router();

/** A Decimal/Json prisma row is not structurally a PromotionLike; coerce it. */
function toPromotionLike(row: {
  id: string;
  name: string;
  type: string;
  value: unknown;
  rule: unknown;
  minPurchase: unknown;
  maxDiscount: unknown;
  applicableProducts: string[];
  autoApply: boolean;
  priority: number;
  stackable: boolean;
  daysOfWeek: number[];
  startMinute: number | null;
  endMinute: number | null;
  channels: string[];
  startDate: Date;
  endDate: Date | null;
  isActive: boolean;
}): PromotionLike {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    value: Number(row.value),
    rule: (row.rule ?? null) as PromotionLike['rule'],
    minPurchase: row.minPurchase === null ? null : Number(row.minPurchase),
    maxDiscount: row.maxDiscount === null ? null : Number(row.maxDiscount),
    applicableProducts: row.applicableProducts ?? [],
    autoApply: row.autoApply,
    priority: row.priority,
    stackable: row.stackable,
    daysOfWeek: row.daysOfWeek ?? [],
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    channels: row.channels ?? [],
    startDate: row.startDate,
    endDate: row.endDate,
    isActive: row.isActive,
  };
}

async function loadLivePromotions(organizationId: string, now: Date, channel?: string): Promise<PromotionLike[]> {
  const rows = await prisma.promotion.findMany({
    where: { organizationId, isActive: true, autoApply: true },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    take: 200,
  });
  // Dates, weekday and daypart cannot be expressed in a single Prisma filter, so
  // the window test runs here against the same service the planner uses.
  return rows.map(toPromotionLike).filter((p) => isActive(p, { now, channel }));
}

const lineSchema = z.object({
  productId: z.string().min(1),
  /** Decimal quantity: a promotion must work on 0.375 kg as well as on 3 each. */
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  categoryId: z.string().nullable().optional(),
});

const planSchema = z.object({
  lines: z.array(lineSchema).min(1).max(500),
  channel: z.string().max(40).optional(),
  /** Evaluate "as if it were now" — used by the back office preview. */
  at: z.string().optional(),
  excludeIds: z.array(z.string().min(1)).max(50).optional(),
});

// GET /api/marketing/promotions/active?channel=IN_STORE
router.get('/promotions/active', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const now = new Date();
    const channel = req.query.channel ? String(req.query.channel).toUpperCase() : undefined;
    const live = await loadLivePromotions(organizationId, now, channel);
    res.json({
      success: true,
      data: live,
      meta: { evaluatedAt: now.toISOString(), channel: channel ?? 'ALL' },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/marketing/promotions/plan - dry run against a basket
router.post('/promotions/plan', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = planSchema.parse(req.body);

    const now = body.at ? new Date(body.at) : new Date();
    if (Number.isNaN(now.getTime())) {
      return res.status(400).json({ success: false, message: '`at` is not a valid date' });
    }

    // Fill in the category for any line the caller did not tag, so a
    // category-scoped promotion is not silently skipped.
    const untagged = body.lines.filter((l) => !l.categoryId).map((l) => l.productId);
    let categoryByProduct = new Map<string, string | null>();
    if (untagged.length > 0) {
      const products = await prisma.product.findMany({
        where: { organizationId, id: { in: [...new Set(untagged)] } },
        select: { id: true, categoryId: true },
      });
      categoryByProduct = new Map(products.map((p) => [p.id, p.categoryId]));
    }

    const lines = body.lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      categoryId: l.categoryId ?? categoryByProduct.get(l.productId) ?? null,
    }));

    const exclude = new Set(body.excludeIds ?? []);
    const live = (await loadLivePromotions(organizationId, now, body.channel)).filter((p) => !exclude.has(p.id));
    const plan = planPromotions(live, lines, { now, channel: body.channel });

    const basketTotal = round2(lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0));
    res.json({
      success: true,
      data: {
        applied: plan.applied,
        perLine: plan.perLine,
        totalDiscount: plan.totalDiscount,
        basketTotal,
        basketAfterDiscount: round2(Math.max(0, basketTotal - plan.totalDiscount)),
        evaluatedPromotions: live.length,
      },
      meta: { evaluatedAt: now.toISOString(), channel: body.channel ?? 'ALL' },
    });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * POST /api/marketing/promotions/apply/:orderId
 *
 * Commit (or re-commit) the auto-apply plan onto an order that is still open.
 * Re-applying is idempotent: the previously stored per-line allocation is
 * removed before the new one is written, so a cashier who removes an item never
 * ends up with a discount that was earned by a basket that no longer exists.
 */
router.post('/promotions/apply/:orderId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const orderId = String(req.params.orderId);

    const order = await prisma.order.findFirst({
      where: { id: orderId, organizationId },
      include: { items: true },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (['PAID', 'COMPLETED', 'REFUNDED', 'CANCELLED'].includes(order.status)) {
      return res.status(409).json({ success: false, message: `A ${order.status} order cannot be re-priced` });
    }
    if (order.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Order has no lines to price' });
    }

    const productIds = [...new Set(order.items.map((i) => i.productId))];
    const products = await prisma.product.findMany({
      where: { organizationId, id: { in: productIds } },
      select: { id: true, categoryId: true },
    });
    const categoryByProduct = new Map(products.map((p) => [p.id, p.categoryId]));

    const lines = order.items.map((i) => ({
      productId: i.productId,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
      categoryId: categoryByProduct.get(i.productId) ?? null,
    }));

    const channel = String(order.channel ?? 'IN_STORE');
    const now = new Date();
    const live = await loadLivePromotions(organizationId, now, channel);
    const plan = planPromotions(live, lines, { now, channel });

    // Undo the previous allocation so the write below is a replace, not an add.
    const previous = (order.appliedPromotions ?? null) as { perLine?: Record<string, number> } | null;
    const previousPerLine = previous?.perLine ?? {};

    const nextItems = order.items.map((i) => {
      const restored = round2(Number(i.discountAmt) - (previousPerLine[i.productId] ?? 0));
      const baseDiscount = Math.max(0, restored);
      const lineValue = round2(Number(i.unitPrice) * Number(i.quantity));
      const promo = round2(plan.perLine[i.productId] ?? 0);
      // A discount can never exceed what the line is worth.
      const discountAmt = round2(Math.min(lineValue, baseDiscount + promo));
      return { id: i.id, discountAmt, totalAmount: round2(lineValue - discountAmt) };
    });

    const subtotal = round2(nextItems.reduce((s, i) => s + i.totalAmount, 0));
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { taxRate: true } });
    const taxRate = Number(org?.taxRate || 0);
    const orderDiscount = round2(Number(order.discountAmount));
    const taxable = round2(Math.max(0, subtotal - orderDiscount));
    const taxAmount = round2(taxable * (taxRate / 100));
    const totalAmount = round2(taxable + taxAmount);

    const appliedPromotions = plan.applied.length > 0 ? { applied: plan.applied, perLine: plan.perLine } : null;

    const updated = await prisma.$transaction(async (tx) => {
      for (const item of nextItems) {
        await tx.orderItem.update({
          where: { id: item.id },
          data: { discountAmt: item.discountAmt, totalAmount: item.totalAmount },
        });
      }
      return tx.order.update({
        where: { id: order.id },
        data: {
          subtotal,
          taxAmount,
          totalAmount,
          appliedPromotions: (appliedPromotions ?? undefined) as any,
        },
        include: { items: true },
      });
    });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'PROMOTIONS_APPLIED',
      resourceType: 'ORDER',
      resourceId: order.id,
      newValue: { totalDiscount: plan.totalDiscount, promotions: plan.applied.map((a: AppliedPromotion) => a.name) },
    });

    res.json({
      success: true,
      data: {
        order: updated,
        applied: plan.applied,
        totalDiscount: plan.totalDiscount,
        perLine: plan.perLine,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
