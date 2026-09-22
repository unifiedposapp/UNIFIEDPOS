// ─── Barcode symbologies (pure, deterministic, dependency-free) ──────────────
// Retail shelf labels need real, scannable codes — not random strings. This
// module implements the arithmetic of EAN-13 (the symbology every POS scanner
// reads worldwide) and derives *stable* internal codes for products that were
// created without one, so reprinting a label never produces a different bar.
//
// GS1 reserves the number ranges 02 and 20-29 for internal/trade use. We emit
// codes that start with "20" so an in-house code can never collide with a
// manufacturer's registered GTIN, and we still compute the check digit exactly
// as GS1 does, which means the result scans with the same logic as a real one.

import crypto from 'node:crypto';

/** Prefix for organization-internal codes (GS1 in-store range). */
export const INTERNAL_PREFIX = '20';

/** Everything a scanner can encode in CODE128 subset B: printable ASCII. */
export function code128Safe(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '');
}

/**
 * EAN-13 check digit: positions are counted from the left of the 12-digit body,
 * odd positions weigh 1 and even positions weigh 3; the check digit is whatever
 * brings the total to the next multiple of ten.
 */
export function ean13CheckDigit(code12: string): number {
  const digits = String(code12).replace(/\D/g, '');
  if (digits.length !== 12) throw new Error(`EAN-13 body must be 12 digits, got ${digits.length}`);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** Append the computed check digit: 12 digits in, 13 digits out. */
export function withEan13CheckDigit(code12: string): string {
  const digits = String(code12).replace(/\D/g, '');
  return `${digits}${ean13CheckDigit(digits)}`;
}

/** True when `code` is a well-formed EAN-13 with a valid check digit. */
export function isValidEan13(code: string): boolean {
  const digits = String(code ?? '').trim();
  if (!/^\d{13}$/.test(digits)) return false;
  return withEan13CheckDigit(digits.slice(0, 12)) === digits;
}

/**
 * Derive a deterministic internal EAN-13 for one product of one organization.
 * Same inputs always produce the same code, so a lost label can be reprinted.
 */
export function internalEan13(organizationId: string, seed: string): string {
  // Hash blocks are consumed byte by byte until the 12-digit body is complete;
  // byte % 10 is uniform enough for an in-store code and keeps this pure.
  let body = INTERNAL_PREFIX;
  let block = 0;
  while (body.length < 12) {
    const digest = crypto.createHash('sha256').update(`${organizationId}|${seed}|${block++}`).digest();
    for (const byte of digest) {
      if (body.length >= 12) break;
      body += String(byte % 10);
    }
  }
  return withEan13CheckDigit(body);
}

/** Human-readable grouping under the bars: "2012345 678901". */
export function formatEan13(code: string): string {
  const digits = String(code).replace(/\D/g, '');
  if (digits.length !== 13) return code;
  return `${digits.slice(0, 7)} ${digits.slice(7)}`;
}

/**
 * Normalize whatever a scanner reports into a comparable key: digits only for
 * numeric codes, trimmed otherwise. Lets a search match "978-0-306-40615-7"
 * against a stored "9780306406157".
 */
export function normalizeScannedCode(value: string): string {
  const raw = String(value ?? '').trim();
  const digits = raw.replace(/[\s-]/g, '');
  return /^\d+$/.test(digits) ? digits : raw;
}

/**
 * Expand a scanned/entered code to the stored forms worth searching for:
 * the raw value, the digit-only value, and — for 12-digit UPC-A — the EAN-13
 * with a leading zero (UPC-A is a subset of EAN-13 in the GS1 spec).
 */
export function scannedCodeCandidates(value: string): string[] {
  const out = new Set<string>();
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  out.add(raw);
  const digits = normalizeScannedCode(raw);
  out.add(digits);
  if (/^\d{12}$/.test(digits)) out.add(`0${digits}`);
  if (/^\d{13}$/.test(digits) && digits.startsWith('0')) out.add(digits.slice(1));
  return [...out];
}

export interface LabelSpec {
  productId: string;
  name: string;
  sku: string | null;
  barcode: string;
  symbology: 'EAN13' | 'CODE128';
  price: number;
  costPrice: number | null;
  currency: string;
  taxPercent: number | null;
  categoryName: string | null;
  /** Catalog type, so the UI can flag services as "no shelf label needed". */
  productType: string;
}

/**
 * Turn a product row into a printable label. The barcode is the product's own
 * when it has one, otherwise the deterministic internal code (which the caller
 * may persist back onto the product).
 */
export function buildLabel(
  product: { id: string; name: string; sku?: string | null; barcode?: string | null; type?: string | null; price?: unknown; costPrice?: unknown },
  context: { organizationId: string; currency: string; taxPercent?: number | null; categoryName?: string | null },
): { label: LabelSpec; generated: boolean } {
  const existing = product.barcode ? code128Safe(product.barcode) : '';
  const generated = !existing;
  const barcode = generated ? internalEan13(context.organizationId, product.id) : existing;
  const numeric = /^\d{13}$/.test(barcode) && isValidEan13(barcode);
  return {
    generated,
    label: {
      productId: product.id,
      name: product.name,
      sku: product.sku ?? null,
      barcode,
      symbology: numeric ? 'EAN13' : 'CODE128',
      price: Number(product.price ?? 0),
      costPrice: product.costPrice == null ? null : Number(product.costPrice),
      currency: context.currency,
      taxPercent: context.taxPercent ?? null,
      categoryName: context.categoryName ?? null,
      productType: product.type || 'PHYSICAL',
    },
  };
}
