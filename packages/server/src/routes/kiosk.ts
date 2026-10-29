/**
 * Kiosk and customer-facing display (self-service, §7 in-store experience).
 *
 * Why this exists: a kiosk and a pole display both need to work with nobody
 * logged in — a pairing token is the natural credential. The token is stored on
 * the session row, scoped to one organization, and revocable from the back
 * office, so a stolen tablet is a support ticket rather than a breach.
 *
 * Two modes:
 *   KIOSK             — public catalogue and self-service ordering
 *   CUSTOMER_DISPLAY  — read-only mirror of the cashier's live basket
 */

import crypto from 'node:crypto';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';

const router = Router();

const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const MANAGERS = requireRole('OWNER', 'ADMIN', 'MANAGER');

function newToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

function kioskOrderNumber(): string {
  const d = new Date();
  const stamp = `${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `KIOSK-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

/** Load a session by token, refusing revoked pairs. Deliberately unauthenticated. */
async function sessionByToken(token: string) {
  const session = await prisma.kioskSession.findUnique({ where: { token } });
  if (!session) return null;
  if (session.status !== 'ACTIVE') return null;
  return session;
}

// ─── Pairing (back office) ─────────────────────────────────────────────────

// POST /api/kiosk/sessions - pair a device
router.post('/sessions', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = z
      .object({
        label: z.string().min(1).max(120),
        mode: z.enum(['KIOSK', 'CUSTOMER_DISPLAY']).default('KIOSK'),
        registerId: z.string().min(1).nullable().optional(),
        deviceId: z.string().min(1).nullable().optional(),
      })
      .parse(req.body);

    if (body.registerId) {
      const register = await prisma.register.findFirst({ where: { id: body.registerId, organizationId }, select: { id: true } });
      if (!register) return res.status(404).json({ success: false, message: 'Register not found' });
    }

    const created = await prisma.kioskSession.create({
      data: {
        organizationId,
        label: body.label,
        mode: body.mode,
        registerId: body.registerId ?? null,
        deviceId: body.deviceId ?? null,
        token: newToken(),
        status: 'ACTIVE',
      },
    });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'KIOSK_PAIRED',
      resourceType: 'KIOSK_SESSION',
      resourceId: created.id,
      newValue: { mode: created.mode, label: created.label, registerId: created.registerId },
    });

    // The token is returned exactly once, at pairing time.
    res.status(201).json({ success: true, data: created });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/kiosk/sessions
router.get('/sessions', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const rows = await prisma.kioskSession.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
    res.json({
      success: true,
      // Never echo the token back in a list; pairing already handed it over.
      data: rows.map(({ token, ...rest }) => ({ ...rest, tokenPreview: `${token.slice(0, 6)}…` })),
    });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/kiosk/sessions/:id - revoke
router.delete('/sessions/:id', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const session = await prisma.kioskSession.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    await prisma.kioskSession.update({ where: { id: session.id }, data: { status: 'REVOKED' } });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'KIOSK_REVOKED',
      resourceType: 'KIOSK_SESSION',
      resourceId: session.id,
      newValue: { label: session.label, mode: session.mode },
    });

    res.json({ success: true, data: { id: session.id, status: 'REVOKED' } });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Device surface (token-authenticated, no login) ────────────────────────

/**
 * GET /api/kiosk/session/:token/bootstrap
 *
 * Everything the device needs in one call: branding, currency, the sellable
 * catalogue with availability, and (for a display) the current basket.
 */
