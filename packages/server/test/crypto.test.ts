import { describe, it, expect } from 'vitest';
import {
  encryptText,
  decryptText,
  encryptJson,
  decryptJson,
  generateBase32Secret,
  totpCode,
  verifyTotp,
  otpauthUrl,
} from '../src/services/crypto';

describe('AES-256-GCM encryption at rest', () => {
  it('round-trips text and emits the v1 envelope (v1:iv:tag:ct)', () => {
    const enc = encryptText('super-secret-value');
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc.split(':')).toHaveLength(4);
    expect(decryptText(enc)).toBe('super-secret-value');
  });

  it('uses a random IV so the same input encrypts differently', () => {
    const a = encryptText('same-input');
    const b = encryptText('same-input');
    expect(a).not.toBe(b);
    expect(decryptText(a)).toBe(decryptText(b));
  });

  it('returns legacy non-v1 values unchanged (tolerant decrypt)', () => {
    expect(decryptText('plaintext-legacy-row')).toBe('plaintext-legacy-row');
  });

  it('round-trips JSON and handles null', () => {
    const enc = encryptJson({ apiKey: 'abc', n: 1 });
    expect(decryptJson(enc)).toEqual({ apiKey: 'abc', n: 1 });
    expect(decryptJson(null)).toBeNull();
  });
});

describe('RFC-6238 TOTP (MFA)', () => {
  it('generates a base32 secret and a 6-digit code', () => {
    const secret = generateBase32Secret();
    expect(secret).toMatch(/^[A-Z2-7]+=*$/);
    expect(totpCode(secret)).toMatch(/^\d{6}$/);
  });

  it('verifies the current code', () => {
    const secret = generateBase32Secret();
    expect(verifyTotp(secret, totpCode(secret))).toBe(true);
  });

  it('rejects malformed codes', () => {
    const secret = generateBase32Secret();
    expect(verifyTotp(secret, '12345')).toBe(false);
    expect(verifyTotp(secret, 'abcdef')).toBe(false);
    expect(verifyTotp(secret, '')).toBe(false);
  });

  it('is deterministic for a fixed timestamp', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const at = 1_700_000_000_000;
    expect(totpCode(secret, 30, at)).toBe(totpCode(secret, 30, at));
    expect(totpCode(secret, 30, at)).toMatch(/^\d{6}$/);
  });

  it('builds an otpauth:// provisioning URL', () => {
    const url = otpauthUrl('JBSWY3DPEHPK3PXP', 'user@example.com');
    expect(url.startsWith('otpauth://totp/')).toBe(true);
    expect(url).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(url).toContain('issuer=UnifiedPOS');
  });
});
