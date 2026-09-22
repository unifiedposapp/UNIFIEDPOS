import { describe, it, expect } from 'vitest';
import {
  canonicalJson,
  sha256Hex,
  newNonce,
  mandateSigningBody,
  signMandate,
  verifyMandateSignature,
  buildMandate,
  evaluateMandate,
  productToJsonLd,
  catalogToJsonLd,
  agentDescriptor,
  MANDATE_SPEC_VERSION,
  MAX_MANDATE_TTL_SECONDS,
  MAX_MANDATE_LINES,
  MANDATE_CLOCK_SKEW_SECONDS,
  AGENT_SIGNATURE_ALG,
  type Mandate,
  type MandateDraftInput,
} from '../src/services/agenticCommerce';

const NOW = new Date('2026-06-01T12:00:00Z');
const SECRET = 'shared-between-merchant-and-agent';

const draft = (overrides: Partial<MandateDraftInput> = {}): MandateDraftInput => ({
  agentId: 'agent-openai-1',
  merchantId: 'merchant-77',
  ceilingAmount: 100,
  items: [{ sku: 'S1', quantity: 2 }],
  issuedAt: NOW,
  nonce: 'nonce-1',
  ...overrides,
});

const signed = (overrides: Partial<MandateDraftInput> = {}): Mandate => {
  const mandate = buildMandate(draft(overrides));
  return { ...mandate, signature: signMandate(mandate, SECRET), signatureAlg: AGENT_SIGNATURE_ALG };
};

const goodQuote = [{ sku: 'S1', price: 20, quantityAvailable: 10 }];

describe('canonicalisation', () => {
  it('sorts keys at every depth so two encoders agree byte for byte', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });

  it('keeps array order because an array order is meaning', () => {
    expect(canonicalJson({ a: [2, 1] })).toBe('{"a":[2,1]}');
  });

  it('normalises money to two places and junk to zero', () => {
    expect(canonicalJson({ price: 12.3456 })).toBe('{"price":12.35}');
    expect(canonicalJson({ price: NaN })).toBe('{"price":0}');
    expect(canonicalJson({ price: Infinity })).toBe('{"price":0}');
  });

  it('drops what cannot be signed and dates an agent cannot parse differently', () => {
    expect(canonicalJson({ a: 1, b: undefined, c: () => 1 })).toBe('{"a":1}');
    expect(canonicalJson({ d: new Date('2026-01-01T00:00:00Z') })).toBe('{"d":"2026-01-01T00:00:00.000Z"}');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson([undefined])).toBe('[null]');
  });

  it('hashes the empty string the way every vector published it', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toHaveLength(64);
  });

  it('mints an unguessable, unique nonce', () => {
    const a = newNonce();
    expect(a.startsWith('mnt_')).toBe(true);
    expect(/^[0-9a-f]{24}$/.test(a.slice(4))).toBe(true);
    expect(newNonce()).not.toBe(a);
  });
});

describe('mandate signing', () => {
  it('signs the body without the signature itself', () => {
    const mandate = signed();
    expect(mandate.signature).toHaveLength(64);
    expect(mandateSigningBody(mandate)).not.toHaveProperty('signature');
    expect(mandateSigningBody(mandate)).toHaveProperty('ceilingAmount');
    expect(verifyMandateSignature(mandate, SECRET)).toBe(true);
  });

  it('a tampered ceiling is caught even though it is a single field', () => {
    const mandate = signed();
    expect(verifyMandateSignature({ ...mandate, ceilingAmount: 9999 }, SECRET)).toBe(false);
    expect(verifyMandateSignature({ ...mandate, merchantId: 'someone-else' }, SECRET)).toBe(false);
    expect(verifyMandateSignature(mandate, 'wrong-secret')).toBe(false);
  });

  it('is independent of the JSON key order the agent happened to use', () => {
    const mandate = buildMandate(draft());
    const reordered = JSON.parse(`{"items":${JSON.stringify(mandate.items)},"ceilingAmount":${mandate.ceilingAmount},"nonce":"${mandate.nonce}","currency":"${mandate.currency}","merchantId":"${mandate.merchantId}","agentId":"${mandate.agentId}","spec":"${mandate.spec}","expiresAt":"${mandate.expiresAt}","issuedAt":"${mandate.issuedAt}","mandateType":"${mandate.mandateType}","fulfilment":"${mandate.fulfilment}","principalEmail":null,"locationId":null}`);
    expect(signMandate(reordered, SECRET)).toBe(signMandate(mandate, SECRET));
  });

  it('refuses absent, empty and malformed credentials instead of throwing', () => {
    const mandate = signed();
    expect(verifyMandateSignature({ ...mandate, signature: undefined }, SECRET)).toBe(false);
    expect(verifyMandateSignature({ ...mandate, signature: '' }, SECRET)).toBe(false);
    expect(verifyMandateSignature(mandate, '')).toBe(false);
    expect(verifyMandateSignature({ ...mandate, signature: 'z'.repeat(64) }, SECRET)).toBe(false);
    expect(verifyMandateSignature({ ...mandate, signature: 'deadbeef' }, SECRET)).toBe(false);
  });

  it('accepts the hex: transport prefix some agents add', () => {
    const mandate = signed();
    expect(verifyMandateSignature({ ...mandate, signature: `hex:${mandate.signature}` }, SECRET)).toBe(true);
  });
});

