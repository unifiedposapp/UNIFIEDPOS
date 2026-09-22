import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import { createAuditEvent } from '../utils/audit.js';
import {
  consumePinAttempt,
  decideOpenRegister,
  DEFAULT_IDLE_LOCK_MINUTES,
  findRegisterHolder,
  hashRegisterPin,
  loadPinState,
  LOCK_REASON,
  normalizeIdleMinutes,
  pinIssueMessage,
  validateRegisterPin,
} from '../services/registerAccess.js';

const router = Router();

// Roles that may supervise other people's drawers (force unlock / force close /
// see who is on which register). A CASHIER is never allowed here.
const SUPERVISOR_ROLES = ['OWNER', 'ADMIN', 'MANAGER'];
function isSupervisor(role?: string): boolean {
  return SUPERVISOR_ROLES.includes(String(role));
}

const sessionSchema = z.object({
  registerId: z.string().uuid(),
  openingCash: z.number().min(0),
});

const closeSessionSchema = z.object({
  closingCash: z.number().min(0),
  notes: z.string().optional(),
});

const pinSetupSchema = z.object({
  pin: z.string().min(1),
  // Required by the server only when a PIN already exists (rotation). Ignored
  // when there is nothing to overwrite yet.
  currentPin: z.string().optional(),
});

const unlockSchema = z.object({
  pin: z.string().min(1, 'Enter your PIN'),
});

const lockSchema = z.object({
  reason: z.enum([LOCK_REASON.MANUAL, LOCK_REASON.IDLE]).optional(),
});

const pinResetSchema = z.object({
  employeeId: z.string().uuid(),
});

const forceCloseSchema = z.object({
  closingCash: z.number().min(0).optional(),
  notes: z.string().optional(),
});

const policySchema = z.object({
  idleLockMinutes: z.number().int().min(0).max(60),
});

/** Every register route below needs a staff profile, not just a user account. */
function requireEmployee(req: AuthRequest): { employeeId: string; organizationId: string } | null {
  const employeeId = req.user?.employeeId;
  const organizationId = req.user?.organizationId;
  if (!employeeId || !organizationId) return null;
  return { employeeId, organizationId };
}

function noProfile(res: Response): void {
  res.status(400).json({ success: false, error: 'No employee profile is linked to this account' });
}

// PIN guessing is the one attack this whole feature exists to stop, so the two
// PIN endpoints get a shared (cross-instance) limiter keyed by the STAFF PROFILE
// rather than the IP — a whole shop floor shares one address, and an attacker
// cycling one cashier's code must not gain budget from that.
const pinRateLimiter = rateLimiter({
  name: 'register-pin',
  maxRequests: 12,
  windowSeconds: 60,
  shared: true,
  keyFn: (req: any) => `pin:${req.user?.employeeId || req.ip || 'unknown'}`,
});

