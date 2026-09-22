// ─── AGENTIC COMMERCE (machine-speed checkout) ───────────────────────────────
// Shopping agents are already buying; what they cannot do is check out safely,
// because there is no way to prove a human authorised the spend. The missing
// primitive is a MANDATE: a small, signed, time-boxed, ceiling-capped purchase
// authorisation an agent presents and the merchant verifies before fulfilling.
//
// Three surfaces make a store agent-ready:
//   1. A JSON-LD catalog an agent can read (schema.org Product + Offer).
//   2. A /.well-known descriptor saying where checkout lives and what it accepts.
//   3. Signed mandates with deterministic acceptance rules.
//
// Everything here is pure over its inputs (the signing secret and clock are
// injected), so acceptance can be replayed exactly — which is what a dispute
// about an agent order requires.
import crypto from 'node:crypto';

export const MANDATE_SPEC_VERSION = 'unifiedpos-mandate/1';
export const AGENT_SIGNATURE_ALG = 'HMAC-SHA256';
/** Wall-clock tolerance so a slightly skewed agent clock is not a rejection. */
export const MANDATE_CLOCK_SKEW_SECONDS = 120;
export const MAX_MANDATE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const MAX_MANDATE_LINES = 100;

// ─── canonicalisation ────────────────────────────────────────────────────────
/** Deterministic JSON: keys sorted at every depth, money normalised to 2dp. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortNode(value));
}

function sortNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortNode);
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value !== 'object') return scalar(value);
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src).sort()) {
    const v = src[key];
    if (v === undefined || typeof v === 'function') continue;
    out[key] = sortNode(v);
  }
  return out;
}

function scalar(v: unknown): unknown {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  if (typeof v === 'string' || typeof v === 'boolean' || v === null) return v;
  if (typeof v === 'undefined') return null;
  return String(v);
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function newNonce(): string {
  return `mnt_${crypto.randomBytes(12).toString('hex')}`;
}

// ─── mandate ─────────────────────────────────────────────────────────────────
export interface MandateLine {
  /** One of sku / productId / gtin identifies the item; all three are accepted. */
  sku?: string | null;
  productId?: string | null;
  gtin?: string | null;
  quantity: number;
  /** Per-agent guard: never pay more than this for a unit. */
  maxUnitPrice?: number | null;
}

export interface Mandate {
  spec: string;
  agentId: string;
  principalEmail?: string | null;
  merchantId: string;
  locationId?: string | null;
  mandateType: 'PURCHASE' | 'GIFT' | 'REPLENISH';
  currency: string;
  ceilingAmount: number;
  items: MandateLine[];
  nonce: string;
  issuedAt: string; // ISO-8601
  expiresAt: string; // ISO-8601
  fulfilment?: 'PICKUP' | 'DELIVERY' | 'SHIP' | 'DIGITAL' | null;
  signature?: string;
  signatureAlg?: string;
}

/**
 * The signed body excludes `signature` itself and any volatile bookkeeping. The
 * merchant id is inside the envelope so a mandate cannot be replayed against a
 * different store.
 */
export function mandateSigningBody(mandate: Partial<Mandate>): Record<string, unknown> {
  const { signature: _signature, signatureAlg: _alg, ...rest } = mandate as Record<string, unknown>;
  return rest;
}

export function signMandate(mandate: Partial<Mandate>, secret: string): string {
  return crypto.createHmac('sha256', String(secret || '')).update(canonicalJson(mandateSigningBody(mandate))).digest('hex');
}

export function verifyMandateSignature(mandate: Partial<Mandate>, secret: string): boolean {
  // An agent may present the signature as `hex:<digest>`; the transport hint is
  // stripped before any comparison so the tolerance is real rather than cosmetic.
  const provided = String(mandate?.signature || '').replace(/^hex:/, '').trim();
  if (!provided || !secret) return false;
  const expected = signMandate(mandate, secret);
  if (expected.length !== provided.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false;
  }
}

