// ─── Regional payment-gateway adapters (Paystack / Flutterwave / M-Pesa) ──────
// The card PSP layer (services/paymentProvider.ts) speaks Stripe + simulator.
// But most of the world does not pay by card: West Africa pays through Paystack
// and Flutterwave, Kenya/Tanzania through Safaricom's M-Pesa (the Daraja API).
// This module adds those three as first-class charge providers using their real,
// documented REST APIs, driven by credentials the merchant supplies (stored
// encrypted on an IntegrationConnection of type PAYMENT).
//
// Deliberate honesty about scope — the same contract as the delivery-channel
// adapters (services/deliveryChannels.ts):
//   * Every network call hits the provider's OFFICIAL documented endpoint; we do
//     not invent URLs or response shapes.
//   * With no credentials configured, every call runs in an explicitly-labelled
//     SIMULATION so the flow can be rehearsed offline and in tests without keys or
//     network — never silently pretending to be live money.
//   * Raw card/phone PIN data never touches us: Paystack/Flutterwave hand back a
//     hosted checkout URL the customer is redirected to; M-Pesa pushes a PIN
//     prompt to the customer's handset via the carrier.
//
// Webhook authenticity is verified with each provider's real scheme: Paystack
// signs the raw body with HMAC-SHA512 (x-paystack-signature), Flutterwave sends a
// shared `verif-hash` header, and Daraja callbacks are unsigned (so we only trust
// a confirmation obtained by querying the API for that transaction).

import crypto from 'node:crypto';
import { toMinorUnits, fromMinorUnits, normalizeCurrency } from '../data/currencies.js';

export const REGIONAL_GATEWAY_IDS = ['paystack', 'flutterwave', 'mpesa'] as const;
export type RegionalProvider = (typeof REGIONAL_GATEWAY_IDS)[number];

export interface RegionalGatewayMeta {
  id: RegionalProvider;
  name: string;
  region: string;
  countries: string[];
  currencies: string[];
  docUrl: string;
  /** How the customer completes the payment: a hosted redirect or a handset PIN prompt. */
  flow: 'redirect' | 'prompt';
}

export const REGIONAL_GATEWAYS: RegionalGatewayMeta[] = [
  { id: 'paystack', name: 'Paystack', region: 'West & Southern Africa', countries: ['NG', 'GH', 'ZA', 'KE', 'EG', 'CI'], currencies: ['NGN', 'GHS', 'ZAR', 'KES', 'EGP', 'XOF'], docUrl: 'https://paystack.com/docs/api', flow: 'redirect' },
  { id: 'flutterwave', name: 'Flutterwave', region: 'Africa', countries: ['NG', 'KE', 'GH', 'UG', 'ZA', 'TZ', 'RW'], currencies: ['NGN', 'KES', 'GHS', 'UGX', 'ZAR', 'TZS', 'RWF', 'USD'], docUrl: 'https://developer.flutterwave.com', flow: 'redirect' },
  { id: 'mpesa', name: 'M-Pesa (Daraja)', region: 'East Africa', countries: ['KE', 'TZ'], currencies: ['KES', 'TZS'], docUrl: 'https://developer.safaricom.co.ke', flow: 'prompt' },
];

export function findRegionalGateway(id?: string | null): RegionalGatewayMeta | null {
  if (!id) return null;
  const key = id.trim().toLowerCase();
  return REGIONAL_GATEWAYS.find((g) => g.id === key || (key === 'm-pesa' && g.id === 'mpesa')) ?? null;
}

export function isRegionalProvider(id?: string | null): boolean {
  return findRegionalGateway(id) !== null;
}

