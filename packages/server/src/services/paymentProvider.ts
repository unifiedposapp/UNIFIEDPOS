// ─── Payment Service Provider (PSP) abstraction ───────────────────────────
// Env-gated gateway integration. When STRIPE_SECRET_KEY is set the app talks to
// the real Stripe REST API; otherwise a deterministic simulator keeps dev/tests
// working with no keys and no network.
//
// SECURITY / PCI: this service NEVER handles raw card numbers. Charges are made
// against a tokenized `payment_method` id (pm_...) collected client-side by
// Stripe Elements / the Payment Element, so card data never touches our servers
// (SAQ-A scope). Webhook authenticity is verified with an HMAC signature check.
//
// Uses Node 20's global fetch — no extra runtime dependency on the Stripe SDK.

import crypto from 'node:crypto';
import { toMinorUnits, fromMinorUnits, normalizeCurrency } from '../data/currencies.js';
import { recordPayment } from './observability.js';

const STRIPE_API = 'https://api.stripe.com/v1';

export type ChargeStatus = 'SUCCEEDED' | 'REQUIRES_ACTION' | 'FAILED' | 'SIMULATED';

export interface ChargeInput {
  amount: number;                 // major units (e.g. 12.50)
  currency: string;               // ISO 4217
  paymentMethodId?: string;       // tokenized pm_... from Stripe Elements
  idempotencyKey?: string;
  description?: string;
  metadata?: Record<string, string>;
  capture?: boolean;              // false = authorize only (default true)
  // ─── Card-present / Terminal (in-person) ────────────────────────────────
  // When cardPresent is true the charge originates from a physical terminal.
  // The reader collects the card and returns a tokenized payment method, so
  // raw PAN/track data still never touches our servers (P2PE / SAQ-A scope).
  cardPresent?: boolean;
  terminalId?: string;            // Stripe Terminal reader id (tmr_...)
  paymentMethodTypes?: string[];  // e.g. ['card_present'] for in-person
}

export interface CaptureInput {
  reference: string;              // authorization payment intent id (pi_...)
  amount?: number;                // partial capture; omit to capture the full authorized amount
  currency?: string;
  idempotencyKey?: string;
}

export interface CaptureResult {
  status: 'SUCCEEDED' | 'FAILED' | 'SIMULATED';
  provider: string;
  reference?: string;
  amount?: number;
  currency?: string;
  message?: string;
}

export interface ChargeResult {
  status: ChargeStatus;
  provider: string;               // 'stripe' | 'simulator'
  reference?: string;             // processor transaction id (pi_...)
  authorizationId?: string;
  clientSecret?: string;          // for client-side 3DS/SCA confirmation
  declineCode?: string;
  message?: string;
  amount: number;                 // echoed, major units
  currency: string;               // normalized, upper-case
}

export interface RefundInput {
  reference: string;              // original processor payment intent id
  amount: number;                 // major units
  currency: string;
  idempotencyKey?: string;
  reason?: string;
}

export interface RefundResult {
  status: 'SUCCEEDED' | 'PENDING' | 'FAILED' | 'SIMULATED';
  provider: string;
  reference?: string;             // processor refund id (re_...)
  message?: string;
}

/** True when real Stripe credentials are configured. */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_'));
}

/** The active provider name — handy for receipts/audit and the /payments/config endpoint. */
export function activeProvider(): string {
  return isStripeConfigured() ? 'stripe' : 'simulator';
}

// ─── Observability hooks (§39) ────────────────────────────────────────────
// Record every gateway outcome so /api/metrics reflects real money movement
// (authorisations, captures, refunds, settled volume) and alert thresholds fire.
function observeCharge(result: ChargeResult, input: ChargeInput, currency: string): void {
  const method = input.cardPresent ? 'CARD_PRESENT' : 'CARD';
  if (result.status === 'FAILED') { recordPayment('failed', { method }); return; }
  // REQUIRES_ACTION = authorized but not yet captured => no settled volume yet.
  if (result.status === 'REQUIRES_ACTION') { recordPayment('succeeded', { method }); return; }
  recordPayment('succeeded', { method, amountCents: toMinorUnits(input.amount, currency) });
}

function observeRefund(result: RefundResult, input: RefundInput, currency: string): void {
  if (result.status === 'FAILED') return;
  recordPayment('refunded', { method: 'REFUND', amountCents: toMinorUnits(input.amount, currency) });
}

