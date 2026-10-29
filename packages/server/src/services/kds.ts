/**
 * Kitchen display routing and course pacing (§17).
 *
 * A KDS that shows every ticket in one queue is a wall of text. Toast, Aloha,
 * Revel and MICROS route each item to the station that cooks it (grill, fry,
 * cold, bar, pass) and pace tickets by course so mains are not fired while the
 * appetisers are still on the pass.
 *
 * This module owns both decisions. Pure: no Prisma, no I/O.
 */

export interface StationLike {
  id: string;
  name: string;
  kind?: string | null;
  categoryIds?: string[] | null;
  targetPrepMinutes?: number | null;
  isActive?: boolean;
}

export interface RoutableItem {
  id?: string;
  productId: string;
  productName?: string;
  categoryId?: string | null;
  modifiers?: { name?: string }[] | null;
  quantity?: number;
}

export interface StationRoute {
  stationId: string | null;
  stationName: string | null;
  targetPrepMinutes: number;
  /** Why this station won, for KDS debugging and merchant trust. */
  matchedBy: 'CATEGORY' | 'MODIFIER' | 'FALLBACK' | 'NONE';
}

const DEFAULT_PREP_MINUTES = 10;

/**
 * Route one item to a station.
 *
 * Precedence: an explicit modifier rule (a `BAR` modifier sends a drink to the
 * bar regardless of its menu category), then the station that claims the
 * category, then the first active station, then nothing.
 */
export function routeItem(item: RoutableItem, stations: StationLike[]): StationRoute {
  const active = (stations ?? []).filter((s) => s.isActive !== false);
  if (active.length === 0) {
    return { stationId: null, stationName: null, targetPrepMinutes: DEFAULT_PREP_MINUTES, matchedBy: 'NONE' };
  }

  const modifierNames = (item.modifiers ?? []).map((m) => String(m?.name ?? '').toUpperCase()).join(' ');
  if (modifierNames) {
    const byModifier = active.find((s) => {
      const kind = String(s.kind ?? '').toUpperCase();
      return kind && modifierNames.includes(kind);
    });
    if (byModifier) {
      return {
        stationId: byModifier.id,
        stationName: byModifier.name,
        targetPrepMinutes: Number(byModifier.targetPrepMinutes) || DEFAULT_PREP_MINUTES,
        matchedBy: 'MODIFIER',
      };
    }
  }

  if (item.categoryId) {
    const byCategory = active.find((s) => (s.categoryIds ?? []).includes(String(item.categoryId)));
    if (byCategory) {
      return {
        stationId: byCategory.id,
        stationName: byCategory.name,
        targetPrepMinutes: Number(byCategory.targetPrepMinutes) || DEFAULT_PREP_MINUTES,
        matchedBy: 'CATEGORY',
      };
    }
  }

  const fallback = active[0];
  return {
    stationId: fallback.id,
    stationName: fallback.name,
    targetPrepMinutes: Number(fallback.targetPrepMinutes) || DEFAULT_PREP_MINUTES,
    matchedBy: 'FALLBACK',
  };
}

export interface KitchenTicketItem extends RoutableItem {
  status?: string;
  course?: number;
}

/** Items grouped by station name, preserving input order within each station. */
export function groupByStation(items: KitchenTicketItem[], stations: StationLike[]): Record<string, KitchenTicketItem[]> {
  const out: Record<string, KitchenTicketItem[]> = {};
  for (const item of items ?? []) {
    const route = routeItem(item, stations);
    const key = route.stationName ?? 'Unrouted';
    (out[key] ??= []).push(item);
  }
  return out;
}

export interface CoursePlanItem {
  itemId: string;
  course: number;
  fire: boolean;
}

/**
 * Decide which items to fire now.
 *
 * - No `fireCourse` means "fire everything not already sent" (the initial send).
 * - A numeric `fireCourse` fires only that course — the standard
 *   "start the mains when the appetisers are cleared" gesture.
 * - Items already sent (status beyond PENDING) are never re-fired.
 */
export function planCourseFire(
  items: (KitchenTicketItem & { id: string; status?: string })[],
  fireCourse?: number | null,
): CoursePlanItem[] {
  return (items ?? []).map((item) => {
    const status = String(item.status ?? 'PENDING').toUpperCase();
    const alreadySent = status !== 'PENDING';
    const course = Number(item.course) || 1;
    const fire = !alreadySent && (fireCourse === null || fireCourse === undefined || course === Number(fireCourse));
    return { itemId: item.id, course, fire };
  });
}

export type SlaStatus = 'ON_TIME' | 'AT_RISK' | 'LATE';

/**
 * Ticket age against its target. AT_RISK is the last 20% of the window, which is
 * when an expo should chase the station rather than after the food is late.
 */
export function slaStatus(ageMinutes: number, targetPrepMinutes: number): SlaStatus {
  const age = Math.max(0, Number(ageMinutes) || 0);
  const target = Math.max(1, Number(targetPrepMinutes) || DEFAULT_PREP_MINUTES);
  if (age > target) return 'LATE';
  if (age >= target * 0.8) return 'AT_RISK';
  return 'ON_TIME';
}

/** Minutes a ticket has been open, floored at 0. */
export function ticketAgeMinutes(openedAt: Date | string, now: Date = new Date()): number {
  const start = openedAt instanceof Date ? openedAt : new Date(openedAt);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / 60000));
}

/** Average ticket time for a set of ready tickets, in minutes. */
export function averageTicketMinutes(
  tickets: { createdAt: Date | string; readyAt?: Date | string | null }[],
): number | null {
  const spans: number[] = [];
  for (const t of tickets ?? []) {
    if (!t.readyAt) continue;
    const created = new Date(t.createdAt).getTime();
    const ready = new Date(t.readyAt).getTime();
    if (Number.isFinite(created) && Number.isFinite(ready) && ready > created) {
      spans.push((ready - created) / 60000);
    }
  }
  if (spans.length === 0) return null;
  return Math.round((spans.reduce((s, v) => s + v, 0) / spans.length) * 10) / 10;
}
