// ─── Scheduled jobs for the global-expansion subsystems ──────────────────────
// Everything in this file is a background guarantee: a fiscal chain that must not
// have holes, a loan that repays itself from the day's takings, a royalty that is
// calculated the same way whether a human pressed the button or the clock did, and
// a benchmark that is recomputed rather than cached in a stale form. Each handler
// is idempotent (upserts, status guards, per-run caps) so a restart mid-window
// cannot double-spend, double-seal or double-accrue.

import { prisma } from '../db/client.js';
import { registerJob, type JobResult } from './scheduler.js';
import { emitEvent } from './eventBus.js';
import { round2 } from './moneyMath.js';
import { transmitPendingBatch } from './fiscalization.js';
import { leaseExpired, type FenceState } from './mesh.js';
import { BENCHMARK_METRICS } from './benchmark.js';
import {
  accrueRoyalties,
  backfillFiscalSeals,
  buildCohortForOrg,
  buildReplenishmentPlan,
  runAllSweeps,
  saveReplenishmentRun,
} from './globalTasks.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Metrics this platform can actually compute from a tenant's own ledger. */
const SELF_COMPUTED_METRICS = ['avg_basket', 'gross_margin_pct', 'discount_rate_pct', 'sales_per_day'];

// ─── fiscalization: the chain has to close by itself ─────────────────────────

/** Push sealed-but-unsent documents to the authority, honouring per-doc backoff. */
async function fiscalTransmitPending(): Promise<JobResult> {
  const sent = await transmitPendingBatch(Number(process.env.FISCAL_TRANSMIT_BATCH) || 25);
  if (sent) console.log(`[fiscal] transmitted ${sent} document(s) to the authority`);
  return { recordsProcessed: sent, message: sent ? `${sent} transmitted` : undefined };
}

/** Re-scan recent completed sales and seal anything the checkout path missed. */
async function fiscalBackfillSeals(): Promise<JobResult> {
  const days = Math.max(1, Number(process.env.FISCAL_BACKFILL_DAYS) || 3);
  const sealed = await backfillFiscalSeals(days, Number(process.env.FISCAL_BACKFILL_LIMIT) || 200);
  if (sealed) {
    const orgs = await prisma.fiscalDocument.groupBy({ by: ['organizationId'], where: { sealedAt: { gte: new Date(Date.now() - MIN) } }, _count: { _all: true } });
    for (const org of orgs) {
      await emitEvent({ organizationId: org.organizationId, event: 'fiscal.seals_backfilled', data: { count: org._count._all } });
    }
  }
  return { recordsProcessed: sealed, message: sealed ? `${sealed} late seal(s)` : undefined };
}

// ─── embedded finance: repayment is a slice of today's takings ───────────────

async function financeDailySweep(): Promise<JobResult> {
  const swept = await runAllSweeps(Number(process.env.FINANCE_SWEEP_LIMIT) || 200);
  return { recordsProcessed: swept, message: swept ? `${swept} facility sweep(s)` : undefined };
}

// ─── agentic back-office: draft the orders, let a human sign them ────────────
/**
 * Only tenants that already asked for low-stock alerts opt in here, and the job
 * stops at DRAFT. Auto-approving a purchase order from a cron would be the point
 * where an "assistant" becomes an liability, so the veto stays with the manager.
 */
async function agentAutoReplenish(): Promise<JobResult> {
  if (String(process.env.AGENT_AUTO_REPLENISH ?? '').toLowerCase() === 'false') return { recordsProcessed: 0, message: 'disabled' };
  const optedIn = await prisma.storeSettings.findMany({ where: { lowStockAlertEnabled: true }, select: { organizationId: true }, take: 40 });
  const since = new Date(Date.now() - 20 * HOUR);
  let drafted = 0;
  for (const setting of optedIn) {
    const organizationId = setting.organizationId;
    const existing = await prisma.replenishmentRun.findFirst({ where: { organizationId, trigger: 'AUTO', createdAt: { gte: since } }, select: { id: true } });
    if (existing) continue; // one draft per day per tenant, however often the tick fires
    try {
      const built = await buildReplenishmentPlan(organizationId, { horizonDays: 14, lookbackDays: 90 });
      if (!built.plan.items.some((item) => item.action === 'ORDER')) continue;
      const run = await saveReplenishmentRun(organizationId, built, {
        trigger: 'AUTO',
        actorId: null,
        guardrails: { serviceLevel: built.plan.serviceLevel, source: 'scheduler', maxSpend: built.plan.totals.cost },
      });
      await emitEvent({
        organizationId,
        event: 'replenishment.draft_ready',
        data: { runId: run.id, lines: run.itemCount, estimatedCost: run.estimatedCost, horizonDays: run.horizonDays },
      });
      drafted++;
    } catch (error) {
      // One tenant's missing supplier data must not stall the whole sweep.
      console.warn(`[agent] replenishment skipped for ${organizationId}: ${(error as Error).message}`);
    }
  }
  return { recordsProcessed: drafted, message: drafted ? `${drafted} draft run(s) awaiting approval` : undefined };
}

// ─── franchise: close the previous month for every active agreement ──────────