describe('buildMandate', () => {
  it('applies the advertised defaults', () => {
    const mandate = buildMandate(draft());
    expect(mandate.spec).toBe(MANDATE_SPEC_VERSION);
    expect(mandate.currency).toBe('USD');
    expect(mandate.mandateType).toBe('PURCHASE');
    expect(mandate.fulfilment).toBe('PICKUP');
    expect(mandate.principalEmail).toBeNull();
    expect(mandate.locationId).toBeNull();
    expect(Date.parse(mandate.expiresAt) - Date.parse(mandate.issuedAt)).toBe(15 * 60 * 1000);
  });

  it('clamps the lifetime into a usable window', () => {
    const seconds = (m: Mandate) => (Date.parse(m.expiresAt) - Date.parse(m.issuedAt)) / 1000;
    expect(seconds(buildMandate(draft({ ttlSeconds: 1 })))).toBe(60);
    expect(seconds(buildMandate(draft({ ttlSeconds: 3600 })))).toBe(3600);
    expect(seconds(buildMandate(draft({ ttlSeconds: 10 * 24 * 60 * 60 })))).toBe(MAX_MANDATE_TTL_SECONDS);
  });

  it(' sanitises junk the agent may have been given', () => {
    const mandate = buildMandate(
      draft({
        currency: 'eur',
        ceilingAmount: -50,
        items: [{ sku: 'S1', quantity: 2.9, maxUnitPrice: 12.3456 }, { productId: 'P2', quantity: -3 }],
      })
    );
    expect(mandate.currency).toBe('EUR');
    expect(mandate.ceilingAmount).toBe(0);
    expect(mandate.items[0].quantity).toBe(2);
    expect(mandate.items[0].maxUnitPrice).toBe(12.35);
    expect(mandate.items[1].quantity).toBe(0);
    expect(mandate.items[1].sku).toBeNull();
    expect(mandate.items[1].maxUnitPrice).toBeNull();
  });
});

