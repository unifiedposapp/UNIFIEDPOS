import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';

const router = Router();

const promotionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.string(), // PERCENTAGE, FIXED, BOGO, BUNDLE
  value: z.number().min(0),
  minPurchase: z.number().min(0).optional(),
  maxDiscount: z.number().min(0).optional(),
  applicableProducts: z.array(z.string()).optional(),
  startDate: z.string(),
  endDate: z.string().optional(),
});

const couponSchema = z.object({
  code: z.string().min(1),
  description: z.string().optional(),
  type: z.string(), // PERCENTAGE, FIXED, FREE_SHIPPING
  value: z.number().min(0),
  minPurchase: z.number().min(0).optional(),
  maxDiscount: z.number().min(0).optional(),
  usageLimit: z.number().int().min(1).optional(),
  perCustomerLimit: z.number().int().min(1).optional(),
  startDate: z.string(),
  endDate: z.string().optional(),
});

const campaignSchema = z.object({
  name: z.string().min(1),
  type: z.string(), // EMAIL, SMS, PUSH, SOCIAL
  audience: z.string().default('ALL'),
  segmentFilter: z.any().optional(),
  message: z.string().optional(),
  subject: z.string().optional(),
  scheduledAt: z.string().optional(),
});

// ─── Segmentation engine ─────────────────────────────────────
// Derives RFM + lifecycle segments from REAL order history (recency, frequency,
// monetary) so campaigns can target actual behaviour rather than static fields.
export interface SegmentRow {
  key: string;
  name: string;
  description: string;
  count: number;
  avgValue: number;
  customerIds: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SEGMENT_KEYS = [
  'all', 'new', 'active', 'at_risk', 'dormant', 'champions', 'loyal',
  'high_value', 'opt_in', 'loyalty_members', 'never_purchased',
] as const;

async function computeSegments(orgId: string): Promise<SegmentRow[]> {
  const now = Date.now();

  const [agg, customers] = await Promise.all([
    prisma.order.groupBy({
      by: ['customerId'],
      where: { organizationId: orgId, customerId: { not: null }, status: { in: ['PAID', 'COMPLETED'] } },
      _sum: { totalAmount: true },
      _count: { _all: true },
      _max: { createdAt: true },
      _min: { createdAt: true },
    }),
    prisma.customer.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, totalSpent: true, loyaltyPoints: true, marketingOptIn: true },
    }),
  ]);

  interface M { recencyDays: number; frequency: number; monetary: number; firstDays: number; }
  const metrics = new Map<string, M>();
  for (const row of agg) {
    const cid = row.customerId;
    if (!cid) continue;
    const last = row._max.createdAt ? new Date(row._max.createdAt).getTime() : now;
    const first = row._min.createdAt ? new Date(row._min.createdAt).getTime() : last;
    metrics.set(cid, {
      recencyDays: Math.max(0, Math.round((now - last) / DAY_MS)),
      frequency: row._count?._all ?? 0,
      monetary: Number(row._sum.totalAmount ?? 0),
      firstDays: Math.max(0, Math.round((now - first) / DAY_MS)),
    });
  }

  const buyers = [...metrics.values()];
  const avgSpend = buyers.length ? buyers.reduce((s, m) => s + m.monetary, 0) / buyers.length : 0;
  const highValueThreshold = Math.max(100, Math.round(avgSpend * 1.5));

  const buckets: Record<string, string[]> = Object.fromEntries(SEGMENT_KEYS.map((k) => [k, []]));
  const valueSum: Record<string, number> = Object.fromEntries(SEGMENT_KEYS.map((k) => [k, 0]));

  for (const c of customers) {
    const m = metrics.get(c.id);
    const spend = m ? m.monetary : Number(c.totalSpent ?? 0);
    const put = (k: string) => { buckets[k].push(c.id); valueSum[k] += spend; };
    put('all');
    if (c.marketingOptIn) put('opt_in');
    if (c.loyaltyPoints > 0) put('loyalty_members');
    if (!m || m.frequency === 0) { put('never_purchased'); continue; }
    if (m.recencyDays <= 30) put('active');
    else if (m.recencyDays <= 90) put('at_risk');
    else put('dormant');
    if (m.firstDays <= 30) put('new');
    if (spend >= highValueThreshold) put('high_value');
    if (m.recencyDays <= 60 && m.frequency >= 3 && spend >= highValueThreshold) put('champions');
    else if (m.frequency >= 3) put('loyal');
  }

  const meta: Record<string, { name: string; description: string }> = {
    all: { name: 'All Customers', description: 'Every active customer on file.' },
    new: { name: 'New (30 days)', description: 'First completed order within the last 30 days.' },
    active: { name: 'Active (30 days)', description: 'Completed an order in the last 30 days.' },
    at_risk: { name: 'At Risk (31–90 days)', description: 'Last order 31–90 days ago — re-engage before they lapse.' },
    dormant: { name: 'Dormant (90+ days)', description: 'No completed order in over 90 days.' },
    champions: { name: 'Champions', description: 'Bought recently, order often, and spend above average.' },
    loyal: { name: 'Loyal', description: 'Three or more completed orders.' },
    high_value: { name: 'High Value', description: `Lifetime spend at or above ${highValueThreshold}.` },
    opt_in: { name: 'Marketing Opt-In', description: 'Consented to receive marketing messages.' },
    loyalty_members: { name: 'Loyalty Members', description: 'Have a positive loyalty points balance.' },
    never_purchased: { name: 'Never Purchased', description: 'On file but no completed order yet.' },
  };

  return SEGMENT_KEYS.map((k) => ({
    key: k,
    name: meta[k].name,
    description: meta[k].description,
    count: buckets[k].length,
    avgValue: buckets[k].length ? Math.round((valueSum[k] / buckets[k].length) * 100) / 100 : 0,
    customerIds: buckets[k],
  }));
}