function observeCapture(result: CaptureResult, input: CaptureInput): void {
  if (result.status === 'FAILED') { recordPayment('failed', { method: 'CAPTURE' }); return; }
  const currency = normalizeCurrency(result.currency || input.currency || 'USD') || 'USD';
  const amount = result.amount ?? input.amount ?? 0;
  recordPayment('captured', { method: 'CAPTURE', amountCents: toMinorUnits(amount, currency) });
}

// Stripe expects form-encoded bodies.
function encodeForm(params: Record<string, unknown>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    usp.append(k, String(v));
  }
  return usp.toString();
}

async function stripeRequest(path: string, params: Record<string, unknown>, idempotencyKey?: string): Promise<any> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: encodeForm(params),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || `Stripe request failed (${res.status})`) as Error & {
      declineCode?: string;
      type?: string;
    };
    err.declineCode = json?.error?.decline_code;
    err.type = json?.error?.type;
    throw err;
  }
  return json;
}

// ─── Simulator (no STRIPE_SECRET_KEY) ───────────────────────────────────────
// Deterministic so tests are stable: a payment method of "pm_decline" fails,
// "pm_auth" authorizes without capture, anything else succeeds.
function simulateCharge(input: ChargeInput): ChargeResult {
  const currency = normalizeCurrency(input.currency) || 'USD';
  const pm = input.paymentMethodId || '';
  if (pm.includes('decline')) {
    return { status: 'FAILED', provider: 'simulator', declineCode: 'card_declined', message: 'Simulated decline', amount: input.amount, currency };
  }
  const reference = `sim_pi_${crypto.randomBytes(8).toString('hex')}`;
  if (input.capture === false || pm.includes('auth')) {
    return { status: 'REQUIRES_ACTION', provider: 'simulator', reference, authorizationId: reference, message: 'Simulated authorization (capture later)', amount: input.amount, currency };
  }
  return { status: 'SUCCEEDED', provider: 'simulator', reference, message: 'Simulated approval — set STRIPE_SECRET_KEY to process real payments', amount: input.amount, currency };
}

