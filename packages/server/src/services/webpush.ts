// ─── Web Push (VAPID) — RFC 8291 content encryption + RFC 8292 VAPID auth ────
// Dependency-free implementation using node:crypto (no `web-push` package). The
// sender is env-gated: when VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
// are configured it performs a real encrypted POST to the push service; otherwise
// it no-ops (and reports `enabled:false`) so nothing breaks in dev/CI.
//
// Keys are base64url. Public key = 65-byte uncompressed P-256 point (0x04||X||Y).
// Private key = 32-byte scalar d. Generate a pair via GET /api/push/vapid-keys
// (OWNER only) or `npx web-push generate-vapid-keys`.

import crypto from 'node:crypto';
import { prisma } from '../db/client.js';

export interface PushSubscriptionLike {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string } | null;
}

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function bufToB64url(b: Buffer): string {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isWebPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

/** HKDF (extract+expand) helper returning a Buffer of `len` bytes. */
function hkdf(ikm: Buffer, salt: Buffer, info: Buffer, len: number): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));
}

/** Convert a DER-encoded ECDSA signature to the fixed 64-byte r||s (JWS) form. */
function derToRaw(der: Buffer): Buffer {
  // DER: 0x30 <len> 0x02 <rlen> <r> 0x02 <slen> <s>
  let off = 2;
  if (der[1] & 0x80) off = 2 + (der[1] & 0x7f); // long-form length (rare)
  if (der[off] !== 0x02) throw new Error('Malformed DER signature');
  const rLen = der[off + 1];
  const r = der.subarray(off + 2, off + 2 + rLen);
  off = off + 2 + rLen;
  if (der[off] !== 0x02) throw new Error('Malformed DER signature');
  const sLen = der[off + 1];
  const s = der.subarray(off + 2, off + 2 + sLen);
  const pad = (b: Buffer) => {
    // Strip a leading 0x00 sign byte, then left-pad to 32 bytes.
    let x = b;
    if (x.length === 33 && x[0] === 0) x = x.subarray(1);
    if (x.length > 32) x = x.subarray(x.length - 32);
    return Buffer.concat([Buffer.alloc(32 - x.length), x]);
  };
  return Buffer.concat([pad(r), pad(s)]);
}

/** Build the VAPID ES256 JWT + Authorization header value for an endpoint. */
function vapidAuthHeader(endpoint: string): string {
  const pub = b64urlToBuf(process.env.VAPID_PUBLIC_KEY!);
  const priv = b64urlToBuf(process.env.VAPID_PRIVATE_KEY!);
  const url = new URL(endpoint);
  const aud = `${url.protocol}//${url.host}`;

  const x = bufToB64url(pub.subarray(1, 33));
  const y = bufToB64url(pub.subarray(33, 65));
  const d = bufToB64url(priv.length > 32 ? priv.subarray(priv.length - 32) : priv);

  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x, y, d }, format: 'jwk' });

  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: process.env.VAPID_SUBJECT };
  const signingInput = `${bufToB64url(Buffer.from(JSON.stringify(header)))}.${bufToB64url(Buffer.from(JSON.stringify(payload)))}`;
  const derSig = crypto.sign('sha256', Buffer.from(signingInput), key);
  const jwt = `${signingInput}.${bufToB64url(derToRaw(derSig))}`;

  return `vapid t=${jwt}, k=${process.env.VAPID_PUBLIC_KEY}`;
}

/** Encrypt a JSON payload per RFC 8291 (aes128gcm content encoding). */
function encryptPayload(sub: PushSubscriptionLike, payload: string): Buffer {
  const uaPublic = b64urlToBuf(sub.keys!.p256dh!); // 65 bytes
  const authSecret = b64urlToBuf(sub.keys!.auth!); // 16 bytes

  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(); // 65 bytes uncompressed
  const ecdhSecret = ecdh.computeSecret(uaPublic);

  // IKM = HKDF(salt=authSecret, ikm=ecdhSecret, info="WebPush: info\0"||uaPublic||asPublic)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'binary'), uaPublic, asPublic]);
  const ikm = hkdf(ecdhSecret, authSecret, keyInfo, 32);

  const salt = crypto.randomBytes(16);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'binary'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'binary'), 12);

  // Single record: plaintext || 0x02 delimiter (final record).
  const plaintext = Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  // Header: salt(16) || rs(4, BE) || idlen(1) || keyid(asPublic, 65)
  const rs = 4096;
  const rsBuf = Buffer.alloc(4);
  rsBuf.writeUInt32BE(rs, 0);
  const header = Buffer.concat([salt, rsBuf, Buffer.from([asPublic.length]), asPublic]);
  return Buffer.concat([header, ciphertext]);
}

export interface SendResult {
  endpoint: string;
  ok: boolean;
  status?: number;
  simulated: boolean;
  reason?: string;
}

/** Send one push. Returns a result; never throws (failures are captured). */
export async function sendWebPush(sub: PushSubscriptionLike, payload: Record<string, unknown>, ttl = 3600): Promise<SendResult> {
  if (!isWebPushConfigured()) {
    return { endpoint: sub.endpoint, ok: false, simulated: true, reason: 'VAPID not configured' };
  }
  if (!sub.keys?.p256dh || !sub.keys?.auth) {
    return { endpoint: sub.endpoint, ok: false, simulated: false, reason: 'Subscription missing keys' };
  }
  try {
    const body = encryptPayload(sub, JSON.stringify(payload));
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthHeader(sub.endpoint),
        TTL: String(ttl),
        'Content-Length': String(body.length),
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
      },
      body,
    });
    return { endpoint: sub.endpoint, ok: res.ok, status: res.status, simulated: false };
  } catch (error) {
    return { endpoint: sub.endpoint, ok: false, simulated: false, reason: String(error) };
  }
}

/**
 * Fan a notification out to every PushSubscription for an organization (optionally
 * a single user). Subscriptions that return 404/410 (expired) are pruned.
 */
export async function notifySubscribers(
  organizationId: string,
  notification: { title: string; body?: string; url?: string; tag?: string; data?: unknown },
  opts: { userId?: string } = {}
): Promise<{ sent: number; pruned: number; enabled: boolean }> {
  if (!isWebPushConfigured()) return { sent: 0, pruned: 0, enabled: false };

  const where: any = { organizationId };
  if (opts.userId) where.userId = opts.userId;
  const subs = await prisma.pushSubscription.findMany({ where });

  let sent = 0;
  let pruned = 0;
  for (const s of subs) {
    const result = await sendWebPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, {
      title: notification.title,
      body: notification.body,
      url: notification.url,
      tag: notification.tag,
      data: notification.data,
    });
    if (result.ok) sent += 1;
    else if (result.status === 404 || result.status === 410) {
      await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
      pruned += 1;
    }
  }
  return { sent, pruned, enabled: true };
}

/** Generate a fresh VAPID key pair (base64url) — used by the setup endpoint. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const pub = ecdh.getPublicKey(); // 65 bytes uncompressed
  let priv = ecdh.getPrivateKey();
  if (priv.length > 32) priv = priv.subarray(priv.length - 32);
  if (priv.length < 32) priv = Buffer.concat([Buffer.alloc(32 - priv.length), priv]);
  return { publicKey: bufToB64url(pub), privateKey: bufToB64url(priv) };
}
