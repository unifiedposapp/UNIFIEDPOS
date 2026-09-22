import { describe, it, expect } from 'vitest';
import {
  INTERNAL_PREFIX,
  code128Safe,
  ean13CheckDigit,
  withEan13CheckDigit,
  isValidEan13,
  internalEan13,
  formatEan13,
  normalizeScannedCode,
  scannedCodeCandidates,
  buildLabel,
} from '../src/services/barcodes';

// ─── EAN-13 arithmetic ──────────────────────────────────────────────────────
// Reference codes are the two GTINs GS1 uses in its own examples, so a mistake
// in the weighting shows up immediately.
describe('ean13CheckDigit', () => {
  it('reproduces the published check digits', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1); // 4006381333931
    expect(ean13CheckDigit('590123412345')).toBe(7); // 5901234123457
    expect(withEan13CheckDigit('590123412345')).toBe('5901234123457');
  });

  it('ignores separators typed by a human', () => {
    expect(withEan13CheckDigit('590-1234-1234 5')).toBe('5901234123457');
  });

  it('refuses a body that is not twelve digits', () => {
    expect(() => ean13CheckDigit('12345')).toThrow(/12 digits/);
    expect(() => ean13CheckDigit('abcdefghijkl')).toThrow(/12 digits/);
  });
});

describe('isValidEan13', () => {
  it('accepts a well-formed code and rejects a corrupted digit', () => {
    expect(isValidEan13('5901234123457')).toBe(true);
    expect(isValidEan13('5901234123456')).toBe(false);
    expect(isValidEan13('590123412345')).toBe(false); // too short
    expect(isValidEan13('590123412345a')).toBe(false);
    expect(isValidEan13('')).toBe(false);
  });
});

// ─── Internal in-store codes ────────────────────────────────────────────────
describe('internalEan13', () => {
  it('is deterministic per organization + product so labels can be reprinted', () => {
    expect(internalEan13('org-1', 'prod-1')).toBe(internalEan13('org-1', 'prod-1'));
  });

  it('differs across organizations and across products', () => {
    const a = internalEan13('org-1', 'prod-1');
    expect(internalEan13('org-2', 'prod-1')).not.toBe(a);
    expect(internalEan13('org-1', 'prod-2')).not.toBe(a);
  });

  it('always lands in the GS1 in-store range with a valid check digit', () => {
    for (const seed of ['a', 'b', 'c', 'prod-9f', '']) {
      const code = internalEan13('org-7', seed);
      expect(code).toMatch(/^\d{13}$/);
      expect(code.startsWith(INTERNAL_PREFIX)).toBe(true);
      expect(isValidEan13(code)).toBe(true);
    }
  });
});

describe('formatEan13', () => {
  it('groups the digits and leaves anything else alone', () => {
    expect(formatEan13('5901234123457')).toBe('5901234 123457');
    expect(formatEan13('ABC-123')).toBe('ABC-123');
  });
});

// ─── Scanner tolerance ──────────────────────────────────────────────────────
describe('scanned code normalization', () => {
  it('strips spaces and dashes from numeric codes only', () => {
    expect(normalizeScannedCode('978 0-306-40615-7')).toBe('9780306406157');
    expect(normalizeScannedCode(' AB12 ')).toBe('AB12');
  });

  it('expands UPC-A to its EAN-13 form and back', () => {
    // A 12-digit UPC-A scans as 0-prefixed EAN-13 in most back offices.
    expect(scannedCodeCandidates('012345678905')).toEqual(expect.arrayContaining(['012345678905', '0012345678905']));
    expect(scannedCodeCandidates('0012345678905')).toEqual(expect.arrayContaining(['0012345678905', '012345678905']));
    expect(scannedCodeCandidates('978 0-306-40615-7')).toContain('9780306406157');
    expect(scannedCodeCandidates('   ')).toEqual([]);
  });
});

describe('code128Safe', () => {
  it('drops characters CODE128 subset B cannot encode', () => {
    // The accented letter and the emoji have no CODE128 subset-B glyph; the
    // surrounding spaces survive because a scanner can encode them.
    expect(code128Safe('Café ☕ 250g')).toBe('Caf  250g');
    expect(code128Safe('plain-ascii 123')).toBe('plain-ascii 123');
  });
});

// ─── Label projection ───────────────────────────────────────────────────────
describe('buildLabel', () => {
  const context = { organizationId: 'org-1', currency: 'USD', taxPercent: 7.5, categoryName: 'Drinks' };

  it('prints a manufacturer code unchanged as a real EAN-13', () => {
    const { label, generated } = buildLabel(
      { id: 'p1', name: 'Cola', sku: 'COLA-1', barcode: '5901234123457', price: 1.5, costPrice: 0.9, type: 'PHYSICAL' },
      context
    );
    expect(generated).toBe(false);
    expect(label.barcode).toBe('5901234123457');
    expect(label.symbology).toBe('EAN13');
    expect(label.price).toBe(1.5);
    expect(label.taxPercent).toBe(7.5);
    expect(label.categoryName).toBe('Drinks');
  });

  it('generates a stable in-store code when the product has none, and says so', () => {
    const first = buildLabel({ id: 'p2', name: 'House blend' }, context);
    const second = buildLabel({ id: 'p2', name: 'House blend' }, context);
    expect(first.generated).toBe(true);
    expect(first.label.barcode).toBe(second.label.barcode);
    expect(isValidEan13(first.label.barcode)).toBe(true);
    expect(first.label.symbology).toBe('EAN13');
    expect(first.label.productType).toBe('PHYSICAL');
    expect(first.label.costPrice).toBeNull();
  });

  it('falls back to CODE128 for an alphanumeric code a vendor typed in', () => {
    const { label } = buildLabel({ id: 'p3', name: 'Gift card', barcode: 'GC-XYZ-9', type: 'GIFT_CARD' }, context);
    expect(label.symbology).toBe('CODE128');
    expect(label.barcode).toBe('GC-XYZ-9');
    expect(label.productType).toBe('GIFT_CARD');
  });

  it('sanitizes a code containing characters the symbology cannot draw', () => {
    const { label } = buildLabel({ id: 'p4', name: 'Import', barcode: 'ÁBC-123' }, context);
    expect(label.barcode).toBe('BC-123');
    expect(label.symbology).toBe('CODE128');
  });
});
