// ─── Delivery-channel adapters (§ delivery aggregators) ──────────────────────
// A merchant who sells on their own storefront still needs the parcel to move.
// This module is the connector layer: one normalized "dispatch" contract out,
// one normalized status vocabulary in, with per-provider wiring supplied by the
// merchant's own partner credentials.
//
// Deliberate honesty about scope: the request/response shape of each aggregator
// is a commercial contract we cannot verify offline, so a channel is driven by
// endpoints and secrets the merchant configures (the same model as
// DELIVERY_PARTNER_URL in the app catalog). What this layer *does* guarantee is
// that whatever the partner answers, it lands in one vocabulary, one signature
// scheme and one audit trail — and that with no endpoint configured the flow
// still runs end-to-end in an explicitly-labelled simulation.

import crypto from 'node:crypto';

/** The one status vocabulary the rest of the app speaks. */
export const DELIVERY_STATUSES = ['REQUESTED', 'ACCEPTED', 'ASSIGNED', 'PICKED_UP', 'DELIVERED', 'CANCELLED', 'FAILED'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/**
 * Partner vocabulary → our vocabulary. Aggregators use different words for the
 * same event; this table is what makes one webhook handler serve every channel.
 */
const STATUS_ALIASES: Record<string, DeliveryStatus> = {
  requested: 'REQUESTED',
  new: 'REQUESTED',
  pending: 'REQUESTED',
  created: 'REQUESTED',
  searching: 'REQUESTED',
  accepted: 'ACCEPTED',
  confirmed: 'ACCEPTED',
  acknowledged: 'ACCEPTED',
  store_ready: 'ACCEPTED',
  ready: 'ACCEPTED',
  assigned: 'ASSIGNED',
  driver_assigned: 'ASSIGNED',
  courier_assigned: 'ASSIGNED',
  enroute: 'ASSIGNED',
  en_route: 'ASSIGNED',
  picked_up: 'PICKED_UP',
  collected: 'PICKED_UP',
  on_way: 'PICKED_UP',
  delivering: 'PICKED_UP',
  in_transit: 'PICKED_UP',
  delivered: 'DELIVERED',
  completed: 'DELIVERED',
  dropped_off: 'DELIVERED',
  cancelled: 'CANCELLED',
  canceled: 'CANCELLED',
  rejected: 'CANCELLED',
  declined: 'CANCELLED',
  failed: 'FAILED',
  expired: 'FAILED',
  no_show: 'FAILED',
};

/** Map any partner status string onto ours; null when it means nothing to us. */
export function normalizeDeliveryStatus(raw: unknown): DeliveryStatus | null {
  const key = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!key) return null;
  if (STATUS_ALIASES[key]) return STATUS_ALIASES[key];
  // Some partners namespace the event like an `order.delivered` type; the verb
  // after the last dot is what actually describes the state change.
  const tail = key.includes('.') ? key.split('.').pop() ?? '' : '';
  return (tail && STATUS_ALIASES[tail]) || null;
}

/** Progress is monotonic: a late `accepted` must not undo a `picked_up`. */
const STATUS_RANK: Record<string, number> = {
  REQUESTED: 0,
  ACCEPTED: 1,
  ASSIGNED: 2,
  PICKED_UP: 3,
  DELIVERED: 4,
  CANCELLED: 5,
  FAILED: 5,
};

/**
 * A fulfillment row stores the app's own status names, not the channel's, so
 * the two vocabularies are ranked on one scale — otherwise a callback could
 * drag an `OUT_FOR_DELIVERY` parcel back to `PENDING`.
 */
const FULFILLMENT_RANK: Record<string, number> = {
  PENDING: STATUS_RANK.REQUESTED,
  PREPARING: STATUS_RANK.ACCEPTED,
  READY: STATUS_RANK.ACCEPTED,
  OUT_FOR_DELIVERY: STATUS_RANK.PICKED_UP,
  SHIPPED: STATUS_RANK.PICKED_UP,
  DELIVERED: STATUS_RANK.DELIVERED,
  COMPLETED: STATUS_RANK.DELIVERED,
  CANCELLED: STATUS_RANK.CANCELLED,
  FAILED: STATUS_RANK.FAILED,
};

