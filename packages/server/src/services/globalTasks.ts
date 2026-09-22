// ─── GLOBAL-EXPANSION TASK LAYER ─────────────────────────────────────────────
// The pure modules (fiscalization, paymentRails, settlement, replenishment,
// embeddedFinance, franchise, benchmark …) hold the rules and never touch a
// database. This file is the seam: it assembles real tenant data into those pure
// inputs, and writes the results back. Routes and scheduler jobs both call here,
// so a manual "Plan now" click and a 03:00 cron produce identical output.
import { prisma } from '../db/client.js';
import { toJson, jsonOrNull } from '../utils/json.js';
import { round2 } from './moneyMath.js';
import { planReplenishment, stdDev, type PlanOptions, type ReplenishInput, type PlanResult } from './replenishment.js';
import { underwrite, amortizeSchedule, applySweep, type TradingMetrics, type UnderwritingDecision } from './embeddedFinance.js';
import { computeRoyalty, consolidatePnl, periodLabel, type RoyaltyAgreement, type EntityPnl } from './franchise.js';
import { buildCohort, cohortKey, revenueBand, type CohortResult } from './benchmark.js';
import { fiscalProfileFor } from '../data/fiscalProfiles.js';
import { sealOrder } from './fiscalization.js';

const DAY_MS = 86_400_000;
const NON_STOCKED_TYPES = new Set(['SERVICE', 'DIGITAL', 'GIFT_CARD', 'NON_INVENTORY']);

// ─── demand series ────────────────────────────────────────────────────────────
export interface DemandOptions {
  /** Days of history used to learn the pattern. */
  lookbackDays?: number;
  /** Days the plan must cover. */
  horizonDays?: number;
  locationId?: string | null;
  /** Restrict the run to specific SKUs (a category-level buyer). */
  productIds?: string[] | null;
}

export interface DemandSeries {
  /** Day-indexed (0 = oldest) units sold per day. */
  daily: number[];
  /** Forecast for the horizon, built from the same weekday's history. */
  forecast: number[];
  total: number;
  avgPerDay: number;
  stdDevPerDay: number;
}

/**
 * Turn raw order lines into a per-product demand profile. Weekday seasonality is
 * kept because "closed on Monday" and "slow on Monday" need different orders.
 */
export function buildSeriesFromQuantities(buckets: { dayIndex: number; quantity: number }[], lookbackDays: number, horizonDays: number): DemandSeries {
  const daily = new Array(Math.max(1, lookbackDays)).fill(0);
  for (const b of buckets) {
    if (b.dayIndex >= 0 && b.dayIndex < daily.length) daily[b.dayIndex] += Math.max(0, Number(b.quantity) || 0);
  }
  const total = daily.reduce((a, b) => a + b, 0);
  const avgPerDay = total / daily.length;

  const byWeekday: number[][] = Array.from({ length: 7 }, () => []);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  daily.forEach((value, index) => {
    const date = new Date(start.getTime() - (daily.length - 1 - index) * DAY_MS);
    byWeekday[date.getDay()].push(value);
  });
  const weekdayMean = byWeekday.map((rows) => (rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : avgPerDay));

  const forecast: number[] = [];
  for (let i = 1; i <= Math.max(1, horizonDays); i++) {
    const date = new Date(start.getTime() + i * DAY_MS);
    forecast.push(round2(weekdayMean[date.getDay()]));
  }
  return { daily, forecast, total, avgPerDay: round2(avgPerDay), stdDevPerDay: round2(stdDev(daily)) };
}

export async function loadDemandSeries(organizationId: string, productId: string, options: DemandOptions = {}): Promise<DemandSeries> {
  const lookbackDays = Math.min(365, Math.max(7, Math.trunc(options.lookbackDays ?? 56)));
  const horizonDays = Math.min(120, Math.max(1, Math.trunc(options.horizonDays ?? 14)));
  const since = new Date(Date.now() - lookbackDays * DAY_MS);
  const items = await prisma.orderItem.findMany({
    where: { productId, order: { organizationId, status: { in: ['COMPLETED', 'PAID', 'FULFILLED'] }, completedAt: { gte: since }, ...(options.locationId ? { locationId: options.locationId } : {}) } },
    select: { quantity: true, order: { select: { completedAt: true } } },
    take: 20_000,
  });
  const buckets = items
    .filter((i) => i.order.completedAt)
    .map((i) => ({ dayIndex: Math.floor(((i.order.completedAt as Date).getTime() - since.getTime()) / DAY_MS), quantity: i.quantity }));
  return buildSeriesFromQuantities(buckets, lookbackDays, horizonDays);
}

