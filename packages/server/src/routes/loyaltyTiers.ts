/**
 * Loyalty tiers (§8 loyalty depth).
 *
 * Why this exists: the program in `routes/loyalty.ts` has one flat earn rate, so
 * "gold members earn double" — the one lever that actually moves repeat spend —
 * had nowhere to live. Tiers are a ladder keyed on *lifetime* points, evaluated
 * here and recomputed whenever points are earned.
 *
 * Mounted after `loyaltyRoutes` on the same `/loyalty` base (fall-through). This
 * module owns `/tiers*` and `/customers/:id/status`; nothing collides.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';

const router = Router();

const MANAGERS = requireRole('OWNER', 'ADMIN', 'MANAGER');

const tierSchema = z.object({
  programId: z.string().min(1),
  name: z.string().min(1).max(60),
  minLifetimePoints: z.number().int().min(0).max(100_000_000),
  pointsMultiplier: z.number().min(0.01).max(100).optional(),
  perks: z.record(z.unknown()).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});

/** Highest tier whose threshold the customer has reached; null when below all. */
function tierFor<T extends { minLifetimePoints: number }>(lifetimePoints: number, tiers: T[]): T | null {
  let best: T | null = null;
  for (const tier of tiers) {
    if (lifetimePoints < tier.minLifetimePoints) continue;
    if (!best || tier.minLifetimePoints > best.minLifetimePoints) best = tier;
  }
  return best;
}