function rankOf(status: string): number | null {
  const key = String(status || '').trim().toUpperCase();
  if (!key) return null;
  if (key in STATUS_RANK) return STATUS_RANK[key];
  return key in FULFILLMENT_RANK ? FULFILLMENT_RANK[key] : null;
}

export function isProgressiveStatus(from: string | null | undefined, to: DeliveryStatus): boolean {
  const current = from ? rankOf(from) : null;
  // Nothing known about the past: accept the update rather than lose it.
  if (current === null) return true;
  return (STATUS_RANK[to] ?? 0) >= current;
}

export interface DeliveryChannel {
  provider: string;
  name: string;
  markets: string;
  /** Continent/region bucket so the catalog can prove global coverage. */
  region: string;
  /** True when the channel is a bring-your-own-endpoint partner connection. */
  hosted: boolean;
  blurb: string;
}

/**
 * Catalog of channels the dispatcher understands. The breadth is deliberate: a
 * merchant in Lagos, Mumbai, Sao Paulo, Jakarta or Nairobi should find their
 * local network already listed, not have to file a feature request. Every entry
 * is still the same bring-your-own-credentials contract - listing a partner here
 * adds no endpoint we pretend to know, it only names the market so the merchant
 * wiring their own partner credentials has a place to file them.
 */
