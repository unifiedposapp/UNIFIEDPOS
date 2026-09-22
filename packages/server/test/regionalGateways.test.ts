import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'node:crypto';
import {
  REGIONAL_GATEWAYS,
  findRegionalGateway,
  isRegionalConfigured,
  createRegionalCharge,
  verifyRegionalTransaction,
  verifyRegionalWebhook,
  regionalWebhookReference,
  regionalWebhookPaid,
} from '../src/services/regionalGateways';

describe('gateway catalog', () => {
  it('lists Paystack, Flutterwave and M-Pesa with countries + currencies', () => {
    const ids = REGIONAL_GATEWAYS.map((g) => g.id);
    expect(ids).toEqual(expect.arrayContaining(['paystack', 'flutterwave', 'mpesa']));
    for (const g of REGIONAL_GATEWAYS) {
      expect(g.countries.length).toBeGreaterThan(0);
      expect(g.currencies.length).toBeGreaterThan(0);
      expect(g.docUrl).toMatch(/^https:\/\//);
    }
  });

  it('resolves providers case-insensitively and via the m-pesa alias', () => {
    expect(findRegionalGateway('Paystack')?.id).toBe('paystack');
    expect(findRegionalGateway('m-pesa')?.id).toBe('mpesa');
    expect(findRegionalGateway('stripe')).toBeNull();
  });
});

describe('credential gating', () => {
  it('requires a secret key for the redirect gateways', () => {
    expect(isRegionalConfigured('paystack', { secretKey: 'sk_test_x' })).toBe(true);
    expect(isRegionalConfigured('paystack', {})).toBe(false);
    expect(isRegionalConfigured('flutterwave', { secretKey: 'key_x' })).toBe(true);
  });
  it('requires the full Daraja credential set for M-Pesa', () => {
    expect(isRegionalConfigured('mpesa', { consumerKey: 'a', consumerSecret: 'b', shortcode: '174379', passkey: 'p' })).toBe(true);
    expect(isRegionalConfigured('mpesa', { consumerKey: 'a' })).toBe(false);
  });
});

describe('simulation fallback (no credentials, no network)', () => {
  it('returns a labelled simulated charge with a hosted redirect for paystack', async () => {
    const r = await createRegionalCharge('paystack', { amount: 1500, currency: 'NGN', email: 'a@b.com', reference: 'ref_sim_1' }, {});
    expect(r.simulated).toBe(true);
    expect(r.status).toBe('SIMULATED');
    expect(r.redirectUrl).toContain('paystack');
  });

  it('M-Pesa simulation is a prompt flow with no redirect', async () => {
    const r = await createRegionalCharge('mpesa', { amount: 100, currency: 'KES', phoneNumber: '254700000000' }, {});
    expect(r.simulated).toBe(true);
    expect(r.redirectUrl).toBeNull();
    expect(findRegionalGateway(r.provider)?.flow).toBe('prompt');
  });

  it('verification is deterministic: a "fail" reference fails, others settle', async () => {
    const bad = await verifyRegionalTransaction('paystack', 'order-fail-01', {});
    expect(bad.paid).toBe(false);
    expect(bad.simulated).toBe(true);
    const good = await verifyRegionalTransaction('paystack', 'order-01', {});
    expect(good.paid).toBe(true);
  });
});

describe('live adapter against a documented endpoint (stubbed fetch)', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(body: unknown) {
    const calls: { url: string; init: any }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    }));
    return calls;
  }

  it('initializes a Paystack transaction against api.paystack.co in minor units', async () => {
    const calls = stubFetch({ status: true, data: { authorization_url: 'https://check.paystack/1', access_code: 'abc', reference: 'ref_1' } });
    const r = await createRegionalCharge('paystack', { amount: 1500, currency: 'NGN', email: 'a@b.com', reference: 'ref_1' }, { secretKey: 'sk_test_x' });
    expect(r.status).toBe('PENDING');
    expect(r.simulated).toBe(false);
    expect(r.redirectUrl).toBe('https://check.paystack/1');
    expect(calls[0].url).toBe('https://api.paystack.co/transaction/initialize');
    const sent = JSON.parse(calls[0].init.body);
    expect(sent.amount).toBe(150000); // 1500 NGN × 100
    expect(sent.currency).toBe('NGN');
    expect(calls[0].init.headers.Authorization).toBe('Bearer sk_test_x');
  });

  it('verifies a successful Flutterwave transaction as paid', async () => {
    stubFetch({ status: 'success', data: { status: 'successful', amount: 5000, currency: 'NGN' } });
    const r = await verifyRegionalTransaction('flutterwave', 'tx_ref_9', { secretKey: 'key_x' });
    expect(r.paid).toBe(true);
    expect(r.status).toBe('SUCCEEDED');
  });
});

describe('webhook authentication', () => {
  it('accepts a correctly HMAC-SHA512-signed Paystack payload and rejects a tampered one', () => {
    const secret = 'sk_test_abc';
    const event = { event: 'charge.success', data: { reference: 'ref_1', status: 'success', paid: true } };
    const body = JSON.stringify(event);
    const sig = crypto.createHmac('sha512', secret).update(body).digest('hex');
    const ok = verifyRegionalWebhook('paystack', body, { 'x-paystack-signature': sig }, { secretKey: secret });
    expect(ok?.event.data.reference).toBe('ref_1');
    const bad = verifyRegionalWebhook('paystack', body, { 'x-paystack-signature': 'deadbeef' }, { secretKey: secret });
    expect(bad).toBeNull();
    // Missing signature with no configured secret must never pass.
    expect(verifyRegionalWebhook('paystack', body, {}, {})).toBeNull();
  });

  it('requires the shared verif-hash for Flutterwave', () => {
    const body = JSON.stringify({ data: { status: 'successful', tx_ref: 'tx_1' } });
    expect(verifyRegionalWebhook('flutterwave', body, { 'verif-hash': 'hashlock' }, { webhookSecret: 'hashlock' })).not.toBeNull();
    expect(verifyRegionalWebhook('flutterwave', body, { 'verif-hash': 'wrong' }, { webhookSecret: 'hashlock' })).toBeNull();
  });

  it('parses an unsigned M-Pesa callback but flags it for verification', () => {
    const body = JSON.stringify({ Body: { stkCallback: { ResultCode: 0, CallbackMetadata: { Item: [{ Name: 'MpesaReceiptNumber', Value: 'LCX1' }] } } } });
    const v = verifyRegionalWebhook('mpesa', body, {}, {});
    expect(v?.unsigned).toBe(true);
    expect(regionalWebhookReference('mpesa', v!.event)).toBe('LCX1');
    expect(regionalWebhookPaid('mpesa', v!.event)).toBe(true);
  });

  it('maps success flags across all three webhook shapes', () => {
    expect(regionalWebhookPaid('paystack', { data: { status: 'success', paid: true } })).toBe(true);
    expect(regionalWebhookPaid('flutterwave', { data: { status: 'successful' } })).toBe(true);
    expect(regionalWebhookReference('paystack', { data: { reference: 'r' } })).toBe('r');
    expect(regionalWebhookReference('flutterwave', { data: { tx_ref: 't' } })).toBe('t');
  });
});
