/**
 * Labour: worked hours, overtime, roster conflicts, availability, coverage.
 *
 * Square, Toast, Lightspeed, Revel, MICROS and Aloha all schedule staff and cost
 * the schedule before publishing it. The data existed here (TimeEntry + hours +
 * hourlyRate) but nothing turned it into a roster. This module is the arithmetic
 * half — pure, testable, with no notion of a database.
 *
 * Jurisdiction caveat: overtime is a policy input, not a legal opinion. Defaults
 * are the US federal 40h/week rule; callers pass daily thresholds where local
 * law differs (e.g. 8h/day in California).
 */

export function round2(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export interface TimeEntryLike {
  clockIn: Date | string;
  clockOut?: Date | string | null;
  breakStart?: Date | string | null;
  breakEnd?: Date | string | null;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Decimal hours for one entry, breaks deducted. A live shift ends at `now`. */
export function entryHours(entry: TimeEntryLike, now: Date = new Date()): number {
  const start = toDate(entry.clockIn);
  if (!start) return 0;
  const end = toDate(entry.clockOut) ?? now;
  const grossMs = Math.max(0, end.getTime() - start.getTime());

  const bs = toDate(entry.breakStart);
  const be = toDate(entry.breakEnd) ?? (bs && !entry.breakEnd ? now : null);
  const breakMs = bs && be ? Math.max(0, be.getTime() - bs.getTime()) : 0;

  return round2((grossMs - breakMs) / 3_600_000);
}

/** Sum entries, grouping by ISO date (local) so per-day rules can apply. */
export function hoursByDay(entries: TimeEntryLike[], now: Date = new Date()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries ?? []) {
    const start = toDate(e.clockIn);
    if (!start) continue;
    const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    out[key] = round2((out[key] ?? 0) + entryHours(e, now));
  }
  return out;
}

export interface OvertimeRules {
  /** Weekly threshold, typically 40. Pass 0 to disable. */
  weeklyThreshold?: number;
  /** Daily threshold, e.g. 8 in CA. Pass 0 to disable. */
  dailyThreshold?: number;
  /** Overtime multiplier used for costing, typically 1.5. */
  multiplier?: number;
}

export interface OvertimeSplit {
  regularHours: number;
  overtimeHours: number;
  totalHours: number;
}

/**
 * Split a day's hours into regular and overtime. Daily OT is computed first,
 * then the week is topped up to the weekly threshold — the combination both
 * California and the FLSA require, without double counting.
 */
export function splitOvertime(
  daily: number[],
  rules: OvertimeRules = {},
): OvertimeSplit {
  const weeklyThreshold = rules.weeklyThreshold ?? 40;
  const dailyThreshold = rules.dailyThreshold ?? 0;

  let regular = 0;
  let overtime = 0;

  for (const h of daily ?? []) {
    const hours = Math.max(0, Number(h) || 0);
    if (dailyThreshold > 0 && hours > dailyThreshold) {
      regular += dailyThreshold;
      overtime += hours - dailyThreshold;
    } else {
      regular += hours;
    }
  }

  if (weeklyThreshold > 0 && regular > weeklyThreshold) {
    const excess = regular - weeklyThreshold;
    regular -= excess;
    overtime += excess;
  }

  return {
    regularHours: round2(regular),
    overtimeHours: round2(overtime),
    totalHours: round2(regular + overtime),
  };
}

/** Cost of a shift: regular at base rate, overtime at the multiplier. */
export function labourCost(split: OvertimeSplit, hourlyRate: number, multiplier = 1.5): number {
  const rate = Number(hourlyRate) || 0;
  return round2(split.regularHours * rate + split.overtimeHours * rate * multiplier);
}

export interface ShiftLike {
  id?: string;
  employeeId: string;
  startAt: Date | string;
  endAt: Date | string;
  breakMinutes?: number;
  status?: string;
}

export interface Conflict {
  a: string;
  b: string;
  employeeId: string;
  reason: 'OVERLAP' | 'INSUFFICIENT_REST' | 'TOO_LONG' | 'PAST_END';
  detail: string;
}

/** Paid hours of a rostered shift, breaks removed. */
export function shiftHours(shift: ShiftLike): number {
  const s = toDate(shift.startAt);
  const e = toDate(shift.endAt);
  if (!s || !e) return 0;
  const minutes = (e.getTime() - s.getTime()) / 60000 - (Number(shift.breakMinutes) || 0);
  return round2(Math.max(0, minutes) / 60);
}

/**
 * Roster problems a manager should see before publishing: the same person
 * double-booked, a shift ending after another begins with too little rest
 * (default 11h), a shift that is implausibly long, or an end before its start.
 * Cancelled shifts are ignored.
 */
export function detectConflicts(shifts: ShiftLike[], options: { minRestHours?: number; maxShiftHours?: number } = {}): Conflict[] {
  const minRest = options.minRestHours ?? 11;
  const maxShift = options.maxShiftHours ?? 16;
  const conflicts: Conflict[] = [];

  const live = (shifts ?? []).filter((s) => String(s.status ?? 'PUBLISHED') !== 'CANCELLED');
  const byEmployee = new Map<string, ShiftLike[]>();
  for (const s of live) {
    const arr = byEmployee.get(s.employeeId) ?? [];
    arr.push(s);
    byEmployee.set(s.employeeId, arr);
  }

  for (const [employeeId, list] of byEmployee) {
    for (const s of list) {
      const start = toDate(s.startAt);
      const end = toDate(s.endAt);
      if (start && end && end.getTime() <= start.getTime()) {
        conflicts.push({
          a: String(s.id ?? ''), b: String(s.id ?? ''), employeeId, reason: 'PAST_END',
          detail: 'Shift ends before it starts',
        });
      } else if (shiftHours(s) > maxShift) {
        conflicts.push({
          a: String(s.id ?? ''), b: String(s.id ?? ''), employeeId, reason: 'TOO_LONG',
          detail: `Shift is ${shiftHours(s)}h (max ${maxShift}h)`,
        });
      }
    }

    const sorted = [...list].sort(
      (x, y) => (toDate(x.startAt)?.getTime() ?? 0) - (toDate(y.startAt)?.getTime() ?? 0),
    );
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const aEnd = toDate(sorted[i].endAt)?.getTime() ?? 0;
        const bStart = toDate(sorted[j].startAt)?.getTime() ?? 0;
        if (bStart < aEnd) {
          conflicts.push({
            a: String(sorted[i].id ?? ''), b: String(sorted[j].id ?? ''), employeeId,
            reason: 'OVERLAP', detail: 'Shifts overlap',
          });
        } else if ((bStart - aEnd) / 3_600_000 < minRest) {
          conflicts.push({
            a: String(sorted[i].id ?? ''), b: String(sorted[j].id ?? ''), employeeId,
            reason: 'INSUFFICIENT_REST',
            detail: `Only ${round2((bStart - aEnd) / 3_600_000)}h rest (min ${minRest}h)`,
          });
        }
      }
    }
  }
  return conflicts;
}