export const DELIVERY_CHANNELS: DeliveryChannel[] = [
  // ─── Universal / bring-your-own ───────────────────────────────────────────
  { provider: 'own_fleet', name: 'Own fleet', markets: 'Anywhere', region: 'Global', hosted: false, blurb: 'Your own riders; status comes back through your POS or the webhook below.' },
  { provider: 'generic', name: 'Universal partner API', markets: 'Anywhere', region: 'Global', hosted: true, blurb: 'Any aggregator exposing an HTTP dispatch endpoint and an HMAC shared secret.' },
  { provider: 'local_courier', name: 'Local courier / 3PL', markets: 'Anywhere', region: 'Global', hosted: true, blurb: 'A single assigned courier or van company you pay by invoice.' },
  { provider: 'ubereats', name: 'Uber Direct', markets: 'Global', region: 'Global', hosted: true, blurb: 'Third-party delivery via Uber Direct, configured per city.' },

  // ─── Americas ──────────────────────────────────────────────────────────────
  { provider: 'doordash', name: 'DoorDash Drive', markets: 'US, CA', region: 'Americas', hosted: true, blurb: 'On-demand courier capacity; connect with the credentials DoorDash issued you.' },
  { provider: 'rappi', name: 'Rappi Logistics', markets: 'LATAM', region: 'Americas', hosted: true, blurb: 'Colombia-rooted multi-category delivery across Latin America.' },
  { provider: 'ifood', name: 'iFood Delivery', markets: 'BR, LATAM', region: 'Americas', hosted: true, blurb: 'Brazil\u0027s dominant food logistics network.' },
  { provider: 'didifood', name: 'DiDi Food', markets: 'LATAM, ME, AU', region: 'Americas', hosted: true, blurb: 'DiDi on-demand delivery in Latin America and beyond.' },

  // ─── Europe ────────────────────────────────────────────────────────────────
  { provider: 'deliveroo', name: 'Deliveroo Editions', markets: 'UK, EU, ME', region: 'Europe', hosted: true, blurb: 'Marketplace logistics; dispatch is pushed to your Editions endpoint.' },
  { provider: 'glovo', name: 'Glovo', markets: 'EU, LATAM, ME, Africa', region: 'Europe', hosted: true, blurb: 'Multi-category couriers with per-order pricing across four continents.' },
  { provider: 'wolt', name: 'Wolt Delivery', markets: 'EU, JP', region: 'Europe', hosted: true, blurb: 'Wolt-compatible courier network (owned by DoorDash).' },

  // ─── Middle East ───────────────────────────────────────────────────────────
  { provider: 'talabat', name: 'Talabat', markets: 'ME', region: 'Middle East', hosted: true, blurb: 'Middle East marketplace logistics (Delivery Hero).' },
  { provider: 'getir', name: 'Getir', markets: 'TR, ME, US', region: 'Middle East', hosted: true, blurb: 'Quick-commerce and instant delivery, Turkey and the Gulf.' },
  { provider: 'yango', name: 'Yango Deli', markets: 'ME, Africa', region: 'Middle East', hosted: true, blurb: 'Yandex-backed on-demand delivery in the Gulf and Africa.' },

  // ─── Africa ────────────────────────────────────────────────────────────────
  { provider: 'boltfood', name: 'Bolt Food', markets: 'Africa, EE', region: 'Africa', hosted: true, blurb: 'Bolt on-demand food delivery across African and Eastern-European cities.' },
  { provider: 'giglogistics', name: 'GIG Logistics', markets: 'NG, GH, Africa', region: 'Africa', hosted: true, blurb: 'West-African last-mile and e-commerce parcel network.' },
  { provider: 'kudi', name: 'Kudi', markets: 'NG', region: 'Africa', hosted: true, blurb: 'Nigerian on-demand delivery and logistics for businesses.' },
  { provider: 'jumia', name: 'Jumia Express', markets: 'Africa (pan)', region: 'Africa', hosted: true, blurb: 'Pan-African marketplace fulfilment and last-mile.' },

  // ─── South Asia ────────────────────────────────────────────────────────────
  { provider: 'swiggy', name: 'Swiggy Delivery', markets: 'IN', region: 'South Asia', hosted: true, blurb: 'India on-demand food and instant delivery.' },
  { provider: 'zomato', name: 'Zomato Delivery', markets: 'IN', region: 'South Asia', hosted: true, blurb: 'India food-delivery network (now part of Blinkit).' },
  { provider: 'dunzo', name: 'Dunzo', markets: 'IN', region: 'South Asia', hosted: true, blurb: 'Hyperlocal pick-up-and-drop courier across Indian cities.' },
  { provider: 'shadowfax', name: 'Shadowfax', markets: 'IN', region: 'South Asia', hosted: true, blurb: 'India\u0027s largest crowdsourced courier and e-commerce last-mile.' },
  { provider: 'delhivery', name: 'Delhivery', markets: 'IN', region: 'South Asia', hosted: true, blurb: 'Integrated parcel, freight and supply-chain network.' },
  { provider: 'porter', name: 'Porter', markets: 'IN', region: 'South Asia', hosted: true, blurb: 'Intra-city goods move on bikes, three-wheelers and trucks.' },

  // ─── East Asia ─────────────────────────────────────────────────────────────
  { provider: 'meituan', name: 'Meituan Delivery', markets: 'CN', region: 'East Asia', hosted: true, blurb: 'China\u0027s largest instant delivery network.' },
  { provider: 'eleme', name: 'Ele.me Fengniao', markets: 'CN', region: 'East Asia', hosted: true, blurb: 'Alibaba local-services on-demand delivery.' },
  { provider: 'dada', name: 'Dada Now', markets: 'CN', region: 'East Asia', hosted: true, blurb: 'Instant retail delivery, on the JD.com network.' },

  // ─── Southeast Asia ────────────────────────────────────────────────────────
  { provider: 'grab', name: 'GrabExpress', markets: 'SEA', region: 'Southeast Asia', hosted: true, blurb: 'Southeast Asia instant courier (Grab).' },
  { provider: 'foodpanda', name: 'foodpanda', markets: 'APAC', region: 'Southeast Asia', hosted: true, blurb: 'Delivery across South-East Asia and Chinese Taipei.' },
  { provider: 'lalamove', name: 'Lalamove', markets: 'SEA, CN', region: 'Southeast Asia', hosted: true, blurb: 'On-demand goods delivery across Asian megacities.' },

  // ─── CIS ───────────────────────────────────────────────────────────────────
  { provider: 'yandex', name: 'Yandex Delivery', markets: 'CIS, TR, EE', region: 'CIS', hosted: true, blurb: 'Yandex on-demand courier across Russia, CIS, Turkey.' },

  // ─── Oceania ───────────────────────────────────────────────────────────────
  { provider: 'easi', name: 'EASI', markets: 'AU', region: 'Oceania', hosted: true, blurb: 'Australian on-demand and scheduled last-mile delivery.' },
  { provider: 'sendle', name: 'Sendle', markets: 'AU, NZ', region: 'Oceania', hosted: true, blurb: 'Carbon-neutral small-business parcel courier for AU/NZ.' },
];

