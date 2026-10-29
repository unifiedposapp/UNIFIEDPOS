/**
 * Sales-channel connectors (Shopify / WooCommerce / BigCommerce).
 *
 * The previous implementation of `POST /commerce/integrations/:id/sync` counted
 * local rows and flipped a status flag — a sync that never called anyone. This
 * module is the real thing: authenticated REST calls to the merchant's store,
 * with webhook signature verification and an honest failure when credentials are
 * missing (rather than a fake success).
 *
 * Design notes:
 *  • No SDK dependencies — `fetch` + `node:crypto`, matching the rest of the
 *    codebase (S3 SigV4 and VAPID are hand-rolled the same way).
 *  • Every adapter speaks the same four verbs, so the sync route is generic.
 *  • Provider quirks (API versions, auth headers, pagination) live in
 *    PROVIDERS below; order/product mapping lives in explicit mappers.
 */

import crypto from 'node:crypto';

export type ChannelProvider = 'SHOPIFY' | 'WOOCOMMERCE' | 'BIGCOMMERCE';

export interface ChannelCredentials {
  shopDomain: string;
  accessToken: string;
  webhookSecret?: string | null;
  apiVersion?: string | null;
}

interface ProviderSpec {
  label: string;
  baseUrl(cfg: ChannelCredentials): string;
  headers(cfg: ChannelCredentials): Record<string, string>;
  /** Paths are relative to baseUrl. */
  paths: { products: string; orders: string; inventory: string };
}

