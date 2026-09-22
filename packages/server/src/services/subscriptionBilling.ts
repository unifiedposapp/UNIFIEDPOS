// ─── RECURRING SUBSCRIPTION BILLING ENGINE ──────────────────────────────────
// Plans, trials, billing periods, invoices, dunning and proration in one
// place. The date arithmetic and the dunning ladder are pure and unit-tested;
// the cycle tick is the only thing that touches Prisma, and it is written to be
// idempotent per (subscription, period) so a re-run after a crash never doubles
// a charge. Payment collection follows the same provider abstraction as the
// rest of the money path: a PSP charge succeeds/fails, and a failure walks the
// subscription down the dunning ladder instead of silently cancelling it.
import { prisma } from '../db/client.js';
import { createCharge } from './paymentProvider.js';
import { round2 } from './moneyMath.js';

export type BillingInterval = 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';
export const BILLING_INTERVALS: BillingInterval[] = ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'];

/** Retry cadence after failed collection attempts (index = attempt count). */
export const DUNNING_LADDER_DAYS = [1, 3, 7, 14];
/** After the ladder is exhausted the subscription gives up on this day. */
export const DUNNING_FINAL_DAYS = 21;

/** Advance `start` by `count` billing intervals. Calendar-accurate: a plan
 *  billed on the 31st lands on the last valid day of short months (clamped,
 *  never overflowing into the next month like raw Date arithmetic would). */
export function intervalEnd(start: Date, interval: BillingInterval, count = 1): Date {
  switch (interval) {
    case 'DAY':
      return new Date(start.getTime() + count * 86_400_000);
    case 'WEEK':
      return new Date(start.getTime() + 7 * count * 86_400_000);
    case 'MONTH':
    case 'QUARTER':
    case 'YEAR': {
      const monthsToAdd = (interval === 'QUARTER' ? 3 : interval === 'YEAR' ? 12 : 1) * count;
      const d = new Date(start);
      const day = d.getUTCDate();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + monthsToAdd);
      const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      d.setUTCDate(Math.min(day, lastDay));
      return d;
    }
    default:
      throw new Error(`unknown billing interval: ${interval}`);
  }
}

/**
 * The day offset that a monthly figure scales by: a yearly plan counts as 1/12
 * of MRR, a weekly one as about 4.35 months. Used for the revenue mix chart.
 */
export function monthsPerInterval(interval: BillingInterval): number {
  switch (interval) {
    case 'DAY':
      return 30.4375;
    case 'WEEK':
      return 4.348;
    case 'MONTH':
      return 1;
    case 'QUARTER':
      return 1 / 3;
    case 'YEAR':
      return 1 / 12;
  }
}

/** Next dunning retry for an invoice that has already failed `attempts` times. */
export function nextRetryAt(failedAt: Date, attempts: number): { retryAt: Date; exhausted: boolean } {
  if (attempts <= DUNNING_LADDER_DAYS.length) {
    const days = DUNNING_LADDER_DAYS[attempts - 1];
    return { retryAt: new Date(failedAt.getTime() + days * 86_400_000), exhausted: false };
  }
  return { retryAt: new Date(failedAt.getTime() + DUNNING_FINAL_DAYS * 86_400_000), exhausted: true };
}

/**
 * Prorated charge for upgrading mid-period: the customer pays the plan *delta*
 * for the time remaining in the period (Stripe-style), clamped to [0, newAmount]
 * so downgrades never produce a cash refund out of this path.
 */
export function prorate(newAmount: number, oldAmount: number, remainingMs: number, totalMs: number): number {
  if (totalMs <= 0) return round2(newAmount);
  const fraction = Math.max(0, Math.min(1, remainingMs / totalMs));
  return round2(Math.max(0, Math.min(newAmount, (newAmount - oldAmount) * fraction)));
}