export function findChannel(provider: string): DeliveryChannel | undefined {
  const key = String(provider || '').trim().toLowerCase();
  return DELIVERY_CHANNELS.find((c) => c.provider === key);
}

// ─── Signature scheme ────────────────────────────────────────────────────────

export const SIGNATURE_HEADER = 'x-dispatch-signature';
export const TIMESTAMP_HEADER = 'x-dispatch-timestamp';
/** Replay window: a stale-but-valid signature is still a replay attempt. */
export const DEFAULT_TOLERANCE_SEC = 300;

/** `v1=<hmacsha256(secret, `${timestamp}.${rawBody}`)>` — signed, never encrypted. */
export function signDeliveryPayload(secret: string, timestamp: string | number, rawBody: string): string {
  const digest = crypto.createHmac('sha256', String(secret || '')).update(`${timestamp}.${rawBody}`).digest('hex');
  return `v1=${digest}`;
}

/**
 * Constant-time verification of an inbound webhook. Missing secret means the
 * channel was never given a key, which is a configuration error, not a pass.
 */
export function verifyDeliverySignature(input: {
  secret: string | null | undefined;
  rawBody: string;
  signature: string | undefined | null;
  timestamp: string | undefined | null;
  toleranceSec?: number;
}): { ok: boolean; reason?: string } {
  const { secret, rawBody, signature, timestamp } = input;
  if (!secret) return { ok: false, reason: 'no_shared_secret' };
  if (!signature) return { ok: false, reason: 'missing_signature' };
  if (!timestamp) return { ok: false, reason: 'missing_timestamp' };
  const skew = Math.abs(Date.now() / 1000 - Number(timestamp) / (String(timestamp).length > 11 ? 1000 : 1));
  if (!Number.isFinite(skew)) return { ok: false, reason: 'bad_timestamp' };
  if (skew > (input.toleranceSec ?? DEFAULT_TOLERANCE_SEC)) return { ok: false, reason: 'stale_timestamp' };
  const expected = signDeliveryPayload(secret, timestamp, rawBody);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature).startsWith('v1=') ? String(signature) : `v1=${signature}`);
  if (a.length !== b.length) return { ok: false, reason: 'bad_signature' };
  return crypto.timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'bad_signature' };
}

// ─── Outbound dispatch ───────────────────────────────────────────────────────

export interface DispatchAddress {
  recipientName?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  notes?: string | null;
}

export interface DispatchOrder {
  orderId: string;
  orderNumber: string;
  storeName: string;
  currency: string;
  totalAmount: number;
  deliveryFee: number;
  pickupBy?: Date | string | null;
  dropoff: DispatchAddress;
  items: { name: string; quantity: number }[];
  /** Merchant override so a test kitchen can pin a deterministic id. */
  idempotencyKey?: string;
}

export interface ChannelConfig {
  /** Partner endpoint; omit to run the channel in labelled simulation. */
  dispatchUrl?: string | null;
  statusUrlTemplate?: string | null;
  apiKey?: string | null;
  /** HMAC secret shared with the partner for both directions. */
  webhookSecret?: string | null;
  /** Extra headers the partner demands, e.g. { 'X-Client-Id': 'abc' }. */
  headers?: Record<string, string> | null;
  timeoutMs?: number;
}