/** Latest supplier per product, plus each supplier's observed lead time. */
async function loadSupplyProfile(organizationId: string): Promise<{ byProduct: Map<string, { supplierId: string; supplierName: string }>; leadTimeBySupplier: Map<string, number> }> {
  const [rows, suppliers] = await Promise.all([
    prisma.purchaseOrderItem.findMany({
      where: { purchaseOrder: { organizationId } },
      select: { productId: true, purchaseOrderId: true, purchaseOrder: { select: { supplierId: true, orderDate: true, receivedDate: true } } },
      take: 50_000,
    }),
    prisma.supplier.findMany({ where: { organizationId }, select: { id: true, name: true } }),
  ]);
  const names = new Map(suppliers.map((s) => [s.id, s.name]));
  const byProduct = new Map<string, { supplierId: string; supplierName: string }>();
  const samples = new Map<string, number[]>();
  for (const row of rows) {
    const po = row.purchaseOrder;
    if (!po?.supplierId) continue;
    byProduct.set(row.productId, { supplierId: po.supplierId, supplierName: names.get(po.supplierId) || 'Supplier' });
    if (po.receivedDate) {
      const days = Math.round((po.receivedDate.getTime() - po.orderDate.getTime()) / DAY_MS);
      if (days >= 0 && days <= 365) {
        const list = samples.get(po.supplierId) || [];
        list.push(days);
        samples.set(po.supplierId, list);
      }
    }
  }
  const leadTimeBySupplier = new Map<string, number>();
  for (const [supplierId, list] of samples) {
    leadTimeBySupplier.set(supplierId, Math.max(1, Math.round(list.reduce((a, b) => a + b, 0) / list.length)));
  }
  return { byProduct, leadTimeBySupplier };
}

export interface OrganizationPlan {
  inputs: ReplenishInput[];
  plan: PlanResult;
  horizonDays: number;
  lookbackDays: number;
}

/**
 * Assemble a real replenishment plan for a tenant: stocked SKUs with their stock
 * on hand, in-transit quantity, learned demand and observed supplier lead times.
 */
export async function buildReplenishmentPlan(organizationId: string, options: PlanOptions & DemandOptions = {}): Promise<OrganizationPlan> {
  const lookbackDays = Math.min(365, Math.max(7, Math.trunc(options.lookbackDays ?? 56)));
  const horizonDays = Math.min(120, Math.max(1, Math.trunc(options.horizonDays ?? 14)));
  const since = new Date(Date.now() - lookbackDays * DAY_MS);

  const [products, balances, supply, openItems, allItems] = await Promise.all([
    prisma.product.findMany({
      where: { organizationId, isActive: true, ...(options.productIds?.length ? { id: { in: options.productIds } } : {}) },
      select: { id: true, name: true, sku: true, price: true, costPrice: true, type: true },
      take: 5000,
    }),
    prisma.inventoryBalance.findMany({
      where: { product: { organizationId }, ...(options.locationId ? { locationId: options.locationId } : {}) },
      select: { productId: true, quantity: true, reserved: true, reorderPoint: true },
      take: 20_000,
    }),
    loadSupplyProfile(organizationId),
    prisma.purchaseOrderItem.findMany({
      where: { purchaseOrder: { organizationId, status: { in: ['DRAFT', 'SENT', 'PARTIAL'] } } },
      select: { productId: true, quantity: true, receivedQty: true },
      take: 20_000,
    }),
    prisma.orderItem.findMany({
      where: { order: { organizationId, status: { in: ['COMPLETED', 'PAID', 'FULFILLED'] }, completedAt: { gte: since }, ...(options.locationId ? { locationId: options.locationId } : {}) } },
      select: { productId: true, quantity: true, order: { select: { completedAt: true } } },
      take: 100_000,
    }),
  ]);

  const stock = new Map<string, { onHand: number; reserved: number }>();
  for (const b of balances) {
    const current = stock.get(b.productId) || { onHand: 0, reserved: 0 };
    stock.set(b.productId, { onHand: current.onHand + b.quantity, reserved: current.reserved + b.reserved });
  }
  const inTransit = new Map<string, number>();
  for (const item of openItems) {
    inTransit.set(item.productId, (inTransit.get(item.productId) || 0) + Math.max(0, item.quantity - item.receivedQty));
  }

  // One pass over the order history builds every product's day buckets.
  const buckets = new Map<string, { dayIndex: number; quantity: number }[]>();
  for (const item of allItems) {
    const at = item.order.completedAt;
    if (!at) continue;
    const dayIndex = Math.floor((at.getTime() - since.getTime()) / DAY_MS);
    const list = buckets.get(item.productId) || [];
    list.push({ dayIndex, quantity: item.quantity });
    buckets.set(item.productId, list);
  }

  const inputs: ReplenishInput[] = [];
  for (const product of products) {
    const type = String(product.type || 'PHYSICAL').toUpperCase();
    if (NON_STOCKED_TYPES.has(type)) continue;
    const series = buildSeriesFromQuantities(buckets.get(product.id) || [], lookbackDays, horizonDays);
    const unitCost = Number(product.costPrice) || 0;
    if (series.total <= 0 && unitCost <= 0) continue; // never sold, never bought: nothing to plan
    const linked = supply.byProduct.get(product.id) || null;
    inputs.push({
      productId: product.id,
      sku: product.sku || null,
      name: product.name,
      supplierId: linked?.supplierId ?? null,
      supplierName: linked?.supplierName ?? null,
      onHand: stock.get(product.id)?.onHand ?? 0,
      reserved: stock.get(product.id)?.reserved ?? 0,
      inTransit: inTransit.get(product.id) ?? 0,
      dailyForecast: series.forecast,
      dailyStdDev: series.stdDevPerDay,
      leadTimeDays: (linked && supply.leadTimeBySupplier.get(linked.supplierId)) || 7,
      unitCost,
      price: Number(product.price) || 0,
    });
  }

  return { inputs, plan: planReplenishment(inputs, options), horizonDays, lookbackDays };
}