// ─── Promotions ──────────────────────────────────────────────

router.get('/promotions', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const promotions = await prisma.promotion.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: promotions });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/promotions', authMiddleware, validateRequest(promotionSchema), async (req: AuthRequest, res: Response) => {
  try {
    const promotion = await prisma.promotion.create({
      data: {
        ...req.body,
        organizationId: req.user!.organizationId!,
        startDate: new Date(req.body.startDate),
        endDate: req.body.endDate ? new Date(req.body.endDate) : null,
      },
    });
    res.status(201).json({ success: true, data: promotion });
  } catch (error) {
    handleError(error, res);
  }
});

router.put('/promotions/:id', authMiddleware, validateRequest(promotionSchema.partial()), async (req: AuthRequest, res: Response) => {
  try {
    const data: any = { ...req.body };
    if (data.startDate) data.startDate = new Date(data.startDate);
    if (data.endDate) data.endDate = new Date(data.endDate);

    const promotion = await prisma.promotion.update({
      where: { id: String(req.params.id) },
      data,
    });
    res.json({ success: true, data: promotion });
  } catch (error) {
    handleError(error, res);
  }
});

router.delete('/promotions/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.promotion.update({
      where: { id: String(req.params.id) },
      data: { isActive: false },
    });
    res.json({ success: true, message: 'Promotion deactivated' });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Coupons ─────────────────────────────────────────────────

router.get('/coupons', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const coupons = await prisma.coupon.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: coupons });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/coupons', authMiddleware, validateRequest(couponSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;

    // Check for duplicate code
    const existing = await prisma.coupon.findUnique({
      where: { organizationId_code: { organizationId: orgId, code: req.body.code.toUpperCase() } },
    });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Coupon code already exists' });
    }

    const coupon = await prisma.coupon.create({
      data: {
        ...req.body,
        code: req.body.code.toUpperCase(),
        organizationId: orgId,
        startDate: new Date(req.body.startDate),
        endDate: req.body.endDate ? new Date(req.body.endDate) : null,
      },
    });
    res.status(201).json({ success: true, data: coupon });
  } catch (error) {
    handleError(error, res);
  }
});