export interface CreatedSubscription {
  id: string;
  status: string;
  trialEnd: Date | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

/**
 * Start a subscription on a plan. With trialDays > 0 the first period is free
 * (TRIALING, no invoice); otherwise period one opens with an invoice due now.
 */
export async function startSubscription(
  organizationId: string,
  customerId: string,
  planId: string,
  options: { externalId?: string; trialDaysOverride?: number } = {},
): Promise<CreatedSubscription> {
  const plan = await prisma.subscriptionPlan.findFirst({ where: { id: planId, organizationId, active: true } });
  if (!plan) throw Object.assign(new Error('Plan not found or inactive'), { status: 404 });
  const customer = await prisma.customer.findFirst({ where: { id: customerId, organizationId } });
  if (!customer) throw Object.assign(new Error('Customer not found'), { status: 404 });

  const now = new Date();
  const trialDays = Math.max(0, options.trialDaysOverride ?? plan.trialDays);
  const periodEnd = intervalEnd(now, plan.interval as BillingInterval, plan.intervalCount);
  const sub = await prisma.subscription.create({
    data: {
      organizationId,
      customerId,
      planId,
      status: trialDays > 0 ? 'TRIALING' : 'ACTIVE',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      trialEnd: trialDays > 0 ? new Date(now.getTime() + trialDays * 86_400_000) : null,
      externalId: options.externalId,
    },
  });
  if (trialDays === 0) {
    await openInvoice(sub, plan, now, periodEnd);
  }
  return { id: sub.id, status: sub.status, trialEnd: sub.trialEnd, currentPeriodStart: sub.currentPeriodStart, currentPeriodEnd: sub.currentPeriodEnd };
}

/** One invoice for a billing period; idempotent per (subscription, periodStart). */
async function openInvoice(
  sub: { id: string; organizationId: string },
  plan: { amount: unknown; currency: string },
  periodStart: Date,
  periodEnd: Date,
) {
  const existing = await prisma.subscriptionInvoice.findFirst({
    where: { subscriptionId: sub.id, periodStart },
  });
  if (existing) return existing;
  return prisma.subscriptionInvoice.create({
    data: {
      organizationId: sub.organizationId,
      subscriptionId: sub.id,
      number: `SUB-${sub.id.slice(0, 8).toUpperCase()}-${periodStart.toISOString().slice(0, 10)}`,
      amount: plan.amount as never,
      currency: plan.currency,
      periodStart,
      periodEnd,
      dueDate: periodStart,
      status: 'OPEN',
      nextRetryAt: periodStart,
    },
  });
}

/** Attempt collection on one open/past-due invoice. Returns true when paid. */
export async function attemptCollection(invoiceId: string): Promise<{ paid: boolean; status: string; reference?: string; message?: string }> {
  const invoice = await prisma.subscriptionInvoice.findFirst({
    where: { id: invoiceId, status: { in: ['OPEN', 'UNPAID', 'DUNNING'] } },
  });
  if (!invoice) return { paid: false, status: 'NOT_FOUND' };
  const charge = await createCharge({
    amount: Number(invoice.amount),
    currency: invoice.currency,
    metadata: { subscriptionInvoiceId: invoice.id, kind: 'SUBSCRIPTION' },
  });
  if (charge.status === 'SUCCEEDED') {
    // The PSP reference is returned to the caller for logging; the invoice row
    // itself only needs the accounting state.
    await prisma.subscriptionInvoice.update({
      where: { id: invoice.id },
      data: { status: 'PAID', paidAt: new Date() },
    });
    // A paid invoice always rescues a PAST_DUE subscription.
    await prisma.subscription.update({ where: { id: invoice.subscriptionId }, data: { status: 'ACTIVE' } });
    return { paid: true, status: 'PAID', reference: charge.reference ?? undefined };
  }
  const attempts = invoice.attemptCount + 1;
  const { retryAt, exhausted } = nextRetryAt(new Date(), attempts);
  await prisma.subscriptionInvoice.update({
    where: { id: invoice.id },
    data: { status: 'DUNNING', attemptCount: attempts, nextRetryAt: retryAt },
  });
  await prisma.subscription.update({ where: { id: invoice.subscriptionId }, data: { status: exhausted ? 'CANCELLED' : 'PAST_DUE' } });
  return { paid: false, status: exhausted ? 'DUNNING_EXHAUSTED' : 'PAST_DUE', message: charge.message ?? 'charge declined' };
}

export interface CycleResult {
  trialsActivated: number;
  periodsAdvanced: number;
  invoicesCharged: number;
  dunned: number;
  cancelled: number;
}

/**
 * The scheduler tick. Four passes, each idempotent:
 *  1. end trials whose trial window has elapsed,
 *  2. roll periods that have elapsed (honouring cancel-at-period-end),
 *  3. collect due invoices (open ones on their due date; dunning ones when the
 *     retry window says so),
 *  4. expire nothing — the ladder in attemptCollection handles final failure.
 */
export async function runSubscriptionCycle(now = new Date()): Promise<CycleResult> {
  const result: CycleResult = { trialsActivated: 0, periodsAdvanced: 0, invoicesCharged: 0, dunned: 0, cancelled: 0 };
  // The models are relation-free by migration design, so plans are fetched
  // through a per-tick cache instead of `include`.
  const planCache = new Map<string, Awaited<ReturnType<typeof prisma.subscriptionPlan.findUnique>> | null>();
  const planOf = async (planId: string) => {
    if (!planCache.has(planId)) planCache.set(planId, await prisma.subscriptionPlan.findUnique({ where: { id: planId } }));
    return planCache.get(planId);
  };

  // 1. Trial → active
  const trials = await prisma.subscription.findMany({
    where: { status: 'TRIALING', trialEnd: { not: null, lte: now } },
    take: 500,
  });
  for (const sub of trials) {
    if (sub.cancelAtPeriodEnd) {
      await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED', canceledAt: now } });
      result.cancelled += 1;
      continue;
    }
    const plan = await planOf(sub.planId);
    if (!plan) continue;
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'ACTIVE' } });
    await openInvoice({ id: sub.id, organizationId: sub.organizationId }, plan, sub.currentPeriodStart, sub.currentPeriodEnd);
    result.trialsActivated += 1;
  }

  // 2. Period elapsed → advance + new invoice (or cancel at period end)
  const due = await prisma.subscription.findMany({
    where: { status: 'ACTIVE', currentPeriodEnd: { lte: now } },
    take: 500,
  });
  for (const sub of due) {
    if (sub.cancelAtPeriodEnd || (sub.cancelAt && sub.cancelAt <= now)) {
      await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED', canceledAt: now } });
      result.cancelled += 1;
      continue;
    }
    const plan = await planOf(sub.planId);
    if (!plan) continue;
    const nextStart = sub.currentPeriodEnd;
    const nextEnd = intervalEnd(nextStart, plan.interval as BillingInterval, plan.intervalCount);
    await prisma.subscription.update({ where: { id: sub.id }, data: { currentPeriodStart: nextStart, currentPeriodEnd: nextEnd } });
    await openInvoice({ id: sub.id, organizationId: sub.organizationId }, plan, nextStart, nextEnd);
    result.periodsAdvanced += 1;
  }

  // 3. Collection: open invoices on/after their due date, dunning ones when
  // the retry window says so. Driven from the subscription side so only live
  // (ACTIVE/PAST_DUE) billing relationships are ever charged.
  const billable = await prisma.subscription.findMany({
    where: { status: { in: ['ACTIVE', 'PAST_DUE'] } },
    take: 500,
  });
  for (const sub of billable) {
    const invoices = await prisma.subscriptionInvoice.findMany({
      where: { subscriptionId: sub.id, status: { in: ['OPEN', 'DUNNING'] } },
      take: 12,
    });
    for (const invoice of invoices) {
      const windowStart = invoice.status === 'OPEN' ? invoice.dueDate : invoice.nextRetryAt;
      if (!windowStart || windowStart > now) continue;
      const outcome = await attemptCollection(invoice.id);
      if (outcome.paid) result.invoicesCharged += 1;
      else if (outcome.status === 'PAST_DUE' || outcome.status === 'DUNNING_EXHAUSTED') {
        result.dunned += 1;
        if (outcome.status === 'DUNNING_EXHAUSTED') result.cancelled += 1;
      }
    }
  }
  return result;
}

