import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import {
  createCharge,
  refundCharge,
  verifyStripeWebhook,
  isStripeConfigured,
  activeProvider,
} from '../src/services/paymentProvider';

describe('payment provider — simulator (no STRIPE_SECRET_KEY)', () => {
  beforeAll(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  it('reports the simulator as the active provider', () => {
    expect(isStripeConfigured()).toBe(false);
    expect(activeProvider()).toBe('simulator');
  });

  it('approves a normal charge and normalises the currency', async () => {
    const r = await createCharge({ amount: 10, currency: 'usd' });
    expect(r.status).toBe('SUCCEEDED');
    expect(r.currency).toBe('USD');
    expect(r.reference).toMatch(/^sim_pi_/);
  });

  it('declines a charge flagged for decline', async () => {
    const r = await createCharge({ amount: 10, currency: 'USD', paymentMethodId: 'pm_decline' });
    expect(r.status).toBe('FAILED');
    expect(r.declineCode).toBe('card_declined');
  });

  it('refunds via the simulator', async () => {
    const r = await refundCharge({ reference: 'sim_pi_abc', amount: 5, currency: 'USD' });
    expect(r.status).toBe('SIMULATED');
    expect(r.provider).toBe('simulator');
  });
});

describe('Stripe webhook signature verification', () => {
  const secret = 'whsec_test_secret';

  beforeAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = secret;
  });
  afterAll(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  function sign(body: string, t = Math.floor(Date.now() / 1000), key = secret): string {
    const v1 = crypto.createHmac('sha256', key).update(`${t}.${body}`).digest('hex');
    return `t=${t},v1=${v1}`;
  }

  it('accepts a correctly signed payload', () => {
    const body = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } });
    const event = verifyStripeWebhook(body, sign(body));
    expect(event).toBeTruthy();
    expect(event.type).toBe('payment_intent.succeeded');
  });

  it('rejects a tampered body', () => {
    const body = JSON.stringify({ type: 'payment_intent.succeeded' });
    expect(verifyStripeWebhook(`${body}x`, sign(body))).toBeNull();
  });

  it('rejects a signature made with the wrong secret', () => {
    const body = JSON.stringify({ type: 'charge.dispute.created' });
    expect(verifyStripeWebhook(body, sign(body, undefined, 'whsec_wrong'))).toBeNull();
  });

  it('rejects a stale timestamp (replay protection)', () => {
    const body = JSON.stringify({ type: 'payment_intent.succeeded' });
    const stale = Math.floor(Date.now() / 1000) - 10_000; // beyond the 300s tolerance
    expect(verifyStripeWebhook(body, sign(body, stale))).toBeNull();
  });

  it('rejects a missing signature header', () => {
    expect(verifyStripeWebhook('{}', undefined)).toBeNull();
  });
});