/** Persist a plan as a DRAFT run the merchant can approve. */
export async function saveReplenishmentRun(
  organizationId: string,
  built: OrganizationPlan,
  options: { trigger?: 'MANUAL' | 'AUTO'; actorId?: string | null; guardrails?: Record<string, unknown> | null } = {}
) {
  const orderLines = built.plan.items.filter((i) => i.action === 'ORDER');
  return prisma.replenishmentRun.create({
    data: {
      organizationId,
      trigger: options.trigger || 'MANUAL',
      horizonDays: built.horizonDays,
      itemCount: orderLines.length,
      supplierCount: built.plan.bySupplier.filter((s) => s.lines > 0).length,
      estimatedCost: round2(built.plan.totals.cost),
      status: 'DRAFT',
      plan: toJson(built.plan),
      guardrails: jsonOrNull(options.guardrails),
      approvedBy: options.actorId ?? null,
    },
  });
}

/**
 * Turn an approved draft into real purchase orders — one per supplier, in one
 * transaction. The agent may draft; only this call creates a commitment.
 */
export async function approveReplenishmentRun(organizationId: string, runId: string, actorId: string | null) {
  const run = await prisma.replenishmentRun.findFirst({ where: { id: runId, organizationId } });
  if (!run) throw Object.assign(new Error('Replenishment run not found'), { status: 404 });
  if (run.status !== 'DRAFT') throw Object.assign(new Error(`This run is already ${run.status}`), { status: 409 });
  const plan = (run.plan || {}) as { items?: { productId: string; quantity: number; unitCost: number; supplierId: string | null; supplierName: string | null; name: string; action?: string }[] };
  const lines = (plan.items || []).filter((i) => !i.action || i.action === 'ORDER').filter((i) => Number(i.quantity) > 0);
  if (!lines.length) throw Object.assign(new Error('The plan has no lines to order'), { status: 400 });

  const knownSuppliers = await prisma.supplier.findMany({ where: { organizationId }, select: { id: true, name: true } });
  const byName = new Map(knownSuppliers.map((s) => [String(s.name).trim().toLowerCase(), s.id]));
  const knownIds = new Set(knownSuppliers.map((s) => s.id));

  const created = await prisma.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const line of lines) {
      const supplierId = line.supplierId && knownIds.has(line.supplierId) ? line.supplierId : line.supplierName ? byName.get(String(line.supplierName).trim().toLowerCase()) ?? null : null;
      if (!supplierId) continue; // an unassigned line cannot become a real order
      const product = await tx.product.findFirst({ where: { id: line.productId, organizationId }, select: { id: true } });
      if (!product) continue;
      const existing = await tx.purchaseOrder.findFirst({ where: { organizationId, supplierId, status: 'DRAFT', notes: `Replenishment run ${run.id}` }, select: { id: true } });
      const total = round2(Number(line.quantity) * Number(line.unitCost || 0));
      if (existing) {
        await tx.purchaseOrderItem.create({ data: { purchaseOrderId: existing.id, productId: line.productId, quantity: Math.trunc(line.quantity), unitCost: Number(line.unitCost || 0) } });
        await tx.purchaseOrder.update({ where: { id: existing.id }, data: { totalAmount: { increment: total } } });
        if (!ids.includes(existing.id)) ids.push(existing.id);
      } else {
        const po = await tx.purchaseOrder.create({
          data: {
            organizationId,
            supplierId,
            status: 'DRAFT',
            totalAmount: total,
            expectedDate: new Date(Date.now() + 7 * DAY_MS),
            notes: `Replenishment run ${run.id}`,
            items: { create: [{ productId: line.productId, quantity: Math.trunc(line.quantity), unitCost: Number(line.unitCost || 0) }] },
          },
        });
        ids.push(po.id);
      }
    }
    if (!ids.length) throw Object.assign(new Error('No supplier could be resolved for any line in this plan'), { status: 400 });
    await tx.replenishmentRun.update({ where: { id: run.id }, data: { status: 'APPROVED', approvedBy: actorId, approvedAt: new Date(), purchaseOrderIds: ids } });
    return ids;
  });

  return { purchaseOrderIds: created, lineCount: lines.length };
}

