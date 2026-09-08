// ─── ESC/POS receipt builder (pure, browser-free) ───────────────────────────
// Thermal receipt printers (Epson/Star/Zjiang and most 58mm/80mm USB+serial
// units) speak the ESC/POS byte protocol. Everything in this module is a pure
// function that turns receipt data into a Uint8Array of printer commands, so it
// can be unit-tested with no DOM, no device, and no I/O.
//
// The transport that actually writes these bytes to a printer lives in
// ./hardware.ts (WebSerial / WebUSB). Keeping the byte-building separate means
// the money-critical formatting (totals, change, column alignment) is testable.

/** ESC/POS control bytes. */
export const ESC = 0x1b;
export const GS = 0x1d;

export const CMD = {
  /** ESC @ — reset the printer to defaults. */
  INIT: new Uint8Array([ESC, 0x40]),
  /** ESC a n — alignment (0 left, 1 center, 2 right). */
  align: (n: 0 | 1 | 2) => new Uint8Array([ESC, 0x61, n]),
  /** ESC E n — bold on/off. */
  bold: (on: boolean) => new Uint8Array([ESC, 0x45, on ? 1 : 0]),
  /** GS ! n — character size; high nibble = width, low nibble = height (0 = normal). */
  size: (n: number) => new Uint8Array([GS, 0x21, n & 0xff]),
  /** ESC d n — feed n lines. */
  feed: (n: number) => new Uint8Array([ESC, 0x64, n & 0xff]),
  /** GS V 66 0 — partial (feed-and-)cut. */
  CUT: new Uint8Array([GS, 0x56, 0x42, 0x00]),
  /** Line feed. */
  LF: new Uint8Array([0x0a]),
};

/** Standard paper widths in printable characters (font A, 12x24). */
export const PAPER_WIDTH = { W58MM: 32, W80MM: 48 } as const;
export type PaperWidth = 32 | 42 | 48;

export interface ReceiptItem {
  name: string;
  quantity?: number;
  unitPrice?: number;
  lineTotal: number;
  /** Optional modifier/variant lines printed under the item. */
  notes?: string[];
}

export interface ReceiptPayment {
  method: string;
  amount: number;
  /** Cash change due (only meaningful for cash tenders). */
  change?: number;
  /** Gift card / store credit reference to print. */
  reference?: string;
}

export interface ReceiptData {
  storeName: string;
  addressLine?: string;
  phone?: string;
  taxId?: string;
  orderNumber: string;
  cashier?: string;
  register?: string;
  location?: string;
  createdAt?: Date | string;
  items: ReceiptItem[];
  subtotal: number;
  discount?: number;
  tax?: number;
  tip?: number;
  total: number;
  payments?: ReceiptPayment[];
  footer?: string;
  /** Print a CODE128 barcode of this value (defaults to the order number). */
  barcode?: string | null;
  /** Characters per line; defaults to 42 (common 80mm). */
  width?: PaperWidth;
  /** ISO currency symbol to prefix amounts; defaults to '$'. */
  currencySymbol?: string;
  /** Emit a cut command at the end (default true). */
  cut?: boolean;
}

/** Encode a string to ASCII-safe bytes; unsupported code points become '?'. */
export function encodeText(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Printable ASCII + space; everything else (unicode, control) → '?'.
    bytes.push(code >= 0x20 && code <= 0x7e ? code : 0x3f);
  }
  return new Uint8Array(bytes);
}

/** Concatenate any number of byte arrays into one. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Format a number as a currency amount, e.g. money(12.5) → "12.50". */
export function money(value: number, symbol = '$'): string {
  const n = Number.isFinite(value) ? value : 0;
  return `${symbol}${n.toFixed(2)}`;
}

/** Right-pad/trim `s` to exactly `width` characters. */
export function padRight(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + ' '.repeat(width - s.length);
}

/**
 * Build a two-column line: `left` flushed left, `right` flushed right, joined
 * by spaces (never overflowing `width`). Used for item totals and the amounts
 * block.
 */
export function columnLine(left: string, right: string, width: number): string {
  const gap = width - left.length - right.length;
  if (gap <= 0) {
    // Not enough room: trim the left side so the right (amount) stays intact.
    const keep = Math.max(0, width - right.length);
    return left.slice(0, keep) + right;
  }
  return left + ' '.repeat(gap) + right;
}

/** A dashed separator line across the paper width. */
export function divider(width: number, char = '-'): string {
  return char.repeat(width);
}

/**
 * Encode a CODE128 (subset B) barcode using the GS k command. Returns an empty
 * array when the value is not encodable so callers can safely skip it.
 */
export function barcodeBytes(value: string): Uint8Array {
  const clean = value.replace(/[^\x20-\x7e]/g, '');
  if (!clean) return new Uint8Array(0);
  // GS k m=73 (CODE128, length-prefixed). Data must be wrapped in {B for subset B.
  const payload = encodeText(`{B${clean}`);
  const len = payload.length;
  return concatBytes(new Uint8Array([GS, 0x68, 0x64]), // GS h n — bar height 100 dots
    new Uint8Array([GS, 0x77, 0x02]), // GS w n — module width 2
    new Uint8Array([GS, 0x6b, 0x49, len & 0xff]), // GS k m=73 n
    payload);
}

