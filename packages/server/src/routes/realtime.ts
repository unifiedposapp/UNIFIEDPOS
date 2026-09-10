// ─── Real-time SSE stream ────────────────────────────────────────────────────
// GET /api/realtime/stream opens a Server-Sent Events channel scoped to the
// caller's organization. The browser's EventSource cannot set an Authorization
// header, so we accept the JWT from (in order) the ?token= query param, the
// httpOnly session cookie, or a Bearer header. Every §27 business event for the
// org is streamed to the client (see services/realtime.ts + eventBus bridge).

import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../services/crypto.js';
import { SESSION_COOKIE } from '../services/session.js';
import { AuthRequest } from '../middleware/auth.js';
import { addClient, realtimeClientCount, realtimeChannelStats } from '../services/realtime.js';

const router = Router();

interface TokenPayload {
  id: string;
  email: string;
  role: string;
  organizationId?: string;
  employeeId?: string;
}

/** Resolve + verify the caller's JWT from query token, session cookie, or header. */
function resolveUser(req: AuthRequest): TokenPayload | null {
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
  const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
  const cookieToken = (req as any).cookies?.[SESSION_COOKIE] as string | undefined;
  const token = queryToken || bearer || cookieToken;
  if (!token) return null;
  try {
    return jwt.verify(token, getJwtSecret()) as TokenPayload;
  } catch {
    return null;
  }
}

// GET /api/realtime/stream?token=... — open the SSE channel
router.get('/stream', (req: AuthRequest, res: Response) => {
  const user = resolveUser(req);
  if (!user || !user.organizationId) {
    res.status(401).json({ success: false, error: 'Authentication required for the real-time stream' });
    return;
  }

  const { dispose } = addClient(user.organizationId, res, { userId: user.id });

  // Clean up when the browser closes the stream or the socket drops.
  req.on('close', dispose);
  res.on('error', dispose);
});

// GET /api/realtime/status — small introspection endpoint (subscriber counts)
router.get('/status', (req: AuthRequest, res: Response) => {
  const user = resolveUser(req);
  if (!user) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }
  res.json({
    success: true,
    data: {
      totalClients: realtimeClientCount(),
      channels: realtimeChannelStats(),
    },
  });
});

export default router;