export interface MandateDraftInput {
  agentId: string;
  principalEmail?: string | null;
  merchantId: string;
  locationId?: string | null;
  mandateType?: Mandate['mandateType'];
  currency?: string;
  ceilingAmount: number;
  items: MandateLine[];
  ttlSeconds?: number;
  fulfilment?: Mandate['fulfilment'];
  issuedAt?: Date;
  nonce?: string;
}

export function buildMandate(input: MandateDraftInput): Mandate {
  const issuedAt = input.issuedAt || new Date();
  const requestedTtl = Math.trunc(Number(input.ttlSeconds) || 15 * 60);
  const ttl = Math.max(60, Math.min(MAX_MANDATE_TTL_SECONDS, requestedTtl));
  const expiresAt = new Date(issuedAt.getTime() + ttl * 1000);
  return {
    spec: MANDATE_SPEC_VERSION,
    agentId: String(input.agentId || ''),
    principalEmail: input.principalEmail ?? null,
    merchantId: String(input.merchantId || ''),
    locationId: input.locationId ?? null,
    mandateType: input.mandateType || 'PURCHASE',
    currency: String(input.currency || 'USD').toUpperCase(),
    ceilingAmount: Math.max(0, round2(Number(input.ceilingAmount) || 0)),
    items: (input.items || []).map((i) => ({
      sku: i.sku ?? null,
      productId: i.productId ?? null,
      gtin: i.gtin ?? null,
      quantity: Math.max(0, Math.trunc(Number(i.quantity) || 0)),
      maxUnitPrice: i.maxUnitPrice == null ? null : round2(Number(i.maxUnitPrice)),
    })),
    nonce: input.nonce || newNonce(),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    fulfilment: input.fulfilment ?? 'PICKUP',
  };
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// ─── acceptance ──────────────────────────────────────────────────────────────
export interface CatalogItemPrice {
  sku?: string | null;
  productId?: string | null;
  gtin?: string | null;
  price: number;
  quantityAvailable?: number | null;
  agentPurchasable?: boolean;
  currency?: string | null;
}

export interface MandateCheckInput {
  /** Resolved live prices/stock for the mandate lines, same order as mandate.items. */
  quoted: (CatalogItemPrice | null)[];
  total: number;
  now?: Date;
  currency?: string | null;
}

export type MandateVerdict =
  | { accept: true; total: number; code: 'OK' }
  | { accept: false; code: string; message: string; itemIndex?: number };

/**
 * Acceptance rules, in the order a merchant would argue them: format, window,
 * identity, priceability, per-line guard, then the ceiling. The signature is
 * checked by the caller (it needs the secret) so this stays a pure policy test.
 */
export function evaluateMandate(mandate: Mandate, check: MandateCheckInput): MandateVerdict {
  const now = check.now || new Date();
  if (!mandate?.agentId || !mandate?.merchantId) return { accept: false, code: 'MALFORMED', message: 'mandate is missing an agent or merchant identity' };
  if (mandate.spec !== MANDATE_SPEC_VERSION) return { accept: false, code: 'UNSUPPORTED_SPEC', message: `unsupported mandate spec ${String(mandate.spec)}` };
  if (!Array.isArray(mandate.items) || mandate.items.length === 0) return { accept: false, code: 'EMPTY_MANDATE', message: 'mandate lists no line items' };
  if (mandate.items.length > MAX_MANDATE_LINES) return { accept: false, code: 'TOO_MANY_LINES', message: `mandate is limited to ${MAX_MANDATE_LINES} lines` };

  const issued = Date.parse(mandate.issuedAt);
  const expires = Date.parse(mandate.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires)) return { accept: false, code: 'BAD_TIMESTAMPS', message: 'mandate issuedAt/expiresAt must be ISO-8601' };
  if (now.getTime() < issued - MANDATE_CLOCK_SKEW_SECONDS * 1000) return { accept: false, code: 'NOT_YET_VALID', message: 'mandate is not valid yet' };
  if (now.getTime() > expires + MANDATE_CLOCK_SKEW_SECONDS * 1000) return { accept: false, code: 'EXPIRED', message: 'mandate expired' };

  const mandateCurrency = String(mandate.currency || '').toUpperCase();
  const quoteCurrency = String(check.currency || mandateCurrency).toUpperCase();
  if (mandateCurrency && quoteCurrency && mandateCurrency !== quoteCurrency) {
    return { accept: false, code: 'CURRENCY_MISMATCH', message: `mandate is in ${mandateCurrency}, the cart is in ${quoteCurrency}` };
  }

  let computed = 0;
  for (let i = 0; i < mandate.items.length; i++) {
    const line = mandate.items[i];
    const quote = check.quoted?.[i] ?? null;
    if (!line.sku && !line.productId && !line.gtin) return { accept: false, code: 'UNIDENTIFIED_LINE', message: 'line has no sku, productId or gtin', itemIndex: i };
    if (!quote) return { accept: false, code: 'ITEM_NOT_FOUND', message: 'item is not in this store catalog', itemIndex: i };
    if (quote.agentPurchasable === false) return { accept: false, code: 'NOT_AGENT_SELLABLE', message: 'item may not be sold to an agent', itemIndex: i };
    const qty = Math.trunc(Number(line.quantity) || 0);
    if (qty <= 0) return { accept: false, code: 'BAD_QUANTITY', message: 'quantity must be positive', itemIndex: i };
    if (quote.quantityAvailable != null && qty > Math.trunc(quote.quantityAvailable)) {
      return { accept: false, code: 'INSUFFICIENT_STOCK', message: `only ${quote.quantityAvailable} available`, itemIndex: i };
    }
    const unit = round2(Number(quote.price) || 0);
    if (line.maxUnitPrice != null && unit > round2(Number(line.maxUnitPrice))) {
      return { accept: false, code: 'PRICE_ABOVE_GUARD', message: `unit price ${unit} exceeds the ${line.maxUnitPrice} guard`, itemIndex: i };
    }
    computed = round2(computed + unit * qty);
  }

  if (mandate.ceilingAmount > 0 && computed > round2(mandate.ceilingAmount)) {
    return { accept: false, code: 'CEILING_EXCEEDED', message: `total ${computed} exceeds the ${mandate.ceilingAmount} ceiling` };
  }
  const quotedTotal = round2(Number(check.total) || 0);
  if (quotedTotal > computed && mandate.ceilingAmount > 0 && quotedTotal > round2(mandate.ceilingAmount)) {
    return { accept: false, code: 'CEILING_EXCEEDED', message: `charged total ${quotedTotal} exceeds the ceiling` };
  }
  return { accept: true, code: 'OK', total: computed };
}

