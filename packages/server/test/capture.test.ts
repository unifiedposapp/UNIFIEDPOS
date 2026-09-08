import { describe, it, expect, beforeAll } from 'vitest';
import {
  createCharge,
  captureCharge,
  isStripeConfigured,
} from '../src/services/paymentProvider';

// These exercise the deterministic simulator (no STRIPE_SECRET_KEY) so they run
// offline and never touch the network or a database.
describe('payment provider — capture & card-present (simulator)', () => {
  beforeAll(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  it('is in simulator mode', () => {
    expect(isStripeConfigured()).toBe(false);
  });

  it('captures a previously authorized charge and echoes the reference', async () => {
    const r = await captureCharge({ reference: 'sim_pi_auth_1' });
    expect(r.status).toBe('SIMULATED');
    expect(r.provider).toBe('simulator');
    expect(r.reference).toBe('sim_pi_auth_1');
  });

  it('normalises the currency on a partial capture', async () => {
    const r = await captureCharge({ reference: 'sim_pi_2', amount: 4.2, currency: 'usd' });
    expect(r.status).toBe('SIMULATED');
    expect(r.currency).toBe('USD');
    expect(r.amount).toBe(4.2);
  });

  it('authorizes a card-present charge that can be captured later', async () => {
    const auth = await createCharge({ amount: 12, currency: 'USD', cardPresent: true, capture: false });
    expect(auth.status).toBe('REQUIRES_ACTION'); // manual capture / authorize-only
    expect(auth.reference).toMatch(/^sim_pi_/);
    const cap = await captureCharge({ reference: auth.reference! });
    expect(cap.status).toBe('SIMULATED');
  });

  it('approves a normal card-present charge by default (auto-capture)', async () => {
    const r = await createCharge({ amount: 7.5, currency: 'USD', cardPresent: true, terminalId: 'tmr_1' });
    expect(r.status).toBe('SUCCEEDED');
    expect(r.currency).toBe('USD');
  });

  it('still declines a card-present charge flagged for decline', async () => {
    const r = await createCharge({ amount: 7.5, currency: 'USD', cardPresent: true, paymentMethodId: 'pm_decline' });
    expect(r.status).toBe('FAILED');
    expect(r.declineCode).toBe('card_declined');
  });
});
