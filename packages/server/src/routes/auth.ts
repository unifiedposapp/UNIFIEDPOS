import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { createAuditEvent } from '../services/audit.js';
import { getJwtSecret, generateBase32Secret, verifyTotp, otpauthUrl } from '../services/crypto.js';
import { isValidCurrency, normalizeCurrency } from '../data/currencies.js';
import { setSessionCookies, clearSessionCookies, issueCsrfToken } from '../services/session.js';
import { sendPasswordResetEmail, canExposeResetToken } from '../services/email.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const createUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  name: z.string().min(1, 'Name is required'),
  role: z.enum(['OWNER', 'ADMIN', 'MANAGER', 'CASHIER']),
});

const registerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters')
    .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), 'Password must include upper-case, lower-case and a number'),
  organizationName: z.string().min(1, 'Business name is required'),
  country: z.string().min(1, 'Country is required'),
  countryCode: z.string().length(2, 'Invalid country code'),
  currency: z.string().min(3).max(3).optional()
    .refine((c) => !c || isValidCurrency(c), 'Currency must be a valid ISO 4217 code (e.g. USD, EUR, NGN)'),
  industry: z.string().optional(),
  phone: z.string().optional(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters')
    .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), 'Password must include upper-case, lower-case and a number'),
});

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

function signToken(user: { id: string; email: string; role: string }, organizationId?: string, employeeId?: string) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, organizationId, employeeId },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' } as any
  );
}

// Issues the session cookies AND returns the token in the body (dual-mode).
// Shared by /login and /mfa/verify so both set cookies identically.
function respondWithSession(
  res: Response,
  user: { id: string; email: string; name: string; role: string; isActive: boolean },
  employee: { id: string; employeeNumber?: string | null } | null,
  token: string
) {
  setSessionCookies(res, token, issueCsrfToken());
  res.json({ success: true, data: { user, employee, token } });
}

