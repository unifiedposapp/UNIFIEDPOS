import { describe, it, expect } from 'vitest';
import {
  canonicalize,
  sha256Hex,
  buildFiscalPayload,
  sealFiscalDocument,
  verifyFiscalSeal,
  verifyFiscalChain,
  formatReceiptNumber,
  nextSequence,
  findSequenceGaps,
  encodeTlv,
  decodeTlv,
  buildFiscalQr,
  retentionUntil,
  transmitBackoffMs,
  isFiscalBridgeConfigured,
  MAX_TRANSMIT_ATTEMPTS,
} from '../src/services/fiscalization';

const SALT = 'unit-test-seal-salt';

function payload(sequence: number, total = 100) {
  return buildFiscalPayload({
    organizationId: 'org-1',
    profileCode: 'BR_CFE',
    receiptNumber: formatReceiptNumber('NFC', sequence),
    issuedAt: new Date('2026-03-04T10:00:00Z'),
    total,
    vatTotal: total * 0.18,
    currency: 'BRL',
    paymentMethod: 'CARD',
    deviceId: 'dev-1',
    orderId: `order-${sequence}`,
    locationId: 'loc-1',
  });
}

describe('canonicalize', () => {
  it('sorts keys at every depth so the same sale always digests the same', () => {
    const a = canonicalize({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalize({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":"3.00","d":"2.00"},"b":"1.00"}');
  });

  it('normalises money to two decimals so 12.1 and 12.10 hash identically', () => {
    expect(canonicalize({ total: 12.1 })).toBe(canonicalize({ total: 12.1 }));
    expect(canonicalize({ total: 12.1 })).toContain('12.10');
  });

  it('keeps array order and drops undefined but not null', () => {
    expect(canonicalize([3, 1, 2])).toBe('["3.00","1.00","2.00"]');
    expect(canonicalize({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it('serialises dates as ISO-8601', () => {
    expect(canonicalize({ at: new Date('2026-01-01T00:00:00Z') })).toContain('2026-01-01T00:00:00.000Z');
  });
});

describe('sha256Hex', () => {
  it('matches the known digest of the empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('buildFiscalPayload', () => {
  it('uppercases currency and document type and rounds the money', () => {
    const p = payload(1, 100.007);
    expect(p.currency).toBe('BRL');
    expect(p.documentType).toBe('RECEIPT');
    expect(p.amount).toBe(100.01);
    expect(p.vat).toBe(18);
    expect(p.receiptNumber).toBe('NFC-000001');
  });
});

describe('sealing + chain integrity', () => {
  it('reproduces the same seal for the same payload and link', () => {
    const p = payload(1);
    const first = sealFiscalDocument(p, null, SALT);
    const second = sealFiscalDocument(p, null, SALT);
    expect(first.signedHash).toBe(second.signedHash);
    expect(first.previousHash).toBeNull();
  });

  it('produces a different seal under a different salt', () => {
    const p = payload(1);
    expect(sealFiscalDocument(p, null, SALT).signedHash).not.toBe(sealFiscalDocument(p, null, 'other-salt').signedHash);
  });

  it('verifies an intact three-document chain', () => {
    const docs: { receiptNumber: string; payloadHash: string; previousHash: string | null; signedHash: string | null }[] = [];
    let link: string | null = null;
    for (let i = 1; i <= 3; i++) {
      const sealed = sealFiscalDocument(payload(i, 100 * i), link, SALT);
      link = sealed.signedHash;
      docs.push({
        receiptNumber: String(payload(i).receiptNumber),
        payloadHash: sealed.payloadHash,
        previousHash: sealed.previousHash,
        signedHash: sealed.signedHash,
      });
    }
    expect(verifyFiscalChain(docs, SALT)).toMatchObject({ ok: true, checked: 3 });
  });

  it('detects a deleted document as a broken link', () => {
    const docs: { receiptNumber: string; payloadHash: string; previousHash: string | null; signedHash: string | null }[] = [];
    let link: string | null = null;
    for (let i = 1; i <= 3; i++) {
      const sealed = sealFiscalDocument(payload(i), link, SALT);
      link = sealed.signedHash;
      docs.push({ receiptNumber: `R-${i}`, payloadHash: sealed.payloadHash, previousHash: sealed.previousHash, signedHash: sealed.signedHash });
    }
    const tampered = [docs[0], docs[2]];
    const check = verifyFiscalChain(tampered, SALT);
    expect(check.ok).toBe(false);
    expect(check.breaks[0].reason).toBe('broken-link');
  });

  it('detects an edited amount as an invalid seal', () => {
    const sealed = sealFiscalDocument(payload(1), null, SALT);
    const doc = { receiptNumber: 'R-1', payloadHash: sha256Hex('someone elided the VAT'), previousHash: null, signedHash: sealed.signedHash };
    expect(verifyFiscalSeal(doc, SALT)).toBe(false);
    expect(verifyFiscalChain([doc], SALT).breaks[0].reason).toBe('invalid-seal');
  });

  it('rejects a seal made with another key', () => {
    const p = payload(2);
    const sealed = sealFiscalDocument(p, null, SALT);
    expect(verifyFiscalSeal({ payloadHash: sealed.payloadHash, previousHash: null, signedHash: sealed.signedHash }, 'wrong')).toBe(false);
  });

  it('emits no QR unless the profile asks for one', () => {
    expect(sealFiscalDocument(payload(1), null, SALT, { withQr: false }).qrPayload).toBeNull();
    const qr = sealFiscalDocument(payload(1), null, SALT, { withQr: true }).qrPayload as string;
    const tags = decodeTlv(qr);
    expect(tags.find((t) => t.tag === 4)?.value).toBe(String(payload(1).amount));
  });
});

describe('numbering', () => {
  it('pads the sequence so ordering is lexical and stable', () => {
    expect(formatReceiptNumber('nfc', 7)).toBe('NFC-000007');
    expect(formatReceiptNumber('nfc', 1234567)).toBe('NFC-1234567');
    expect(formatReceiptNumber('nfc', 0)).toBe('NFC-000001');
  });

  it('advances the sequence and never goes backwards', () => {
    expect(nextSequence(null)).toBe(1);
    expect(nextSequence(12)).toBe(13);
    expect(nextSequence(-5)).toBe(1);
  });

  it('reports the gaps an auditor would ask about', () => {
    expect(findSequenceGaps([1, 2, 4, 7])).toEqual([3, 5, 6]);
    expect(findSequenceGaps([1, 2, 3])).toEqual([]);
    expect(findSequenceGaps([])).toEqual([]);
  });
});

describe('TLV QR encoding', () => {
  it('round-trips every tag', () => {
    const fields = [
      { tag: 1, value: 'Seller Ltda' },
      { tag: 2, value: '12.345.678/0001-90' },
      { tag: 6, value: 'abc123' },
    ];
    expect(decodeTlv(encodeTlv(fields))).toEqual(fields);
  });

  it('stops rather than guessing on a truncated payload', () => {
    const encoded = Buffer.from([1, 5, 65, 66]).toString('base64'); // claims 5 bytes, has 2
    expect(decodeTlv(encoded)).toEqual([]);
  });

  it('carries the signature in tag 6', () => {
    const p = payload(1);
    const qr = buildFiscalQr(p, 'deadbeef', 'serial-1');
    expect(decodeTlv(qr).find((t) => t.tag === 6)?.value).toBe('deadbeef');
  });
});

describe('retention + retry windows', () => {
  it('extends retention by whole years', () => {
    const at = new Date(2026, 0, 15, 12, 0, 0);
    expect(retentionUntil(at, 5).getFullYear()).toBe(2031);
    expect(retentionUntil(at, 0).getTime()).toBe(at.getTime());
  });

  it('backs off exponentially and caps at six hours', () => {
    expect(transmitBackoffMs(1)).toBe(60_000);
    expect(transmitBackoffMs(3)).toBe(240_000);
    expect(transmitBackoffMs(40)).toBe(6 * 60 * 60 * 1000);
  });

  it('gives up after the documented attempt budget', () => {
    expect(MAX_TRANSMIT_ATTEMPTS).toBeGreaterThan(3);
  });

  it('is unconfigured without both bridge variables', () => {
    const saved = { url: process.env.FISCAL_BRIDGE_URL, token: process.env.FISCAL_BRIDGE_TOKEN };
    delete process.env.FISCAL_BRIDGE_URL;
    delete process.env.FISCAL_BRIDGE_TOKEN;
    expect(isFiscalBridgeConfigured()).toBe(false);
    process.env.FISCAL_BRIDGE_URL = 'https://bridge.example';
    expect(isFiscalBridgeConfigured()).toBe(false);
    process.env.FISCAL_BRIDGE_TOKEN = 'secret';
    expect(isFiscalBridgeConfigured()).toBe(true);
    if (saved.url) process.env.FISCAL_BRIDGE_URL = saved.url;
    else delete process.env.FISCAL_BRIDGE_URL;
    if (saved.token) process.env.FISCAL_BRIDGE_TOKEN = saved.token;
    else delete process.env.FISCAL_BRIDGE_TOKEN;
  });
});