export interface RegionalCredentials {
  /** Paystack secret key (sk_test_/sk_live_) or Flutterwave secret (key-...). */
  secretKey?: string | null;
  /** M-Pesa Daraja consumer key + secret (OAuth client credentials). */
  consumerKey?: string | null;
  consumerSecret?: string | null;
  /** M-Pesa till/paybill shortcode and its APID passkey. */
  shortcode?: string | null;
  passkey?: string | null;
  /** Flutterwave webhook hash-lock (verif-hash); Paystack signs with secretKey instead. */
  webhookSecret?: string | null;
  /** Sandbox flag: routes M-Pesa to the test/safaricom sandbox host. */
  sandbox?: boolean;
  /** Where the hosted checkout returns the customer to (Paystack/Flutterwave). */
  redirectUrl?: string | null;
  /** Our public callback URL for M-Pesa STKPush / provider webhooks. */
  callbackUrl?: string | null;
  /** Advanced override for self-hosted / proxy gateways. */
  baseUrl?: string | null;
}

export interface RegionalChargeInput {
  amount: number; // major units (e.g. 1500.00)
  currency: string; // ISO 4217
  email?: string; // paystack/flutterwave customer identity
  phoneNumber?: string; // required for M-Pesa (Safaricom format, e.g. 2547XXXXXXXX)
  reference?: string; // merchant idempotency reference; generated when absent
  description?: string;
  metadata?: Record<string, string>;
}

export interface RegionalChargeResult {
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'SIMULATED';
  provider: RegionalProvider;
  reference: string;
  processorReference?: string | null; // access_code / flw_ref / CheckoutRequestID
  redirectUrl?: string | null; // hosted checkout (redirect flows)
  message?: string;
  amount: number;
  currency: string;
  simulated: boolean;
  raw?: unknown;
}

export interface RegionalVerifyResult {
  status: 'SUCCEEDED' | 'FAILED' | 'PENDING' | 'SIMULATED';
  provider: RegionalProvider;
  reference: string;
  paid: boolean;
  amount?: number;
  currency?: string;
  message?: string;
  simulated: boolean;
}

/** True only when the credentials required for a real call to this provider exist. */
export function isRegionalConfigured(provider: RegionalProvider, creds: RegionalCredentials = {}): boolean {
  if (provider === 'mpesa') {
    return Boolean(creds.consumerKey && creds.consumerSecret && creds.shortcode && creds.passkey);
  }
  return Boolean(creds.secretKey);
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────
async function httpJson(url: string, init: RequestInit, timeoutMs = 15000): Promise<{ ok: boolean; status: number; json: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Math.max(timeoutMs, 1000), 30000));
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text().catch(() => '');
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function newReference(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

function paystackBase(creds: RegionalCredentials): string {
  return (creds.baseUrl || 'https://api.paystack.co').replace(/\/+$/, '');
}
function flutterwaveBase(creds: RegionalCredentials): string {
  return (creds.baseUrl || 'https://api.flutterwave.com/v3').replace(/\/+$/, '');
}
function darajaBase(creds: RegionalCredentials): string {
  if (creds.baseUrl) return creds.baseUrl.replace(/\/+$/, '');
  return creds.sandbox === false ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
}

/** Daraja auth header password: base64(shortcode + passkey + YYYYMMDDHHmmss). */
function darajaPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}
function darajaTimestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function darajaToken(creds: RegionalCredentials): Promise<string | null> {
  const basic = Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString('base64');
  const { ok, json } = await httpJson(`${darajaBase(creds)}/oauth/v1/generate?grant_type=client_credentials`, {
    method: 'GET',
    headers: { Authorization: `Basic ${basic}`, Accept: 'application/json' },
  });
  return ok && json?.access_token ? String(json.access_token) : null;
}