// ─── JSON-LD catalog ─────────────────────────────────────────────────────────
export interface JsonLdProductInput {
  id: string;
  name: string;
  description?: string | null;
  sku?: string | null;
  gtin?: string | null;
  image?: string | null;
  brand?: string | null;
  category?: string | null;
  price: number;
  currency: string;
  stockQuantity?: number | null;
  agentPurchasable?: boolean;
  taxPercent?: number | null;
  locationId?: string | null;
}

/** schema.org/Product with an AggregateOffer — what an agent parser expects. */
export function productToJsonLd(input: JsonLdProductInput, baseUrl: string): Record<string, unknown> {
  const inStock = (input.stockQuantity ?? 0) > 0;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${baseUrl}/api/agents/public/catalog/${encodeURIComponent(input.id)}`,
    name: input.name,
    description: input.description || undefined,
    sku: input.sku || undefined,
    gtin13: input.gtin || undefined,
    image: input.image || undefined,
    category: input.category || undefined,
    brand: input.brand ? { '@type': 'Brand', name: input.brand } : undefined,
    offers: {
      '@type': 'Offer',
      url: `${baseUrl}/api/agents/checkout`,
      priceCurrency: String(input.currency || 'USD').toUpperCase(),
      price: round2(Number(input.price) || 0),
      priceSpecification: input.taxPercent
        ? { '@type': 'PriceSpecification', valueAddedTaxIncluded: true, tax: round2(Number(input.taxPercent)) }
        : undefined,
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      inventoryQuantity: input.stockQuantity == null ? undefined : Math.max(0, Math.trunc(Number(input.stockQuantity))),
      itemCondition: 'https://schema.org/NewCondition',
      eligibleQuantity: input.agentPurchasable === false ? undefined : { '@type': 'QuantitativeValue', minValue: 1 },
      merchant: { '@type': 'Organization', identifier: input.locationId || undefined },
    },
  };
}

export function catalogToJsonLd(products: Record<string, unknown>[], meta: { name: string; url: string; locationId?: string | null }): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: meta.name,
    url: meta.url,
    numberOfItems: products.length,
    // Agents follow @graph rather than a bare array, so the collection is a graph.
    '@graph': products.map((p, index) => ({ ...p, position: index + 1 })),
    location: meta.locationId ? { '@type': 'Place', identifier: meta.locationId } : undefined,
  };
}

// ─── well-known descriptor ───────────────────────────────────────────────────
export interface AgentDescriptor {
  '@context': string;
  specification: string;
  merchantName: string;
  merchantId: string;
  countryCode: string | null;
  currency: string;
  endpoints: { catalog: string; checkout: string; mandateVerify: string; order: string };
  mandate: {
    spec: string;
    signatureAlgorithm: string;
    signingCurveHint: string;
    maxTtlSeconds: number;
    maxLines: number;
    requiredFields: string[];
    guards: string[];
  };
  checkout: {
    accepts: { mandate: string; cart: string[]; paymentMethods: string[] };
    returns: string[];
    rateLimitPerMinute: number;
  };
  catalogueFormats: string[];
  updatedAt: string;
}

export function agentDescriptor(input: {
  merchantName: string;
  merchantId: string;
  baseUrl: string;
  countryCode?: string | null;
  currency?: string;
  paymentMethods?: string[];
  now?: Date;
}): AgentDescriptor {
  const base = String(input.baseUrl || '').replace(/\/$/, '');
  return {
    '@context': 'https://schema.org',
    specification: MANDATE_SPEC_VERSION,
    merchantName: input.merchantName,
    merchantId: input.merchantId,
    countryCode: input.countryCode ?? null,
    currency: String(input.currency || 'USD').toUpperCase(),
    endpoints: {
      catalog: `${base}/api/agents/public/:locationId/catalog.jsonld`,
      checkout: `${base}/api/agents/checkout`,
      mandateVerify: `${base}/api/agents/mandate/verify`,
      order: `${base}/api/agents/public/order/:orderId`,
    },
    mandate: {
      spec: MANDATE_SPEC_VERSION,
      signatureAlgorithm: AGENT_SIGNATURE_ALG,
      signingCurveHint: 'Provide the shared secret out of band; the signature is HMAC-SHA256 over the canonical JSON body.',
      maxTtlSeconds: MAX_MANDATE_TTL_SECONDS,
      maxLines: MAX_MANDATE_LINES,
      requiredFields: ['spec', 'agentId', 'merchantId', 'currency', 'ceilingAmount', 'items', 'nonce', 'issuedAt', 'expiresAt', 'signature'],
      guards: ['per-line maxUnitPrice', 'ceilingAmount', 'expiry window', 'stock availability', 'agent-sellable flag'],
    },
    checkout: {
      accepts: { mandate: 'signed mandate + resolved cart', cart: ['sku', 'productId', 'gtin'], paymentMethods: input.paymentMethods || ['CASH', 'CARD'] },
      returns: ['orderId', 'orderNumber', 'receiptUrl', 'status'],
      rateLimitPerMinute: 60,
    },
    catalogueFormats: ['application/ld+json', 'application/json'],
    updatedAt: (input.now || new Date()).toISOString(),
  };
}