// GET /api/loyalty/tiers?programId=
router.get('/tiers', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const where: Record<string, unknown> = { organizationId };
    if (req.query.programId) where.programId = String(req.query.programId);

    const [tiers, profiles] = await Promise.all([
      prisma.loyaltyTier.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { minLifetimePoints: 'asc' }] }),
      prisma.customerProfile.findMany({
        where: { organizationId, tierId: { not: null } },
        select: { tierId: true },
      }),
    ]);

    const counts = new Map<string, number>();
    for (const p of profiles) {
      if (p.tierId) counts.set(p.tierId, (counts.get(p.tierId) ?? 0) + 1);
    }

    res.json({
      success: true,
      data: tiers.map((t) => ({
        ...t,
        pointsMultiplier: Number(t.pointsMultiplier),
        memberCount: counts.get(t.id) ?? 0,
      })),
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/loyalty/tiers
router.post('/tiers', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = tierSchema.parse(req.body);

    const program = await prisma.loyaltyProgram.findFirst({
      where: { id: body.programId, organizationId },
      select: { id: true },
    });
    if (!program) return res.status(404).json({ success: false, message: 'Loyalty program not found' });

    // Two tiers starting at the same threshold is a ladder with a rung that can
    // never be climbed, so it is rejected rather than silently shadowed.
    const clash = await prisma.loyaltyTier.findFirst({
      where: { organizationId, programId: body.programId, minLifetimePoints: body.minLifetimePoints },
      select: { id: true, name: true },
    });
    if (clash) {
      return res.status(409).json({ success: false, message: `"${clash.name}" already starts at ${body.minLifetimePoints} points` });
    }

    const created = await prisma.loyaltyTier.create({
      data: {
        organizationId,
        programId: body.programId,
        name: body.name,
        minLifetimePoints: body.minLifetimePoints,
        pointsMultiplier: body.pointsMultiplier ?? 1,
        perks: (body.perks ?? null) as any,
        sortOrder: body.sortOrder ?? body.minLifetimePoints,
      },
    });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'LOYALTY_TIER_CREATED',
      resourceType: 'LOYALTY_TIER',
      resourceId: created.id,
      newValue: { name: created.name, minLifetimePoints: created.minLifetimePoints },
    });

    res.status(201).json({ success: true, data: { ...created, pointsMultiplier: Number(created.pointsMultiplier) } });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/loyalty/tiers/:id
router.put('/tiers/:id', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);
    const body = tierSchema.partial().parse(req.body);

    const existing = await prisma.loyaltyTier.findFirst({ where: { id, organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Tier not found' });

    const updated = await prisma.loyaltyTier.update({
      where: { id },
      data: {
        name: body.name ?? existing.name,
        minLifetimePoints: body.minLifetimePoints ?? existing.minLifetimePoints,
        pointsMultiplier: body.pointsMultiplier ?? existing.pointsMultiplier,
        perks: body.perks === undefined ? (existing.perks as any) : ((body.perks ?? null) as any),
        sortOrder: body.sortOrder ?? existing.sortOrder,
      },
    });

    res.json({ success: true, data: { ...updated, pointsMultiplier: Number(updated.pointsMultiplier) } });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/loyalty/tiers/:id - holders fall back to no tier, never to a bad one
router.delete('/tiers/:id', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const id = String(req.params.id);

    const existing = await prisma.loyaltyTier.findFirst({ where: { id, organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Tier not found' });

    const released = await prisma.$transaction(async (tx) => {
      const cleared = await tx.customerProfile.updateMany({ where: { organizationId, tierId: id }, data: { tierId: null, tierSince: null } });
      await tx.loyaltyTier.delete({ where: { id } });
      return cleared.count;
    });

    res.json({ success: true, data: { id, releasedCustomers: released } });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * POST /api/loyalty/tiers/evaluate
 *
 * Recompute every member's lifetime points and tier. Lifetime points are the sum
 * of positive movements — redeeming a reward must never demote a customer, which
 * is exactly what a running balance would do.
 */
router.post('/tiers/evaluate', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = z.object({ programId: z.string().min(1).optional() }).parse(req.body ?? {});

    const tiers = await prisma.loyaltyTier.findMany({
      where: { organizationId, ...(body.programId ? { programId: body.programId } : {}) },
      select: { id: true, programId: true, minLifetimePoints: true, sortOrder: true, name: true },
    });

    const programs = body.programId
      ? await prisma.loyaltyProgram.findMany({ where: { id: body.programId, organizationId }, select: { id: true } })
      : await prisma.loyaltyProgram.findMany({ where: { organizationId }, select: { id: true } });
    const programIds = programs.map((p) => p.id);

    // One grouped aggregate rather than a query per customer.
    const earned = await prisma.loyaltyTransaction.groupBy({
      by: ['customerId'],
      where: { organizationId, programId: { in: programIds }, points: { gt: 0 } },
      _sum: { points: true },
    });
    const lifetimeByCustomer = new Map(earned.map((e) => [e.customerId, e._sum.points ?? 0]));

    const profiles = await prisma.customerProfile.findMany({
      where: { organizationId },
      select: { id: true, customerId: true, tierId: true, lifetimePoints: true },
    });

    let promoted = 0;
    let demoted = 0;
    const now = new Date();

    for (const profile of profiles) {
      const lifetime = Math.max(profile.lifetimePoints, lifetimeByCustomer.get(profile.customerId) ?? 0);
      const match = tierFor(lifetime, tiers);
      const nextTierId = match?.id ?? null;
      if (nextTierId === profile.tierId && lifetime === profile.lifetimePoints) continue;

      await prisma.customerProfile.update({
        where: { id: profile.id },
        data: {
          lifetimePoints: lifetime,
          tierId: nextTierId,
          // `tierSince` marks when the CURRENT tier began, so it only moves on a change.
          tierSince: nextTierId === profile.tierId ? undefined : nextTierId ? now : null,
        },
      });
      if (nextTierId && nextTierId !== profile.tierId) promoted++;
      if (!nextTierId && profile.tierId) demoted++;
    }

    res.json({
      success: true,
      data: { evaluated: profiles.length, promoted, demoted, tiers: tiers.length },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/loyalty/customers/:customerId/status - balance, tier and the next rung
router.get('/customers/:customerId/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const customerId = String(req.params.customerId);

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      select: { id: true, name: true, email: true, loyaltyPoints: true },
    });
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const profile = await prisma.customerProfile.findUnique({
      where: { organizationId_customerId: { organizationId, customerId } },
      select: { tierId: true, tierSince: true, lifetimePoints: true },
    });

    const tiers = await prisma.loyaltyTier.findMany({
      where: { organizationId },
      orderBy: { minLifetimePoints: 'asc' },
    });
    const lifetimePoints = profile?.lifetimePoints ?? 0;
    const current = tiers.find((t) => t.id === profile?.tierId) ?? tierFor(lifetimePoints, tiers);
    const next = tiers.find((t) => t.minLifetimePoints > (current?.minLifetimePoints ?? lifetimePoints)) ?? null;

    res.json({
      success: true,
      data: {
        customer,
        balance: customer.loyaltyPoints,
        lifetimePoints,
        tier: current
          ? { id: current.id, name: current.name, pointsMultiplier: Number(current.pointsMultiplier), perks: current.perks, since: profile?.tierSince ?? null }
          : null,
        nextTier: next
          ? {
              id: next.id,
              name: next.name,
              pointsMultiplier: Number(next.pointsMultiplier),
              pointsToGo: Math.max(0, next.minLifetimePoints - lifetimePoints),
            }
          : null,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
