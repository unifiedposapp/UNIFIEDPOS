/**
 * Age verification records (§6 / §17 age-restricted selling).
 *
 * `services/ageGate.ts` decides whether a basket needs a check and whether a
 * given piece of evidence satisfies it. This route is the audit surface: it
 * stores the evidence, returns a verdict, and hands the caller an id that
 * `POST /orders` will accept.
 *
 * Deliberately minimal on what is retained: a date of birth, the document TYPE
 * and the last four characters — never a document number or a scan. Storing an
 * ID image would turn a till into a privacy liability for no operational gain.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { ageGateMessage, evaluateAgeGate, requiredMinAge, type AgePolicy } from '../services/ageGate.js';

const router = Router();

const MANAGERS = requireRole('OWNER', 'ADMIN', 'MANAGER');

const createSchema = z.object({
  method: z.enum(['MANUAL_DOB', 'ID_SCAN', 'SUPERVISOR_OVERRIDE']).default('MANUAL_DOB'),
  birthDate: z.string().nullable().optional(),
  documentType: z.enum(['DRIVING_LICENCE', 'PASSPORT', 'NATIONAL_ID']).nullable().optional(),
  documentLast4: z.string().max(8).nullable().optional(),
  customerId: z.string().min(1).nullable().optional(),
  orderId: z.string().min(1).nullable().optional(),
  deviceId: z.string().min(1).nullable().optional(),
  /**
   * The restrictions being checked against. Optional: when the order already
   * exists the server reads the real lines, so a client cannot understate the
   * minimum age it is being asked to clear.
   */
  items: z
    .array(z.object({ productId: z.string().min(1), name: z.string().optional(), ageRestricted: z.boolean().optional(), minAge: z.number().int().nullable().optional() }))
    .max(200)
    .optional(),
  notes: z.string().max(500).nullable().optional(),
});

/** The store policy, expressed in the shape the pure gate expects. */
async function policyOf(organizationId: string): Promise<AgePolicy> {
  const settings = await prisma.storeSettings.findUnique({
    where: { organizationId },
    select: { ageVerificationEnabled: true, ageVerificationMinAge: true, ageVerificationRequireId: true },
  });
  return {
    // A product marked age-restricted is always gated, whatever the store switch
    // says; the switch only controls whether the store defaults apply at all.
    enabled: true,
    defaultMinAge: settings?.ageVerificationMinAge ?? 18,
    requireId: settings?.ageVerificationRequireId ?? false,
  };
}

// POST /api/age-verifications
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = createSchema.parse(req.body);

    // An override is a supervisor decision, not a cashier shortcut, so the role is
    // checked here rather than by router middleware (the same route also serves
    // ordinary ID checks, which any till operator may perform).
    if (body.method === 'SUPERVISOR_OVERRIDE') {
      const role = String(req.user!.role ?? '').toUpperCase();
      if (!['OWNER', 'ADMIN', 'MANAGER'].includes(role)) {
        return res.status(403).json({ success: false, code: 'OVERRIDE_FORBIDDEN', message: 'Only a supervisor can override an age check' });
      }
    }

    // Resolve the restriction set: the named order's real lines win over anything
    // the client sent, so the minimum age cannot be talked down.
    let lines = body.items ?? [];
    let orderId = body.orderId ?? null;
    if (orderId) {
      const order = await prisma.order.findFirst({
        where: { id: orderId, organizationId },
        include: { items: { select: { productId: true, productName: true } } },
      });
      if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
      const products = await prisma.product.findMany({
        where: { organizationId, id: { in: [...new Set(order.items.map((i) => i.productId))] } },
        select: { id: true, name: true, ageRestricted: true, minAge: true },
      });
      const byId = new Map(products.map((p) => [p.id, p]));
      lines = order.items.map((i) => ({
        productId: i.productId,
        name: byId.get(i.productId)?.name ?? i.productName,
        ageRestricted: byId.get(i.productId)?.ageRestricted ?? false,
        minAge: byId.get(i.productId)?.minAge ?? null,
      }));
    }

    const policy = await policyOf(organizationId);
    const minAge = requiredMinAge(lines, policy.defaultMinAge) ?? policy.defaultMinAge;
    const verdict = evaluateAgeGate(
      policy,
      lines,
      {
        birthDate: body.birthDate ?? null,
        documentType: body.documentType ?? null,
        method: body.method,
      },
      new Date(),
    );

    if (verdict.required && !verdict.satisfied) {
      // A failed check is still recorded: refusing the sale is the outcome, and
      // the attempt is evidence that the control ran.
      await prisma.ageVerification.create({
        data: {
          organizationId,
          orderId,
          customerId: body.customerId ?? null,
          employeeId: req.user!.employeeId ?? null,
          deviceId: body.deviceId ?? null,
          method: body.method,
          minAge,
          birthDate: body.birthDate ? new Date(body.birthDate) : null,
          documentType: body.documentType ?? null,
          documentLast4: body.documentLast4 ?? null,
          passed: false,
          notes: body.notes ?? ageGateMessage(verdict),
        },
      });

      return res.status(422).json({
        success: false,
        code: verdict.reason,
        minAge,
        message: ageGateMessage(verdict),
      });
    }

    const created = await prisma.ageVerification.create({
      data: {
        organizationId,
        orderId,
        customerId: body.customerId ?? null,
        employeeId: req.user!.employeeId ?? null,
        deviceId: body.deviceId ?? null,
        method: body.method,
        minAge,
        birthDate: body.birthDate ? new Date(body.birthDate) : null,
        documentType: body.documentType ?? null,
        documentLast4: body.documentLast4 ?? null,
        passed: true,
        notes: body.notes ?? null,
      },
    });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'AGE_VERIFIED',
      resourceType: 'AGE_VERIFICATION',
      resourceId: created.id,
      newValue: { method: created.method, minAge, orderId, reason: verdict.required ? verdict.reason : 'NO_RESTRICTED_ITEMS' },
    });

    res.status(201).json({
      success: true,
      data: {
        id: created.id,
        minAge,
        passed: true,
        method: created.method,
        verifiedAt: created.verifiedAt,
        // The POS passes this straight into POST /orders.
        ageVerificationId: created.id,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/age-verifications?from=&to=&passed=&employeeId=
router.get('/', authMiddleware, MANAGERS, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const where: Record<string, unknown> = { organizationId };

    if (req.query.passed !== undefined) where.passed = String(req.query.passed) === 'true';
    if (req.query.employeeId) where.employeeId = String(req.query.employeeId);
    if (req.query.orderId) where.orderId = String(req.query.orderId);
    if (req.query.from || req.query.to) {
      const range: Record<string, Date> = {};
      if (req.query.from) range.gte = new Date(String(req.query.from));
      if (req.query.to) range.lt = new Date(String(req.query.to));
      where.verifiedAt = range;
    }

    const rows = await prisma.ageVerification.findMany({ where, orderBy: { verifiedAt: 'desc' }, take: 500 });
    res.json({
      success: true,
      data: rows,
      meta: {
        total: rows.length,
        refused: rows.filter((r) => !r.passed).length,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/age-verifications/policy - what the register must enforce
router.get('/policy', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const policy = await policyOf(req.user!.organizationId!);
    res.json({ success: true, data: policy });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
