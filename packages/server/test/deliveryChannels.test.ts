import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DELIVERY_CHANNELS,
  DELIVERY_STATUSES,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  DEFAULT_TOLERANCE_SEC,
  findChannel,
  normalizeDeliveryStatus,
  isProgressiveStatus,
  signDeliveryPayload,
  verifyDeliverySignature,
  buildDispatchPayload,
  simulatedDeliveryId,
  dispatchOrder,
  fetchDeliveryStatus,
  parseStatusWebhook,
  type DispatchOrder,
} from '../src/services/deliveryChannels';

const ORDER: DispatchOrder = {
  orderId: 'ord_123',
  orderNumber: 'WEB-0042',
  storeName: 'Harbour Roasters',
  currency: 'EUR',
  totalAmount: 34.5,
  deliveryFee: 3.9,
  pickupBy: new Date('2026-09-21T12:30:00Z'),
  dropoff: {
    recipientName: 'Ana Ruiz',
    phone: '+34 600 000 000',
    addressLine1: 'Paseo 12',
    addressLine2: '3B',
    city: 'Madrid',
    state: 'M',
    postalCode: '28001',
    country: 'ES',
    notes: 'Ring twice',
  },
  items: [
    { name: 'Flat white', quantity: 2 },
    { name: 'Croissant', quantity: 1 },
  ],
};

// ─── One vocabulary for every partner ───────────────────────────────────────
describe('normalizeDeliveryStatus', () => {
  it('maps the words partners actually use onto our statuses', () => {
    expect(normalizeDeliveryStatus('delivered')).toBe('DELIVERED');
    expect(normalizeDeliveryStatus('COMPLETED')).toBe('DELIVERED');
    expect(normalizeDeliveryStatus('driver-assigned')).toBe('ASSIGNED');
    expect(normalizeDeliveryStatus('On way')).toBe('PICKED_UP');
    expect(normalizeDeliveryStatus('canceled')).toBe('CANCELLED'); // US spelling
    expect(normalizeDeliveryStatus(' No Show ')).toBe('FAILED');
  });

  it('understands dotted event names by their trailing verb', () => {
    expect(normalizeDeliveryStatus('order.delivered')).toBe('DELIVERED');
    expect(normalizeDeliveryStatus('delivery.driver_assigned')).toBe('ASSIGNED');
    expect(normalizeDeliveryStatus('v2.order.teleported')).toBeNull();
  });

  it('returns null for anything it does not understand rather than guessing', () => {
    expect(normalizeDeliveryStatus('quantum_leap')).toBeNull();
    expect(normalizeDeliveryStatus('')).toBeNull();
    expect(normalizeDeliveryStatus(undefined)).toBeNull();
    expect(normalizeDeliveryStatus(null)).toBeNull();
  });

  it('covers every status in the vocabulary with at least one alias', () => {
    for (const status of DELIVERY_STATUSES) {
      expect(normalizeDeliveryStatus(status.toLowerCase())).toBe(status);
    }
  });
});

describe('isProgressiveStatus', () => {
  it('refuses to rewind a parcel already on its way', () => {
    expect(isProgressiveStatus('PICKED_UP', 'ACCEPTED')).toBe(false);
    expect(isProgressiveStatus('DELIVERED', 'REQUESTED')).toBe(false);
    // The fulfillment row uses the app vocabulary, which must rank too.
    expect(isProgressiveStatus('OUT_FOR_DELIVERY', 'REQUESTED')).toBe(false);
    expect(isProgressiveStatus('OUT_FOR_DELIVERY', 'DELIVERED')).toBe(true);
  });

  it('accepts equal or later progress, and anything with no known history', () => {
    expect(isProgressiveStatus('ACCEPTED', 'ACCEPTED')).toBe(true);
    expect(isProgressiveStatus('REQUESTED', 'DELIVERED')).toBe(true);
    expect(isProgressiveStatus(null, 'FAILED')).toBe(true);
    expect(isProgressiveStatus('SOMETHING_WE_HAVE_NEVER_SEEN', 'ACCEPTED')).toBe(true);
  });

  it('lets a cancellation or failure land last', () => {
    expect(isProgressiveStatus('PICKED_UP', 'CANCELLED')).toBe(true);
    expect(isProgressiveStatus('DELIVERED', 'FAILED')).toBe(true);
  });
});