describe('mandate acceptance', () => {
  const evaluate = (mandate: Mandate, check: Parameters<typeof evaluateMandate>[1]) => evaluateMandate(mandate, { now: NOW, ...check });

  it('accepts a well-formed, in-window, priced cart and returns the computed total', () => {
    const verdict = evaluate(signed(), { quoted: goodQuote, total: 40 });
    expect(verdict).toEqual({ accept: true, code: 'OK', total: 40 });
  });

  it('rejects identity, spec and shape problems before anything else', () => {
    expect(evaluate({ ...signed(), agentId: '' }, { quoted: goodQuote, total: 40 }).code).toBe('MALFORMED');
    expect(evaluate({ ...signed(), merchantId: '' }, { quoted: goodQuote, total: 40 }).code).toBe('MALFORMED');
    expect(evaluate({ ...signed(), spec: 'other/2' }, { quoted: goodQuote, total: 40 }).code).toBe('UNSUPPORTED_SPEC');
    expect(evaluate({ ...signed(), items: [] }, { quoted: [], total: 0 }).code).toBe('EMPTY_MANDATE');
    const many = Array.from({ length: MAX_MANDATE_LINES + 1 }, (_, i) => ({ sku: `S${i}`, quantity: 1 }));
    expect(evaluate({ ...signed(), items: many }, { quoted: [], total: 0 }).code).toBe('TOO_MANY_LINES');
  });

  it('refuses unreadable timestamps', () => {
    expect(evaluate({ ...signed(), issuedAt: 'yesterday' }, { quoted: goodQuote, total: 40 }).code).toBe('BAD_TIMESTAMPS');
  });

  it('honours the window, with a little clock tolerance', () => {
    const mandate = signed();
    const expired = Date.parse(mandate.expiresAt);
    expect(evaluate(mandate, { quoted: goodQuote, total: 40, now: new Date(Date.parse(mandate.issuedAt) - 60 * 60_000) }).code).toBe('NOT_YET_VALID');
    expect(evaluate(mandate, { quoted: goodQuote, total: 40, now: new Date(expired + 60 * 60_000) }).code).toBe('EXPIRED');
    // A clock a couple of minutes off is a network problem, not a rejection.
    expect(
      evaluate(mandate, { quoted: goodQuote, total: 40, now: new Date(expired + MANDATE_CLOCK_SKEW_SECONDS * 1000 - 1000) }).accept
    ).toBe(true);
  });

  it('will not price a USD mandate against an EUR cart', () => {
    const verdict = evaluate(signed(), { quoted: goodQuote, total: 40, currency: 'eur' });
    expect(verdict.code).toBe('CURRENCY_MISMATCH');
    expect(verdict.accept).toBe(false);
    // No currency asserted on the quote means the mandate\'s own currency governs.
    expect(evaluate(signed(), { quoted: goodQuote, total: 40, currency: null }).accept).toBe(true);
  });

  it('reports the offending line by index so the agent can fix one item', () => {
    const base = { now: NOW, total: 40 };
    expect(evaluate({ ...signed(), items: [{ quantity: 1 } as never] }, { ...base, quoted: [{ price: 1 }] }).code).toBe('UNIDENTIFIED_LINE');
    expect(evaluate(signed(), { ...base, quoted: [null] }).code).toBe('ITEM_NOT_FOUND');
    expect(evaluate(signed(), { ...base, quoted: [{ sku: 'S1', price: 20, agentPurchasable: false }] }).code).toBe('NOT_AGENT_SELLABLE');
    expect(evaluate({ ...signed(), items: [{ sku: 'S1', quantity: 0 }] }, { ...base, quoted: goodQuote }).code).toBe('BAD_QUANTITY');
    expect(evaluate(signed(), { ...base, quoted: [{ sku: 'S1', price: 20, quantityAvailable: 1 }] }).code).toBe('INSUFFICIENT_STOCK');
    const stock = evaluate({ ...signed(), items: [{ sku: 'S1', quantity: 5, maxUnitPrice: 10 }] }, { ...base, quoted: [{ sku: 'S1', price: 20 }] });
    expect(stock.code).toBe('PRICE_ABOVE_GUARD');
    expect((stock as { itemIndex?: number }).itemIndex).toBe(0);
  });

  it('holds the ceiling against the computed total', () => {
    const verdict = evaluate(signed(), { quoted: [{ sku: 'S1', price: 60, quantityAvailable: 10 }], total: 120, now: NOW });
    expect(verdict.accept).toBe(false);
    expect(verdict.code).toBe('CEILING_EXCEEDED');
    expect((verdict as { message: string }).message).toContain('120');
  });

  it('holds the ceiling against what the merchant actually charges', () => {
    // The lines price out inside the ceiling, but the cart total does not.
    const verdict = evaluate(signed(), { quoted: goodQuote, total: 500, now: NOW });
    expect(verdict.code).toBe('CEILING_EXCEEDED');
    expect((verdict as { message: string }).message).toContain('charged total');
  });

  it('treats a zero ceiling as no ceiling at all', () => {
    const mandate = signed({ ceilingAmount: 0 });
    expect(evaluate(mandate, { quoted: [{ sku: 'S1', price: 9000, quantityAvailable: 10 }], total: 18_000 }).accept).toBe(true);
  });

  it('accumulates each line at two decimals', () => {
    const mandate = signed({ items: [{ sku: 'A', quantity: 3 }, { sku: 'B', quantity: 1 }] });
    const verdict = evaluate(mandate, { quoted: [{ sku: 'A', price: 19.99 }, { sku: 'B', price: 0.01 }], total: 59.98 });
    expect(verdict.accept && verdict.total).toBe(59.98);
  });
});

