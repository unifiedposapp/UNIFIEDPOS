import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/client.js';

/**
 * Idempotency middleware (§36 Idempotency)
 *
 * Ensures that repeated requests with the same idempotency key return the
 * original result rather than creating duplicate business actions.
 *
 * Mandatory for: Orders, Payments, Refunds, Inventory movements, Sync, Webhooks
 *
 * Usage: Client sends `Idempotency-Key` header.
 * Server checks if a response for that key already exists.
 * If yes → return the cached response.
 * If no → claim the key, process the request, persist the response, return it.
 *
 * Backing store: PostgreSQL (IdempotencyKey). The previous in-memory Map lost
 * keys on restart and never shared state across instances, so two servers (or a
 * redeploy) could both process the same key → double charge. The DB unique
 * constraint on (scope, key, method, path) is the concurrency guard: exactly one
 * request can own a key at a time, and losers back off with 409.
 */

const PROCESSING = 'PROCESSING';
const COMPLETED = 'COMPLETED';

export function idempotencyMiddleware(options?: { ttlSeconds?: number }) {
  const ttlMs = (options?.ttlSeconds || 24 * 60 * 60) * 1000; // Default 24 hours

  return async (req: Request, res: Response, next: NextFunction) => {
    const idempotencyKey = req.headers['idempotency-key'] as string;

    // If no idempotency key, skip
    if (!idempotencyKey) {
      return next();
    }

    // Only apply to state-changing methods
    if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
      return next();
    }

    // Capture the FULL request path now. During route handling Express strips
    // the mount prefix (req.path becomes router-relative, e.g. "/"), so the
    // store inside the res.json interceptor would otherwise use a different
    // path than this lookup — breaking replay dedupe (§36 Idempotency).
    const requestPath = req.path;

    try {
      // This middleware runs globally, BEFORE the per-route authMiddleware, so
      // req.user is not populated yet. Decode the JWT here to derive the
      // idempotency scope (organization + user) — §36 Idempotency.
      const authHeader = req.headers.authorization?.replace('Bearer ', '');
      let scope: string | null = null;
      if (authHeader) {
        try {
          const decoded = jwt.verify(authHeader, process.env.JWT_SECRET || 'fallback-secret') as any;
          if (decoded?.organizationId) {
            scope = `${decoded.organizationId}:${decoded.id || 'anon'}`;
          }
        } catch {
          // Invalid/expired token — let authMiddleware reject it downstream.
        }
      }
      // No authenticated subject (e.g. public endpoints) → nothing to dedupe.
      if (!scope) {
        return next();
      }

      const keyWhere = { scope, idempotencyKey, method: req.method, path: requestPath };
      const now = Date.now();

      // Have we already seen this key?
      const existing = await prisma.idempotencyKey.findUnique({
        where: { scope_idempotencyKey_method_path: keyWhere },
      });

      if (existing) {
        const expired = existing.expiresAt.getTime() <= now;
        if (!expired && existing.status === COMPLETED && existing.responseBody != null) {
          // Replay the original response.
          return res.status(existing.responseStatus || 200).json(JSON.parse(existing.responseBody));
        }
        if (!expired && existing.status === PROCESSING) {
          // A concurrent request is still in flight — refuse rather than risk a
          // duplicate side effect (e.g. a second charge).
          return res.status(409).json({
            success: false,
            message: 'A request with this Idempotency-Key is already being processed. Retry shortly.',
          });
        }
        // Expired, or a stale PROCESSING row left by a crashed request — clear it
        // and re-claim below.
        await prisma.idempotencyKey.delete({ where: { id: existing.id } }).catch(() => {});
      }

      // Claim the key atomically. The unique constraint means only one concurrent
      // request can win; the loser gets P2002 and backs off.
      try {
        await prisma.idempotencyKey.create({
          data: { ...keyWhere, status: PROCESSING, expiresAt: new Date(now + ttlMs) },
        });
      } catch (raceErr: any) {
        if (raceErr?.code === 'P2002') {
          return res.status(409).json({
            success: false,
            message: 'A request with this Idempotency-Key is already being processed. Retry shortly.',
          });
        }
        throw raceErr;
      }

      // Intercept the response to persist it for future idempotent replays.
      const originalJson = res.json.bind(res);
      const originalStatus = res.status.bind(res);
      let statusCode = 200;

      res.status = ((code: number) => {
        statusCode = code;
        return originalStatus(code);
      }) as any;

      res.json = ((body: any) => {
        let serialized: string;
        try {
          serialized = JSON.stringify(body);
        } catch {
          serialized = 'null';
        }
        prisma.idempotencyKey
          .updateMany({
            where: { ...keyWhere, status: PROCESSING },
            data: { status: COMPLETED, responseStatus: statusCode, responseBody: serialized },
          })
          .catch((err) => console.error('Failed to store idempotency record:', err));

        return originalJson(body);
      }) as any;

      next();
    } catch (error) {
      console.error('Idempotency middleware error:', error);
      // Don't block the request if the idempotency check fails.
      next();
    }
  };
}

// Periodically purge expired rows so the table doesn't grow unbounded. Safe to
// run on every instance (idempotent deleteMany). unref() so the timer never
// keeps the process alive on its own (e.g. in tests).
setInterval(() => {
  prisma.idempotencyKey
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch((err) => console.error('Idempotency cleanup failed:', err));
}, 10 * 60 * 1000).unref();
