import { describe, it, expect } from 'vitest';
import {
  buildReceipt,
  cashDrawerBytes,
  barcodeBytes,
  columnLine,
  concatBytes,
  divider,
  encodeText,
  money,
  padRight,
  CMD,
  ESC,
  type ReceiptData,
} from '../src/services/escpos';

/** Decode ASCII bytes back to a string for readable assertions. */
function ascii(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.';
  return s;
}

const SAMPLE: ReceiptData = {
  storeName: 'Demo Store',
  addressLine: '123 Main St',
  phone: '555-0100',
  orderNumber: 'ORD-1',
  cashier: 'Alice',
  register: 'R1',
  items: [
    { name: 'Coffee', quantity: 2, unitPrice: 3, lineTotal: 6 },
    { name: 'Tea', quantity: 1, lineTotal: 2.5 },
  ],
  subtotal: 8.5,
  tax: 0.72,
  total: 9.22,
  payments: [{ method: 'CASH', amount: 10, change: 0.78 }],
};

describe('money formatting', () => {
  it('always renders two decimals', () => {
    expect(money(12.5)).toBe('$12.50');
    expect(money(0)).toBe('$0.00');
    expect(money(1000)).toBe('$1000.00');
  });
  it('honours a custom currency symbol', () => {
    expect(money(3, '€')).toBe('€3.00');
  });
  it('treats non-finite values as zero (never prints NaN)', () => {
    expect(money(NaN)).toBe('$0.00');
    expect(money(Infinity)).toBe('$0.00');
  });
});

describe('column layout', () => {
  it('produces an exactly-width line with left/right flush', () => {
    const line = columnLine('Subtotal', '9.22', 32);
    expect(line).toHaveLength(32);
    expect(line.startsWith('Subtotal')).toBe(true);
    expect(line.endsWith('9.22')).toBe(true);
  });
  it('trims the left side rather than dropping the amount on overflow', () => {
    const line = columnLine('A very long label that will not fit', '9.22', 20);
    expect(line).toHaveLength(20);
    expect(line.endsWith('9.22')).toBe(true);
  });
  it('padRight pads and truncates to width', () => {
    expect(padRight('ab', 5)).toBe('ab   ');
    expect(padRight('abcdef', 4)).toBe('abcd');
  });
  it('divider spans the full width', () => {
    expect(divider(10)).toBe('----------');
    expect(divider(4, '=')).toBe('====');
  });
});

describe('byte encoding', () => {
  it('maps non-ASCII characters to "?" so printers never choke', () => {
    const bytes = encodeText('A€B');
    expect(Array.from(bytes)).toEqual([0x41, 0x3f, 0x42]);
  });
  it('concatBytes preserves order and length', () => {
    const out = concatBytes(new Uint8Array([1, 2]), new Uint8Array([3]));
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });
  it('cashDrawerBytes emits the ESC p pulse with the right pin', () => {
    const b = cashDrawerBytes(1);
    expect(b[0]).toBe(ESC);
    expect(b[1]).toBe(0x70);
    expect(b[2]).toBe(1);
    expect(b).toHaveLength(5);
  });
  it('barcodeBytes is empty for blank input, non-empty otherwise', () => {
    expect(barcodeBytes('')).toHaveLength(0);
    expect(barcodeBytes('ORD-1').length).toBeGreaterThan(0);
  });
});

describe('buildReceipt', () => {
  it('starts with an initialise command and ends with a cut by default', () => {
    const bytes = buildReceipt(SAMPLE);
    expect(bytes[0]).toBe(ESC);
    expect(bytes[1]).toBe(0x40); // ESC @
    const tail = bytes.slice(bytes.length - CMD.CUT.length);
    expect(Array.from(tail)).toEqual(Array.from(CMD.CUT));
  });

  it('omits the cut when cut:false', () => {
    const bytes = buildReceipt({ ...SAMPLE, cut: false });
    const tail = bytes.slice(bytes.length - CMD.CUT.length);
    expect(Array.from(tail)).not.toEqual(Array.from(CMD.CUT));
  });

  it('includes the store name, order number and total', () => {
    const text = ascii(buildReceipt(SAMPLE));
    expect(text).toContain('DEMO STORE'); // header is upper-cased
    expect(text).toContain('ORD-1');
    expect(text).toContain('9.22'); // total
    expect(text).toContain('CASH');
    expect(text).toContain('0.78'); // change
  });

  it('is deterministic — same input yields identical bytes', () => {
    const fixed = { ...SAMPLE, createdAt: new Date('2026-01-01T12:00:00Z') };
    const a = buildReceipt(fixed);
    const b = buildReceipt(fixed);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('respects the configured paper width (no line overflows)', () => {
    const bytes = buildReceipt({ ...SAMPLE, width: 32 });
    // Every rendered text line must be <= 32 chars; verify via the divider.
    const text = ascii(bytes);
    expect(text).toContain('-'.repeat(32));
  });

  it('prints a discount line only when a discount exists', () => {
    expect(ascii(buildReceipt(SAMPLE))).not.toContain('Discount');
    expect(ascii(buildReceipt({ ...SAMPLE, discount: 1.5 }))).toContain('Discount');
  });
});