router.get('/session/:token/bootstrap', async (req: Request, res: Response) => {
  try {
    const session = await sessionByToken(String(req.params.token));
    if (!session) return res.status(401).json({ success: false, message: 'This device is not paired' });

    const [settings, products, placements] = await Promise.all([
      prisma.storeSettings.findUnique({ where: { organizationId: session.organizationId } }),
      prisma.product.findMany({
        where: { organizationId: session.organizationId, isActive: true, type: { not: 'SERVICE' } },
        orderBy: { name: 'asc' },
        take: 500,
        select: {
          id: true,
          name: true,
          price: true,
          imageUrl: true,
          categoryId: true,
          unitOfMeasure: true,
          isWeighed: true,
          ageRestricted: true,
          minAge: true,
        },
      }),
      prisma.menuCategoryItem.findMany({
        where: { category: { organizationId: session.organizationId } },
        select: { productId: true, isAvailable: true },
      }),
    ]);

    // A product is sellable unless every menu placement for it is 86ed.
    const availability = new Map<string, boolean>();
    for (const p of placements) {
      availability.set(p.productId, (availability.get(p.productId) ?? false) || p.isAvailable);
    }

    const catalogue = products.map((p) => ({
      ...p,
      price: Number(p.price),
      available: availability.has(p.id) ? availability.get(p.id)! : true,
    }));

    await prisma.kioskSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });

    res.json({
      success: true,
      data: {
        mode: session.mode,
        label: session.label,
        store: settings
          ? {
              storeName: settings.storeName,
              tagline: settings.tagline,
              logoUrl: settings.logoUrl,
              currency: settings.currency ?? 'USD',
              brandPrimaryColor: settings.brandPrimaryColor,
              brandSecondaryColor: settings.brandSecondaryColor,
              countryCode: settings.countryCode,
            }
          : null,
        catalogue,
        cart: session.mode === 'CUSTOMER_DISPLAY' ? session.lastCart : null,
        displayOrderId: session.displayOrderId,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/kiosk/session/:token/heartbeat - keeps the pairing visibly alive
router.post('/session/:token/heartbeat', async (req: Request, res: Response) => {
  try {
    const session = await sessionByToken(String(req.params.token));
    if (!session) return res.status(401).json({ success: false, message: 'This device is not paired' });
    await prisma.kioskSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    res.json({ success: true, data: { mode: session.mode, serverTime: new Date().toISOString() } });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * POST /api/kiosk/session/:token/order
 *
 * A guest builds a basket and submits it. Prices are always re-read from the
 * catalog — a kiosk that trusts the browser's price is a discount engine for
 * anyone with a dev console.
 */
router.post('/session/:token/order', async (req: Request, res: Response) => {
  try {
    const session = await sessionByToken(String(req.params.token));
    if (!session) return res.status(401).json({ success: false, message: 'This device is not paired' });
    if (session.mode !== 'KIOSK') {
      return res.status(403).json({ success: false, message: 'This device is a customer display, not a kiosk' });
    }

    const body = z
      .object({
        items: z
          .array(
            z.object({
              productId: z.string().min(1),
              quantity: z.number().positive(),
              notes: z.string().max(300).optional(),
            }),
          )
          .min(1)
          .max(50),
        customerName: z.string().max(120).optional(),
        notes: z.string().max(500).optional(),
        fulfillmentType: z.enum(['TAKEOUT', 'DINE_IN', 'PICKUP']).optional(),
      })
      .parse(req.body);

    const productIds = [...new Set(body.items.map((i) => i.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, organizationId: session.organizationId, isActive: true },
      select: { id: true, name: true, price: true, unitOfMeasure: true, isWeighed: true, ageRestricted: true },
    });
    if (products.length !== productIds.length) {
      return res.status(400).json({ success: false, message: 'One or more items are no longer available' });
    }
    const byId = new Map(products.map((p) => [p.id, p]));

    // A weighable item must be sold in a decimal amount; a kiosk has no scale, so
    // the guest picks a preset quantity and we keep the unit consistent.
    const lines = body.items.map((i) => {
      const product = byId.get(i.productId)!;
      const unitPrice = money(Number(product.price));
      const quantity = product.isWeighed ? Math.round(Number(i.quantity) * 1000) / 1000 : Math.max(1, Math.round(Number(i.quantity)));
      return {
        productId: product.id,
        productName: product.name,
        quantity,
        uom: product.unitOfMeasure ?? 'EACH',
        weighed: Boolean(product.isWeighed),
        unitPrice,
        totalAmount: money(unitPrice * quantity),
        notes: i.notes ?? null,
      };
    });

    const subtotal = money(lines.reduce((s, l) => s + l.totalAmount, 0));
    const ageRestricted = products.some((p) => p.ageRestricted);

    const order = await prisma.order.create({
      data: {
        organizationId: session.organizationId,
        orderNumber: kioskOrderNumber(),
        channel: 'IN_STORE',
        status: 'CONFIRMED',
        registerId: session.registerId,
        fulfillmentType: body.fulfillmentType ?? 'TAKEOUT',
        subtotal,
        totalAmount: subtotal,
        notes: [body.customerName ? `Guest: ${body.customerName}` : null, body.notes ?? null, 'Self-service kiosk order']
          .filter(Boolean)
          .join(' · '),
        items: { create: lines },
      },
      select: { id: true, orderNumber: true, totalAmount: true, status: true },
    });

    await prisma.kioskSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });

    res.status(201).json({
      success: true,
      data: {
        order,
        // The counter must check ID before this order is paid.
        requiresAgeCheck: ageRestricted,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * PUT /api/kiosk/session/:token/cart
 *
 * The cashier's POS pushes the basket snapshot; the pole display only reads it.
 * Requires a logged-in operator AND the pairing token, so a guest cannot push a
 * fake total onto the screen.
 */
router.put('/session/:token/cart', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const session = await sessionByToken(String(req.params.token));
    if (!session) return res.status(401).json({ success: false, message: 'This device is not paired' });
    if (session.organizationId !== req.user!.organizationId) {
      return res.status(403).json({ success: false, message: 'This display belongs to another organization' });
    }
    if (session.mode !== 'CUSTOMER_DISPLAY') {
      return res.status(400).json({ success: false, message: 'Only a customer display mirrors a basket' });
    }

    const body = z
      .object({
        orderId: z.string().min(1).nullable().optional(),
        lines: z
          .array(
            z.object({
              productName: z.string().min(1).max(200),
              quantity: z.number(),
              unitPrice: z.number(),
              totalAmount: z.number(),
            }),
          )
          .max(200),
        subtotal: z.number(),
        discount: z.number().optional(),
        tax: z.number().optional(),
        total: z.number(),
        tip: z.number().optional(),
        customerName: z.string().max(120).nullable().optional(),
        paymentStatus: z.string().max(40).nullable().optional(),
      })
      .parse(req.body);

    if (body.orderId) {
      const order = await prisma.order.findFirst({ where: { id: body.orderId, organizationId: session.organizationId }, select: { id: true } });
      if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const updated = await prisma.kioskSession.update({
      where: { id: session.id },
      data: { displayOrderId: body.orderId ?? null, lastCart: body, lastSeenAt: new Date() },
    });

    res.json({ success: true, data: { sessionId: updated.id, displayOrderId: updated.displayOrderId } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/kiosk/session/:token/cart - the display polls this
router.get('/session/:token/cart', async (req: Request, res: Response) => {
  try {
    const session = await sessionByToken(String(req.params.token));
    if (!session) return res.status(401).json({ success: false, message: 'This device is not paired' });

    res.json({
      success: true,
      data: {
        mode: session.mode,
        cart: session.lastCart,
        displayOrderId: session.displayOrderId,
        updatedAt: session.lastSeenAt,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
