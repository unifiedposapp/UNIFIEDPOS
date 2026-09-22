// ─── request URL helpers ─────────────────────────────────────────────────────
// Machine-facing documents (JSON-LD, well-known descriptors) have to carry absolute
// URLs, and behind a proxy the only trustworthy host is the forwarded one.

import type { Request } from 'express';

/** Scheme + host the caller reached us on, without a trailing slash. */
export function requestUrlBase(req: Request): string {
  const proto = String(req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http')).split(',')[0];
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3001');
  return `${proto}://${host}`;
}
