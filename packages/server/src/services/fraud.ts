// ─── §37 Fraud detection ─────────────────────────────────────────────────────
// Env-tunable, dependency-light transaction risk scoring. The decision logic
// (scoreFraud) is PURE and separated from DB signal-gathering (gatherSignals) so
// the rules are unit-testable without a database. evaluateFraud() gathers
// signals, scores them, persists a FraudAlert when flagged, emits an event, and
// returns a verdict the payment path acts on: ALLOW / REVIEW / BLOCK.
//
// NOTE: DEVICE_VELOCITY is fully implemented in the scorer and unit-tested, but
// the current schema stores no per-payment device/IP telemetry, so gatherSignals
// leaves that signal at 0. Supply it via FraudContext.signals to activate.

import { prisma } from '../db/client.js';
import { emitEvent } from './eventBus.js';

export type FraudLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type FraudAction = 'ALLOW' | 'REVIEW' | 'BLOCK';

export interface FraudContext {
  organizationId: string;
  amount: number;
  currency?: string;
  method?: string;
  customerId?: string | null;
  orderId?: string | null;
  paymentId?: string | null;
  /** Optional pre-computed override (e.g. device telemetry from the edge). */
  signals?: Partial<FraudSignals>;
}

export interface FraudSignals {
  amount: number;
  method?: string;
  paymentsLastHour: number;
  refundsLast24h: number;
  distinctCustomersOnDevice: number;
  giftCardFundingLastHour: number;
  largeAmountThreshold: number;
  velocityThreshold: number;
  refundThreshold: number;
  deviceThreshold: number;
  giftCardThreshold: number;
  blockScore: number;
  reviewScore: number;
}

export interface FraudRuleHit {
  rule: 'LARGE_AMOUNT' | 'VELOCITY' | 'RAPID_REFUNDS' | 'DEVICE_VELOCITY' | 'GIFT_CARD_ABUSE';
  severity: FraudLevel;
  weight: number;
  message: string;
}

export interface FraudVerdict {
  score: number;
  level: FraudLevel;
  action: FraudAction;
  rules: FraudRuleHit[];
}

function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * PURE: convert gathered signals into a bounded 0–100 score + verdict. No I/O.
 * Weights are additive and capped at 100; thresholds decide ALLOW/REVIEW/BLOCK.
 */
export function scoreFraud(s: FraudSignals): FraudVerdict {
  const rules: FraudRuleHit[] = [];

  if (s.amount >= s.largeAmountThreshold) {
    rules.push({ rule: 'LARGE_AMOUNT', severity: 'MEDIUM', weight: 30, message: `Amount ${s.amount} is at/above the large-amount threshold (${s.largeAmountThreshold}).` });
  }
  if (s.paymentsLastHour >= s.velocityThreshold) {
    rules.push({ rule: 'VELOCITY', severity: 'HIGH', weight: 35, message: `${s.paymentsLastHour} payment attempts in the last hour (threshold ${s.velocityThreshold}).` });
  }
  if (s.refundsLast24h >= s.refundThreshold) {
    rules.push({ rule: 'RAPID_REFUNDS', severity: 'MEDIUM', weight: 25, message: `${s.refundsLast24h} refunds in the last 24h (threshold ${s.refundThreshold}).` });
  }
  if (s.distinctCustomersOnDevice >= s.deviceThreshold) {
    rules.push({ rule: 'DEVICE_VELOCITY', severity: 'HIGH', weight: 30, message: `${s.distinctCustomersOnDevice} distinct customers on one device in the last hour (threshold ${s.deviceThreshold}).` });
  }
  if (s.giftCardFundingLastHour >= s.giftCardThreshold) {
    rules.push({ rule: 'GIFT_CARD_ABUSE', severity: 'MEDIUM', weight: 20, message: `${s.giftCardFundingLastHour} gift-card funding events in the last hour (threshold ${s.giftCardThreshold}).` });
  }

  const score = Math.min(100, rules.reduce((sum, r) => sum + r.weight, 0));
  let level: FraudLevel = 'LOW';
  let action: FraudAction = 'ALLOW';
  if (score >= s.blockScore) {
    level = 'HIGH';
    action = 'BLOCK';
  } else if (score >= s.reviewScore) {
    level = 'MEDIUM';
    action = 'REVIEW';
  } else if (rules.length > 0) {
    level = 'LOW';
    action = 'ALLOW';
  }
  return { score, level, action, rules };
}