const PROVIDERS: Record<ChannelProvider, ProviderSpec> = {
  SHOPIFY: {
    label: 'Shopify',
    baseUrl: (c) => {
      const domain = c.shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
      return `https://${domain}/admin/api/${c.apiVersion || '2024-10'}`;
    },
    headers: (c) => ({
      'X-Shopify-Access-Token': c.accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    paths: { products: '/products.json', orders: '/orders.json', inventory: '/inventory_levels/set.json' },
  },
  WOOCOMMERCE: {
    label: 'WooCommerce',
    baseUrl: (c) => {
      const domain = c.shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
      return `https://${domain}/wp-json/wc/v3`;
    },
    headers: (c) => {
      // WooCommerce application passwords are HTTP Basic (key:secret).
      const [key, secret] = String(c.accessToken).split(':');
      const basic = Buffer.from(`${key}:${secret ?? ''}`).toString('base64');
      return { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json', Accept: 'application/json' };
    },
    paths: { products: '/products', orders: '/orders', inventory: '/products/batch' },
  },
  BIGCOMMERCE: {
    label: 'BigCommerce',
    baseUrl: (c) => {
      const domain = c.shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
      return `https://api.bigcommerce.com/stores/${domain}/v3`;
    },
    headers: (c) => ({
      'X-Auth-Token': c.accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    paths: { products: '/catalog/products', orders: '/orders', inventory: '/inventory/adjustments/absolute' },
  },
};

export function isChannelProvider(value: unknown): value is ChannelProvider {
  return typeof value === 'string' && value.toUpperCase() in PROVIDERS;
}

export function providerLabel(provider: string): string {
  return isChannelProvider(provider) ? PROVIDERS[provider.toUpperCase() as ChannelProvider].label : provider;
}

export type ChannelFailure =
  | { ok: false; reason: 'UNSUPPORTED_PROVIDER'; provider: string }
  | { ok: false; reason: 'MISSING_CREDENTIALS' }
  | { ok: false; reason: 'HTTP_ERROR'; status: number; message: string }
  | { ok: false; reason: 'NETWORK'; message: string };

export type ChannelResult<T> = { ok: true; data: T } | ChannelFailure;

export interface RequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * One authenticated call. Network failures and non-2xx responses are returned as
 * typed failures so the sync route can record `lastError` and keep going —
 * an unreachable store must not 500 the whole nightly job.
 */
export async function channelRequest<T = unknown>(
  provider: ChannelProvider,
  cfg: ChannelCredentials,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<ChannelResult<T>> {
  if (!cfg || !cfg.shopDomain || !cfg.accessToken) return { ok: false, reason: 'MISSING_CREDENTIALS' };

  const spec = PROVIDERS[provider];
  const url = `${spec.baseUrl(cfg)}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
  if (options.signal) options.signal.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const res = await fetch(url, {
      method,
      headers: spec.headers(cfg),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      return { ok: false, reason: 'HTTP_ERROR', status: res.status, message: text.slice(0, 500) };
    }
    return { ok: true, data: (text ? JSON.parse(text) : {}) as T };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'NETWORK', message };
  } finally {
    clearTimeout(timeout);
  }
}

/* ─────────────────────────── webhook verification ─────────────────────────── */

export interface WebhookHeaders {
  [key: string]: string | string[] | undefined;
}

function headerValue(headers: WebhookHeaders, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (k.toLowerCase() === target) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

/**
 * Constant-time HMAC comparison of the raw request body.
 *
 * Shopify sends base64 in `X-Shopify-Hmac-Sha256`; WooCommerce sends the same
 * base64 digest in `X-WC-Webhook-Signature`; BigCommerce signs with
 * `X-Bc-Webhook-Signature` over the raw body. All three are HMAC-SHA256.
 */
export function verifyChannelWebhook(
  provider: ChannelProvider,
  rawBody: string | Buffer,
  headers: WebhookHeaders,
  secret: string,
): boolean {
  if (!secret) return false;

  const headerName =
    provider === 'SHOPIFY'
      ? 'x-shopify-hmac-sha256'
      : provider === 'WOOCOMMERCE'
        ? 'x-wc-webhook-signature'
        : 'x-bc-webhook-signature';
  const provided = headerValue(headers, headerName);
  if (!provided) return false;

  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(digest);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* ───────────────────────────── product mapping ───────────────────────────── */

export interface LocalProduct {
  id: string;
  name: string;
  sku: string;
  barcode?: string | null;
  price: number;
  description?: string | null;
  isActive?: boolean;
}

export interface ExternalProduct {
  externalId: string;
  sku?: string | null;
  name: string;
  price: number;
  barcode?: string | null;
  description?: string | null;
  isActive: boolean;
}

/** Provider payload → neutral shape, so the route stores one mapping table. */
export function mapExternalProduct(provider: ChannelProvider, raw: any): ExternalProduct | null {
  if (!raw) return null;
  try {
    if (provider === 'SHOPIFY') {
      return {
        externalId: String(raw.id),
        sku: raw.variants?.[0]?.sku ?? null,
        barcode: raw.variants?.[0]?.barcode ?? null,
        name: String(raw.title ?? ''),
        price: Number(raw.variants?.[0]?.price ?? 0),
        description: raw.body_html ?? null,
        isActive: String(raw.status ?? 'active') === 'active',
      };
    }
    if (provider === 'WOOCOMMERCE') {
      return {
        externalId: String(raw.id),
        sku: raw.sku ?? null,
        barcode: raw.barcode ?? null,
        name: String(raw.name ?? ''),
        price: Number(raw.price ?? 0),
        description: raw.description ?? null,
        isActive: String(raw.status ?? 'publish') === 'publish',
      };
    }
    return {
      externalId: String(raw.id),
      sku: raw.sku ?? null,
      name: String(raw.name ?? ''),
      price: Number(raw.price ?? 0),
      description: raw.description ?? null,
      isActive: raw.is_visible !== false,
    };
  } catch {
    return null;
  }
}

/** Local product → provider payload for create/update. */
export function toExternalProductPayload(provider: ChannelProvider, p: LocalProduct): Record<string, unknown> {
  if (provider === 'SHOPIFY') {
    return {
      product: {
        title: p.name,
        body_html: p.description ?? '',
        status: p.isActive === false ? 'draft' : 'active',
        variants: [{ sku: p.sku, barcode: p.barcode ?? undefined, price: p.price.toFixed(2) }],
      },
    };
  }
  if (provider === 'WOOCOMMERCE') {
    return {
      name: p.name,
      sku: p.sku,
      regular_price: p.price.toFixed(2),
      description: p.description ?? '',
      status: p.isActive === false ? 'draft' : 'publish',
    };
  }
  return {
    name: p.name,
    sku: p.sku,
    price: p.price,
    description: p.description ?? '',
    is_visible: p.isActive !== false,
  };
}

export interface LocalOrderLine {
  productId: string;
  sku?: string | null;
  quantity: number;
  unitPrice: number;
}

export interface ExternalOrder {
  externalId: string;
  orderNumber: string;
  email?: string | null;
  currency: string;
  total: number;
  createdAt: string;
  lines: LocalOrderLine[];
  raw: any;
}

/**
 * Map an inbound channel order to the neutral shape. Product mapping happens in
 * the route (SKU → local product) because that needs the database; price and
 * quantity survive the trip so a re-import is idempotent.
 */
export function mapExternalOrder(provider: ChannelProvider, raw: any): ExternalOrder | null {
  if (!raw) return null;
  try {
    if (provider === 'SHOPIFY') {
      return {
        externalId: String(raw.id),
        orderNumber: String(raw.name ?? raw.id).replace(/^#/, ''),
        email: raw.email ?? raw.customer?.email ?? null,
        currency: String(raw.currency ?? 'USD'),
        total: Number(raw.total_price ?? 0),
        createdAt: String(raw.created_at ?? new Date().toISOString()),
        lines: (raw.line_items ?? []).map((l: any) => ({
          productId: String(l.sku ?? l.product_id ?? ''),
          sku: l.sku ?? null,
          quantity: Number(l.quantity ?? 0),
          unitPrice: Number(l.price ?? 0),
        })),
        raw,
      };
    }
    if (provider === 'WOOCOMMERCE') {
      return {
        externalId: String(raw.id),
        orderNumber: String(raw.number ?? raw.id),
        email: raw.billing?.email ?? null,
        currency: String(raw.currency ?? 'USD'),
        total: Number(raw.total ?? 0),
        createdAt: String(raw.date_created_gmt ?? new Date().toISOString()),
        lines: (raw.line_items ?? []).map((l: any) => ({
          productId: String(l.sku ?? l.product_id ?? ''),
          sku: l.sku ?? null,
          quantity: Number(l.quantity ?? 0),
          unitPrice: Number(l.price ?? 0),
        })),
        raw,
      };
    }
    return {
      externalId: String(raw.id),
      orderNumber: String(raw.id),
      email: raw.billing_address?.email ?? null,
      currency: String(raw.currency_code ?? 'USD'),
      total: Number(raw.total_inc_tax ?? 0),
      createdAt: String(raw.date_created ?? new Date().toISOString()),
      lines: (raw.products ?? []).map((l: any) => ({
        productId: String(l.sku ?? l.product_id ?? ''),
        sku: l.sku ?? null,
        quantity: Number(l.quantity ?? 0),
        unitPrice: Number(l.price_inc_tax ?? 0),
      })),
      raw,
    };
  } catch {
    return null;
  }
}

/* ────────────────────────────── adapter verbs ────────────────────────────── */

export interface ChannelSyncSummary {
  processed: number;
  failed: number;
  message: string;
}

/** Cheap authenticated read that proves the credentials work. */
export async function testConnection(provider: ChannelProvider, cfg: ChannelCredentials): Promise<ChannelResult<{ label: string }>> {
  const spec = PROVIDERS[provider];
  const res = await channelRequest<unknown>(provider, cfg, 'GET', `${spec.paths.products}?limit=1`);
  if (!res.ok) return res;
  return { ok: true, data: { label: spec.label } };
}

/** Pull the store's recent products (first page; pagination is a caller concern). */
export async function fetchChannelProducts(
  provider: ChannelProvider,
  cfg: ChannelCredentials,
  limit = 50,
): Promise<ChannelResult<ExternalProduct[]>> {
  const spec = PROVIDERS[provider];
  const path = provider === 'BIGCOMMERCE' ? `${spec.paths.products}?limit=${limit}` : `${spec.paths.products}?limit=${limit}`;
  const res = await channelRequest<any>(provider, cfg, 'GET', path);
  if (!res.ok) return res;

  const list: any[] = res.data?.products ?? res.data?.data ?? [];
  const mapped = list.map((p) => mapExternalProduct(provider, p)).filter((p): p is ExternalProduct => Boolean(p));
  return { ok: true, data: mapped };
}

/** Pull recent orders. `sinceIso` becomes each provider's own date filter. */
export async function fetchChannelOrders(
  provider: ChannelProvider,
  cfg: ChannelCredentials,
  sinceIso?: string | null,
  limit = 50,
): Promise<ChannelResult<ExternalOrder[]>> {
  const spec = PROVIDERS[provider];
  const since = sinceIso ? encodeURIComponent(sinceIso) : null;

  const path =
    provider === 'SHOPIFY'
      ? `${spec.paths.orders}?status=any&limit=${limit}${since ? `&updated_at_min=${since}` : ''}`
      : provider === 'WOOCOMMERCE'
        ? `${spec.paths.orders}?per_page=${limit}${since ? `&after=${since}` : ''}`
        : `${spec.paths.orders}?limit=${limit}${since ? `&min_date_modified=${since}` : ''}`;

  const res = await channelRequest<any>(provider, cfg, 'GET', path);
  if (!res.ok) return res;

  const list: any[] = Array.isArray(res.data) ? res.data : res.data?.data ?? res.data?.orders ?? [];
  const mapped = list.map((o) => mapExternalOrder(provider, o)).filter((o): o is ExternalOrder => Boolean(o));
  return { ok: true, data: mapped };
}

/** Push one local product to the store (create; update requires a stored mapping). */
export async function pushProduct(
  provider: ChannelProvider,
  cfg: ChannelCredentials,
  product: LocalProduct,
  externalId?: string | null,
): Promise<ChannelResult<{ externalId: string }>> {
  const spec = PROVIDERS[provider];
  const payload = toExternalProductPayload(provider, product);

  const res = externalId
    ? await channelRequest<any>(provider, cfg, 'PUT', `${spec.paths.products}/${externalId}`, payload)
    : await channelRequest<any>(provider, cfg, 'POST', spec.paths.products, payload);

  if (!res.ok) return res;
  const id = String(res.data?.product?.id ?? res.data?.id ?? externalId ?? '');
  if (!id) return { ok: false, reason: 'HTTP_ERROR', status: 200, message: 'Channel returned no product id' };
  return { ok: true, data: { externalId: id } };
}

/**
 * Push an on-hand quantity to the store.
 *
 * Shopify needs a separate inventory-level call keyed by inventory_item_id, which
 * the caller resolves from the product mapping; WooCommerce accepts a batch
 * update; BigCommerce takes an absolute adjustment.
 */
export async function pushInventory(
  provider: ChannelProvider,
  cfg: ChannelCredentials,
  input: { externalId: string; inventoryItemId?: string | null; locationId?: string | null; quantity: number },
): Promise<ChannelResult<true>> {
  const spec = PROVIDERS[provider];

  if (provider === 'SHOPIFY') {
    if (!input.inventoryItemId) {
      return { ok: false, reason: 'HTTP_ERROR', status: 400, message: 'Shopify requires inventory_item_id and location_id' };
    }
    const res = await channelRequest<any>(provider, cfg, 'POST', spec.paths.inventory, {
      inventory_item_id: input.inventoryItemId,
      location_id: input.locationId,
      available: Math.max(0, Math.round(input.quantity)),
    });
    return res.ok ? { ok: true, data: true } : res;
  }

  if (provider === 'WOOCOMMERCE') {
    const res = await channelRequest<any>(provider, cfg, 'POST', spec.paths.inventory, {
      update: [{ id: input.externalId, stock_quantity: Math.max(0, Math.round(input.quantity)) }],
    });
    return res.ok ? { ok: true, data: true } : res;
  }

  const res = await channelRequest<any>(provider, cfg, 'POST', spec.paths.inventory, [
    { product_id: Number(input.externalId), location_id: Number(input.locationId ?? 1), quantity: Math.round(input.quantity) },
  ]);
  return res.ok ? { ok: true, data: true } : res;
}

/** Human message for a failure, used as `ChannelConnection.lastError`. */
export function describeFailure(failure: ChannelFailure): string {
  switch (failure.reason) {
    case 'MISSING_CREDENTIALS':
      return 'No API credentials stored for this channel';
    case 'UNSUPPORTED_PROVIDER':
      return `Unsupported channel provider "${failure.provider}"`;
    case 'HTTP_ERROR':
      return `HTTP ${failure.status}: ${failure.message}`;
    case 'NETWORK':
      return `Network error: ${failure.message}`;
    default:
      return 'Unknown channel error';
  }
}