// ─── embedded finance ─────────────────────────────────────────────────────────
/**
 * Underwriting evidence, straight from the ledger: settled daily sales, refund
 * and chargeback rates, dormancy and existing debt service. Missing inputs stay
 * null so the decision can report its own confidence instead of guessing.
 */
export async function collectTradingMetrics(organizationId: string, windowDays = 180): Promise<TradingMetrics & { series: number[]; currency: string }> {
  const days = Math.min(730, Math.max(14, Math.trunc(windowDays)));
  const since = new Date(Date.now() - days * DAY_MS);
  const [org, orders, refundAggregate, chargebacks, completedPayments, facilities, settlement] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { currency: true, createdAt: true, countryCode: true } }),
    prisma.order.findMany({
      where: { organizationId, status: { in: ['COMPLETED', 'PAID', 'FULFILLED'] }, completedAt: { gte: since } },
      select: { totalAmount: true, completedAt: true },
      take: 50_000,
    }),
    prisma.refund.aggregate({ where: { organizationId, createdAt: { gte: since }, status: { in: ['APPROVED', 'PROCESSED'] } }, _sum: { amount: true } }),
    prisma.payment.count({ where: { order: { organizationId }, status: 'CHARGEBACK' } }),
    prisma.payment.count({ where: { order: { organizationId }, createdAt: { gte: since }, status: { in: ['COMPLETED', 'CAPTURED', 'SETTLED'] } } }),
    prisma.creditFacility.findMany({ where: { organizationId, status: { in: ['ACTIVE', 'APPROVED'] } }, select: { installmentAmount: true, outstanding: true } }),
    prisma.settlementBatch.findFirst({ where: { organizationId }, orderBy: { batchDate: 'desc' }, select: { batchDate: true } }),
  ]);
  const currency = String(org?.currency || 'USD').toUpperCase();

  const daily = new Array(days).fill(0) as number[];
  for (const order of orders) {
    if (!order.completedAt) continue;
    const index = Math.floor((order.completedAt.getTime() - since.getTime()) / DAY_MS);
    if (index >= 0 && index < days) daily[index] += Number(order.totalAmount);
  }
  const series = daily.map((v) => round2(v));
  const sum = series.reduce((a, b) => a + b, 0);
  const tradingDays = series.filter((v) => v > 0).length;
  const avg = sum / days;

  const refundTotal = round2(Number(refundAggregate._sum.amount || 0));

  const activeMonths = org?.createdAt ? Math.max(0, (Date.now() - org.createdAt.getTime()) / (30 * DAY_MS)) : 0;
  return {
    avgDailyNetSales: round2(avg),
    salesStdDev: round2(stdDev(series)),
    activeMonths: round2(activeMonths),
    refundRatePercent: sum > 0 ? round2((refundTotal / sum) * 100) : 0,
    chargebackRatePercent: completedPayments > 0 ? round2((chargebacks / completedPayments) * 100) : 0,
    dormantDayRatio: days > 0 ? round2(1 - tradingDays / days) : 1,
    existingMonthlyDebt: round2(facilities.reduce((a, f) => a + Number(f.installmentAmount || 0), 0)),
    staleSettlementDays: settlement?.batchDate ? Math.floor((Date.now() - settlement.batchDate.getTime()) / DAY_MS) : undefined,
    currency,
    series,
  };
}

export interface FacilityQuote {
  decision: UnderwritingDecision;
  metrics: TradingMetrics & { series: number[]; currency: string };
}

export async function quoteFacility(organizationId: string, windowDays = 180): Promise<FacilityQuote> {
  const metrics = await collectTradingMetrics(organizationId, windowDays);
  return { metrics, decision: underwrite(metrics) };
}

