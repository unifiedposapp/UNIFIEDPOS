// ─── Web Push subscriptions (§ real-time push) ───────────────────────────────
// The browser registers a service worker, subscribes via PushManager using the
// VAPID public key, and POSTs the resulting subscription here. On notable events
// the server fans a notification out (services/webpush.ts). All routes require
// auth; key generation is OWNER-only.

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { isWebPushConfigured, notifySubscribers, generateVapidKeys } from '../services/webpush.js';

const router = Router();

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  userAgent: z.string().optional(),
});

// GET /api/push/config — public VAPID key + whether push is enabled
router.get('/config', (_req, res: Response) => {
  res.json({
    success: true,
    data: {
      enabled: isWebPushConfigured(),
      publicKey: process.env.VAPID_PUBLIC_KEY || null,
      applicationServerKey: process.env.VAPID_PUBLIC_KEY || null,
    },
  });
});

// POST /api/push/subscribe — register/update this browser's push subscription
router.post('/subscribe', authMiddleware, validateRequest(subscribeSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { endpoint, keys, userAgent } = req.body;
    const sub = await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { p256dh: keys.p256dh, auth: keys.auth, userId: req.user!.id, organizationId: orgId, userAgent },
      create: { organizationId: orgId, userId: req.user!.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent },
    });
    res.status(201).json({ success: true, data: { id: sub.id, enabled: isWebPushConfigured() } });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/push/subscribe — unsubscribe (body carries the endpoint)
router.delete('/subscribe', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const endpoint = String(req.body?.endpoint || req.query?.endpoint || '');
    if (!endpoint) return res.status(400).json({ success: false, message: 'endpoint is required' });
    await prisma.pushSubscription.deleteMany({ where: { endpoint, organizationId: req.user!.organizationId! } });
    res.json({ success: true, message: 'Unsubscribed' });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/push/subscriptions — list this org's subscriptions (admin view)
router.get('/subscriptions', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const subs = await prisma.pushSubscription.findMany({
      where: { organizationId: req.user!.organizationId! },
      orderBy: { createdAt: 'desc' },
      select: { id: true, userId: true, userAgent: true, createdAt: true, endpoint: true },
    });
    // Never leak the full endpoint/keys to the admin UI — show a fingerprint.
    res.json({ success: true, data: subs.map((s) => ({ ...s, endpoint: `${s.endpoint.slice(0, 42)}…` })) });
  } catch (error) {
    handleError(error, res);
  }
});

const testSchema = z.object({ title: z.string().optional(), body: z.string().optional() });

// POST /api/push/test — send a test push to the caller's own subscriptions
router.post('/test', authMiddleware, validateRequest(testSchema), async (req: AuthRequest, res: Response) => {
  try {
    const result = await notifySubscribers(
      req.user!.organizationId!,
      { title: req.body.title || 'UnifiedPOS test', body: req.body.body || 'Web push is working.', tag: 'test' },
      { userId: req.user!.id }
    );
    res.json({ success: true, data: result });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/push/vapid-keys — OWNER-only: generate a fresh VAPID key pair to put
// into VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY. Convenience for first-time setup.
router.get('/vapid-keys', authMiddleware, requireRole('OWNER'), (_req: AuthRequest, res: Response) => {
  try {
    const keys = generateVapidKeys();
    res.json({
      success: true,
      data: {
        ...keys,
        subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
        note: 'Set these as VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT and restart the server.',
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
