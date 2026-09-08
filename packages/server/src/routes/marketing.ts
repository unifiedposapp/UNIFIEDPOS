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

// POST /api/marketing/campaigns/:id/launch - Launch campaign
router.post('/campaigns/:id/launch', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const campaign = await prisma.campaign.findUnique({
      where: { id: String(req.params.id) },
    });

    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    // Get target audience
    let customerCount = 0;
    if (campaign.audience === 'ALL') {
      customerCount = await prisma.customer.count({
        where: { organizationId: orgId, isActive: true },
      });
    } else if (campaign.segmentFilter) {
      // Apply segment filter (simplified)
      const filter = campaign.segmentFilter as any;
      customerCount = await prisma.customer.count({
        where: { organizationId: orgId, isActive: true, ...filter },
      });
    }

    const updated = await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'RUNNING', sentCount: customerCount },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/marketing/segments - Get customer segments
router.get('/segments', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const orgId = _req.user!.organizationId!;
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const [total, active, atRisk, dormant, highValue, optedIn] = await Promise.all([
      prisma.customer.count({ where: { organizationId: orgId, isActive: true } }),
      prisma.customer.count({ where: { organizationId: orgId, isActive: true, lastVisitAt: { gte: thirtyDaysAgo } } }),
      prisma.customer.count({ where: { organizationId: orgId, isActive: true, lastVisitAt: { gte: ninetyDaysAgo, lt: thirtyDaysAgo } } }),
      prisma.customer.count({ where: { organizationId: orgId, isActive: true, lastVisitAt: { lt: ninetyDaysAgo } } }),
      prisma.customer.count({ where: { organizationId: orgId, isActive: true, totalSpent: { gte: 500 } } }),
      prisma.customer.count({ where: { organizationId: orgId, isActive: true, marketingOptIn: true } }),
    ]);

    res.json({
      success: true,
      data: [
        { name: 'All Customers', count: total, filter: {} },
        { name: 'Active (30 days)', count: active, filter: { lastVisitAt: { gte: thirtyDaysAgo } } },
        { name: 'At Risk (30-90 days)', count: atRisk, filter: { lastVisitAt: { gte: ninetyDaysAgo, lt: thirtyDaysAgo } } },
        { name: 'Dormant (90+ days)', count: dormant, filter: { lastVisitAt: { lt: ninetyDaysAgo } } },
        { name: 'High Value ($500+)', count: highValue, filter: { totalSpent: { gte: 500 } } },
        { name: 'Marketing Opt-In', count: optedIn, filter: { marketingOptIn: true } },
      ],
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
