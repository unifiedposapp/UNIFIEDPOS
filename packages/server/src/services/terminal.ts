/**
 * Card-present payments over Stripe Terminal (§9 payments).
 *
 * Why this exists: the app could only take tokenised (SAQ-A) charges, so it had
 * no answer for a merchant who wants to tap a physical card — the one thing
 * Square, Clover and Toast all lead with. Terminal moves the card data to the
 * reader, keeps the server out of PCI scope, and gives us manual capture, which
 * is what restaurant pre-authorisation and tip adjustment require.
 *
 * Env-gated exactly like the rest of the codebase: with `STRIPE_SECRET_KEY`
 * unset every call returns a deterministic simulator result so the UI, tests and
 * smoke runs work offline. With a key set, these are real HTTPS calls.
 *
 * Form-encoded bodies (not JSON) are what Stripe's REST API expects.
 */

const STRIPE_API = 'https://api.stripe.com/v1';

export type TerminalReaderType =
  | 'chipper_2x'
  | 'stripe_s700'
  | 'stripe_m2'
  | 'simulated_wpe'
  | 'verifone_p400'
  | 'wise_pos_e'
  | 'square_terminal'
  | 'unknown';

export interface ReaderRegistration {
  registrationCode: string;
  label: string;
  locationId?: string | null;
}

export interface ReaderInfo {
  id: string;
  label: string;
  deviceType: string;
  status: string;
  serialNumber?: string | null;
  ipAddress?: string | null;
  simulated?: boolean;
}

export interface TerminalIntent {
  id: string;
  amount: number;
  currency: string;
  status: string;
  captureMethod: 'automatic' | 'manual';
  clientSecret?: string | null;
  readerId?: string | null;
  simulated?: boolean;
}

export type TerminalFailure = { ok: false; reason: string; message: string; status?: number };
export type TerminalResult<T> = { ok: true; data: T } | TerminalFailure;

export function isTerminalConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

export function terminalProvider(env: NodeJS.ProcessEnv = process.env): 'stripe' | 'simulator' {
  return isTerminalConfigured(env) ? 'stripe' : 'simulator';
}

