// ─── CRYPTO SERVICE (§37 Security Architecture) ─────────────────────────────
// Provides (a) AES-256-GCM encryption-at-rest for sensitive stored values such
// as integration credentials, (b) RFC-6238 TOTP helpers for MFA / 2FA, and
// (c) centralised secret resolution so production never falls back to a
// hard-coded development secret.
import crypto from 'node:crypto';

const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret';
const DEV_ENC_KEY = 'dev-only-insecure-encryption-key';
const KEY_SALT = 'unifiedpos.v1';

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

// Resolve the JWT signing secret. Production MUST supply JWT_SECRET; in
// development a clearly-labelled insecure default keeps the app runnable.
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.trim().length > 0) return secret;
  if (isProduction()) {
    throw new Error('JWT_SECRET environment variable must be set in production');
  }
  // eslint-disable-next-line no-console
  console.warn('[security] JWT_SECRET not set — using dev-only insecure secret');
  return DEV_JWT_SECRET;
}

// Resolve the at-rest encryption key (32 bytes for AES-256).
function getEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  const source = raw && raw.trim().length > 0 ? raw : (isProduction() ? (() => { throw new Error('ENCRYPTION_KEY environment variable must be set in production'); })() : DEV_ENC_KEY);
  if (!raw || raw.trim().length === 0) {
    // eslint-disable-next-line no-console
    console.warn('[security] ENCRYPTION_KEY not set — using dev-only insecure key');
  }
  return crypto.scryptSync(String(source), KEY_SALT, 32);
}

// ── AES-256-GCM at-rest ─────────────────────────────────────────────────────
// Format: v1:<iv base64>:<authTag base64>:<ciphertext base64>
export function encryptText(plain: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

// Decrypt an encrypted payload. Values that are not in the v1: format are
// returned unchanged so legacy plaintext rows keep working (tolerant read).
export function decryptText(payload: string): string {
  if (typeof payload !== 'string' || !payload.startsWith('v1:')) return payload;
  const parts = payload.split(':');
  if (parts.length !== 4) return payload;
  const [, ivB64, tagB64, ctB64] = parts;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return payload; // undecryptable (wrong key / tampered) — surface raw rather than crash
  }
}

// Recursively encrypt string leaves of a JSON-ish value, returning a string blob.
export function encryptJson(value: unknown): string {
  return encryptText(JSON.stringify(value ?? null));
}
export function decryptJson<T = unknown>(payload: string | null | undefined): T | null {
  if (payload == null) return null;
  const plain = decryptText(payload);
  try {
    return JSON.parse(plain) as T;
  } catch {
    return null;
  }
}

// ── RFC-6238 TOTP (MFA) ─────────────────────────────────────────────────────
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateBase32Secret(bytes = 20): string {
  const buf = crypto.randomBytes(bytes);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(encoded: string): Buffer {
  const clean = encoded.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

export function totpCode(secret: string, timeStep = 30, at = Date.now()): string {
  return hotp(secret, Math.floor(at / 1000 / timeStep));
}

// Verify a 6-digit code allowing ±1 time-step drift.
export function verifyTotp(secret: string, code: string, window = 1): boolean {
  if (!/^\d{6}$/.test(code || '')) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    if (hotp(secret, counter + i) === code) return true;
  }
  return false;
}

export function otpauthUrl(secret: string, email: string, issuer = 'UnifiedPOS'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