router.put('/coupons/:id', authMiddleware, validateRequest(couponSchema.partial()), async (req: AuthRequest, res: Response) => {
  try {
    const data: any = { ...req.body };
    if (data.code) data.code = data.code.toUpperCase();
    if (data.startDate) data.startDate = new Date(data.startDate);
    if (data.endDate) data.endDate = new Date(data.endDate);

    const coupon = await prisma.coupon.update({
      where: { id: String(req.params.id) },
      data,
    });
    res.json({ success: true, data: coupon });
  } catch (error) {
    handleError(error, res);
  }
});

router.delete('/coupons/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.coupon.update({
      where: { id: String(req.params.id) },
      data: { isActive: false },
    });
    res.json({ success: true, message: 'Coupon deactivated' });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/marketing/coupons/validate - Validate a coupon code
router.post('/coupons/validate', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { code, orderTotal } = req.body;
    const orgId = req.user!.organizationId!;

    const coupon = await prisma.coupon.findUnique({
      where: { organizationId_code: { organizationId: orgId, code: code.toUpperCase() } },
    });

    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    if (!coupon.isActive) return res.status(400).json({ success: false, message: 'Coupon is inactive' });
    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      return res.status(400).json({ success: false, message: 'Coupon usage limit reached' });
    }
    if (coupon.endDate && new Date() > coupon.endDate) {
      return res.status(400).json({ success: false, message: 'Coupon has expired' });
    }
    if (new Date() < coupon.startDate) {
      return res.status(400).json({ success: false, message: 'Coupon is not yet active' });
    }
    if (orderTotal && Number(orderTotal) < Number(coupon.minPurchase)) {
      return res.status(400).json({ success: false, message: `Minimum purchase of $${coupon.minPurchase} required` });
    }

    // Calculate discount
    let discount = 0;
    if (coupon.type === 'PERCENTAGE') {
      discount = (Number(orderTotal || 0) * Number(coupon.value)) / 100;
      if (coupon.maxDiscount) discount = Math.min(discount, Number(coupon.maxDiscount));
    } else if (coupon.type === 'FIXED') {
      discount = Number(coupon.value);
    } else if (coupon.type === 'FREE_SHIPPING') {
      discount = 0; // Shipping calculated separately
    }

    res.json({ success: true, data: { coupon, discount } });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Campaigns ───────────────────────────────────────────────

router.get('/campaigns', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: campaigns });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/campaigns', authMiddleware, validateRequest(campaignSchema), async (req: AuthRequest, res: Response) => {
  try {
    const campaign = await prisma.campaign.create({
      data: {
        ...req.body,
        organizationId: req.user!.organizationId!,
        scheduledAt: req.body.scheduledAt ? new Date(req.body.scheduledAt) : null,
      },
    });
    res.status(201).json({ success: true, data: campaign });
  } catch (error) {
    handleError(error, res);
  }
});