/** Open a facility: writes the amortisation schedule the sweep repays. */
export async function openCreditFacility(organizationId: string, input: { principal: number; termMonths: number; ratePercent: number; sweepPercent: number; actorId?: string | null }) {
  const principal = round2(Math.max(0, input.principal));
  const months = Math.max(1, Math.trunc(input.termMonths));
  const schedule = amortizeSchedule(principal, input.ratePercent, months, new Date());
  return prisma.$transaction(async (tx) => {
    const facility = await tx.creditFacility.create({
      data: {
        organizationId,
        status: 'ACTIVE',
        requestedAmount: principal,
        approvedLimit: principal,
        drawnAmount: principal,
        outstanding: principal,
        rate: round2(input.ratePercent),
        termMonths: months,
        installmentAmount: round2(schedule[0]?.total || 0),
        sweepPercent: round2(input.sweepPercent),
        openedAt: new Date(),
        nextDueDate: schedule[0]?.dueDate || null,
        decidedBy: input.actorId ?? null,
      },
    });
    await tx.loanRepayment.createMany({
      data: schedule.map((row) => ({
        facilityId: facility.id,
        organizationId,
        period: row.period,
        dueDate: row.dueDate,
        principal: row.principal,
        interest: row.interest,
        total: row.total,
        status: 'DUE',
      })),
    });
    return facility;
  });
}

/**
 * Sweep: take a share of yesterday's settled sales and apply it to the oldest
 * unpaid instalments. Cash the merchant already earned, not a new loan.
 */
export async function runSweepForFacility(facilityId: string, now: Date = new Date()): Promise<{ swept: number; sales: number; skipped: string | null }> {
  const facility = await prisma.creditFacility.findUnique({ where: { id: facilityId } });
  if (!facility || facility.status !== 'ACTIVE') return { swept: 0, sales: 0, skipped: 'not-active' };
  if (Number(facility.outstanding) <= 0) return { swept: 0, sales: 0, skipped: 'settled' };

  const from = facility.lastSweepAt || facility.openedAt || new Date(now.getTime() - DAY_MS);
  const orders = await prisma.order.findMany({
    where: { organizationId: facility.organizationId, status: { in: ['COMPLETED', 'PAID', 'FULFILLED'] }, completedAt: { gt: from, lte: now } },
    select: { totalAmount: true },
    take: 20_000,
  });
  const sales = round2(orders.reduce((a, o) => a + Number(o.totalAmount), 0));
  const target = round2(Math.min(Number(facility.outstanding), (sales * Number(facility.sweepPercent || 0)) / 100));
  if (target <= 0) {
    await prisma.creditFacility.update({ where: { id: facility.id }, data: { lastSweepAt: now } });
    return { swept: 0, sales, skipped: sales <= 0 ? 'no-sales' : 'nothing-owed' };
  }

  const rows = await prisma.loanRepayment.findMany({ where: { facilityId: facility.id, status: { in: ['DUE', 'PARTIAL', 'OVERDUE'] } }, orderBy: { period: 'asc' } });
  const { schedule, applied } = applySweep(
    rows.map((r) => ({ period: r.period, total: Number(r.total), paidAmount: Number(r.paidAmount), id: r.id })),
    target
  );
  let outstanding = round2(Number(facility.outstanding));
  await prisma.$transaction(async (tx) => {
    for (const row of schedule) {
      const paidDelta = round2(row.paidAmount - Number(rows.find((r) => r.id === row.id)?.paidAmount || 0));
      outstanding = round2(Math.max(0, outstanding - paidDelta));
      await tx.loanRepayment.update({ where: { id: row.id }, data: { paidAmount: row.paidAmount, status: row.status, paidAt: row.status === 'PAID' ? now : null } });
    }
    const next = await tx.loanRepayment.findFirst({ where: { facilityId: facility.id, status: { in: ['DUE', 'PARTIAL', 'OVERDUE'] } }, orderBy: { period: 'asc' }, select: { dueDate: true } });
    await tx.creditFacility.update({
      where: { id: facility.id },
      data: { outstanding, lastSweepAt: now, nextDueDate: next?.dueDate || null, status: outstanding <= 0.01 ? 'CLOSED' : 'ACTIVE', closedAt: outstanding <= 0.01 ? now : null },
    });
  });
  return { swept: applied, sales, skipped: null };
}

export async function runAllSweeps(limit = 200): Promise<number> {
  const facilities = await prisma.creditFacility.findMany({ where: { status: 'ACTIVE' }, select: { id: true }, take: limit });
  let processed = 0;
  for (const facility of facilities) {
    const result = await runSweepForFacility(facility.id);
    if (result.swept > 0 || !result.skipped) processed++;
  }
  return processed;
}