describe('JSON-LD catalog', () => {
  const product = (overrides: Partial<Parameters<typeof productToJsonLd>[0]> = {}) => ({
    id: 'p/1',
    name: 'Espresso',
    price: 3.5,
    currency: 'usd',
    ...overrides,
  });

  it('emits the schema.org shape an agent parser expects', () => {
    const json = productToJsonLd(product(), 'https://shop.example');
    expect(json['@context']).toBe('https://schema.org');
    expect(json['@type']).toBe('Product');
    expect(json['@id']).toBe('https://shop.example/api/agents/public/catalog/p%2F1');
    const offers = json.offers as Record<string, unknown>;
    expect(offers.url).toBe('https://shop.example/api/agents/checkout');
    expect(offers.priceCurrency).toBe('USD');
    expect(offers.price).toBe(3.5);
    expect(offers.availability).toBe('https://schema.org/OutOfStock');
  });

  it('declares stock, and omits what the merchant did not provide', () => {
    const inStock = productToJsonLd(product({ stockQuantity: 12.7, brand: 'House', description: 'Beans' }), 'https://shop.example');
    const offers = inStock.offers as Record<string, unknown>;
    expect(offers.availability).toBe('https://schema.org/InStock');
    expect(offers.inventoryQuantity).toBe(12);
    expect(inStock.brand).toEqual({ '@type': 'Brand', name: 'House' });
    // A null stock is unknown stock, never zero stock.
    expect(JSON.parse(JSON.stringify(productToJsonLd(product({ stockQuantity: null }), 'https://x'))).offers).not.toHaveProperty('inventoryQuantity');
    expect(JSON.parse(JSON.stringify(inStock))).toHaveProperty('description');
    expect(JSON.parse(JSON.stringify(productToJsonLd(product(), 'https://x')))).not.toHaveProperty('sku');
  });

  it('withdraws the open quantity offer from a product an agent may not buy', () => {
    const locked = JSON.parse(JSON.stringify(productToJsonLd(product({ agentPurchasable: false }), 'https://x')));
    expect(locked.offers).not.toHaveProperty('eligibleQuantity');
    const open = JSON.parse(JSON.stringify(productToJsonLd(product(), 'https://x')));
    expect(open.offers.eligibleQuantity).toEqual({ '@type': 'QuantitativeValue', minValue: 1 });
    // A zero tax rate is not a tax-inclusive price.
    expect(JSON.parse(JSON.stringify(productToJsonLd(product({ taxPercent: 0 }), 'https://x'))).offers).not.toHaveProperty('priceSpecification');
    expect((productToJsonLd(product({ taxPercent: 20 }), 'https://x').offers as Record<string, unknown>).priceSpecification).toEqual({
      '@type': 'PriceSpecification',
      valueAddedTaxIncluded: true,
      tax: 20,
    });
  });

  it('wraps a collection as a graph with stable positions', () => {
    const list = catalogToJsonLd([{ '@type': 'Product', name: 'A' }, { '@type': 'Product', name: 'B' }], { name: 'Menu', url: 'https://x/catalog', locationId: 'loc-1' });
    expect(list['@type']).toBe('ItemList');
    expect(list.numberOfItems).toBe(2);
    expect((list['@graph'] as Record<string, unknown>[]).map((p) => p.position)).toEqual([1, 2]);
    expect(list.location).toEqual({ '@type': 'Place', identifier: 'loc-1' });
    expect(JSON.parse(JSON.stringify(catalogToJsonLd([], { name: 'Empty', url: 'https://x' })))).not.toHaveProperty('location');
  });
});

describe('well-known descriptor', () => {
  it('publishes the contract an agent needs before it authenticates', () => {
    const descriptor = agentDescriptor({ merchantName: 'Corner Cafe', merchantId: 'm-1', baseUrl: 'https://shop.example/', countryCode: 'US', now: NOW });
    expect(descriptor.endpoints.checkout).toBe('https://shop.example/api/agents/checkout');
    expect(descriptor.endpoints.catalog).toBe('https://shop.example/api/agents/public/:locationId/catalog.jsonld');
    expect(descriptor.mandate.spec).toBe(MANDATE_SPEC_VERSION);
    expect(descriptor.mandate.signatureAlgorithm).toBe('HMAC-SHA256');
    expect(descriptor.mandate.maxTtlSeconds).toBe(MAX_MANDATE_TTL_SECONDS);
    expect(descriptor.mandate.maxLines).toBe(MAX_MANDATE_LINES);
    expect(descriptor.mandate.requiredFields).toContain('signature');
    expect(descriptor.mandate.guards).toContain('ceilingAmount');
    expect(descriptor.checkout.accepts.paymentMethods).toEqual(['CASH', 'CARD']);
    expect(descriptor.currency).toBe('USD');
    expect(descriptor.updatedAt).toBe(NOW.toISOString());
    expect(descriptor.catalogueFormats).toContain('application/ld+json');
  });

  it('is honest about an unknown country and a bare base url', () => {
    const descriptor = agentDescriptor({ merchantName: 'X', merchantId: 'm', baseUrl: '' });
    expect(descriptor.countryCode).toBeNull();
    expect(descriptor.endpoints.order).toBe('/api/agents/public/order/:orderId');
    expect(typeof descriptor.updatedAt).toBe('string');
  });
});