// GET /api/registers/policy — drawer-lock policy for the organization.
// Mounted before the router-wide handlers so it is never shadowed.
router.get('/policy', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const settings = await prisma.storeSettings.findFirst({
      where: { organizationId: req.user!.organizationId! },
      select: { registerIdleLockMinutes: true },
    });
    const minutes = normalizeIdleMinutes(settings?.registerIdleLockMinutes ?? DEFAULT_IDLE_LOCK_MINUTES);
    res.json({ success: true, data: { idleLockMinutes: minutes, autoLockEnabled: minutes > 0 } });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/registers/policy — supervisors decide how long an unattended
// register may sit before the screen locks itself.
router.put('/policy', authMiddleware, requireRole(...SUPERVISOR_ROLES), validateRequest(policySchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const minutes = normalizeIdleMinutes(req.body.idleLockMinutes);
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    const settings = await prisma.storeSettings.upsert({
      where: { organizationId },
      update: { registerIdleLockMinutes: minutes },
      create: { organizationId, storeName: org?.name || 'My Store', registerIdleLockMinutes: minutes },
    });
    res.json({ success: true, data: { idleLockMinutes: settings.registerIdleLockMinutes } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/registers — the floor's registers, each annotated with WHO (if
// anybody) currently holds its drawer. The annotation is what lets the POS warn
// "Register 2 is Maria's" instead of silently letting a second cashier ring
// through someone else's till. Cashiers only ever see that a register is taken;
// the holding colleague's identity is supervisor-only.
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const viewerId = req.user!.employeeId;
    const [registers, openSessions] = await Promise.all([
      prisma.register.findMany({
        where: { organizationId },
        include: { location: true },
        orderBy: { name: 'asc' },
      }),
      prisma.registerSession.findMany({
        where: { status: 'OPEN', register: { organizationId } },
        include: { employee: { include: { user: { select: { name: true } } } } },
        orderBy: { openedAt: 'desc' },
      }),
    ]);

    const holderByRegister = new Map(openSessions.map((s) => [s.registerId, s]));
    const data = registers.map((register) => {
      const held = holderByRegister.get(register.id);
      const mine = !!held && held.employeeId === viewerId;
      const occupied = !!held && !mine;
      return {
        ...register,
        available: !occupied,
        occupied,
        openSession: held
          ? {
              sessionId: held.id,
              locked: held.locked,
              mine,
              openedAt: held.openedAt,
              // Never leak a colleague's identity to another cashier.
              ...(isSupervisor(req.user!.role)
                ? { employeeId: held.employeeId, cashier: held.employee?.user?.name || 'Staff' }
                : {}),
            }
          : null,
      };
    });

    res.json({ success: true, data });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/registers
router.post('/', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const register = await prisma.register.create({
      data: { ...req.body, organizationId: req.user!.organizationId! },
    });
    res.status(201).json({ success: true, data: register });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/registers/session — the caller's own drawer, plus the state the POS
// needs to arm its lock screen (is a PIN configured? how long before idle
// lock?). Employee-scoped: one cashier can never read another's session.
router.get('/session', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const ctx = requireEmployee(req);
    if (!ctx) return noProfile(res);

    const [session, pin, settings] = await Promise.all([
      prisma.registerSession.findFirst({
        where: { employeeId: ctx.employeeId, status: 'OPEN' },
        include: { register: true },
        orderBy: { openedAt: 'desc' },
      }),
      loadPinState(ctx.employeeId),
      prisma.storeSettings.findFirst({
        where: { organizationId: ctx.organizationId },
        select: { registerIdleLockMinutes: true },
      }),
    ]);

    res.json({
      success: true,
      // `null` when this cashier holds no drawer (unchanged contract for older
      // clients); the extra flags travel with the session so the POS can arm its
      // lock screen in one round trip.
      data: session
        ? {
            ...session,
            locked: !!session.locked,
            lockReason: session.lockReason ?? null,
            pinConfigured: pin.pinConfigured,
            pinLock: pin.lock,
            idleLockMinutes: normalizeIdleMinutes(settings?.registerIdleLockMinutes ?? DEFAULT_IDLE_LOCK_MINUTES),
          }
        : null,
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/registers/open — Open register (start session)
router.post('/open', authMiddleware, validateRequest(sessionSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { registerId, openingCash } = req.body;
    const ctx = requireEmployee(req);
    if (!ctx) return noProfile(res);
    const { employeeId, organizationId } = ctx;

    // The register must belong to the caller's organization — a guessed uuid can
    // never attach a cashier to another tenant's drawer.
    const register = await prisma.register.findFirst({ where: { id: registerId, organizationId } });
    if (!register) {
      res.status(404).json({ success: false, error: 'Register not found for this business' });
      return;
    }

    // Check for existing open session
    const existing = await prisma.registerSession.findFirst({
      where: { employeeId, status: 'OPEN' },
    });
    if (existing) {
      res.status(409).json({
        success: false,
        code: 'SESSION_ALREADY_OPEN',
        message: 'You already have an open session. Close your current register first.',
        data: { sessionId: existing.id, registerId: existing.registerId },
      });
      return;
    }

    // One drawer, one cashier: somebody else already holds this register.
    const holder = await findRegisterHolder(registerId, organizationId);
    const decision = decideOpenRegister(employeeId, holder);
    if (decision !== 'OK') {
      const blocked = decision === 'LOCKED_TO_OTHER';
      res.status(409).json({
        success: false,
        code: decision,
        message: blocked
          ? `${register.name} is locked to another cashier's session. Use your own register.`
          : `${register.name} is already in use by another cashier. Use your own register.`,
        data: { registerId, locked: blocked },
      });
      return;
    }

    // A cashier may only take a drawer they can lock again — an un-PIN-ed
    // workstation is the exact hole this feature closes.
    if (!isSupervisor(req.user!.role)) {
      const pin = await loadPinState(employeeId);
      if (!pin.pinConfigured) {
        res.status(400).json({
          success: false,
          code: 'PIN_REQUIRED',
          error: 'Set your personal register PIN before opening a register',
        });
        return;
      }
    }

    const session = await prisma.$transaction(async (tx) => {
      const s = await tx.registerSession.create({
        data: { registerId, employeeId, openingCash },
        include: { register: true },
      });
      await tx.register.update({ where: { id: registerId }, data: { status: 'OPEN' } });
      return s;
    });

    await createAuditEvent({
      organizationId,
      actorId: employeeId,
      action: 'REGISTER_OPENED',
      resourceType: 'REGISTER',
      resourceId: registerId,
      newValue: { sessionId: session.id, openingCash },
    });

    res.status(201).json({ success: true, data: { ...session, locked: false } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/registers/close — Close register (end session)
router.post('/close', authMiddleware, validateRequest(closeSessionSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { closingCash, notes } = req.body;
    const ctx = requireEmployee(req);
    if (!ctx) return noProfile(res);
    const employeeId = ctx.employeeId;

    const session = await prisma.registerSession.findFirst({
      where: { employeeId, status: 'OPEN' },
      include: { register: true },
    });

    if (!session) {
      res.status(404).json({ success: false, message: 'No open session found' });
      return;
    }

    // Balancing a drawer is a money movement: it requires the PIN too.
    if (session.locked) {
      res.status(423).json({
        success: false,
        code: 'REGISTER_LOCKED',
        error: 'Register is locked. Unlock it with your PIN before closing.',
        data: { sessionId: session.id },
      });
      return;
    }

    // Calculate expected cash from orders in this session
    const orders = await prisma.order.findMany({
      where: { sessionId: session.id, status: { in: ['COMPLETED', 'PAID'] } },
      select: { totalAmount: true, payments: { where: { method: 'CASH' }, select: { amount: true } } },
    });

    const cashPayments = orders.reduce((sum: number, o: any) => sum + o.payments.reduce((s: number, p: any) => s + Number(p.amount), 0), 0);
    const expectedCash = Number(session.openingCash) + cashPayments;
    const variance = closingCash - expectedCash;

    const closed = await prisma.$transaction(async (tx) => {
      const s = await tx.registerSession.update({
        where: { id: session.id },
        data: { closingCash, expectedCash, variance, status: 'CLOSED', closedAt: new Date(), notes },
        include: { register: true },
      });
      await tx.register.update({ where: { id: session.registerId }, data: { status: 'CLOSED' } });
      return s;
    });

    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: employeeId,
      action: 'REGISTER_CLOSED',
      resourceType: 'REGISTER',
      resourceId: session.registerId,
      newValue: { sessionId: session.id, closingCash, expectedCash, variance },
    });

    res.json({ success: true, data: closed });
  } catch (error) {
    handleError(error, res);
  }
});

// ── Individual register PIN + drawer lock (§37 / §7) ────────────────────────

// GET /api/registers/pin — the caller's own PIN state (never the PIN itself).
router.get('/pin', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const ctx = requireEmployee(req);
    if (!ctx) return noProfile(res);
    const pin = await loadPinState(ctx.employeeId);
    res.json({ success: true, data: pin });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/registers/pin — set (or rotate) the caller's OWN register PIN.
// Rotating an existing PIN requires the current one, so a colleague who walks
// past an unlocked screen cannot quietly take over somebody's code. Setting the
// first PIN (or a supervisor-reset one) also releases any lock on the caller's
// own drawer. SECURITY: only the bcrypt hash is persisted; the audit event never
// carries PIN material.
router.post('/pin', authMiddleware, pinRateLimiter, validateRequest(pinSetupSchema), async (req: AuthRequest, res: Response) => {
  try {
    const ctx = requireEmployee(req);
    if (!ctx) return noProfile(res);
    const { employeeId, organizationId } = ctx;
    const { pin: candidate, currentPin } = req.body;

    const issue = validateRegisterPin(candidate);
    if (issue) {
      res.status(400).json({ success: false, code: 'PIN_WEAK', error: pinIssueMessage(issue) });
      return;
    }

    const existing = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { registerPin: true },
    });

    if (existing?.registerPin) {
      const check = await consumePinAttempt(employeeId, String(currentPin || ''));
      if (!check.ok) {
        await createAuditEvent({
          organizationId,
          actorId: employeeId,
          action: 'REGISTER_PIN_VERIFY_FAILED',
          resourceType: 'EMPLOYEE',
          resourceId: employeeId,
          newValue: { purpose: 'ROTATE', retryAfterSeconds: check.lock.retryAfterSeconds },
        });
        // 403 (not 401): the app session is still valid — only this drawer-level
        // re-authentication failed. A 401 would make clients drop the session.
        res.status(check.lock.locked ? 423 : 403).json({
          success: false,
          code: check.lock.locked ? 'PIN_COOLDOWN' : 'PIN_INVALID',
          error: check.lock.locked
            ? `Too many incorrect attempts. Try again in ${Math.ceil(check.lock.retryAfterSeconds / 60)} minute(s).`
            : 'Current PIN is incorrect',
          data: { remainingAttempts: check.lock.remainingAttempts, retryAfterSeconds: check.lock.retryAfterSeconds },
        });
        return;
      }
    }

    await prisma.employee.update({
      where: { id: employeeId },
      data: {
        registerPin: await hashRegisterPin(String(candidate)),
        pinUpdatedAt: new Date(),
        pinFailedAttempts: 0,
        pinLockedUntil: null,
      },
    });

    await createAuditEvent({
      organizationId,
      actorId: employeeId,
      action: existing?.registerPin ? 'REGISTER_PIN_CHANGED' : 'REGISTER_PIN_SET',
      resourceType: 'EMPLOYEE',
      resourceId: employeeId,
    });

    // A supervisor-reset PIN leaves the drawer locked with no way back in; this
    // is the moment the cashier can reclaim it.
    const session = await prisma.registerSession.findFirst({
      where: { employeeId, status: 'OPEN', locked: true },
    });
    if (session) {
      await prisma.registerSession.update({
        where: { id: session.id },
        data: { locked: false, lockedAt: null, lockReason: null },
      });
    }

    res.status(existing?.registerPin ? 200 : 201).json({
      success: true,
      data: { pinConfigured: true, sessionUnlocked: !!session },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/registers/pin/reset — a supervisor clears a forgotten PIN. The
// cashier must then choose a new one (which reopens their own drawer). Fully
// audited with the acting supervisor, because this is the one path that can put
// a colleague back behind a locked till.
router.post('/pin/reset', authMiddleware, requireRole(...SUPERVISOR_ROLES), validateRequest(pinResetSchema), async (req: AuthRequest, res: Response) => {
  try {
    const ctx = requireEmployee(req);
    if (!ctx) return noProfile(res);
    const { employeeId: targetId } = req.body;

    // Scoped to the caller's organization — no cross-tenant PIN clearing.
    const target = await prisma.employee.findFirst({
      where: { id: targetId, organizationId: ctx.organizationId },
      include: { user: { select: { name: true } } },
    });
    if (!target) {
      res.status(404).json({ success: false, error: 'Employee not found in this business' });
      return;
    }

    await prisma.employee.update({
      where: { id: target.id },
      data: { registerPin: null, pinFailedAttempts: 0, pinLockedUntil: null, pinUpdatedAt: new Date() },
    });

    const stuckSession = await prisma.registerSession.findFirst({ where: { employeeId: target.id, status: 'OPEN' } });
    if (stuckSession?.locked) {
      await prisma.registerSession.update({
        where: { id: stuckSession.id },
        data: { locked: false, lockedAt: null, lockReason: null },
      });
    }

    await createAuditEvent({
      organizationId: ctx.organizationId,
      actorId: ctx.employeeId,
      action: 'REGISTER_PIN_RESET',
      resourceType: 'EMPLOYEE',
      resourceId: target.id,
      newValue: { targetName: target.user?.name, sessionReleased: !!stuckSession?.locked },
    });

    res.json({ success: true, data: { employeeId: target.id, pinConfigured: false } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/registers/lock — step away from the drawer. Locks the CALLER's own
// open session; there is deliberately no way to lock someone else's.
router.post('/lock', authMiddleware, validateRequest(lockSchema), async (req: AuthRequest, res: Response) => {
  try {
    const ctx = requireEmployee(req);
    if (!ctx) return noProfile(res);
    const { employeeId, organizationId } = ctx;
    const reason = req.body.reason === LOCK_REASON.IDLE ? LOCK_REASON.IDLE : LOCK_REASON.MANUAL;

    const session = await prisma.registerSession.findFirst({
      where: { employeeId, status: 'OPEN' },
      include: { register: { select: { name: true } } },
      orderBy: { openedAt: 'desc' },
    });
    if (!session) {
      res.status(404).json({ success: false, code: 'NO_OPEN_SESSION', error: 'No open register to lock' });
      return;
    }

    const pin = await loadPinState(employeeId);
    if (!pin.pinConfigured) {
      // Nothing to lock behind: refuse instead of trapping the cashier.
      res.status(400).json({
        success: false,
        code: 'PIN_REQUIRED',
        error: 'Set your personal register PIN before locking this register',
      });
      return;
    }

    if (session.locked) {
      res.json({ success: true, data: { ...session, alreadyLocked: true } });
      return;
    }

    const locked = await prisma.registerSession.update({
      where: { id: session.id },
      data: { locked: true, lockedAt: new Date(), lockReason: reason, lockedCount: { increment: 1 } },
      include: { register: true },
    });

    await createAuditEvent({
      organizationId,
      actorId: employeeId,
      action: 'REGISTER_LOCKED',
      resourceType: 'REGISTER',
      resourceId: session.registerId,
      newValue: { sessionId: session.id, reason, register: session.register?.name },
    });

    res.json({ success: true, data: locked });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/registers/unlock — the cashier's individual code gets them back in.
// Wrong guesses are counted per employee and freeze the PIN briefly, and a
// session can only ever be unlocked by the employee who owns it.
router.post('/unlock', authMiddleware, pinRateLimiter, validateRequest(unlockSchema), async (req: AuthRequest, res: Response) => {
  try {
    const ctx = requireEmployee(req);
    if (!ctx) return noProfile(res);
    const { employeeId, organizationId } = ctx;

    const session = await prisma.registerSession.findFirst({
      where: { employeeId, status: 'OPEN' },
      include: { register: { select: { name: true } } },
      orderBy: { openedAt: 'desc' },
    });
    if (!session) {
      res.status(404).json({ success: false, code: 'NO_OPEN_SESSION', error: 'No locked register to unlock — open a register first' });
      return;
    }

    const pin = await loadPinState(employeeId);
    if (!pin.pinConfigured) {
      // Supervisor cleared the PIN: let the cashier set a new one to get back in.
      res.status(400).json({
        success: false,
        code: 'PIN_REQUIRED',
        error: 'No PIN is set for this account. Create a new register PIN to continue.',
      });
      return;
    }

    const attempt = await consumePinAttempt(employeeId, String(req.body.pin));
    if (!attempt.ok) {
      await createAuditEvent({
        organizationId,
        actorId: employeeId,
        action: 'REGISTER_UNLOCK_DENIED',
        resourceType: 'REGISTER',
        resourceId: session.registerId,
        newValue: { sessionId: session.id, retryAfterSeconds: attempt.lock.retryAfterSeconds },
      });
      res.status(attempt.lock.locked ? 423 : 403).json({
        success: false,
        code: attempt.lock.locked ? 'PIN_COOLDOWN' : 'PIN_INVALID',
        error: attempt.lock.locked
          ? `Incorrect PIN too many times. Try again in ${Math.ceil(attempt.lock.retryAfterSeconds / 60)} minute(s).`
          : 'Incorrect PIN',
        data: {
          locked: !!session.locked,
          remainingAttempts: attempt.lock.remainingAttempts,
          retryAfterSeconds: attempt.lock.retryAfterSeconds,
        },
      });
      return;
    }

    const unlocked = await prisma.registerSession.update({
      where: { id: session.id },
      data: { locked: false, lockedAt: null, lockReason: null },
      include: { register: true },
    });

    await createAuditEvent({
      organizationId,
      actorId: employeeId,
      action: 'REGISTER_UNLOCKED',
      resourceType: 'REGISTER',
      resourceId: session.registerId,
      newValue: { sessionId: session.id, method: 'PIN' },
    });

    res.json({ success: true, data: unlocked });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/registers/sessions/active — supervisor view of every open drawer:
// who holds it, whether it is locked, and whether a PIN is configured at all.
router.get('/sessions/active', authMiddleware, requireRole(...SUPERVISOR_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const sessions = await prisma.registerSession.findMany({
      where: { status: 'OPEN', register: { organizationId: req.user!.organizationId! } },
      include: {
        register: {
          select: { id: true, name: true, locationId: true, location: { select: { name: true } } },
        },
        employee: {
          select: {
            id: true,
            employeeNumber: true,
            registerPin: true,
            pinLockedUntil: true,
            user: { select: { name: true, email: true, role: true } },
          },
        },
      },
      orderBy: { openedAt: 'desc' },
    });

    res.json({
      success: true,
      data: sessions.map((s) => ({
        sessionId: s.id,
        registerId: s.registerId,
        registerName: s.register?.name || 'Register',
        locationName: s.register?.location?.name || null,
        employeeId: s.employeeId,
        cashier: s.employee?.user?.name || 'Staff',
        cashierRole: s.employee?.user?.role || null,
        employeeNumber: s.employee?.employeeNumber || null,
        pinConfigured: !!s.employee?.registerPin,
        openingCash: s.openingCash,
        openedAt: s.openedAt,
        locked: s.locked,
        lockReason: s.lockReason,
        lockedAt: s.lockedAt,
        lockedCount: s.lockedCount,
      })),
    });
  } catch (error) {
    handleError(error, res);
  }
});

// Resolve an open session by id INSIDE the caller's organization, or answer the
// client and return null. Shared by the supervisor force routes below.
async function findManagedSession(req: AuthRequest, res: Response) {
  const session = await prisma.registerSession.findFirst({
    where: { id: String(req.params.id), register: { organizationId: req.user!.organizationId! } },
    include: {
      register: { select: { name: true } },
      employee: { include: { user: { select: { name: true } } } },
    },
  });
  if (!session) {
    res.status(404).json({ success: false, error: 'Open session not found for this business' });
    return null;
  }
  return session;
}

// POST /api/registers/sessions/:id/unlock — supervisor override for a cashier who
// cannot get back in (forgotten PIN, sick day, shift handover). Always audited
// against the acting supervisor, never silently.
router.post('/sessions/:id/unlock', authMiddleware, requireRole(...SUPERVISOR_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const session = await findManagedSession(req, res);
    if (!session) return;
    if (!session.locked) {
      res.json({ success: true, data: { sessionId: session.id, alreadyUnlocked: true } });
      return;
    }

    const updated = await prisma.registerSession.update({
      where: { id: session.id },
      data: { locked: false, lockedAt: null, lockReason: null },
      include: { register: true },
    });

    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: 'REGISTER_FORCE_UNLOCKED',
      resourceType: 'REGISTER',
      resourceId: session.registerId,
      previousValue: { locked: true, lockReason: session.lockReason },
      newValue: { sessionId: session.id, owner: session.employee?.user?.name, method: 'SUPERVISOR' },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/registers/sessions/:id/close — take a stuck or abandoned drawer off
// the floor at end of shift (supervisor override of a session not owned by the
// caller). Cash counts exactly like a self-close so the variance is real.
router.post('/sessions/:id/close', authMiddleware, requireRole(...SUPERVISOR_ROLES), validateRequest(forceCloseSchema), async (req: AuthRequest, res: Response) => {
  try {
    const session = await findManagedSession(req, res);
    if (!session) return;
    const { closingCash, notes } = req.body;

    const orders = await prisma.order.findMany({
      where: { sessionId: session.id, status: { in: ['COMPLETED', 'PAID'] } },
      select: { totalAmount: true, payments: { where: { method: 'CASH' }, select: { amount: true } } },
    });
    const cashPayments = orders.reduce(
      (sum: number, o: any) => sum + o.payments.reduce((s: number, p: any) => s + Number(p.amount), 0),
      0,
    );
    const expectedCash = Number(session.openingCash) + cashPayments;
    const countable = typeof closingCash === 'number';
    const variance = countable ? Number(closingCash) - expectedCash : null;

    const closed = await prisma.$transaction(async (tx) => {
      const s = await tx.registerSession.update({
        where: { id: session.id },
        data: {
          closingCash: countable ? closingCash : null,
          expectedCash,
          variance,
          status: 'CLOSED',
          closedAt: new Date(),
          locked: false,
          lockedAt: null,
          lockReason: null,
          notes: [notes, 'Closed by supervisor'].filter(Boolean).join(' — ') || null,
        },
        include: { register: true },
      });
      await tx.register.update({ where: { id: session.registerId }, data: { status: 'CLOSED' } });
      return s;
    });

    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: 'REGISTER_FORCE_CLOSED',
      resourceType: 'REGISTER',
      resourceId: session.registerId,
      newValue: {
        sessionId: session.id,
        owner: session.employee?.user?.name,
        expectedCash,
        closingCash: closingCash ?? null,
        variance,
      },
    });

    res.json({ success: true, data: closed });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