export interface DispatchResult {
  externalId: string;
  status: DeliveryStatus;
  trackingUrl: string | null;
  etaMinutes: number | null;
  courier: string | null;
  simulated: boolean;
  /** Echo of what we sent — the merchant support ticket always starts here. */
  request: unknown;
  raw?: unknown;
  error?: string;
}

/** The canonical body every channel receives; documented, not provider-specific folklore. */
export function buildDispatchPayload(order: DispatchOrder, idempotencyKey: string): Record<string, unknown> {
  return {
    external_order_ref: order.orderId,
    order_number: order.orderNumber,
    idempotency_key: idempotencyKey,
    merchant: { name: order.storeName },
    currency: order.currency,
    order_total: Number(order.totalAmount || 0),
    delivery_fee: Number(order.deliveryFee || 0),
    items: order.items.map((i) => ({ name: i.name, quantity: i.quantity })),
    ready_at: order.pickupBy ? new Date(order.pickupBy).toISOString() : null,
    dropoff: {
      name: order.dropoff.recipientName || null,
      phone: order.dropoff.phone || null,
      address1: order.dropoff.addressLine1 || null,
      address2: order.dropoff.addressLine2 || null,
      city: order.dropoff.city || null,
      state: order.dropoff.state || null,
      postal_code: order.dropoff.postalCode || null,
      country: order.dropoff.country || null,
      notes: order.dropoff.notes || null,
    },
  };
}

/** Deterministic, readable id used when no partner is wired up. */
export function simulatedDeliveryId(order: DispatchOrder): string {
  return `SIM-${crypto.createHash('sha1').update(`${order.orderId}|${order.orderNumber}`).digest('hex').slice(0, 10).toUpperCase()}`;
}

function trackingUrlFor(config: ChannelConfig, externalId: string): string | null {
  if (!config.statusUrlTemplate) return null;
  return config.statusUrlTemplate.replace(/\{id\}/g, encodeURIComponent(externalId));
}

/**
 * Push an order to a delivery channel. With a `dispatchUrl` this is a real
 * signed POST; without one the order is accepted locally and flagged
 * `simulated` so nobody mistakes a demo for a dispatched courier.
 */