// POST /api/auth/register — public self-service account creation (any country)
router.post('/register', validateRequest(registerSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { name, email, password, organizationName, country, countryCode, currency, industry, phone } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ success: false, error: 'An account with this email already exists' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: organizationName,
          industry: industry || 'RETAIL',
          currency: normalizeCurrency(currency) || 'USD',
          country,
          countryCode: countryCode.toUpperCase(),
          phone,
          email,
        },
      });

      const user = await tx.user.create({
        data: { email, password: hashedPassword, name, role: 'OWNER', isActive: true },
        select: { id: true, email: true, name: true, role: true, isActive: true },
      });

      const location = await tx.location.create({
        data: { organizationId: organization.id, name: 'Main Location', address: country, isActive: true },
      });

      const employee = await tx.employee.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          employeeNumber: 'EMP-001',
          department: 'Management',
          position: 'OWNER',
          isActive: true,
        },
      });

      await tx.employeeLocation.create({ data: { employeeId: employee.id, locationId: location.id } });

      return { user, organization, employee };
    });

    const token = signToken(result.user, result.organization.id, result.employee.id);

    // Set httpOnly session + CSRF cookies (dual-mode with the returned token).
    setSessionCookies(res, token, issueCsrfToken());

    res.status(201).json({
      success: true,
      data: {
        user: result.user,
        employee: { id: result.employee.id, employeeNumber: result.employee.employeeNumber },
        organization: result.organization,
        token,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/auth/forgot-password — issue a single-use reset token (15 min) and
// email a reset link. The response is UNIFORM so it never reveals whether an
// account exists. SECURITY: in production the raw token is NEVER returned to the
// caller — it is only ever emailed. In local dev with no mail provider the token
// is surfaced inline so the flow is testable, gated by canExposeResetToken().
router.post('/forgot-password', validateRequest(forgotPasswordSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    // Always respond the same to avoid leaking which emails are registered.
    const uniformMessage = 'If that account exists, a password reset link has been sent. Check your inbox.';
    if (!user || !user.isActive) {
      res.json({ success: true, message: uniformMessage });
      return;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken: hashToken(rawToken), resetTokenExpires: new Date(Date.now() + 15 * 60 * 1000) },
    });

    // Email the reset link. sendPasswordResetEmail never throws and returns only
    // delivery metadata — never the token — so it cannot leak secret material.
    const delivery = await sendPasswordResetEmail(user.email, rawToken, { expiresMinutes: 15 });

    // Fail-closed exposure: ONLY a non-production request whose email did not
    // actually deliver may see the raw token (local dev convenience).
    if (canExposeResetToken(process.env.NODE_ENV, delivery.delivered)) {
      res.json({
        success: true,
        message:
          'Dev mode: no email provider configured, so the reset token is returned inline. Set RESEND_API_KEY / SENDGRID_API_KEY / SMTP_HOST (or NODE_ENV=production) to email it instead.',
        data: { resetToken: rawToken, expiresInMinutes: 15, delivery: 'dev-inline' },
      });
      return;
    }

    if (!delivery.delivered) {
      // Provider configured (or production) but delivery failed: do NOT leak the
      // token. Log server-side for ops; the client still sees the uniform message.
      console.error(`[auth] password-reset email not delivered to ${user.email}: ${delivery.reason || 'unknown'}`);
    }

    res.json({ success: true, message: uniformMessage });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/auth/reset-password — consume a valid reset token and set a new password
router.post('/reset-password', validateRequest(resetPasswordSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { token, password } = req.body;
    const user = await prisma.user.findFirst({ where: { resetToken: hashToken(token) } });

    if (!user || !user.resetTokenExpires || user.resetTokenExpires < new Date()) {
      res.status(400).json({ success: false, error: 'Invalid or expired reset token' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, resetToken: null, resetTokenExpires: null },
    });

    res.json({ success: true, message: 'Password has been reset. You can now sign in.' });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/auth/login
router.post('/login', validateRequest(loginSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    // §37 account lockout — refuse sign-in while a temporary lock is active.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      res.status(423).json({ success: false, error: 'Account temporarily locked after too many failed attempts. Try again later.' });
      return;
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      const attempts = user.failedLoginAttempts + 1;
      const lock = attempts >= 5;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: attempts, lockedUntil: lock ? new Date(Date.now() + 15 * 60 * 1000) : user.lockedUntil },
      });
      res.status(401).json({ success: false, error: lock ? 'Too many failed attempts. Account locked for 15 minutes.' : 'Invalid credentials' });
      return;
    }

    // Successful password check — clear the lockout counter.
    if (user.failedLoginAttempts !== 0 || user.lockedUntil) {
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
    }

    // §37 MFA — when enabled, require a second factor before issuing a session.
    if (user.mfaEnabled) {
      const mfaToken = jwt.sign({ id: user.id, scope: 'mfa' }, getJwtSecret(), { expiresIn: '5m' } as any);
      res.json({ success: true, data: { mfaRequired: true, mfaToken } });
      return;
    }

    // Get employee record if exists
    const employee = await prisma.employee.findUnique({ where: { userId: user.id } });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, organizationId: employee?.organizationId, employeeId: employee?.id },
      getJwtSecret(),
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' } as any
    );

    respondWithSession(
      res,
      { id: user.id, email: user.email, name: user.name, role: user.role, isActive: user.isActive },
      employee ? { id: employee.id, employeeNumber: employee.employeeNumber } : null,
      token
    );
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { employee: { include: { organization: true } } },
    });

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const { password, ...userWithoutPassword } = user;

    res.json({
      success: true,
      data: {
        ...userWithoutPassword,
        organization: user.employee?.organization,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/auth/users
router.get('/users', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (_req: AuthRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: users });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/auth/users
router.post('/users', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(createUserSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { email, password, name, role } = req.body;
    const orgId = req.user!.organizationId;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ success: false, error: 'Email already in use' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: { email, password: hashedPassword, name, role },
        select: { id: true, email: true, name: true, role: true, isActive: true },
      });

      if (orgId) {
        await tx.employee.create({
          data: { organizationId: orgId, userId: newUser.id, position: role },
        });
      }

      return newUser;
    });

    if (orgId) {
      await createAuditEvent({ organizationId: orgId, actorId: req.user!.employeeId, action: 'EMPLOYEE_CREATED', resourceType: 'EMPLOYEE', newValue: { userId: user.id, role } });
    }

    res.status(201).json({ success: true, data: user });
  } catch (error) {
    handleError(error, res);
  }
});