describe('channel catalog', () => {
  it('resolves a provider key case- and whitespace-insensitively', () => {
    expect(findChannel(' DoorDash ')).toBe(DELIVERY_CHANNELS.find((c) => c.provider === 'doordash'));
    expect(findChannel('nope')).toBeUndefined();
  });

  it('has unique provider keys and display names', () => {
    const keys = DELIVERY_CHANNELS.map((c) => c.provider);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('own_fleet');
    expect(keys).toContain('generic');
  });

  it('tags every channel with a region so coverage is auditable', () => {
    for (const c of DELIVERY_CHANNELS) expect(c.region?.trim()).toBeTruthy();
  });

  it('covers every inhabited continent, including Africa', () => {
    const regions = new Set(DELIVERY_CHANNELS.map((c) => c.region));
    for (const r of ['Africa', 'Americas', 'Europe', 'Asia', 'Oceania']) {
      // Asia is split into sub-regions; accept any region that mentions it.
      const hit = r === 'Asia'
        ? [...regions].some((x) => x.includes('Asia'))
        : regions.has(r);
      expect(hit, `missing region: ${r}`).toBe(true);
    }
    // The gap the world had: named African networks must be listed.
    const africa = DELIVERY_CHANNELS.filter((c) => c.region === 'Africa').map((c) => c.provider);
    expect(africa).toEqual(expect.arrayContaining(['boltfood', 'giglogistics', 'kudi', 'jumia']));
  });

  it('resolves newly added global providers', () => {
    expect(findChannel('swiggy')?.region).toBe('South Asia');
    expect(findChannel('ifood')?.region).toBe('Americas');
    expect(findChannel('meituan')?.region).toBe('East Asia');
    expect(findChannel('boltfood')?.name).toBe('Bolt Food');
  });
});

// ─── Signature scheme ───────────────────────────────────────────────────────
describe('signDeliveryPayload', () => {
  it('is a versioned, deterministic HMAC over "<timestamp>.<rawBody>"', () => {
    const a = signDeliveryPayload('s3cret', 1700000000, '{"a":1}');
    expect(a).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(a).toBe(signDeliveryPayload('s3cret', '1700000000', '{"a":1}'));
    expect(a).not.toBe(signDeliveryPayload('s3cret', 1700000001, '{"a":1}'));
    expect(a).not.toBe(signDeliveryPayload('other', 1700000000, '{"a":1}'));
  });
});