export async function dispatchOrder(provider: string, order: DispatchOrder, config: ChannelConfig = {}): Promise<DispatchResult> {
  const idempotencyKey = order.idempotencyKey || crypto.randomUUID();
  const payload = buildDispatchPayload(order, idempotencyKey);
  const channel = findChannel(provider);

  if (!config.dispatchUrl || channel?.provider === 'own_fleet') {
    const externalId = simulatedDeliveryId(order);
    return {
      externalId,
      status: 'REQUESTED',
      trackingUrl: trackingUrlFor(config, externalId),
      etaMinutes: null,
      courier: channel?.provider === 'own_fleet' ? 'Own fleet' : null,
      simulated: true,
      request: payload,
    };
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const rawBody = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
    ...normalizeKeys(config.headers),
  };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  if (config.webhookSecret) {
    headers[TIMESTAMP_HEADER] = String(timestamp);
    headers[SIGNATURE_HEADER] = signDeliveryPayload(config.webhookSecret, timestamp, rawBody);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Math.max(config.timeoutMs ?? 8000, 1000), 30000));
  try {
    const response = await fetch(config.dispatchUrl, { method: 'POST', headers, body: rawBody, signal: controller.signal });
    const text = await response.text();
    const parsed = safeJson(text);
    if (!response.ok) {
      return {
        externalId: '',
        status: 'FAILED',
        trackingUrl: null,
        etaMinutes: null,
        courier: null,
        simulated: false,
        request: payload,
        raw: parsed ?? text.slice(0, 500),
        error: `${provider} rejected the order (${response.status})`,
      };
    }
    const externalId = String(parsed?.id || parsed?.delivery_id || parsed?.external_id || parsed?.reference || '').trim() || simulatedDeliveryId(order);
    const eta = Number(parsed?.eta_minutes ?? NaN);
    return {
      externalId,
      status: normalizeDeliveryStatus(parsed?.status) ?? 'REQUESTED',
      trackingUrl: String(parsed?.tracking_url || parsed?.trackingUrl || '') || trackingUrlFor(config, externalId),
      etaMinutes: Number.isFinite(eta) ? eta : null,
      courier: String(parsed?.courier?.name || parsed?.driver_name || parsed?.courier || '') || null,
      simulated: false,
      request: payload,
      raw: parsed ?? text.slice(0, 500),
    };
  } catch (error) {
    return {
      externalId: '',
      status: 'FAILED',
      trackingUrl: null,
      etaMinutes: null,
      courier: null,
      simulated: false,
      request: payload,
      error: (error as Error)?.name === 'AbortError' ? `${provider} dispatch timed out` : `${provider} dispatch failed: ${(error as Error)?.message || 'network error'}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Ask the channel for a status; simulation reports what we last knew. */
export async function fetchDeliveryStatus(
  config: ChannelConfig,
  externalId: string,
  fallback: DeliveryStatus = 'REQUESTED',
): Promise<{ status: DeliveryStatus; etaMinutes: number | null; courier: string | null; simulated: boolean; error?: string }> {
  if (!config.statusUrlTemplate || !externalId) {
    return { status: fallback, etaMinutes: null, courier: null, simulated: true };
  }
  const url = config.statusUrlTemplate.replace(/\{id\}/g, encodeURIComponent(externalId));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Math.max(config.timeoutMs ?? 8000, 1000), 30000));
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}), ...normalizeKeys(config.headers) },
      signal: controller.signal,
    });
    if (!response.ok) return { status: fallback, etaMinutes: null, courier: null, simulated: false, error: `Status lookup failed (${response.status})` };
    const parsed = safeJson(await response.text());
    const eta = Number(parsed?.eta_minutes ?? NaN);
    return {
      status: normalizeDeliveryStatus(parsed?.status) ?? fallback,
      etaMinutes: Number.isFinite(eta) ? eta : null,
      courier: String(parsed?.courier?.name || parsed?.driver_name || parsed?.courier || '') || null,
      simulated: false,
    };
  } catch (error) {
    return { status: fallback, etaMinutes: null, courier: null, simulated: false, error: `Status lookup failed: ${(error as Error)?.message || 'network error'}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Translate an inbound partner webhook into the update our fulfillment row
 * needs. Tolerant of the two shapes partners actually use: a flat status event,
 * or an order object that carries the status inside it.
 */
export function parseStatusWebhook(body: unknown): { externalId: string | null; orderId: string | null; status: DeliveryStatus; courier: string | null; trackingUrl: string | null; etaMinutes: number | null } | null {
  const payload = (body && typeof body === 'object' ? body : {}) as Record<string, any>;
  const event = payload.event && typeof payload.event === 'object' ? payload.event : payload;
  const order = event.order && typeof event.order === 'object' ? event.order : {};
  const rawStatus = event.status ?? event.state ?? event.delivery_status ?? order.status ?? payload.type;
  const status = normalizeDeliveryStatus(rawStatus);
  if (!status) return null;
  const externalId = String(event.delivery_id || event.id || event.external_id || order.delivery_id || payload.delivery_id || '').trim() || null;
  const orderId = String(event.external_order_ref || order.external_order_ref || event.order_id || order.id || payload.order_id || '').trim() || null;
  return {
    externalId,
    orderId,
    status,
    courier: String(event.courier?.name || event.driver_name || order.courier || payload.courier || '').trim() || null,
    trackingUrl: String(event.tracking_url || order.tracking_url || payload.tracking_url || '').trim() || null,
    etaMinutes: Number.isFinite(Number(event.eta_minutes ?? order.eta_minutes)) ? Number(event.eta_minutes ?? order.eta_minutes) : null,
  };
}

function normalizeKeys(headers?: Record<string, string> | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (/^(host|content-length|connection|expect)$/i.test(key)) continue; // hop-by-hop / self-derived
    out[key] = String(value);
  }
  return out;
}

function safeJson(text: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
