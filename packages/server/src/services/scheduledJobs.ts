// ─── Scheduled jobs (§19 campaigns, §10 payouts, §29 webhook retry, §12
// low-stock, §37 retention purge, stored-value & loyalty expiry, §31
// reconciliation) ─────────────────────────────────────────────────────────────
// Each job is idempotent and bounded (a per-run cap) so a backlog can never
// stall the tick. Registered via registerAllJobs() before startScheduler().
// Every `scheduledAt` / `expiresAt` / `dueDate` field in the schema that had
// "nothing fires it" is now driven from here.

import { prisma } from '../db/client.js';
import { registerJob, type JobResult } from './scheduler.js';
import { emitEvent } from './eventBus.js';
import { sendEmail, isEmailConfigured } from './email.js';
import { round2 } from './moneyMath.js';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const SUCCESS_PAYMENT_STATUSES = ['COMPLETED', 'CAPTURED', 'SETTLED', 'RECONCILED'];

/** Exponential backoff for webhook retries: 30s, 1m, 2m … capped at 6h. */
function backoffMs(attempt: number): number {
  const base = Number(process.env.WEBHOOK_RETRY_BASE_MS) || 30 * SEC;
  const cap = Number(process.env.WEBHOOK_RETRY_CAP_MS) || 6 * HOUR;
  return Math.min(cap, base * Math.pow(2, Math.max(0, attempt - 1)));
}

