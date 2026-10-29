/**
 * Tip pooling and distribution (§7 tips, labour compliance).
 *
 * Toast, Aloha, Revel and MICROS all distribute a tip pool by hours, sales or
 * role points — and all of them are audited on one thing: the distributed total
 * must equal the pool exactly. This module allocates with the largest-remainder
 * method so 100.00 split three ways is 33.34 / 33.33 / 33.33, never 99.99.
 *
 * Pure: no Prisma, no I/O. The route supplies participants and persists the
 * resulting TipDistribution rows.
 */

export function round2(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export type PoolMethod = 'EQUAL' | 'HOURS' | 'SALES' | 'POINTS';

export interface PoolParticipant {
  employeeId: string;
  hours?: number;
  sales?: number;
  role?: string;
  name?: string;
}

export type PoolError =
  | { ok: false; reason: 'NO_PARTICIPANTS' }
  | { ok: false; reason: 'NO_WEIGHTS' }
  | { ok: false; reason: 'NO_POOL' };

export interface PoolAllocation {
  employeeId: string;
  name?: string;
  weight: number;
  share: number;
  /** Weight share of the pool as a percentage, for the payroll export. */
  sharePct: number;
}

export interface PoolResult {
  ok: true;
  method: PoolMethod;
  pool: number;
  allocations: PoolAllocation[];
  distributed: number;
  /** Always 0; carried so the caller can assert the invariant. */
  roundingDrift: number;
}

/** Weight an employee carries for a given method. */
export function weightFor(p: PoolParticipant, method: PoolMethod, rolePoints?: Record<string, number> | null): number {
  const hours = Math.max(0, Number(p.hours) || 0);
  const sales = Math.max(0, Number(p.sales) || 0);

  switch (method) {
    case 'EQUAL':
      return 1;
    case 'HOURS':
      // Sub-hour precision matters: a 3.75h closer earns 3.75 shares.
      return Math.round(hours * 100) / 100;
    case 'SALES':
      return Math.round(sales * 100) / 100;
    case 'POINTS':
      return rolePoints && p.role ? Math.max(0, Number(rolePoints[p.role]) || 0) : 0;
    default:
      return 0;
  }
}

/**
 * Split a pool across participants.
 *
 * Participants whose weight is 0 are dropped (a busser with no hours this week
 * gets nothing, rather than an equal share of a pool they did not earn). If
 * nobody carries weight the call fails loudly instead of splitting evenly —
 * silently redistributing money is how payroll disputes start.
 */
export function allocateTips(
  poolAmount: number,
  participants: PoolParticipant[],
  method: PoolMethod,
  options: { rolePoints?: Record<string, number> | null; minHoursPerShift?: number } = {},
): PoolResult | PoolError {
  const pool = round2(poolAmount);
  if (pool <= 0) return { ok: false, reason: 'NO_POOL' };

  const minHours = Number(options.minHoursPerShift) || 0;
  const eligible = (participants ?? []).filter((p) => (Number(p.hours) || 0) >= minHours);
  if (eligible.length === 0) return { ok: false, reason: 'NO_PARTICIPANTS' };

  const weighted = eligible
    .map((p) => ({ p, weight: weightFor(p, method, options.rolePoints) }))
    .filter((x) => x.weight > 0);

  if (weighted.length === 0) return { ok: false, reason: 'NO_WEIGHTS' };

  const totalWeight = weighted.reduce((s, x) => s + x.weight, 0);
  const raw = weighted.map((x) => ({
    employeeId: x.p.employeeId,
    name: x.p.name,
    weight: x.weight,
    exact: (x.weight / totalWeight) * pool,
  }));

  // Largest remainder, in cents.
  const cents = raw.map((r) => ({ ...r, floor: Math.floor(r.exact * 100 + 1e-9) }));
  let assigned = cents.reduce((s, r) => s + r.floor, 0);
  let remainder = Math.round(pool * 100) - assigned;

  const order = cents
    .map((r, i) => ({ i, frac: r.exact * 100 - r.floor, employeeId: r.employeeId }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const bonus = new Map<string, number>();
  for (const entry of order) {
    if (remainder <= 0) break;
    bonus.set(entry.employeeId, 1);
    remainder -= 1;
  }

  const allocations: PoolAllocation[] = cents.map((r) => {
    const centsTotal = r.floor + (bonus.get(r.employeeId) ?? 0);
    return {
      employeeId: r.employeeId,
      name: r.name,
      weight: r.weight,
      share: round2(centsTotal / 100),
      sharePct: round2((r.weight / totalWeight) * 100),
    };
  });

  const distributed = round2(allocations.reduce((s, a) => s + a.share, 0));
  return {
    ok: true,
    method,
    pool,
    allocations,
    distributed,
    roundingDrift: round2(pool - distributed),
  };
}

export interface TipRecordLike {
  employeeId: string;
  amount: number | string;
  type?: string;
}

/**
 * Total tips per employee for a period, optionally excluding cash or card.
 * Cash tips are often pooled separately (or not at all) because they never hit
 * the acquirer.
 */
export function tipsByEmployee(
  tips: TipRecordLike[],
  options: { includeCash?: boolean; includeCard?: boolean } = {},
): Record<string, number> {
  const includeCash = options.includeCash !== false;
  const includeCard = options.includeCard !== false;
  const out: Record<string, number> = {};

  for (const t of tips ?? []) {
    const type = String(t.type ?? 'CARD').toUpperCase();
    const isCash = type === 'CASH';
    if (isCash && !includeCash) continue;
    if (!isCash && !includeCard) continue;
    const amount = Number(t.amount) || 0;
    if (amount <= 0) continue;
    out[t.employeeId] = round2((out[t.employeeId] ?? 0) + amount);
  }
  return out;
}

/** Total pool for a period. */
export function totalTips(tips: TipRecordLike[], options: { includeCash?: boolean; includeCard?: boolean } = {}): number {
  const byEmployee = tipsByEmployee(tips, options);
  return round2(Object.values(byEmployee).reduce((s, v) => s + v, 0));
}

/**
 * Tip-out from a service pool to support staff: a fixed percentage of the pool
 * is set aside for bussers/kitchen, the rest stays with the servers.
 * Percentages are clamped to 0–100 so a mis-keyed 150 cannot create money.
 */
export function tipOutSplit(pool: number, tipOutPct: number): { serviceShare: number; supportShare: number } {
  const total = round2(pool);
  const pct = Math.min(100, Math.max(0, Number(tipOutPct) || 0));
  const supportShare = round2(total * pct / 100);
  return { serviceShare: round2(total - supportShare), supportShare };
}