// ─── franchise royalties ──────────────────────────────────────────────────────
/** Close a royalty period from real sales, with the audit trail stored alongside. */
export async function accrueRoyalties(organizationId: string, periodStart: Date, periodEnd: Date) {
  const agreements = await prisma.franchiseAgreement.findMany({ where: { organizationId, status: 'ACTIVE' } });
  const created: { agreementId: string; entityCode: string; accrualId: string; royalty: number; total: number }[] = [];
  for (const agreement of agreements) {
    const orderWhere = {
      organizationId,
      status: { in: ['COMPLETED', 'PAID', 'FULFILLED'] },
      completedAt: { gte: periodStart, lt: periodEnd },
      ...(agreement.locationId ? { locationId: agreement.locationId } : {}),
    };
    const [aggregate, units] = await Promise.all([
      prisma.order.aggregate({ where: orderWhere, _sum: { totalAmount: true, taxAmount: true, tipAmount: true, discountAmount: true } }),
      prisma.orderItem.aggregate({ where: { order: orderWhere }, _sum: { quantity: true } }),
    ]);
    const grossSales = round2(Number(aggregate._sum.totalAmount || 0));
    const excludedByCategory: Record<string, number> = {};
    const exclusions = Array.isArray(agreement.exclusions) ? (agreement.exclusions as string[]) : [];
    for (const key of exclusions) {
      if (key === 'VAT' || key === 'TAX') excludedByCategory[key] = round2(Number(aggregate._sum.taxAmount || 0));
      else if (key === 'TIPS') excludedByCategory[key] = round2(Number(aggregate._sum.tipAmount || 0));
      else if (key === 'DISCOUNTS') excludedByCategory[key] = round2(Number(aggregate._sum.discountAmount || 0));
    }
    const result = computeRoyalty(
      {
        royaltyModel: agreement.royaltyModel as RoyaltyAgreement['royaltyModel'],
        royaltyPercent: Number(agreement.royaltyPercent),
        tiers: (agreement.tiers as RoyaltyAgreement['tiers']) || null,
        perItemFee: Number(agreement.perItemFee),
        fixedMonthly: Number(agreement.fixedMonthly),
        minimumMonthly: Number(agreement.minimumMonthly),
        marketingFundPercent: Number(agreement.marketingFundPercent),
        exclusions,
      },
      { grossSales, excludedByCategory, unitsSold: Number(units._sum.quantity || 0) }
    );
    const accrual = await prisma.royaltyAccrual.upsert({
      where: { agreementId_periodStart: { agreementId: agreement.id, periodStart } },
      create: {
        organizationId,
        agreementId: agreement.id,
        locationId: agreement.locationId,
        periodStart,
        periodEnd,
        grossSales: result.grossSales,
        taxableBase: result.taxableBase,
        unitsSold: result.unitsSold,
        royaltyAmount: result.royalty,
        marketingFundAmount: result.marketingFund,
        minimumApplied: result.minimumApplied,
        calculation: result.calculation,
      },
      update: {
        periodEnd,
        grossSales: result.grossSales,
        taxableBase: result.taxableBase,
        unitsSold: result.unitsSold,
        royaltyAmount: result.royalty,
        marketingFundAmount: result.marketingFund,
        minimumApplied: result.minimumApplied,
        calculation: result.calculation,
      },
    });
    created.push({ agreementId: agreement.id, entityCode: agreement.entityCode, accrualId: accrual.id, royalty: result.royalty, total: result.total });
  }
  return { period: periodLabel(periodStart), accruals: created, agreements: agreements.length };
}