/** Stripe wants application/x-www-form-urlencoded with bracket paths. */
function toForm(params: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((v, i) => out.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(v))}`));
    } else if (typeof value === 'object') {
      out.push(...toForm(value as Record<string, unknown>, name));
    } else {
      out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return out;
}

async function stripeCall<T>(
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<TerminalResult<T>> {
  if (!isTerminalConfigured(env)) {
    return { ok: false, reason: 'NOT_CONFIGURED', message: 'STRIPE_SECRET_KEY is not set' };
  }

  const body = toForm(params).join('&');
  const url = method === 'GET' && body ? `${STRIPE_API}${path}?${body}` : `${STRIPE_API}${path}`;

  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // Stripe requires an explicit API version in production integrations.
        'Stripe-Version': env.STRIPE_API_VERSION || '2024-10-28',
      },
      body: method === 'POST' ? body : undefined,
    });

    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        reason: json?.error?.code || 'STRIPE_ERROR',
        message: json?.error?.message || `HTTP ${res.status}`,
      };
    }
    return { ok: true, data: json as T };
  } catch (err) {
    return { ok: false, reason: 'NETWORK', message: err instanceof Error ? err.message : String(err) };
  }
}

/** Short-lived token the browser SDK uses to talk to readers. */
export async function createConnectionToken(env: NodeJS.ProcessEnv = process.env): Promise<TerminalResult<{ secret: string; simulated: boolean }>> {
  if (!isTerminalConfigured(env)) {
    return { ok: true, data: { secret: `simulated_${Date.now()}_${Math.random().toString(36).slice(2)}`, simulated: true } };
  }
  const res = await stripeCall<{ secret: string }>('POST', '/terminal/connection_tokens', {}, env);
  return res.ok ? { ok: true, data: { secret: res.data.secret, simulated: false } } : res;
}

/** Register a physical reader with its pairing code (printed on the device). */
export async function registerReader(
  input: ReaderRegistration,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TerminalResult<ReaderInfo>> {
  if (!/^\d{6,}$/.test(String(input.registrationCode ?? ''))) {
    return { ok: false, reason: 'INVALID_REGISTRATION_CODE', message: 'The pairing code printed on the reader is required' };
  }

  if (!isTerminalConfigured(env)) {
    return {
      ok: true,
      data: {
        id: `sim_reader_${Date.now().toString(36)}`,
        label: input.label,
        deviceType: 'simulated_wpe',
        status: 'online',
        simulated: true,
      },
    };
  }

  const res = await stripeCall<any>('POST', '/terminal/readers', {
    registration_code: input.registrationCode,
    label: input.label,
    location: input.locationId ?? undefined,
  }, env);

  if (!res.ok) return res;
  return { ok: true, data: toReaderInfo(res.data) };
}

export function toReaderInfo(raw: any): ReaderInfo {
  return {
    id: String(raw?.id ?? ''),
    label: String(raw?.label ?? ''),
    deviceType: String(raw?.device_type ?? 'unknown'),
    status: String(raw?.status ?? 'unknown'),
    serialNumber: raw?.serial_number ?? null,
    ipAddress: raw?.ip_address ?? null,
  };
}

export async function listReaders(env: NodeJS.ProcessEnv = process.env): Promise<TerminalResult<ReaderInfo[]>> {
  if (!isTerminalConfigured(env)) return { ok: true, data: [] };
  const res = await stripeCall<{ data: any[] }>('GET', '/terminal/readers', { limit: 100 }, env);
  return res.ok ? { ok: true, data: (res.data.data ?? []).map(toReaderInfo) } : res;
}

export async function setReaderLabel(readerId: string, label: string, env: NodeJS.ProcessEnv = process.env): Promise<TerminalResult<ReaderInfo>> {
  if (!isTerminalConfigured(env)) {
    return { ok: true, data: { id: readerId, label, deviceType: 'simulated_wpe', status: 'online', simulated: true } };
  }
  const res = await stripeCall<any>('POST', `/terminal/readers/${encodeURIComponent(readerId)}`, { label }, env);
  return res.ok ? { ok: true, data: toReaderInfo(res.data) } : res;
}

/** Remove the reader from the merchant account. */
export async function deleteReader(readerId: string, env: NodeJS.ProcessEnv = process.env): Promise<TerminalResult<true>> {
  if (!isTerminalConfigured(env)) return { ok: true, data: true };
  const res = await stripeCall<unknown>('POST', `/terminal/readers/${encodeURIComponent(readerId)}/`, { _method: 'delete' }, env);
  return res.ok ? { ok: true, data: true } : res;
}

export interface CreateIntentInput {
  amount: number;
  currency?: string;
  /** `manual` holds the funds for tipping / tab close; `automatic` captures now. */
  captureMethod?: 'automatic' | 'manual';
  readerId?: string | null;
  description?: string;
  metadata?: Record<string, string>;
}

/**
 * Create a card-present PaymentIntent and push it to the reader.
 *
 * Amounts are in minor units (cents), which is what Stripe expects; callers pass
 * currency amounts and this converts. A non-positive amount is refused here
 * rather than at the acquirer.
 */
export async function createCardPresentIntent(
  input: CreateIntentInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TerminalResult<TerminalIntent>> {
  const currency = String(input.currency ?? 'USD').toLowerCase();
  const minorUnits = Math.round(Number(input.amount) * 100);
  if (!Number.isFinite(minorUnits) || minorUnits <= 0) {
    return { ok: false, reason: 'INVALID_AMOUNT', message: 'Amount must be greater than zero' };
  }

  const captureMethod = input.captureMethod ?? 'automatic';

  if (!isTerminalConfigured(env)) {
    return {
      ok: true,
      data: {
        id: `sim_pi_${Date.now().toString(36)}`,
        amount: minorUnits / 100,
        currency: currency.toUpperCase(),
        status: captureMethod === 'manual' ? 'requires_capture' : 'succeeded',
        captureMethod,
        clientSecret: `sim_secret_${Date.now().toString(36)}`,
        readerId: input.readerId ?? null,
        simulated: true,
      },
    };
  }

  const res = await stripeCall<any>('POST', '/terminal/payment_intents', {
    amount: minorUnits,
    currency,
    capture_method: captureMethod,
    payment_method_types: ['card_present'],
    description: input.description,
    metadata: input.metadata,
  }, env);

  if (!res.ok) return res;

  const intent = res.data;
  const readerId = input.readerId;
  if (readerId) {
    // Hand the intent to the reader; the SDK surfaces the amount on the device.
    const process = await stripeCall<any>('POST', `/terminal/readers/${encodeURIComponent(readerId)}/process_payment_intent`, {
      payment_intent: intent.id,
    }, env);
    if (!process.ok) return process;
    return { ok: true, data: toIntent(process.data, captureMethod, readerId) };
  }
  return { ok: true, data: toIntent(intent, captureMethod, null) };
}

export function toIntent(raw: any, captureMethod: 'automatic' | 'manual', readerId?: string | null): TerminalIntent {
  return {
    id: String(raw?.id ?? ''),
    amount: Number(raw?.amount ?? 0) / 100,
    currency: String(raw?.currency ?? 'usd').toUpperCase(),
    status: String(raw?.status ?? 'unknown'),
    captureMethod: (raw?.capture_method ?? captureMethod) as 'automatic' | 'manual',
    clientSecret: raw?.client_secret ?? null,
    readerId: readerId ?? null,
  };
}

/**
 * Capture a manual intent, optionally for a higher amount than authorised.
 *
 * That difference is the tip: Stripe allows capture up to 20% over the
 * authorised amount on card-present, which is precisely how a restaurant adds a
 * gratuity after the guest signs.
 */
export async function captureIntent(
  intentId: string,
  amount?: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TerminalResult<TerminalIntent>> {
  if (!isTerminalConfigured(env)) {
    return {
      ok: true,
      data: {
        id: intentId,
        amount: Number(amount ?? 0),
        currency: 'USD',
        status: 'succeeded',
        captureMethod: 'manual',
        simulated: true,
      },
    };
  }
  const params: Record<string, unknown> = {};
  if (amount !== undefined) params.amount_to_capture = Math.round(Number(amount) * 100);
  const res = await stripeCall<any>('POST', `/payment_intents/${encodeURIComponent(intentId)}/capture`, params, env);
  return res.ok ? { ok: true, data: toIntent(res.data, 'manual', null) } : res;
}

export async function cancelIntent(intentId: string, env: NodeJS.ProcessEnv = process.env): Promise<TerminalResult<TerminalIntent>> {
  if (!isTerminalConfigured(env)) {
    return { ok: true, data: { id: intentId, amount: 0, currency: 'USD', status: 'canceled', captureMethod: 'manual', simulated: true } };
  }
  const res = await stripeCall<any>('POST', `/payment_intents/${encodeURIComponent(intentId)}/cancel`, {}, env);
  return res.ok ? { ok: true, data: toIntent(res.data, 'manual', null) } : res;
}

/** Refund a captured card-present payment, fully or partially. */
export async function refundIntent(
  intentId: string,
  amount?: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TerminalResult<{ id: string; amount: number; status: string }>> {
  if (!isTerminalConfigured(env)) {
    return { ok: true, data: { id: `sim_re_${Date.now().toString(36)}`, amount: Number(amount ?? 0), status: 'succeeded' } };
  }
  const params: Record<string, unknown> = { payment_intent: intentId };
  if (amount !== undefined) params.amount = Math.round(Number(amount) * 100);
  const res = await stripeCall<any>('POST', '/refunds', params, env);
  if (!res.ok) return res;
  return { ok: true, data: { id: String(res.data.id), amount: Number(res.data.amount ?? 0) / 100, status: String(res.data.status) } };
}

/**
 * Guard for a tip adjust: card-present capture may not exceed the authorised
 * amount by more than 20% (Stripe's own limit), and the tip itself can never be
 * negative. Returning a reason beats letting the acquirer reject it mid-service.
 */
export function validateTipAdjust(authorised: number, newTotal: number): { ok: true } | { ok: false; reason: string } {
  const auth = Number(authorised) || 0;
  const total = Number(newTotal) || 0;
  if (total < auth) return { ok: false, reason: 'TIP_ADJUST_BELOW_AUTHORISED' };
  if (total > auth * 1.2 + 0.001) return { ok: false, reason: 'TIP_ADJUST_EXCEEDS_20_PERCENT' };
  return { ok: true };
}