describe('verifyDeliverySignature', () => {
  const secret = 's3cret';
  const body = '{"delivery_id":"D-9","status":"delivered"}';
  const now = () => Math.floor(Date.now() / 1000);

  it('accepts a fresh correctly-signed callback', () => {
    const ts = now();
    expect(verifyDeliverySignature({ secret, rawBody: body, signature: signDeliveryPayload(secret, ts, body), timestamp: String(ts) })).toEqual({ ok: true });
  });

  it('accepts the bare digest without the v1= prefix and millisecond stamps', () => {
    const ts = now();
    const digest = signDeliveryPayload(secret, ts, body).slice(3);
    expect(verifyDeliverySignature({ secret, rawBody: body, signature: digest, timestamp: String(ts) }).ok).toBe(true);
    const ms = ts * 1000;
    expect(verifyDeliverySignature({ secret, rawBody: body, signature: signDeliveryPayload(secret, ms, body), timestamp: String(ms) }).ok).toBe(true);
  });

  it('rejects a tampered body, a wrong secret and a forged signature', () => {
    const ts = now();
    const good = signDeliveryPayload(secret, ts, body);
    expect(verifyDeliverySignature({ secret, rawBody: body.replace('delivered', 'REQUESTED'), signature: good, timestamp: String(ts) })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyDeliverySignature({ secret: 'wrong', rawBody: body, signature: good, timestamp: String(ts) }).reason).toBe('bad_signature');
    expect(verifyDeliverySignature({ secret, rawBody: body, signature: 'v1=' + 'f'.repeat(64), timestamp: String(ts) }).reason).toBe('bad_signature');
  });

  it('refuses a replay outside the tolerance window', () => {
    const stale = now() - DEFAULT_TOLERANCE_SEC - 60;
    const verdict = verifyDeliverySignature({ secret, rawBody: body, signature: signDeliveryPayload(secret, stale, body), timestamp: String(stale) });
    expect(verdict).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('fails closed on a missing secret, signature, timestamp or garbage timestamp', () => {
    const ts = now();
    const good = signDeliveryPayload(secret, ts, body);
    expect(verifyDeliverySignature({ secret: null, rawBody: body, signature: good, timestamp: String(ts) }).reason).toBe('no_shared_secret');
    expect(verifyDeliverySignature({ secret, rawBody: body, signature: '', timestamp: String(ts) }).reason).toBe('missing_signature');
    expect(verifyDeliverySignature({ secret, rawBody: body, signature: good, timestamp: '' }).reason).toBe('missing_timestamp');
    expect(verifyDeliverySignature({ secret, rawBody: body, signature: good, timestamp: 'yesterday' }).reason).toBe('bad_timestamp');
  });
});

// ─── Outbound contract ──────────────────────────────────────────────────────
describe('buildDispatchPayload', () => {
  it('sends the fields a courier needs, with money as numbers', () => {
    const payload = buildDispatchPayload(ORDER, 'idem-1');
    expect(payload).toMatchObject({
      external_order_ref: 'ord_123',
      order_number: 'WEB-0042',
      idempotency_key: 'idem-1',
      merchant: { name: 'Harbour Roasters' },
      currency: 'EUR',
      order_total: 34.5,
      delivery_fee: 3.9,
      ready_at: '2026-09-21T12:30:00.000Z',
      items: [
        { name: 'Flat white', quantity: 2 },
        { name: 'Croissant', quantity: 1 },
      ],
      dropoff: { name: 'Ana Ruiz', address1: 'Paseo 12', postal_code: '28001', country: 'ES', notes: 'Ring twice' },
    });
  });

  it('keeps internal PII out of the payload when the order has none', () => {
    const payload = buildDispatchPayload({ ...ORDER, pickupBy: null, dropoff: {} }, 'k');
    expect(payload.ready_at).toBeNull();
    expect((payload.dropoff as any).name).toBeNull();
  });
});

describe('dispatchOrder without a partner endpoint', () => {
  it('runs the flow in an explicitly labelled simulation', async () => {
    const result = await dispatchOrder('generic', { ...ORDER, idempotencyKey: 'idem-1' }, {});
    expect(result.simulated).toBe(true);
    expect(result.status).toBe('REQUESTED');
    expect(result.error).toBeUndefined();
    expect(result.externalId).toMatch(/^SIM-[0-9A-F]{10}$/);
    expect(result.externalId).toBe(simulatedDeliveryId(ORDER)); // deterministic reprint
    expect(result.request).toMatchObject({ order_number: 'WEB-0042' });
  });

  it('treats an own-fleet job as local by design and names the rider source', async () => {
    const result = await dispatchOrder('own_fleet', ORDER, { statusUrlTemplate: 'https://ops.example/track/{id}' });
    expect(result.simulated).toBe(true);
    expect(result.courier).toBe('Own fleet');
    expect(result.trackingUrl).toBe(`https://ops.example/track/${encodeURIComponent(result.externalId)}`);
  });
});

describe('dispatchOrder against a live partner', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(handler: () => { ok: boolean; status: number; body: string }) {
    const calls: { url: string; init: any }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: any) => {
        calls.push({ url, init });
        const r = handler();
        return { ok: r.ok, status: r.status, text: async () => r.body };
      })
    );
    return calls;
  }

  it('POSTs a signed, idempotent request and normalizes the answer', async () => {
    const calls = stubFetch(() => ({
      ok: true,
      status: 200,
      body: JSON.stringify({ id: 'D-77', status: 'driver_assigned', eta_minutes: 22, courier: { name: 'Sam' } }),
    }));
    const result = await dispatchOrder('doordash', ORDER, {
      dispatchUrl: 'https://api.partner.test/jobs',
      apiKey: 'pk_test',
      webhookSecret: 'whsec',
      headers: { 'X-Client-Id': 'abc', Host: 'should-be-dropped' },
    });
    expect(result).toMatchObject({ externalId: 'D-77', status: 'ASSIGNED', etaMinutes: 22, courier: 'Sam', simulated: false });
    expect(result.error).toBeUndefined();

    const [call] = calls;
    expect(call.url).toBe('https://api.partner.test/jobs');
    expect(call.init.method).toBe('POST');
    expect(call.init.headers.Authorization).toBe('Bearer pk_test');
    expect(call.init.headers['Idempotency-Key']).toBeTruthy();
    expect(call.init.headers['X-Client-Id']).toBe('abc');
    expect(call.init.headers.Host).toBeUndefined();
    // The signature must cover the exact bytes that went out.
    const sig = call.init.headers[SIGNATURE_HEADER];
    const ts = call.init.headers[TIMESTAMP_HEADER];
    expect(sig).toBe(signDeliveryPayload('whsec', ts, call.init.body));
    expect(JSON.parse(call.init.body).external_order_ref).toBe('ord_123');
  });

  it('surfaces a partner rejection as an error instead of a dispatched order', async () => {
    stubFetch(() => ({ ok: false, status: 422, body: '{"detail":"out of zone"}' }));
    const result = await dispatchOrder('glovo', ORDER, { dispatchUrl: 'https://api.partner.test/jobs' });
    expect(result.simulated).toBe(false);
    expect(result.status).toBe('FAILED');
    expect(result.externalId).toBe('');
    expect(result.error).toContain('422');
    expect(result.raw).toMatchObject({ detail: 'out of zone' });
  });

  it('turns a network failure into a FAILED result, never a throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const result = await dispatchOrder('wolt', ORDER, { dispatchUrl: 'https://down.test/jobs' });
    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('reads a non-JSON body as text so support can see what happened', async () => {
    stubFetch(() => ({ ok: true, status: 200, body: '<html>gateway</html>' }));
    const result = await dispatchOrder('generic', ORDER, { dispatchUrl: 'https://api.partner.test/jobs' });
    expect(result.externalId).toBe(simulatedDeliveryId(ORDER)); // no id in the answer
    expect(result.status).toBe('REQUESTED');
    expect(typeof result.raw).toBe('string');
  });
});