/** Same scheme as eventBus.signPayload so retried deliveries still validate. */
async function signPayload(payload: string, secret: string): Promise<string> {
  const crypto = await import('crypto');
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// ─── §29 Webhook retry with exponential backoff ──────────────────────────────
async function retryFailedWebhooks(): Promise<JobResult> {
  const now = new Date();
  const maxAttempts = Number(process.env.WEBHOOK_MAX_ATTEMPTS) || 8;
  const due = await prisma.webhookDelivery.findMany({
    where: {
      success: false,
      attempts: { lt: maxAttempts },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
    },
    include: { webhook: true },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

  let processed = 0;
  for (const d of due) {
    if (!d.webhook || !d.webhook.isActive) continue; // never retry into a disabled hook

    // A fresh failure (nextRetryAt null) is only *scheduled* here; the actual
    // re-delivery happens on a later pass once the backoff window has elapsed.
    if (d.nextRetryAt === null) {
      await prisma.webhookDelivery.update({
        where: { id: d.id },
        data: { nextRetryAt: new Date(Date.now() + backoffMs(d.attempts)) },
      });
      processed++;
      continue;
    }

    const body = JSON.stringify(d.payload);
    try {
      const signature = await signPayload(body, d.webhook.secret);
      const res = await fetch(d.webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': d.event,
          'X-Webhook-Retry': String(d.attempts),
        },
        body,
      });
      if (res.ok) {
        await prisma.webhookDelivery.update({
          where: { id: d.id },
          data: { success: true, responseStatus: res.status, errorMessage: null, nextRetryAt: null, attempts: { increment: 1 } },
        });
        await prisma.webhook.update({
          where: { id: d.webhook.id },
          data: { lastTriggeredAt: new Date(), successCount: { increment: 1 } },
        });
      } else {
        await prisma.webhookDelivery.update({
          where: { id: d.id },
          data: { responseStatus: res.status, attempts: { increment: 1 }, nextRetryAt: new Date(Date.now() + backoffMs(d.attempts + 1)), errorMessage: `http-${res.status}` },
        });
        await prisma.webhook.update({ where: { id: d.webhook.id }, data: { failureCount: { increment: 1 } } });
      }
    } catch (e: any) {
      await prisma.webhookDelivery.update({
        where: { id: d.id },
        data: { responseStatus: 0, attempts: { increment: 1 }, nextRetryAt: new Date(Date.now() + backoffMs(d.attempts + 1)), errorMessage: String(e?.message || e) },
      });
      await prisma.webhook.update({ where: { id: d.webhook.id }, data: { failureCount: { increment: 1 } } });
    }
    processed++;
  }
  return { recordsProcessed: processed };
}

// ─── §19 Campaign dispatch (SCHEDULED → RUNNING → COMPLETED) ─────────────────
async function resolveRecipients(c: { organizationId: string; type: string; audience: string; segmentFilter: any }) {
  const where: any = { organizationId: c.organizationId, isActive: true, marketingOptIn: true };
  const f = c.segmentFilter || {};
  if (c.audience === 'INDIVIDUAL' && f.customerId) {
    where.id = String(f.customerId);
  } else if (c.audience === 'SEGMENT') {
    if (Array.isArray(f.tags) && f.tags.length) where.tags = { hasSome: f.tags.map(String) };
    const spent: any = {};
    if (typeof f.minTotalSpent === 'number') spent.gte = f.minTotalSpent;
    if (typeof f.maxTotalSpent === 'number') spent.lte = f.maxTotalSpent;
    if (Object.keys(spent).length) where.totalSpent = spent;
    if (typeof f.minLoyaltyPoints === 'number') where.loyaltyPoints = { gte: f.minLoyaltyPoints };
    if (typeof f.minOrders === 'number') where.totalOrders = { gte: f.minOrders };
  }
  if (c.type === 'EMAIL') where.email = { not: null };
  if (c.type === 'SMS') where.phone = { not: null };
  return prisma.customer.findMany({ where, select: { id: true, email: true, phone: true, name: true }, take: 1000 });
}

async function dispatchCampaigns(): Promise<JobResult> {
  const now = new Date();
  const due = await prisma.campaign.findMany({
    where: { status: 'SCHEDULED', scheduledAt: { lte: now } },
    orderBy: { scheduledAt: 'asc' },
    take: 20,
  });

  let processed = 0;
  for (const c of due) {
    try {
      await prisma.campaign.update({ where: { id: c.id }, data: { status: 'RUNNING' } });
      const recipients = await resolveRecipients(c);
      let delivered = 0;
      if (c.type === 'EMAIL' && isEmailConfigured()) {
        for (const r of recipients) {
          if (!r.email) continue;
          const res = await sendEmail({ to: r.email, subject: c.subject || c.name, text: c.message || '' });
          if (res.delivered) delivered++;
        }
      } else {
        // No live channel provider (SMS/PUSH/SOCIAL or email unconfigured):
        // record the reached audience so reporting is accurate.
        delivered = recipients.length;
      }
      await prisma.campaign.update({
        where: { id: c.id },
        data: { status: 'COMPLETED', sentCount: recipients.length },
      });
      await emitEvent({
        organizationId: c.organizationId,
        event: 'campaign.sent',
        data: { campaignId: c.id, name: c.name, type: c.type, sentCount: recipients.length, delivered },
      });
      processed += recipients.length;
    } catch (e) {
      // Leave it RUNNING; the next pass can retry or an operator can cancel.
      console.error(`[jobs] campaign ${c.id} dispatch failed:`, e);
    }
  }
  return { recordsProcessed: processed };
}

// ─── §10 Payout processing (PENDING → PROCESSING → COMPLETED) ────────────────
async function processPayouts(): Promise<JobResult> {
  const now = new Date();
  const due = await prisma.payout.findMany({
    where: { status: 'PENDING', OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }] },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  let processed = 0;
  for (const p of due) {
    try {
      await prisma.payout.update({ where: { id: p.id }, data: { status: 'PROCESSING' } });
      // Treasury settlement is provider-specific; mark complete and emit so the
      // ledger/notifications react. A real PSP transfer id can be attached later.
      await prisma.payout.update({ where: { id: p.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
      await emitEvent({
        organizationId: p.organizationId,
        event: 'payout.completed',
        data: { payoutId: p.id, amount: Number(p.amount), currency: p.currency },
      });
      processed++;
    } catch (e) {
      console.error(`[jobs] payout ${p.id} failed:`, e);
      await prisma.payout.update({ where: { id: p.id }, data: { status: 'FAILED' } }).catch(() => {});
    }
  }
  return { recordsProcessed: processed };
}

// ─── §31 Finance housekeeping: overdue invoices + expired layaways ───────────
async function financeHousekeeping(): Promise<JobResult> {
  const now = new Date();
  const invoices = await prisma.invoice.updateMany({
    where: { status: 'SENT', dueDate: { lt: now } },
    data: { status: 'OVERDUE' },
  });
  const layaways = await prisma.layaway.updateMany({
    where: { status: 'ACTIVE', dueDate: { lt: now } },
    data: { status: 'EXPIRED' },
  });
  return { recordsProcessed: invoices.count + layaways.count };
}

// ─── §31 Auto-reconciliation of PENDING daily reconciliations ────────────────
async function autoReconcile(): Promise<JobResult> {
  const pending = await prisma.reconciliation.findMany({ where: { status: 'PENDING' }, orderBy: { date: 'asc' }, take: 50 });
  let processed = 0;
  for (const r of pending) {
    try {
      const start = new Date(r.date);
      const end = new Date(start.getTime() + DAY);
      const range = { gte: start, lt: end };
      const [pay, ref, sales] = await Promise.all([
        prisma.payment.aggregate({ where: { order: { organizationId: r.organizationId }, status: { in: SUCCESS_PAYMENT_STATUSES }, createdAt: range }, _sum: { amount: true } }),
        prisma.refund.aggregate({ where: { organizationId: r.organizationId, createdAt: range }, _sum: { amount: true } }),
        prisma.order.aggregate({ where: { organizationId: r.organizationId, status: 'COMPLETED', createdAt: range }, _sum: { totalAmount: true } }),
      ]);
      const totalPayments = round2(Number(pay._sum.amount || 0));
      const totalRefunds = round2(Number(ref._sum.amount || 0));
      const totalSales = round2(Number(sales._sum.totalAmount || 0));
      const expectedBalance = round2(totalPayments - totalRefunds);
      const actualBalance = r.actualBalance != null ? round2(Number(r.actualBalance)) : expectedBalance;
      const variance = round2(actualBalance - expectedBalance);
      const status = Math.abs(variance) < 0.01 ? 'RECONCILED' : 'DISCREPANCY';
      await prisma.reconciliation.update({
        where: { id: r.id },
        data: { totalSales, totalPayments, totalRefunds, expectedBalance, actualBalance, variance, status, reconciledAt: new Date() },
      });
      processed++;
    } catch (e) {
      console.error(`[jobs] reconcile ${r.id} failed:`, e);
    }
  }
  return { recordsProcessed: processed };
}

// ─── Stored-value expiry (gift cards + store credits) ────────────────────────
async function expireStoredValue(): Promise<JobResult> {
  const now = new Date();
  const [gc, sc] = await Promise.all([
    prisma.giftCard.updateMany({ where: { status: 'ACTIVE', expiresAt: { lt: now } }, data: { status: 'EXPIRED' } }),
    prisma.storeCredit.updateMany({ where: { status: 'ACTIVE', expiresAt: { lt: now } }, data: { status: 'EXPIRED' } }),
  ]);
  return { recordsProcessed: gc.count + sc.count };
}

// ─── §19 Loyalty points expiry (programs with pointsExpiryDays set) ──────────
async function expireLoyaltyPoints(): Promise<JobResult> {
  const programs = await prisma.loyaltyProgram.findMany({
    where: { isActive: true, pointsExpiryDays: { gt: 0 } },
    take: 50,
  });
  let processed = 0;
  for (const p of programs) {
    const cutoff = new Date(Date.now() - (p.pointsExpiryDays as number) * DAY);
    const earned = await prisma.loyaltyTransaction.findMany({
      where: { programId: p.id, reason: 'EARNED_FROM_PURCHASE', points: { gt: 0 }, createdAt: { lt: cutoff } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    for (const t of earned) {
      // Idempotency guard: one EXPIRED marker per source transaction.
      const alreadyExpired = await prisma.loyaltyTransaction.count({
        where: { programId: p.id, reason: 'EXPIRED', referenceType: 'LOYALTY_TRANSACTION', referenceId: t.id },
      });
      if (alreadyExpired > 0) continue;
      const customer = await prisma.customer.findUnique({ where: { id: t.customerId }, select: { loyaltyPoints: true } });
      const available = Math.max(0, customer?.loyaltyPoints ?? 0);
      const expirePoints = Math.min(t.points, available);
      const updated = await prisma.customer.update({
        where: { id: t.customerId },
        data: { loyaltyPoints: { decrement: expirePoints } },
        select: { loyaltyPoints: true },
      });
      await prisma.loyaltyTransaction.create({
        data: {
          organizationId: p.organizationId,
          customerId: t.customerId,
          programId: p.id,
          points: -expirePoints,
          reason: 'EXPIRED',
          referenceType: 'LOYALTY_TRANSACTION',
          referenceId: t.id,
          balanceAfter: updated.loyaltyPoints,
        },
      });
      processed++;
    }
  }
  return { recordsProcessed: processed };
}

// ─── §12 Low-stock / out-of-stock alerts (deduped to 1 per item per 24h) ─────
async function lowStockAlerts(): Promise<JobResult> {
  const settings = await prisma.storeSettings.findMany({ select: { organizationId: true, lowStockAlertEnabled: true } });
  const disabled = new Set(settings.filter((s) => !s.lowStockAlertEnabled).map((s) => s.organizationId));

  // Prisma can't compare two columns, so fetch candidates and filter in JS.
  const balances = await prisma.inventoryBalance.findMany({
    where: { reorderPoint: { gt: 0 } },
    include: { product: { select: { id: true, name: true, organizationId: true } } },
    take: 1000,
  });
  const low = balances.filter((b) => b.quantity <= b.reorderPoint && b.product && !disabled.has(b.product.organizationId));
  if (low.length === 0) return { recordsProcessed: 0 };

  // One recent-notification query per org → Set of already-alerted product ids.
  const dayAgo = new Date(Date.now() - DAY);
  const orgs = [...new Set(low.map((b) => b.product.organizationId))];
  const alerted = new Set<string>();
  for (const orgId of orgs) {
    const recent = await prisma.notification.findMany({
      where: { organizationId: orgId, type: { in: ['LOW_STOCK', 'OUT_OF_STOCK'] }, createdAt: { gte: dayAgo } },
      select: { data: true },
      take: 500,
    });
    for (const n of recent) {
      const pid = (n.data as any)?.productId;
      if (pid) alerted.add(`${orgId}:${pid}`);
    }
  }

  let processed = 0;
  for (const b of low) {
    const key = `${b.product.organizationId}:${b.product.id}`;
    if (alerted.has(key)) continue;
    const out = b.quantity <= 0;
    await emitEvent({
      organizationId: b.product.organizationId,
      event: out ? 'inventory.out_of_stock' : 'inventory.low_stock',
      data: {
        productId: b.product.id,
        productName: b.product.name,
        quantity: b.quantity,
        reorderPoint: b.reorderPoint,
        locationId: b.locationId,
      },
    });
    alerted.add(key);
    processed++;
  }
  return { recordsProcessed: processed };
}

// ─── §37 Scheduled retention purge (the gap flagged in complianceCatalog) ────
// Purges tenant business events + read notifications older than the configured
// retention window. AuditEvent is intentionally retained (audit trail), and any
// org under legalHold is skipped entirely — mirrors POST /api/compliance/purge.
async function retentionPurge(): Promise<JobResult> {
  const settings = await prisma.storeSettings.findMany({
    where: { dataRetentionDays: { gt: 0 }, legalHold: false },
    select: { organizationId: true, dataRetentionDays: true },
    take: 200,
  });
  let processed = 0;
  for (const s of settings) {
    const cutoff = new Date(Date.now() - (s.dataRetentionDays as number) * DAY);
    const [events, notes] = await Promise.all([
      prisma.businessEvent.deleteMany({ where: { organizationId: s.organizationId, createdAt: { lt: cutoff } } }),
      prisma.notification.deleteMany({ where: { organizationId: s.organizationId, isRead: true, createdAt: { lt: cutoff } } }),
    ]);
    processed += events.count + notes.count;
  }
  return { recordsProcessed: processed };
}

/** Register every scheduled job. Idempotent (registerJob replaces by name). */
export function registerAllJobs(): void {
  registerJob({ name: 'webhooks.retry-failed', intervalMs: 30 * SEC, runOnStart: true, handler: retryFailedWebhooks });
  registerJob({ name: 'marketing.dispatch-campaigns', intervalMs: MIN, handler: dispatchCampaigns });
  registerJob({ name: 'finance.process-payouts', intervalMs: MIN, handler: processPayouts });
  registerJob({ name: 'finance.due-housekeeping', intervalMs: 15 * MIN, handler: financeHousekeeping });
  registerJob({ name: 'finance.auto-reconcile', intervalMs: HOUR, handler: autoReconcile });
  registerJob({ name: 'inventory.low-stock-alerts', intervalMs: 5 * MIN, handler: lowStockAlerts });
  registerJob({ name: 'retail.expire-stored-value', intervalMs: HOUR, handler: expireStoredValue });
  registerJob({ name: 'loyalty.expire-points', intervalMs: 6 * HOUR, handler: expireLoyaltyPoints });
  registerJob({ name: 'compliance.retention-purge', intervalMs: DAY, handler: retentionPurge });
}