export interface AvailabilityWindow {
  employeeId?: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface AvailabilityViolation {
  employeeId: string;
  shiftId?: string;
  weekday: number;
  detail: string;
}

/**
 * Shifts that fall outside the employee's declared availability. Only windows
 * for the matching employee (or global windows with no employeeId) count; an
 * employee with no declarations is unrestricted.
 */
export function availabilityViolations(shifts: ShiftLike[], windows: AvailabilityWindow[]): AvailabilityViolation[] {
  const out: AvailabilityViolation[] = [];
  const byEmployee = new Map<string, AvailabilityWindow[]>();

  for (const w of windows ?? []) {
    if (!w.employeeId) continue;
    const arr = byEmployee.get(w.employeeId) ?? [];
    arr.push(w);
    byEmployee.set(w.employeeId, arr);
  }

  for (const s of shifts ?? []) {
    const decl = byEmployee.get(s.employeeId);
    if (!decl || decl.length === 0) continue;

    const start = toDate(s.startAt);
    const end = toDate(s.endAt);
    if (!start || !end) continue;

    const weekday = start.getDay();
    const startMinute = start.getHours() * 60 + start.getMinutes();
    const endMinute = end.getHours() * 60 + end.getMinutes();

    const covered = decl.some(
      (w) => w.weekday === weekday && w.startMinute <= startMinute && w.endMinute >= endMinute,
    );
    if (!covered) {
      out.push({
        employeeId: s.employeeId,
        shiftId: s.id,
        weekday,
        detail: 'Shift falls outside declared availability',
      });
    }
  }
  return out;
}

export interface CoverageRequirement {
  weekday: number;
  startMinute: number;
  endMinute: number;
  minHeadcount: number;
}

/**
 * Where the roster is short. A shift covers a requirement when it overlaps the
 * window at all; overlapping shifts count once per employee, so two shifts by
 * the same person do not fake coverage.
 */
export function coverageGaps(
  shifts: ShiftLike[],
  requirements: CoverageRequirement[],
): { weekday: number; startMinute: number; endMinute: number; required: number; scheduled: number; shortBy: number }[] {
  const gaps: { weekday: number; startMinute: number; endMinute: number; required: number; scheduled: number; shortBy: number }[] = [];

  for (const req of requirements ?? []) {
    const covering = new Set<string>();
    for (const s of shifts ?? []) {
      if (String(s.status ?? '') === 'CANCELLED') continue;
      const start = toDate(s.startAt);
      const end = toDate(s.endAt);
      if (!start || !end) continue;
      if (start.getDay() !== req.weekday) continue;

      const sMin = start.getHours() * 60 + start.getMinutes();
      const eMin = end.getHours() * 60 + end.getMinutes();
      const overlaps = Math.max(sMin, req.startMinute) < Math.min(eMin, req.endMinute);
      if (overlaps) covering.add(s.employeeId);
    }
    const scheduled = covering.size;
    if (scheduled < req.minHeadcount) {
      gaps.push({
        weekday: req.weekday,
        startMinute: req.startMinute,
        endMinute: req.endMinute,
        required: req.minHeadcount,
        scheduled,
        shortBy: req.minHeadcount - scheduled,
      });
    }
  }
  return gaps;
}

/** Labour as a percentage of net sales — the number operators actually watch. */
export function labourPercent(cost: number, netSales: number): number | null {
  const sales = Number(netSales);
  if (!Number.isFinite(sales) || sales <= 0) return null;
  return round2(((Number(cost) || 0) / sales) * 100);
}

/** SPLH (sales per labour hour), used to compare rosters across days. */
export function salesPerLabourHour(netSales: number, hours: number): number | null {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return null;
  return round2((Number(netSales) || 0) / h);
}