// ── MFA / TOTP (§37 Security Architecture) ──────────────────────────────────
const mfaCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });
const mfaVerifySchema = z.object({
  mfaToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

// GET /api/auth/mfa/status — whether MFA is enabled for the current user.
router.get('/mfa/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { mfaEnabled: true } });
    res.json({ success: true, data: { mfaEnabled: !!user?.mfaEnabled } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/auth/mfa/setup — provision a TOTP secret (not yet enabled).
router.post('/mfa/setup', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const secret = generateBase32Secret();
    await prisma.user.update({ where: { id: req.user!.id }, data: { mfaSecret: secret, mfaEnabled: false } });
    res.json({ success: true, data: { secret, otpauthUrl: otpauthUrl(secret, req.user!.email) } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/auth/mfa/enable — confirm a code to activate MFA.
router.post('/mfa/enable', authMiddleware, validateRequest(mfaCodeSchema), async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user?.mfaSecret) {
      res.status(400).json({ success: false, error: 'Run MFA setup first' });
      return;
    }
    if (!verifyTotp(user.mfaSecret, req.body.code)) {
      res.status(400).json({ success: false, error: 'Invalid code' });
      return;
    }
    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    res.json({ success: true, data: { mfaEnabled: true } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/auth/mfa/disable — turn MFA off (requires a valid code).
router.post('/mfa/disable', authMiddleware, validateRequest(mfaCodeSchema), async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user?.mfaEnabled || !user.mfaSecret) {
      res.status(400).json({ success: false, error: 'MFA is not enabled' });
      return;
    }
    if (!verifyTotp(user.mfaSecret, req.body.code)) {
      res.status(400).json({ success: false, error: 'Invalid code' });
      return;
    }
    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecret: null } });
    res.json({ success: true, data: { mfaEnabled: false } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/auth/mfa/verify — exchange an MFA challenge token for a session.
router.post('/mfa/verify', validateRequest(mfaVerifySchema), async (req: AuthRequest, res: Response) => {
  try {
    let payload: any;
    try {
      payload = jwt.verify(req.body.mfaToken, getJwtSecret());
    } catch {
      res.status(401).json({ success: false, error: 'Invalid or expired MFA challenge' });
      return;
    }
    if (payload?.scope !== 'mfa') {
      res.status(401).json({ success: false, error: 'Invalid MFA challenge' });
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      res.status(401).json({ success: false, error: 'MFA not configured' });
      return;
    }
    if (!verifyTotp(user.mfaSecret, req.body.code)) {
      res.status(401).json({ success: false, error: 'Invalid code' });
      return;
    }
    const employee = await prisma.employee.findUnique({ where: { userId: user.id } });
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, organizationId: employee?.organizationId, employeeId: employee?.id },
      getJwtSecret(),
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' } as any
    );
    respondWithSession(
      res,
      { id: user.id, email: user.email, name: user.name, role: user.role, isActive: user.isActive },
      employee ? { id: employee.id, employeeNumber: employee.employeeNumber } : null,
      token
    );
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/auth/logout — clear the httpOnly session + CSRF cookies.
router.post('/logout', (_req: AuthRequest, res: Response) => {
  clearSessionCookies(res);
  res.json({ success: true, data: { loggedOut: true } });
});

export default router;