/** Tenant rollup for the dashboard: counts, MRR mix, last-12-month revenue. */
export async function subscriptionOverview(organizationId: string) {
  const subs = await prisma.subscription.findMany({ where: { organizationId }, take: 5000 });
  const plans = await prisma.subscriptionPlan.findMany({ where: { organizationId }, take: 1000 });
  const planById = new Map(plans.map((p) => [p.id, p]));
  const byStatus: Record<string, number> = {};
  let mrr = 0;
  for (const sub of subs) {
    byStatus[sub.status] = (byStatus[sub.status] || 0) + 1;
    const plan = planById.get(sub.planId);
    if (plan && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE' || sub.status === 'TRIALING')) {
      mrr += Number(plan.amount) / monthsPerInterval(plan.interval as BillingInterval);
    }
  }
  const since = new Date(Date.now() - 365 * 86_400_000);
  const paid = await prisma.subscriptionInvoice.findMany({
    where: { organizationId, status: 'PAID', paidAt: { gte: since } },
    take: 10_000,
  });
  const byMonth = new Map<string, number>();
  for (const inv of paid) {
    const key = (inv.paidAt ?? new Date()).toISOString().slice(0, 7);
    byMonth.set(key, round2((byMonth.get(key) || 0) + Number(inv.amount)));
  }
  const openInvoices = await prisma.subscriptionInvoice.count({ where: { organizationId, status: { in: ['OPEN', 'UNPAID', 'DUNNING'] } } });
  return {
    subscriptions: subs.length,
    byStatus,
    mrr: round2(mrr),
    openInvoices,
    collectedLast12Months: paid.reduce((a, i) => a + Number(i.amount), 0).toFixed(2),
    revenueByMonth: [...byMonth.entries()].map(([month, total]) => ({ month, total })),
  };
}
