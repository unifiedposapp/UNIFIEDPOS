import { Request, Response, NextFunction } from 'express';
import { prisma } from '../db/client.js';

/**
 * Rate limiter (§37 Security Architecture) with two backends:
 *
 * - in-memory (default): a per-instance fixed-window Map. Fast, zero I/O — used
 *   for the GLOBAL high-volume API limiter, where a DB write per request would
 *   be wasteful and per-instance limiting is standard practice.
 * - shared (DB-backed): a fixed-window counter in PostgreSQL (RateLimitCounter),
 *   keyed by (bucket, key, windowStart) with a unique constraint so increments
 *   are atomic across ALL instances. Used for the security-critical, lower-volume
 *   auth (brute-force) and payment (abuse) limiters, where per-instance counts
 *   would let an attacker multiply their budget by the number of instances.
 *
 * If the DB backend errors (e.g. a connection blip) it falls back to the
 * in-memory counter for that request, so protection degrades to per-instance
 * rather than failing fully open.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Increment (or create) the in-memory counter for a namespaced key and return
// the new count + window reset time. Namespacing by bucket keeps independent
// limiters from sharing a single counter for the same IP.
function memoryHit(storeKey: string, windowMs: number): { count: number; resetAt: number } {
  const now = Date.now();
  let entry = store.get(storeKey);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(storeKey, entry);
  }
  entry.count++;
  return { count: entry.count, resetAt: entry.resetAt };
}

// Apply rate-limit headers and either reject with 429 or continue.
function sendRateLimitResponse(
  res: Response,
  next: NextFunction,
  count: number,
  maxRequests: number,
  resetAt: number,
): void {
  // Automated suites (tenant-isolation, money-path HTTP) make many requests per
  // second from one IP; abuse limiting is exactly what they must not trip.
  if (process.env.NODE_ENV === 'test') {
    next();
    return;
  }

  res.setHeader('X-RateLimit-Limit', maxRequests);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - count));
  res.setHeader('X-RateLimit-Reset', new Date(resetAt).toISOString());

  if (count > maxRequests) {
    const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    res.setHeader('Retry-After', retryAfter);
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again later.',
      retryAfter,
    });
    return;
  }

  next();
}

export interface RateLimitOptions {
  /** Maximum number of requests in the window */
  maxRequests: number;
  /** Window duration in seconds */
  windowSeconds: number;
  /** Key function to identify the client (defaults to IP) */
  keyFn?: (req: Request) => string;
  /** Limiter name — namespaces the counter (also the DB bucket). Defaults to 'default'. */
  name?: string;
  /** Use the shared DB backend (cross-instance) instead of per-instance memory. */
  shared?: boolean;
}

export function rateLimiter(
  options: RateLimitOptions,
): (req: Request, res: Response, next: NextFunction) => void {
  const { maxRequests, windowSeconds, keyFn } = options;
  const bucket = options.name || 'default';
  const windowMs = windowSeconds * 1000;

  const clientKey = (req: Request): string =>
    keyFn ? keyFn(req) : req.ip || req.socket.remoteAddress || 'unknown';

  if (!options.shared) {
    // Fast per-instance path (no I/O).
    return (req: Request, res: Response, next: NextFunction) => {
      const { count, resetAt } = memoryHit(`${bucket}:${clientKey(req)}`, windowMs);
      sendRateLimitResponse(res, next, count, maxRequests, resetAt);
    };
  }

  // Shared, cross-instance path backed by PostgreSQL.
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = clientKey(req);
    const now = Date.now();
    const windowStartMs = Math.floor(now / windowMs) * windowMs;
    const windowStart = new Date(windowStartMs);
    const resetAt = windowStartMs + windowMs;

    try {
      // Atomic increment via the (bucket, key, windowStart) unique constraint,
      // so concurrent requests across instances share one correct counter.
      const counter = await prisma.rateLimitCounter.upsert({
        where: { bucket_key_windowStart: { bucket, key, windowStart } },
        update: { count: { increment: 1 } },
        create: { bucket, key, windowStart, count: 1, expiresAt: new Date(resetAt) },
      });
      sendRateLimitResponse(res, next, counter.count, maxRequests, resetAt);
    } catch (err) {
      // DB unavailable — degrade to per-instance memory rather than fail open.
      console.error(`Rate limiter "${bucket}" DB backend failed; using in-memory fallback:`, err);
      const { count, resetAt: memReset } = memoryHit(`${bucket}:${key}`, windowMs);
      sendRateLimitResponse(res, next, count, maxRequests, memReset);
    }
  };
}

/**
 * Pre-configured rate limiters for common use cases.
 */
// Global API limiter: high volume → per-instance memory (avoids a DB write on
// every request); per-instance limiting is the norm for a coarse abuse guard.
export const apiRateLimiter = rateLimiter({
  name: 'api',
  maxRequests: 100,
  windowSeconds: 60,
});

// Auth limiter: brute-force protection must be shared across instances → DB.
export const authRateLimiter = rateLimiter({
  name: 'auth',
  maxRequests: 10,
  windowSeconds: 60,
  shared: true,
});

// Payment limiter: abuse protection must be shared across instances → DB.
export const paymentRateLimiter = rateLimiter({
  name: 'payment',
  maxRequests: 30,
  windowSeconds: 60,
  shared: true,
});

// Periodically purge expired shared counters. Safe on every instance
// (idempotent deleteMany); unref() so it never keeps the process alive alone.
setInterval(() => {
  prisma.rateLimitCounter
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch((err) => console.error('Rate limit counter cleanup failed:', err));
}, 5 * 60 * 1000).unref();

// Cleanup expired in-memory entries every 5 minutes.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();