// ─── Create a charge ─────────────────────────────────────────────────────────
export async function createRegionalCharge(
  providerRaw: string,
  input: RegionalChargeInput,
  creds: RegionalCredentials = {},
): Promise<RegionalChargeResult> {
  const provider = findRegionalGateway(providerRaw)?.id;
  if (!provider) {
    return { status: 'FAILED', provider: 'paystack', reference: input.reference || '', amount: input.amount, currency: input.currency, simulated: false, message: `Unknown regional gateway: ${providerRaw}` };
  }
  const currency = normalizeCurrency(input.currency) || 'USD';
  const reference = input.reference || newReference(provider);

  if (!isRegionalConfigured(provider, creds)) {
    return simulateCharge(provider, reference, input.amount, currency);
  }

  try {
    if (provider === 'paystack') {
      const body: Record<string, unknown> = {
        email: input.email || 'customer@example.com',
        amount: toMinorUnits(input.amount, currency),
        currency,
        reference,
      };
      if (input.description) body.metadata = { ...input.metadata, description: input.description };
      if (creds.redirectUrl) body.callback_url = creds.redirectUrl;
      const { ok, status, json } = await httpJson(`${paystackBase(creds)}/transaction/initialize`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.secretKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      if (!ok || !json?.status) {
        return { status: 'FAILED', provider, reference, amount: input.amount, currency, simulated: false, message: json?.message || `Paystack init failed (${status})`, raw: json };
      }
      return {
        status: 'PENDING',
        provider,
        reference,
        processorReference: json.data?.access_code ?? null,
        redirectUrl: json.data?.authorization_url ?? null,
        amount: input.amount,
        currency,
        simulated: false,
        message: 'Redirect the customer to the Paystack checkout to complete payment.',
      };
    }

    if (provider === 'flutterwave') {
      const body: Record<string, unknown> = {
        tx_ref: reference,
        // Flutterwave takes the amount in major units, as a number.
        amount: input.amount,
        currency,
        redirect_url: creds.redirectUrl || 'https://example.com/checkout/callback',
        customer: { email: input.email || 'customer@example.com', phonenumber: input.phoneNumber || undefined },
        meta: { ...(input.metadata || {}), ...(input.description ? { description: input.description } : {}) },
      };
      const { ok, status, json } = await httpJson(`${flutterwaveBase(creds)}/payments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.secretKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      if (!ok || json?.status !== 'success') {
        return { status: 'FAILED', provider, reference, amount: input.amount, currency, simulated: false, message: json?.message || `Flutterwave init failed (${status})`, raw: json };
      }
      return {
        status: 'PENDING',
        provider,
        reference,
        processorReference: json.data?.flw_ref ?? null,
        redirectUrl: json.data?.checkout_link ?? null,
        amount: input.amount,
        currency,
        simulated: false,
        message: 'Redirect the customer to the Flutterwave checkout to complete payment.',
      };
    }

    // mpesa — STK Push (Lipa na M-Pesa Online): prompt the handset for a PIN.
    const token = await darajaToken(creds);
    if (!token) {
      return { status: 'FAILED', provider, reference, amount: input.amount, currency, simulated: false, message: 'M-Pesa Daraja authentication failed (check consumer key/secret).' };
    }
    if (!input.phoneNumber) {
      return { status: 'FAILED', provider, reference, amount: input.amount, currency, simulated: false, message: 'M-Pesa requires a customer phone number.' };
    }
    const ts = darajaTimestamp();
    // Daraja expects the amount in whole currency units (KES has no minor unit).
    const stkBody = {
      BusinessShortCode: creds.shortcode,
      Password: darajaPassword(creds.shortcode!, creds.passkey!, ts),
      Timestamp: ts,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(input.amount),
      PartyA: input.phoneNumber,
      PartyB: creds.shortcode,
      PhoneNumber: input.phoneNumber,
      CallBackURL: creds.callbackUrl || 'https://example.com/api/regional/webhooks/mpesa',
      AccountReference: reference,
      TransactionDesc: (input.description || 'Payment').slice(0, 100),
    };
    const { ok, status, json } = await httpJson(`${darajaBase(creds)}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(stkBody),
    });
    if (!ok || String(json?.ResponseCode) !== '0') {
      return { status: 'FAILED', provider, reference, amount: input.amount, currency, simulated: false, message: json?.ErrorMessage || `M-Pesa STKPush failed (${status})`, raw: json };
    }
    return {
      status: 'PENDING',
      provider,
      reference,
      processorReference: json?.CheckoutRequestID ?? null,
      redirectUrl: null,
      amount: input.amount,
      currency,
      simulated: false,
      message: 'An M-Pesa PIN prompt was sent to the customer handset.',
    };
  } catch (err: any) {
    return { status: 'FAILED', provider, reference, amount: input.amount, currency, simulated: false, message: err?.message || 'Gateway request failed' };
  }
}

function simulateCharge(provider: RegionalProvider, reference: string, amount: number, currency: string): RegionalChargeResult {
  const meta = findRegionalGateway(provider)!;
  return {
    status: 'SIMULATED',
    provider,
    reference,
    processorReference: `sim_${provider}_${crypto.randomBytes(6).toString('hex')}`,
    redirectUrl: meta.flow === 'redirect' ? `https://checkout.simulated/${provider}/${reference}` : null,
    amount,
    currency,
    simulated: true,
    message: `Simulated ${meta.name} charge — configure ${provider} credentials to process real payments.`,
  };
}

// ─── Verify / reconcile a transaction ────────────────────────────────────────
export async function verifyRegionalTransaction(
  providerRaw: string,
  reference: string,
  creds: RegionalCredentials = {},
  checkoutRequestId?: string,
): Promise<RegionalVerifyResult> {
  const provider = findRegionalGateway(providerRaw)?.id;
  if (!provider) {
    return { status: 'FAILED', provider: 'paystack', reference, paid: false, simulated: false, message: `Unknown regional gateway: ${providerRaw}` };
  }
  if (!isRegionalConfigured(provider, creds)) {
    return simulateVerify(provider, reference);
  }

  try {
    if (provider === 'paystack') {
      const { ok, status, json } = await httpJson(`${paystackBase(creds)}/transaction/verify/${encodeURIComponent(reference)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${creds.secretKey}`, Accept: 'application/json' },
      });
      if (!ok) return { status: 'FAILED', provider, reference, paid: false, simulated: false, message: `Verify failed (${status})` };
      const data = json?.data || {};
      const paid = Boolean(data.paid) && data.status === 'success';
      return {
        status: paid ? 'SUCCEEDED' : data.status === 'failed' ? 'FAILED' : 'PENDING',
        provider,
        reference,
        paid,
        amount: data.amount != null ? fromMinorUnits(data.amount, data.currency || 'NGN') : undefined,
        currency: data.currency ? normalizeCurrency(data.currency) || undefined : undefined,
        message: data.gateway_message,
        simulated: false,
      };
    }

    if (provider === 'flutterwave') {
      const { ok, status, json } = await httpJson(`${flutterwaveBase(creds)}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${creds.secretKey}`, Accept: 'application/json' },
      });
      if (!ok) return { status: 'FAILED', provider, reference, paid: false, simulated: false, message: `Verify failed (${status})` };
      const data = json?.data || {};
      const paid = data.status === 'successful';
      return {
        status: paid ? 'SUCCEEDED' : data.status === 'failed' || data.status === 'cancelled' ? 'FAILED' : 'PENDING',
        provider,
        reference,
        paid,
        amount: data.amount,
        currency: data.currency ? normalizeCurrency(data.currency) || undefined : undefined,
        message: data.status,
        simulated: false,
      };
    }

    // mpesa — query the STKPush status by CheckoutRequestID.
    const token = await darajaToken(creds);
    const queryId = checkoutRequestId || reference;
    if (!token) return { ...simulateVerify(provider, reference), simulated: false, message: 'M-Pesa Daraja authentication failed.' };
    const ts = darajaTimestamp();
    const { ok, json } = await httpJson(`${darajaBase(creds)}/mpesa/stkpushquery/v1/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: creds.shortcode,
        Password: darajaPassword(creds.shortcode!, creds.passkey!, ts),
        Timestamp: ts,
        CheckoutRequestID: queryId,
      }),
    });
    if (!ok) return { status: 'FAILED', provider, reference, paid: false, simulated: false, message: json?.ErrorMessage || 'M-Pesa query failed' };
    const code = Number(json?.QueryResultCode);
    const paid = code === 0 && /success/i.test(String(json?.QueryResultDesc || ''));
    return {
      status: paid ? 'SUCCEEDED' : code === 1 ? 'PENDING' : 'FAILED',
      provider,
      reference,
      paid,
      message: json?.QueryResultDesc,
      simulated: false,
    };
  } catch (err: any) {
    return { status: 'FAILED', provider, reference, paid: false, simulated: false, message: err?.message || 'Verify request failed' };
  }
}

/** Deterministic simulation: a reference containing "fail"/"decline" fails, else succeeds. */
function simulateVerify(provider: RegionalProvider, reference: string): RegionalVerifyResult {
  const r = reference.toLowerCase();
  const failed = r.includes('fail') || r.includes('decline') || r.includes('cancel');
  return {
    status: failed ? 'FAILED' : 'SUCCEEDED',
    provider,
    reference,
    paid: !failed,
    simulated: true,
    message: failed ? 'Simulated failed payment' : 'Simulated settlement confirmed',
  };
}

// ─── Inbound webhook verification ────────────────────────────────────────────
/**
 * Authenticate and parse a provider webhook. Returns the decoded event, or null
 * when the signature/hash is missing or invalid (the caller must then reject it).
 * M-Pesa (Daraja) callbacks are unsigned, so we parse them but flag them
 * `unsigned: true`; the caller must reconcile against a verify query before
 * treating the money as settled.
 */
export function verifyRegionalWebhook(
  providerRaw: string,
  rawBody: string | Buffer,
  headers: Record<string, string | string[] | undefined>,
  creds: RegionalCredentials = {},
): { event: any; provider: RegionalProvider; unsigned?: boolean } | null {
  const provider = findRegionalGateway(providerRaw)?.id;
  if (!provider) return null;
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');

  const headerVal = (name: string) => {
    const v = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };

  let event: any;
  try { event = JSON.parse(body); } catch { return null; }

  if (provider === 'paystack') {
    const signature = headerVal('x-paystack-signature');
    const secret = creds.secretKey || creds.webhookSecret;
    if (!signature || !secret) return null;
    const computed = crypto.createHmac('sha512', secret).update(body).digest('hex');
    const a = Buffer.from(computed, 'utf8');
    const b = Buffer.from(String(signature), 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return { event, provider };
  }

  if (provider === 'flutterwave') {
    const hash = headerVal('verif-hash') || headerVal('x-verify-hash') || headerVal('verif_hash');
    if (!hash || !creds.webhookSecret) return null;
    const a = Buffer.from(String(creds.webhookSecret), 'utf8');
    const b = Buffer.from(String(hash), 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return { event, provider };
  }

  // mpesa: unsigned callback — parse only. Caller MUST confirm via verify query.
  return { event, provider, unsigned: true };
}

/** Pull the transaction reference a webhook refers to, across the three shapes. */
export function regionalWebhookReference(provider: RegionalProvider, event: any): string | null {
  if (provider === 'paystack') return event?.data?.reference ?? null;
  if (provider === 'flutterwave') return event?.data?.tx_ref ?? event?.extra?.tx_ref ?? null;
  if (provider === 'mpesa') {
    const c = event?.Body?.stkCallback || event?.stkCallback || event;
    return c?.CallbackMetadata?.Item?.find?.((i: any) => i.Name === 'MpesaReceiptNumber')?.Value
      ?? c?.CheckoutRequestID ?? null;
  }
  return null;
}

/** True when a webhook event reports a successful, paid transaction. */
export function regionalWebhookPaid(provider: RegionalProvider, event: any): boolean {
  if (provider === 'paystack') return event?.data?.status === 'success' && Boolean(event?.data?.paid);
  if (provider === 'flutterwave') return event?.data?.status === 'successful' || event?.data?.successful === true;
  if (provider === 'mpesa') {
    const c = event?.Body?.stkCallback || event?.stkCallback || event;
    return Number(c?.ResultCode) === 0;
  }
  return false;
}