function simulateRefund(input: RefundInput): RefundResult {
  return {
    status: 'SIMULATED',
    provider: 'simulator',
    reference: `sim_re_${crypto.randomBytes(8).toString('hex')}`,
    message: `Simulated refund of ${input.amount} ${input.currency} against ${input.reference}`,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────
/**
 * Create (and by default capture) a charge. With Stripe configured and a
 * tokenized payment_method supplied, this confirms a PaymentIntent server-side.
 * Without a payment_method it returns a clientSecret so the browser can confirm
 * via Stripe Elements (keeping card data off our servers).
 */
export async function createCharge(input: ChargeInput): Promise<ChargeResult> {
  const currency = normalizeCurrency(input.currency) || 'USD';
  if (!isStripeConfigured()) {
    const result = simulateCharge({ ...input, currency });
    observeCharge(result, input, currency);
    return result;
  }

  const amountMinor = toMinorUnits(input.amount, currency);
  try {
    const params: Record<string, unknown> = {
      amount: amountMinor,
      currency: currency.toLowerCase(),
      description: input.description,
      'automatic_payment_methods[enabled]': 'true',
      capture_method: input.capture === false ? 'manual' : 'automatic',
    };
    if (input.paymentMethodId) {
      params.payment_method = input.paymentMethodId;
      params.confirm = 'true';
      params.off_session = 'false';
    }
    // Card-present (in-person terminal) charges use the card_present method type.
    if (input.cardPresent) {
      const types = input.paymentMethodTypes?.length ? input.paymentMethodTypes : ['card_present'];
      types.forEach((t, i) => { params[`payment_method_types[${i}]`] = t; });
      if (input.terminalId) params.metadata = { ...(params.metadata as any), terminal_id: input.terminalId };
    }
    if (input.metadata) {
      for (const [k, v] of Object.entries(input.metadata)) params[`metadata[${k}]`] = v;
    }

    const pi = await stripeRequest('/payment_intents', params, input.idempotencyKey);
    const status: ChargeStatus =
      pi.status === 'succeeded' ? 'SUCCEEDED' :
      pi.status === 'requires_capture' ? 'REQUIRES_ACTION' :
      ['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing'].includes(pi.status) ? 'REQUIRES_ACTION' :
      pi.status === 'canceled' ? 'FAILED' : 'REQUIRES_ACTION';

    const result: ChargeResult = {
      status,
      provider: 'stripe',
      reference: pi.id,
      authorizationId: pi.id,
      clientSecret: pi.client_secret,
      amount: fromMinorUnits(pi.amount ?? amountMinor, currency),
      currency,
      message: pi.last_payment_error?.message,
      declineCode: pi.last_payment_error?.decline_code,
    };
    observeCharge(result, input, currency);
    return result;
  } catch (err: any) {
    const result: ChargeResult = { status: 'FAILED', provider: 'stripe', declineCode: err.declineCode, message: err.message, amount: input.amount, currency };
    observeCharge(result, input, currency);
    return result;
  }
}

/** Refund (fully or partially) a previously captured charge. */
export async function refundCharge(input: RefundInput): Promise<RefundResult> {
  const currency = normalizeCurrency(input.currency) || 'USD';
  if (!isStripeConfigured()) {
    const result = simulateRefund({ ...input, currency });
    observeRefund(result, input, currency);
    return result;
  }

  try {
    const refund = await stripeRequest(
      '/refunds',
      {
        payment_intent: input.reference,
        amount: toMinorUnits(input.amount, currency),
        reason: input.reason ? 'requested_by_customer' : undefined,
      },
      input.idempotencyKey
    );
    const result: RefundResult = {
      status: refund.status === 'succeeded' ? 'SUCCEEDED' : refund.status === 'failed' ? 'FAILED' : 'PENDING',
      provider: 'stripe',
      reference: refund.id,
      message: refund.failure_reason,
    };
    observeRefund(result, input, currency);
    return result;
  } catch (err: any) {
    const result: RefundResult = { status: 'FAILED', provider: 'stripe', message: err.message };
    observeRefund(result, input, currency);
    return result;
  }
}

/**
 * Capture a previously authorized (manual-capture) charge, optionally for a
 * partial amount (e.g. after a tip adjustment or a partial fulfilment).
 */
export async function captureCharge(input: CaptureInput): Promise<CaptureResult> {
  if (!isStripeConfigured()) {
    const result: CaptureResult = {
      status: 'SIMULATED',
      provider: 'simulator',
      reference: input.reference,
      amount: input.amount,
      currency: input.currency ? (normalizeCurrency(input.currency) || undefined) : undefined,
      message: `Simulated capture of ${input.reference}`,
    };
    observeCapture(result, input);
    return result;
  }

  try {
    const params: Record<string, unknown> = {};
    if (input.amount !== undefined && input.currency) {
      params.amount_to_capture = toMinorUnits(input.amount, normalizeCurrency(input.currency) || 'USD');
    }
    const pi = await stripeRequest(`/payment_intents/${encodeURIComponent(input.reference)}/capture`, params, input.idempotencyKey);
    const currency = normalizeCurrency(String(pi.currency || input.currency || 'USD')) || 'USD';
    const result: CaptureResult = {
      status: pi.status === 'succeeded' ? 'SUCCEEDED' : 'FAILED',
      provider: 'stripe',
      reference: pi.id,
      amount: fromMinorUnits(pi.amount ?? 0, currency),
      currency,
      message: pi.last_payment_error?.message,
    };
    observeCapture(result, input);
    return result;
  } catch (err: any) {
    const result: CaptureResult = { status: 'FAILED', provider: 'stripe', reference: input.reference, message: err.message };
    observeCapture(result, input);
    return result;
  }
}

/**
 * Verify a Stripe webhook signature (Stripe-Signature header) against the raw
 * request body using the endpoint secret. Implements Stripe's documented
 * `t=timestamp,v1=signature` scheme with a timing-safe compare and a tolerance
 * window to block replay attacks. Returns the parsed event or null if invalid.
 */
export function verifyStripeWebhook(rawBody: string | Buffer, signatureHeader: string | undefined, toleranceSeconds = 300): any | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return null;

  const parts = signatureHeader.split(',').reduce<Record<string, string>>((acc, p) => {
    const [k, v] = p.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const timestamp = parts.t;
  const expected = parts.v1;
  if (!timestamp || !expected) return null;

  // Reject stale timestamps (replay protection).
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > toleranceSeconds) return null;

  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const computed = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