async function franchiseRoyaltyClose(): Promise<JobResult> {
  const agreements = await prisma.franchiseAgreement.findMany({ where: { status: 'ACTIVE' }, select: { organizationId: true }, distinct: ['organizationId'], take: 60 });
  if (!agreements.length) return { recordsProcessed: 0 };
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  let processed = 0;
  for (const agreement of agreements) {
    const organizationId = agreement.organizationId;
    const already = await prisma.royaltyAccrual.findFirst({ where: { organizationId, periodStart }, select: { id: true } });
    if (already) continue;
    const result = await accrueRoyalties(organizationId, periodStart, periodEnd);
    const total = round2(result.accruals.reduce((a, row) => a + row.total, 0));
    if (result.accruals.length) {
      await emitEvent({ organizationId, event: 'franchise.royalties_closed', data: { period: result.period, entities: result.accruals.length, total } });
    }
    processed += result.accruals.length;
  }
  return { recordsProcessed: processed };
}

// ─── peer benchmarking: publish cohort cells nobody can be identified in ─────

async function benchmarkRefreshSnapshots(): Promise<JobResult> {
  const orgs = await prisma.organization.findMany({ where: { isActive: true }, select: { id: true }, orderBy: { updatedAt: 'desc' }, take: 25 });
  const to = new Date();
  const from = new Date(to.getTime() - 90 * DAY);
  let processed = 0;
  for (const org of orgs) {
    for (const metricKey of SELF_COMPUTED_METRICS) {
      const definition = BENCHMARK_METRICS.find((m) => m.key === metricKey);
      if (!definition) continue;
      const { cell, selfValue } = await buildCohortForOrg(org.id, metricKey, 90);
      const existing = await prisma.benchmarkSnapshot.findFirst({ where: { organizationId: org.id, metricKey, periodStart: from }, select: { id: true } });
      const data = {
        organizationId: org.id,
        countryCode: cell.key.split(':')[0] || 'US',
        industry: cell.key.split(':')[1] || 'RETAIL',
        metricKey,
        periodStart: from,
        periodEnd: to,
        cohortSize: cell.cohort.cohortSize,
        kValue: cell.cohort.k,
        publishable: cell.cohort.publishable,
        median: cell.cohort.median,
        p10: cell.cohort.p10,
        p25: cell.cohort.p25,
        p75: cell.cohort.p75,
        p90: cell.cohort.p90,
        noiseApplied: cell.cohort.noiseApplied,
        distribution: { self: selfValue, verdict: cell.cohort.self?.verdict ?? null, reason: cell.cohort.reason },
        generatedAt: new Date(),
      };
      if (existing) await prisma.benchmarkSnapshot.update({ where: { id: existing.id }, data });
      else await prisma.benchmarkSnapshot.create({ data });
      processed++;
    }
  }
  return { recordsProcessed: processed };
}

// ─── store mesh: a leader that stops answering must lose the lease ───────────
/**
 * Election is deterministic, so the only thing a central node has to add is the
 * observation that a lease ran out. The fence epoch still advances on the next
 * claim - this job never promotes a device by itself, it only marks the lease as
 * expired and tells the affected store to look.
 */
async function meshLeaseWatchdog(): Promise<JobResult> {
  const now = new Date();
  const fences = await prisma.meshFence.findMany({ where: { leaderDeviceId: { not: null } }, take: 500 });
  let expired = 0;
  for (const fence of fences) {
    const state: FenceState = {
      epoch: fence.epoch,
      leaderDeviceId: fence.leaderDeviceId,
      committedSequence: fence.committedSequence,
      leaseSeconds: fence.leaseSeconds,
      lastCommitAt: fence.lastCommitAt,
    };
    if (!leaseExpired(state, now)) continue;
    await prisma.meshFence.update({ where: { id: fence.id }, data: { reason: 'HEARTBEAT_TIMEOUT', leaderDeviceId: null } });
    await emitEvent({
      organizationId: fence.organizationId,
      event: 'mesh.lease_expired',
      data: { locationId: fence.locationId, epoch: fence.epoch, previousLeaderId: fence.leaderDeviceId },
    });
    expired++;
  }
  return { recordsProcessed: expired, message: expired ? `${expired} lease(s) expired` : undefined };
}

/** Register the global-expansion jobs. Idempotent (registerJob replaces by name). */
export function registerGlobalJobs(): void {
  registerJob({ name: 'fiscal.transmit-pending', intervalMs: 5 * MIN, handler: fiscalTransmitPending });
  registerJob({ name: 'fiscal.backfill-seals', intervalMs: 15 * MIN, handler: fiscalBackfillSeals });
  registerJob({ name: 'finance.daily-sweep', intervalMs: 6 * HOUR, handler: financeDailySweep });
  registerJob({ name: 'agent.auto-replenish', intervalMs: 4 * HOUR, handler: agentAutoReplenish });
  registerJob({ name: 'franchise.royalty-close', intervalMs: DAY, handler: franchiseRoyaltyClose });
  registerJob({ name: 'benchmark.refresh-snapshots', intervalMs: 6 * HOUR, handler: benchmarkRefreshSnapshots });
  registerJob({ name: 'mesh.lease-watchdog', intervalMs: MIN, handler: meshLeaseWatchdog });
}