/** The current env-tunable thresholds, exposed so callers/tests stay in sync. */
export function fraudThresholds() {
  return {
    largeAmountThreshold: envNum('FRAUD_LARGE_AMOUNT', 5000),
    velocityThreshold: envNum('FRAUD_VELOCITY_PER_HOUR', 6),
    refundThreshold: envNum('FRAUD_REFUNDS_PER_DAY', 4),
    deviceThreshold: envNum('FRAUD_DEVICE_CUSTOMERS_PER_HOUR', 8),
    giftCardThreshold: envNum('FRAUD_GIFTCARD_PER_HOUR', 5),
    blockScore: envNum('FRAUD_BLOCK_SCORE', 70),
    reviewScore: envNum('FRAUD_REVIEW_SCORE', 40),
  };
}

/** Query recent activity for the subject to build the signal set. */
export async function gatherSignals(ctx: FraudContext): Promise<FraudSignals> {
  const t = fraudThresholds();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const base: FraudSignals = {
    amount: ctx.amount,
    method: ctx.method,
    paymentsLastHour: 0,
    refundsLast24h: 0,
    distinctCustomersOnDevice: 0,
    giftCardFundingLastHour: 0,
    ...t,
  };

  if (!ctx.customerId) return { ...base, ...(ctx.signals || {}) };

  const [paymentsLastHour, refundsLast24h, giftCardFundingLastHour] = await Promise.all([
    prisma.payment.count({ where: { order: { customerId: ctx.customerId }, createdAt: { gte: hourAgo } } }),
    prisma.refund.count({ where: { customerId: ctx.customerId, organizationId: ctx.organizationId, createdAt: { gte: dayAgo } } }),
    prisma.giftCard.count({ where: { customerId: ctx.customerId, organizationId: ctx.organizationId, createdAt: { gte: hourAgo } } }),
  ]);

  return {
    ...base,
    paymentsLastHour,
    refundsLast24h,
    giftCardFundingLastHour,
    ...(ctx.signals || {}),
  };
}

/** Persist a FraudAlert and emit an event so ops/notifications can react. */
async function persistAlert(ctx: FraudContext, verdict: FraudVerdict): Promise<void> {
  try {
    const top = verdict.rules[0];
    await prisma.fraudAlert.create({
      data: {
        organizationId: ctx.organizationId,
        paymentId: ctx.paymentId || undefined,
        orderId: ctx.orderId || undefined,
        customerId: ctx.customerId || undefined,
        rule: top ? top.rule : 'VELOCITY',
        severity: verdict.level,
        score: verdict.score,
        status: verdict.action === 'BLOCK' ? 'OPEN' : 'REVIEWING',
        message: verdict.rules.map((r) => r.message).join(' ') || `Risk score ${verdict.score}`,
        metadata: {
          rules: verdict.rules.map((r) => ({ rule: r.rule, severity: r.severity, weight: r.weight, message: r.message })),
          amount: ctx.amount,
          currency: ctx.currency ?? null,
          method: ctx.method ?? null,
          action: verdict.action,
        },
      },
    });
    await emitEvent({
      organizationId: ctx.organizationId,
      event: 'fraud.flagged',
      data: { score: verdict.score, level: verdict.level, action: verdict.action, rules: verdict.rules.map((r) => r.rule), amount: ctx.amount, customerId: ctx.customerId },
    });
  } catch (e) {
    // Alerting must never break the payment path.
    console.error('[fraud] failed to persist alert:', e);
  }
}

/**
 * Full evaluation: gather → score → (persist + emit when flagged). Returns the
 * verdict; the caller decides whether to BLOCK, hold for REVIEW, or ALLOW.
 */
export async function evaluateFraud(ctx: FraudContext): Promise<FraudVerdict> {
  const signals = await gatherSignals(ctx);
  const verdict = scoreFraud(signals);
  if (verdict.action !== 'ALLOW') {
    await persistAlert(ctx, verdict);
  }
  return verdict;
}