/**
 * Build the complete byte stream for a receipt. Deterministic and side-effect
 * free — the same input always yields the same bytes (covered by unit tests).
 */
export function buildReceipt(data: ReceiptData): Uint8Array {
  const width = data.width ?? 42;
  const sym = data.currencySymbol ?? '$';
  const parts: Uint8Array[] = [CMD.INIT, CMD.align(1)];

  // ─── Header ────────────────────────────────────────────────────────────
  parts.push(CMD.bold(true), CMD.size(0x11), encodeText(data.storeName.toUpperCase()), CMD.LF);
  parts.push(CMD.size(0x00), CMD.bold(false));
  if (data.addressLine) parts.push(encodeText(data.addressLine), CMD.LF);
  if (data.phone) parts.push(encodeText(`Tel: ${data.phone}`), CMD.LF);
  if (data.taxId) parts.push(encodeText(`Tax ID: ${data.taxId}`), CMD.LF);
  parts.push(CMD.align(0), encodeText(divider(width)), CMD.LF);

  // ─── Meta ──────────────────────────────────────────────────────────────
  const created = data.createdAt ? new Date(data.createdAt) : new Date();
  const when = Number.isNaN(created.getTime()) ? '' : created.toLocaleString();
  if (when) parts.push(encodeText(columnLine('Date:', when, width)), CMD.LF);
  parts.push(encodeText(columnLine('Order:', data.orderNumber, width)), CMD.LF);
  if (data.register) parts.push(encodeText(columnLine('Register:', data.register, width)), CMD.LF);
  if (data.cashier) parts.push(encodeText(columnLine('Cashier:', data.cashier, width)), CMD.LF);
  if (data.location) parts.push(encodeText(columnLine('Store:', data.location, width)), CMD.LF);
  parts.push(encodeText(divider(width)), CMD.LF);

  // ─── Items ─────────────────────────────────────────────────────────────
  for (const item of data.items) {
    const qty = item.quantity ?? 1;
    const left = `${qty} x ${item.name}`;
    parts.push(encodeText(columnLine(left.slice(0, width - money(item.lineTotal, sym).length - 1), money(item.lineTotal, sym), width)), CMD.LF);
    if (item.unitPrice !== undefined && qty > 1) {
      parts.push(encodeText(`   @ ${money(item.unitPrice, sym)} each`), CMD.LF);
    }
    for (const note of item.notes ?? []) {
      parts.push(encodeText(`   ${note}`.slice(0, width)), CMD.LF);
    }
  }
  parts.push(encodeText(divider(width)), CMD.LF);

  // ─── Totals ────────────────────────────────────────────────────────────
  parts.push(encodeText(columnLine('Subtotal', money(data.subtotal, sym), width)), CMD.LF);
  if (data.discount) parts.push(encodeText(columnLine('Discount', `-${money(data.discount, sym)}`, width)), CMD.LF);
  if (data.tax) parts.push(encodeText(columnLine('Tax', money(data.tax, sym), width)), CMD.LF);
  if (data.tip) parts.push(encodeText(columnLine('Tip', money(data.tip, sym), width)), CMD.LF);
  parts.push(CMD.bold(true), CMD.size(0x11));
  parts.push(encodeText(columnLine('TOTAL', money(data.total, sym), width)), CMD.LF);
  parts.push(CMD.size(0x00), CMD.bold(false));

  // ─── Payments ──────────────────────────────────────────────────────────
  if (data.payments?.length) {
    parts.push(encodeText(divider(width)), CMD.LF);
    for (const p of data.payments) {
      parts.push(encodeText(columnLine(p.method, money(p.amount, sym), width)), CMD.LF);
      if (p.reference) parts.push(encodeText(`   ${p.reference}`.slice(0, width)), CMD.LF);
      if (p.change) parts.push(encodeText(columnLine('   Change', money(p.change, sym), width)), CMD.LF);
    }
  }

  // ─── Footer / barcode ──────────────────────────────────────────────────
  parts.push(CMD.align(1), CMD.feed(1));
  const code = data.barcode === undefined ? data.orderNumber : data.barcode;
  if (code) {
    const bc = barcodeBytes(code);
    if (bc.length) parts.push(bc, CMD.LF);
  }
  if (data.footer) parts.push(encodeText(data.footer), CMD.LF);
  else parts.push(encodeText('Thank you for your business!'), CMD.LF);
  parts.push(CMD.feed(3));
  if (data.cut !== false) parts.push(CMD.CUT);

  return concatBytes(...parts);
}

/**
 * Bytes that kick the cash drawer open. Most drawers wire to the printer's RJ11
 * kick-out port; ESC p m t1 t2 pulses the pin. `pin` 0 = drawer 1, 1 = drawer 2.
 */
export function cashDrawerBytes(pin: 0 | 1 = 0, onMs = 25, offMs = 250): Uint8Array {
  const t1 = Math.min(255, Math.round(onMs / 2));
  const t2 = Math.min(255, Math.round(offMs / 2));
  return new Uint8Array([ESC, 0x70, pin, t1 & 0xff, t2 & 0xff]);
}