router.put('/campaigns/:id', authMiddleware, validateRequest(campaignSchema.partial()), async (req: AuthRequest, res: Response) => {
  try {
    const data: any = { ...req.body };
    if (data.scheduledAt) data.scheduledAt = new Date(data.scheduledAt);

    const campaign = await prisma.campaign.update({
      where: { id: String(req.params.id) },
      data,
    });
    res.json({ success: true, data: campaign });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/marketing/campaigns/:id/launch - Launch campaign to a segment
router.post('/campaigns/:id/launch', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const campaign = await prisma.campaign.findUnique({
      where: { id: String(req.params.id) },
    });

    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    // Resolve the target segment (explicit segmentKey wins, else the stored
    // audience). Falls back to "all" so a launch never targets nobody by accident.
    const segments = await computeSegments(orgId);
    const requested = String(req.body?.segmentKey || campaign.audience || 'all');
    const key = requested.toLowerCase().replace(/\s+/g, '_');
    const segment = segments.find((s) => s.key === key) || segments.find((s) => s.key === 'all')!;

    const updated = await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'RUNNING', audience: segment.key, sentCount: segment.count },
    });

    res.json({ success: true, data: { ...updated, segmentName: segment.name, audienceSize: segment.count } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/marketing/campaigns/:id/engage - Record an open or conversion.
// Drives real open-rate / conversion-rate metrics on the dashboard.
router.post('/campaigns/:id/engage', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const type = String(req.body?.type || 'open');
    const data = type === 'convert'
      ? { convertedCount: { increment: 1 } }
      : { openedCount: { increment: 1 } };
    const campaign = await prisma.campaign.update({ where: { id: String(req.params.id) }, data });
    res.json({ success: true, data: campaign });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/marketing/campaigns/:id/cancel - Cancel a campaign
router.post('/campaigns/:id/cancel', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const campaign = await prisma.campaign.update({
      where: { id: String(req.params.id) },
      data: { status: 'CANCELLED' },
    });
    res.json({ success: true, data: campaign });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/marketing/coupons/:id/redeem - Increment usage (respecting limits)
router.post('/coupons/:id/redeem', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const coupon = await prisma.coupon.findUnique({ where: { id: String(req.params.id) } });
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    if (!coupon.isActive) return res.status(400).json({ success: false, message: 'Coupon is inactive' });
    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      return res.status(400).json({ success: false, message: 'Coupon usage limit reached' });
    }
    if (coupon.endDate && new Date() > coupon.endDate) {
      return res.status(400).json({ success: false, message: 'Coupon has expired' });
    }
    const updated = await prisma.coupon.update({
      where: { id: coupon.id },
      data: { usedCount: { increment: 1 } },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/marketing/segments - RFM + lifecycle segments from real order history
router.get('/segments', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const orgId = _req.user!.organizationId!;
    const segments = await computeSegments(orgId);
    // Omit the (potentially large) id lists from the list response; campaign
    // launch recomputes membership server-side from the segment key.
    res.json({ success: true, data: segments.map(({ customerIds: _ids, ...rest }) => rest) });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/marketing/overview - Marketing KPIs for the dashboard header
router.get('/overview', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const [
      promoTotal, promoActive, couponTotal, couponActive, redeemed,
      campaignTotal, campaignRunning, campaignAgg, customerTotal, optIn, segments,
    ] = await Promise.all([
      prisma.promotion.count({ where: { organizationId: orgId } }),
      prisma.promotion.count({ where: { organizationId: orgId, isActive: true } }),
      prisma.coupon.count({ where: { organizationId: orgId } }),
      prisma.coupon.count({ where: { organizationId: orgId, isActive: true } }),
      prisma.coupon.aggregate({ where: { organizationId: orgId }, _sum: { usedCount: true } }),
      prisma.campaign.count({ where: { organizationId: orgId } }),
      prisma.campaign.count({ where: { organizationId: orgId, status: 'RUNNING' } }),
      prisma.campaign.aggregate({ where: { organizationId: orgId }, _sum: { sentCount: true, openedCount: true, convertedCount: true } }),
      prisma.customer.count({ where: { organizationId: orgId, isActive: true } }),
      prisma.customer.count({ where: { organizationId: orgId, isActive: true, marketingOptIn: true } }),
      computeSegments(orgId),
    ]);

    const sent = campaignAgg._sum.sentCount || 0;
    const opened = campaignAgg._sum.openedCount || 0;
    const converted = campaignAgg._sum.convertedCount || 0;
    const pct = (n: number, d: number) => (d ? Number(((n / d) * 100).toFixed(1)) : 0);
    const topSegment = segments.filter((s) => s.key !== 'all').sort((a, b) => b.count - a.count)[0] || null;

    res.json({
      success: true,
      data: {
        promotions: { total: promoTotal, active: promoActive },
        coupons: { total: couponTotal, active: couponActive, redeemed: redeemed._sum.usedCount || 0 },
        campaigns: {
          total: campaignTotal,
          running: campaignRunning,
          sent, opened, converted,
          openRate: pct(opened, sent),
          conversionRate: pct(converted, sent),
        },
        audience: { customers: customerTotal, optIn, optInRate: pct(optIn, customerTotal) },
        topSegment: topSegment ? { key: topSegment.key, name: topSegment.name, count: topSegment.count } : null,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