/** Consolidated P&L across a tenant's own locations, intercompany eliminated. */
export async function consolidatedPnlFor(organizationId: string, from: Date, to: Date): Promise<{ entities: LocationPnl[]; consolidated: ReturnType<typeof consolidatePnl> }> {
  const locations = await prisma.location.findMany({ where: { organizationId, isActive: true }, select: { id: true, name: true } });
  const entities: LocationPnl[] = [];
  for (const location of locations) {
    const orderWhere = { organizationId, locationId: location.id, completedAt: { gte: from, lt: to }, status: { in: ['COMPLETED', 'PAID', 'FULFILLED'] } };
    const [orders, sold] = await Promise.all([
      prisma.order.aggregate({ where: orderWhere, _sum: { totalAmount: true } }),
      prisma.orderItem.findMany({ where: { order: orderWhere }, select: { quantity: true, product: { select: { costPrice: true } } }, take: 50_000 }),
    ]);
    const revenue = round2(Number(orders._sum.totalAmount || 0));
    const costOfGoods = round2(sold.reduce((a, row) => a + row.quantity * Number(row.product?.costPrice || 0), 0));
    entities.push({
      entityCode: location.name,
      revenue,
      costOfGoods,
      // Wage cost is apportioned below, once the network total is known.
      labour: 0,
      operatingExpenses: 0,
      intercompanyRevenue: 0,
      intercompanyCost: 0,
      labourHoursTracked: 0,
    });
  }
  // Wage cost is tracked on the employee, not the branch, so it is split across
  // locations by each one's share of sales - an estimate the UI labels as such.
  const wages = await labourCostFor(organizationId, from, to);
  const totalRevenue = entities.reduce((a, e) => a + e.revenue, 0);
  for (const entity of entities) {
    const share = totalRevenue > 0 ? entity.revenue / totalRevenue : entities.length ? 1 / entities.length : 0;
    entity.labour = round2(wages.cost * share);
    entity.labourHoursTracked = round2(wages.hours * share);
  }
  return { entities, consolidated: consolidatePnl(entities) };
}

/** A location's P&L row plus the hours behind its apportioned wage figure. */
export interface LocationPnl extends EntityPnl {
  labourHoursTracked: number;
}

/** Time-clock cost in a window: hours x each employee's recorded rate. */
async function labourCostFor(organizationId: string, from: Date, to: Date): Promise<{ hours: number; cost: number }> {
  const entries = await prisma.timeEntry.findMany({
    where: { employee: { organizationId }, clockIn: { gte: from, lt: to } },
    select: { clockIn: true, clockOut: true, employee: { select: { hourlyRate: true } } },
    take: 100_000,
  });
  let hours = 0;
  let cost = 0;
  for (const entry of entries) {
    if (!entry.clockOut) continue;
    const worked = Math.max(0, (entry.clockOut.getTime() - entry.clockIn.getTime()) / 3_600_000);
    hours += worked;
    cost += worked * Number(entry.employee?.hourlyRate || 0);
  }
  return { hours: round2(hours), cost: round2(cost) };
}

// ─── peer benchmarking ────────────────────────────────────────────────────────
export interface BenchmarkInput {
  organizationId: string;
  countryCode: string | null;
  industry: string;
  /** Metric value for this tenant, ready to join its cohort. */
  values: Record<string, number>;
  annualRevenue: number;
}

/**
 * Extract every benchmarkable metric for one tenant over a window. Kept separate
 * from the statistics so the same numbers can be published (anonymised) and shown
 * to their owner (exact).
 */
export async function extractOrgMetrics(organizationId: string, from: Date, to: Date): Promise<{ values: Record<string, number>; annualRevenue: number; countryCode: string | null; industry: string }> {
  const [org, orders] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { countryCode: true, industry: true, currency: true } }),
    prisma.order.findMany({
      where: { organizationId, status: { in: ['COMPLETED', 'PAID', 'FULFILLED'] }, completedAt: { gte: from, lte: to } },
      select: { id: true, totalAmount: true, discountAmount: true, channel: true, items: { select: { quantity: true, product: { select: { costPrice: true } } } } },
      take: 50_000,
    }),
  ]);
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS));
  const netSales = orders.reduce((a, o) => a + Number(o.totalAmount), 0);
  const grossDiscount = orders.reduce((a, o) => a + Number(o.discountAmount), 0);
  const units = orders.reduce((a, o) => a + o.items.reduce((s, i) => s + i.quantity, 0), 0);
  const cogs = orders.reduce((a, o) => a + o.items.reduce((s, i) => s + i.quantity * Number(i.product?.costPrice || 0), 0), 0);
  const digital = orders.filter((o) => String(o.channel || 'IN_STORE') !== 'IN_STORE').length;
  const annualRevenue = round2((netSales / days) * 365);

  return {
    annualRevenue,
    countryCode: org?.countryCode || null,
    industry: String(org?.industry || 'RETAIL').toUpperCase(),
    values: {
      avg_basket: orders.length ? round2(netSales / orders.length) : 0,
      gross_margin_pct: netSales > 0 ? round2(((netSales - cogs) / netSales) * 100) : 0,
      discount_rate_pct: netSales > 0 ? round2((grossDiscount / Math.max(1, netSales + grossDiscount)) * 100) : 0,
      attachment_rate: orders.length ? round2(units / orders.length) : 0,
      online_share_pct: orders.length ? round2((digital / orders.length) * 100) : 0,
      sales_per_day: round2(netSales / days),
    },
  };
}

export interface CohortCell {
  metricKey: string;
  cohort: CohortResult;
  key: string;
  size: number;
}

