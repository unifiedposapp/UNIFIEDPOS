/**
 * Units of measure + weighted selling (§6 cart, grocery/deli parity).
 *
 * Pure, dependency-free maths so a scale-driven line is as testable as cash
 * change. The POS sends a decimal quantity; this module decides whether the
 * product may take one at all, how many decimals are legitimate, and how the
 * money rounds.
 *
 * Why this exists: `OrderItem.quantity` used to be an Int, so 0.375 kg of
 * bananas could only be sold as 1 or 0 — the single largest blocker for
 * grocery and deli counters.
 */

export type Uom = 'EACH' | 'KG' | 'G' | 'L' | 'ML' | 'M' | 'PACK';

export const UOMS: readonly Uom[] = ['EACH', 'KG', 'G', 'L', 'ML', 'M', 'PACK'] as const;

/** Units that sell by a fractional amount. `EACH`/`PACK` are always integers. */
const FRACTIONAL: ReadonlySet<Uom> = new Set<Uom>(['KG', 'G', 'L', 'ML', 'M']);

/** Canonical display bundle for UIs that let a merchant pick a unit. */
export const UOM_LABELS: Record<Uom, string> = {
  EACH: 'Each',
  KG: 'Kilogram',
  G: 'Gram',
  L: 'Litre',
  ML: 'Millilitre',
  M: 'Metre',
  PACK: 'Pack',
};

/** Scale barcodes embed 5 digits of value: grams for weight, cents for price. */
export const SCALE_VALUE_DIGITS = 5;

export function isUom(value: unknown): value is Uom {
  return typeof value === 'string' && (UOMS as readonly string[]).includes(value);
}

export function isFractionalUom(uom: Uom | undefined | null): boolean {
  return Boolean(uom && FRACTIONAL.has(uom));
}

/** Round to 3 decimals — the precision `OrderItem.quantity` stores. */
export function round3(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 1000) / 1000;
}

export type QuantityVerdict =
  | { ok: true; quantity: number }
  | { ok: false; reason: 'NOT_POSITIVE' | 'TOO_MANY_DECIMALS' | 'INTEGER_ONLY' | 'TOO_LARGE' };

/**
 * Validate a cashier- or scale-entered quantity against the product's unit.
 * Integer units accept `3` but not `3.5`; weighed units accept `0.375` but not
 * `0.3751` (sub-gram noise from a flaky scale is a pricing error, not a sale).
 */
export function normalizeQuantity(raw: unknown, uom: Uom | undefined, isWeighed = false): QuantityVerdict {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: 'NOT_POSITIVE' };
  if (n > 1_000_000) return { ok: false, reason: 'TOO_LARGE' };

  const fractional = isWeighed || isFractionalUom(uom);
  if (!fractional && !Number.isInteger(n)) return { ok: false, reason: 'INTEGER_ONLY' };

  const r = round3(n);
  // 0.0004 rounds to 0 — a genuinely free line, so reject it.
  if (r <= 0) return { ok: false, reason: 'NOT_POSITIVE' };
  if (fractional && Math.abs(r - n) > 1e-9) return { ok: false, reason: 'TOO_MANY_DECIMALS' };
  return { ok: true, quantity: r };
}

/** Convert between metric units of the same dimension. Unsupported pairs return null. */
export function convertQty(quantity: number, from: Uom, to: Uom): number | null {
  const q = Number(quantity);
  if (!Number.isFinite(q)) return null;
  if (from === to) return round3(q);

  const table: Record<string, number> = {
    'KG>G': 1000,
    'G>KG': 0.001,
    'L>ML': 1000,
    'ML>L': 0.001,
  };
  const factor = table[`${from}>${to}`];
  return factor === undefined ? null : round3(q * factor);
}

/** Line total in currency: unitPrice * quantity - discount, rounded to cents. */
export function lineTotal(unitPrice: number, quantity: number, discountAmt = 0): number {
  const price = Number(unitPrice) || 0;
  const qty = Number(quantity) || 0;
  const disc = Number(discountAmt) || 0;
  return Math.round((price * qty - disc + Number.EPSILON) * 100) / 100;
}

/** Human string for a receipt line: `0.375 kg` vs `3 each`. */
export function formatQuantity(quantity: number, uom: Uom = 'EACH'): string {
  const q = Number(quantity) || 0;
  if (!isFractionalUom(uom)) return `${Math.round(q)} ${uom === 'EACH' ? 'ea' : uom.toLowerCase()}`;
  const trimmed = String(round3(q)).replace(/\.0+$/, '');
  const label: Record<string, string> = { KG: 'kg', G: 'g', L: 'L', ML: 'ml', M: 'm' };
  return `${trimmed} ${label[uom] ?? uom.toLowerCase()}`;
}

/** EAN-13 / UPC-A mod-10 check digit. Scale codes are 13 digits. */
export function gtinCheckDigitValid(code: string): boolean {
  const digits = String(code ?? '').replace(/\D/g, '');
  if (digits.length !== 13 && digits.length !== 12) return false;
  if (digits.length !== String(code ?? '').length) return false;

  const body = digits.slice(0, -1);
  const check = Number(digits.slice(-1));
  let sum = 0;
  // Right-to-left, alternating weights 3,1 starting with 3.
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += Number(body[i]) * w;
  }
  return (10 - (sum % 10)) % 10 === check;
}

export interface ScaleCode {
  plu: string;
  /** Weight in kilograms, present when the embedded value is a weight. */
  weightKg?: number;
  /** Price in currency, present when the embedded value is a price. */
  price?: number;
  mode: 'WEIGHT' | 'PRICE';
}

/**
 * Decode an in-store (scale) barcode. The GS1 convention for a retailer-assigned
 * EAN-13 is a leading `2`: digit 1 = `2`, digits 2-6 = PLU, digits 7-11 = value
 * (grams or minor currency units), digit 13 = check digit. `mode` tells us which
 * meaning the value carries — it is a store setting, not something the barcode
 * itself reveals.
 *
 * Returns null for anything that is not a valid, prefixed scale code so the
 * caller falls through to a normal SKU/barcode lookup.
 */
export function decodeScaleBarcode(code: string, mode: 'WEIGHT' | 'PRICE' = 'WEIGHT'): ScaleCode | null {
  const raw = String(code ?? '').trim();
  if (!/^\d{13}$/.test(raw) || !raw.startsWith('2')) return null;
  if (!gtinCheckDigitValid(raw)) return null;

  const plu = raw.slice(1, 6);
  const value = Number(raw.slice(6, 11));
  if (!Number.isFinite(value) || value <= 0) return null;

  if (mode === 'WEIGHT') return { plu, weightKg: round3(value / 1000), mode };
  return { plu, price: Math.round(value) / 100, mode };
}

/** Price for a weighed line given a per-unit rate and a kilogram weight. */
export function weighedPrice(ratePerKg: number, weightKg: number): number {
  return lineTotal(ratePerKg, round3(weightKg));
}
