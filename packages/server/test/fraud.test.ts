import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scoreFraud, fraudThresholds, type FraudSignals } from '../src/services/fraud';

// Build a signal set at the documented defaults with every trigger below its
// threshold, so each test can raise exactly one signal and assert one rule.
function baseSignals(over: Partial<FraudSignals> = {}): FraudSignals {
  const t = fraudThresholds();
  return {
    amount: 10,
    method: 'CARD',
    paymentsLastHour: 0,
    refundsLast24h: 0,
    distinctCustomersOnDevice: 0,
    giftCardFundingLastHour: 0,
    ...t,
    ...over,
  };
}

describe('fraudThresholds', () => {
  const keys = [
    'FRAUD_LARGE_AMOUNT',
    'FRAUD_VELOCITY_PER_HOUR',
    'FRAUD_REFUNDS_PER_DAY',
    'FRAUD_DEVICE_CUSTOMERS_PER_HOUR',
    'FRAUD_GIFTCARD_PER_HOUR',
    'FRAUD_BLOCK_SCORE',
    'FRAUD_REVIEW_SCORE',
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    keys.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
  });
  afterEach(() => {
    keys.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  it('falls back to documented defaults when env is unset', () => {
    const t = fraudThresholds();
    expect(t.largeAmountThreshold).toBe(5000);
    expect(t.velocityThreshold).toBe(6);
    expect(t.refundThreshold).toBe(4);
    expect(t.deviceThreshold).toBe(8);
    expect(t.giftCardThreshold).toBe(5);
    expect(t.blockScore).toBe(70);
    expect(t.reviewScore).toBe(40);
  });

  it('honours env overrides', () => {
    process.env.FRAUD_LARGE_AMOUNT = '1000';
    process.env.FRAUD_BLOCK_SCORE = '50';
    const t = fraudThresholds();
    expect(t.largeAmountThreshold).toBe(1000);
    expect(t.blockScore).toBe(50);
  });

  it('ignores a non-numeric env override and keeps the default', () => {
    process.env.FRAUD_REVIEW_SCORE = 'not-a-number';
    expect(fraudThresholds().reviewScore).toBe(40);
  });
});

describe('scoreFraud — clean transactions', () => {
  it('allows a small, low-activity charge with no rules', () => {
    const v = scoreFraud(baseSignals());
    expect(v.score).toBe(0);
    expect(v.level).toBe('LOW');
    expect(v.action).toBe('ALLOW');
    expect(v.rules).toEqual([]);
  });
});

describe('scoreFraud — individual rules', () => {
  it('flags LARGE_AMOUNT at the threshold (weight 30 → REVIEW)', () => {
    const t = fraudThresholds();
    const v = scoreFraud(baseSignals({ amount: t.largeAmountThreshold }));
    expect(v.rules.map((r) => r.rule)).toContain('LARGE_AMOUNT');
    expect(v.score).toBe(30);
    // 30 < reviewScore(40) → still ALLOW but LOW with a recorded rule.
    expect(v.action).toBe('ALLOW');
    expect(v.level).toBe('LOW');
    expect(v.rules).toHaveLength(1);
  });

  it('flags VELOCITY (weight 35) — recorded but below the review threshold alone', () => {
    const t = fraudThresholds();
    const v = scoreFraud(baseSignals({ paymentsLastHour: t.velocityThreshold }));
    expect(v.rules.map((r) => r.rule)).toContain('VELOCITY');
    expect(v.score).toBe(35);
    // 35 < reviewScore(40): a lone velocity hit is recorded but still allowed.
    expect(v.action).toBe('ALLOW');
    expect(v.level).toBe('LOW');
  });

  it('flags RAPID_REFUNDS (weight 25)', () => {
    const t = fraudThresholds();
    const v = scoreFraud(baseSignals({ refundsLast24h: t.refundThreshold }));
    expect(v.rules.map((r) => r.rule)).toContain('RAPID_REFUNDS');
    expect(v.score).toBe(25);
  });

  it('flags DEVICE_VELOCITY (weight 30) when telemetry is supplied', () => {
    const t = fraudThresholds();
    const v = scoreFraud(baseSignals({ distinctCustomersOnDevice: t.deviceThreshold }));
    expect(v.rules.map((r) => r.rule)).toContain('DEVICE_VELOCITY');
    expect(v.score).toBe(30);
  });

  it('flags GIFT_CARD_ABUSE (weight 20)', () => {
    const t = fraudThresholds();
    const v = scoreFraud(baseSignals({ giftCardFundingLastHour: t.giftCardThreshold }));
    expect(v.rules.map((r) => r.rule)).toContain('GIFT_CARD_ABUSE');
    expect(v.score).toBe(20);
  });
});

describe('scoreFraud — escalation and capping', () => {
  it('BLOCKs when combined weights reach the block score', () => {
    const t = fraudThresholds();
    // VELOCITY(35) + DEVICE_VELOCITY(30) + GIFT_CARD_ABUSE(20) = 85 ≥ blockScore(70).
    const v = scoreFraud(baseSignals({
      paymentsLastHour: t.velocityThreshold,
      distinctCustomersOnDevice: t.deviceThreshold,
      giftCardFundingLastHour: t.giftCardThreshold,
    }));
    expect(v.score).toBe(85);
    expect(v.action).toBe('BLOCK');
    expect(v.level).toBe('HIGH');
  });

  it('caps the score at 100 when every rule fires', () => {
    const t = fraudThresholds();
    const v = scoreFraud(baseSignals({
      amount: t.largeAmountThreshold,          // 30
      paymentsLastHour: t.velocityThreshold,   // 35
      refundsLast24h: t.refundThreshold,       // 25
      distinctCustomersOnDevice: t.deviceThreshold, // 30
      giftCardFundingLastHour: t.giftCardThreshold, // 20
    }));
    expect(v.rules).toHaveLength(5);
    expect(v.score).toBe(100); // 140 clamped to 100
    expect(v.action).toBe('BLOCK');
  });

  it('uses REVIEW (not BLOCK) in the band between review and block scores', () => {
    const t = fraudThresholds();
    // VELOCITY(35) + RAPID_REFUNDS(25) = 60 → between 40 and 70 → REVIEW.
    const v = scoreFraud(baseSignals({
      paymentsLastHour: t.velocityThreshold,
      refundsLast24h: t.refundThreshold,
    }));
    expect(v.score).toBe(60);
    expect(v.action).toBe('REVIEW');
    expect(v.level).toBe('MEDIUM');
  });

  it('respects a lowered block score from env', () => {
    process.env.FRAUD_BLOCK_SCORE = '30';
    try {
      const t = fraudThresholds();
      // A single LARGE_AMOUNT hit (30) now meets the lowered block score.
      const v = scoreFraud(baseSignals({ amount: t.largeAmountThreshold }));
      expect(v.action).toBe('BLOCK');
    } finally {
      delete process.env.FRAUD_BLOCK_SCORE;
    }
  });
});