/**
 * Build one tenant's benchmark view. The cohort is every other active tenant in
 * the same market / industry / size band, and nothing is published unless
 * k-anonymity clears. Values are computed per request rather than cached, so a
 * small network can never leak a stale individual figure.
 */
export async function buildCohortForOrg(organizationId: string, metricKey: string, windowDays = 90): Promise<{ cell: CohortCell; selfValue: number | null; participation: { reporting: number; eligible: number } }> {
  const days = Math.min(365, Math.max(7, Math.trunc(windowDays)));
  const to = new Date();
  const from = new Date(to.getTime() - days * DAY_MS);
  const mine = await extractOrgMetrics(organizationId, from, to);
  const myKey = cohortKey(mine.countryCode, mine.industry, mine.annualRevenue);
  const selfValue = Number.isFinite(mine.values[metricKey]) ? mine.values[metricKey] : null;

  const peers = await prisma.organization.findMany({ where: { isActive: true, id: { not: organizationId } }, select: { id: true }, take: 500 });
  const values: number[] = [];
  let reporting = selfValue != null ? 1 : 0;
  for (const peer of peers) {
    const metrics = await extractOrgMetrics(peer.id, from, to);
    const value = metrics.values[metricKey];
    if (value == null || !Number.isFinite(value) || value <= 0) continue;
    reporting++;
    // Only true peers join the cohort: a different market, trade or size band is
    // not a comparison, it is a leak with extra steps.
    if (cohortKey(metrics.countryCode, metrics.industry, metrics.annualRevenue) === myKey) values.push(value);
  }
  const cohort = buildCohort(values, { metricKey, selfValue });
  return { cell: { metricKey, cohort, key: myKey, size: values.length }, selfValue, participation: { reporting, eligible: peers.length + 1 } };
}

/** Fiscal profile for a tenant, used by several routers to label the UI. */
export async function orgProfile(organizationId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { countryCode: true, currency: true, industry: true, name: true } });
  return {
    countryCode: org?.countryCode || null,
    currency: String(org?.currency || 'USD').toUpperCase(),
    industry: String(org?.industry || 'RETAIL').toUpperCase(),
    name: org?.name || '',
    fiscal: fiscalProfileFor(org?.countryCode),
  };
}

/** Revenue band label shown next to a benchmark, so size comparison is explicit. */
export function bandFor(annualRevenue: number): string {
  return revenueBand(Number(annualRevenue) || 0);
}

// ─── fiscalization backfill ───────────────────────────────────────────────────
/**
 * Seal completed sales that never made it onto the chain - the safety net under
 * the checkout hook. A missed seal is a compliance finding in a fiscalised
 * market, so the scheduler re-scans recent orders rather than trusting that
 * every path through the code remembered to seal.
 *
 * Returns the number of documents created. A tenant with no fiscal device for a
 * device-required regime is skipped and stays visible to /api/fiscal/status.
 */
export async function backfillFiscalSeals(lookbackDays = 3, limit = 200): Promise<number> {
  const since = new Date(Date.now() - Math.max(1, lookbackDays) * DAY_MS);
  const candidates = await prisma.order.findMany({
    where: { status: { in: ['COMPLETED', 'PAID', 'FULFILLED'] }, completedAt: { gte: since } },
    select: { id: true, orderNumber: true, totalAmount: true, taxAmount: true, currency: true, locationId: true, employeeId: true, completedAt: true, organization: { select: { id: true, countryCode: true } } },
    orderBy: { completedAt: 'asc' },
    take: limit,
  });
  if (!candidates.length) return 0;
  const sealed = await prisma.fiscalDocument.findMany({
    where: { orderId: { in: candidates.map((c) => c.id) } },
    select: { orderId: true },
  });
  const done = new Set(sealed.map((s) => s.orderId));
  let created = 0;
  for (const order of candidates) {
    if (done.has(order.id)) continue;
    const organizationId = order.organization?.id;
    if (!organizationId) continue;
    try {
      const result = await sealOrder({
        organizationId,
        countryCode: order.organization.countryCode,
        locationId: order.locationId,
        orderId: order.id,
        receiptNumber: order.orderNumber,
        documentType: 'RECEIPT',
        total: Number(order.totalAmount),
        vatTotal: Number(order.taxAmount || 0),
        currency: order.currency,
        cashierId: order.employeeId,
        issuedAt: order.completedAt || undefined,
      });
      if (!result.recreated) created++;
    } catch (error) {
      // A missing fiscal device is a configuration gap the status endpoint
      // reports; it must not stop the rest of the backfill.
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[fiscal-backfill] order ${order.orderNumber} skipped: ${message}`);
    }
  }
  return created;
}