describe('fetchDeliveryStatus', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports the last known state in simulation', async () => {
    expect(await fetchDeliveryStatus({}, 'D-1', 'PICKED_UP')).toMatchObject({ status: 'PICKED_UP', simulated: true });
    expect(await fetchDeliveryStatus({ statusUrlTemplate: 'https://x/{id}' }, '', 'ACCEPTED')).toMatchObject({ status: 'ACCEPTED', simulated: true });
  });

  it('queries the templated URL and normalizes the reply', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'out for delivery', driver_name: 'Lee', eta_minutes: 12 }) };
      })
    );
    const result = await fetchDeliveryStatus({ statusUrlTemplate: 'https://api.test/jobs/{id}', apiKey: 'k' }, 'D 9', 'REQUESTED');
    expect(urls[0]).toBe('https://api.test/jobs/D%209');
    // "out for delivery" is not in the alias table, so the previous status stands.
    expect(result).toMatchObject({ status: 'REQUESTED', courier: 'Lee', etaMinutes: 12, simulated: false });
  });

  it('keeps the previous status when the lookup fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, text: async () => '' })));
    const result = await fetchDeliveryStatus({ statusUrlTemplate: 'https://api.test/jobs/{id}' }, 'D-1', 'ASSIGNED');
    expect(result.status).toBe('ASSIGNED');
    expect(result.error).toContain('503');
  });
});

// ─── Inbound webhook parsing ────────────────────────────────────────────────
describe('parseStatusWebhook', () => {
  it('reads a flat partner event', () => {
    const event = parseStatusWebhook({ delivery_id: 'D-9', external_order_ref: 'ord_123', status: 'delivered', courier: { name: 'Sam' }, eta_minutes: 4 });
    expect(event).toEqual({ externalId: 'D-9', orderId: 'ord_123', status: 'DELIVERED', courier: 'Sam', trackingUrl: null, etaMinutes: 4 });
  });

  it('reads an order object nested inside the event', () => {
    const event = parseStatusWebhook({ event: { order: { id: 'ord_123', status: 'picked up', tracking_url: 'https://t/D-9' } }, delivery_id: 'D-9' });
    expect(event).toMatchObject({ externalId: 'D-9', orderId: 'ord_123', status: 'PICKED_UP', trackingUrl: 'https://t/D-9' });
  });

  it('accepts a webhook type as the status carrier', () => {
    expect(parseStatusWebhook({ type: 'order.completed', order_id: 'ord_123' })).toMatchObject({ status: 'DELIVERED', orderId: 'ord_123', externalId: null });
  });
  it('returns null on a status it cannot map, so the handler can audit it', () => {
    expect(parseStatusWebhook({ status: 'teleported' })).toBeNull();
    expect(parseStatusWebhook(null)).toBeNull();
    expect(parseStatusWebhook('not an object')).toBeNull();
  });
});
