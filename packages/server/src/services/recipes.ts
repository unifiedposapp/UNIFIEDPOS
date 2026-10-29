/**
 * Recipe / bill-of-materials costing and depletion (§17 food cost).
 *
 * `Product.costPrice` is what a reseller pays for a finished good. A kitchen
 * sells a composed plate, so its real cost is the summed cost of its
 * ingredients (plus waste). This module produces both:
 *   • `rollupRecipeCost`  — plate cost, per-line contribution, sale price margin;
 *   • `explodeRecipe`     — the inventory depletion plan written when a plate sells.
 *
 * Sub-recipes are supported (a sauce is itself a recipe) with an explicit
 * cycle guard, because a menu with a self-referencing BOM would otherwise
 * recurse forever inside an order transaction.
 *
 * Pure: no Prisma, no I/O. The route loads components and calls in.
 */

/** Round to 4dp — ingredient costs need more headroom than currency. */
export function round4(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 10000) / 10000;
}

export function round2(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export interface RecipeLineInput {
  componentProductId: string;
  /** Quantity of the component in `unit`. */
  quantity: number;
  unit?: string;
  /** Trim/evaporation/spillage uplift, expressed as a percentage. */
  wastePct?: number;
}

export interface RecipeInput {
  productId: string;
  /** How many sellable units this recipe produces (batching). */
  yieldQty?: number;
  lines: RecipeLineInput[];
}

export interface ComponentInfo {
  id: string;
  name?: string;
  /** Cost per ONE `unit` of the component. */
  cost: number;
  unit?: string;
}

export type RecipeCostError =
  | { ok: false; reason: 'NO_LINES' }
  | { ok: false; reason: 'UNKNOWN_COMPONENT'; componentProductId: string }
  | { ok: false; reason: 'CYCLE'; path: string[] }
  | { ok: false; reason: 'DEPTH_EXCEEDED' };

export interface RecipeCostLine {
  componentProductId: string;
  name: string;
  quantity: number;
  unit: string;
  wastePct: number;
  /** quantity * (1 + waste) * component cost. */
  cost: number;
  /** True when the component is itself a recipe (its cost was rolled up). */
  composed: boolean;
}

export interface RecipeCostResult {
  ok: true;
  productId: string;
  yieldQty: number;
  /** Cost of the whole batch. */
  batchCost: number;
  /** Cost of ONE sellable unit (batchCost / yieldQty) — the plate cost. */
  unitCost: number;
  lines: RecipeCostLine[];
}

const MAX_DEPTH = 6;

/**
 * Roll a recipe up into a plate cost, resolving sub-recipes.
 *
 * `components` maps component product id → cost per unit. When a component is
 * itself a recipe, its rolled-up unit cost wins over any catalog cost (the
 * catalog cost of a sauce is meaningless if you make it in house).
 */
export function rollupRecipeCost(
  recipe: RecipeInput,
  components: Map<string, ComponentInfo>,
  subRecipes: Map<string, RecipeInput> = new Map(),
  path: string[] = [],
  depth = 0,
): RecipeCostResult | RecipeCostError {
  if (!recipe.lines || recipe.lines.length === 0) return { ok: false, reason: 'NO_LINES' };
  if (depth > MAX_DEPTH) return { ok: false, reason: 'DEPTH_EXCEEDED' };
  if (path.includes(recipe.productId)) return { ok: false, reason: 'CYCLE', path: [...path, recipe.productId] };

  const trail = [...path, recipe.productId];
  const lines: RecipeCostLine[] = [];
  let batchCost = 0;

  for (const line of recipe.lines) {
    const component = components.get(line.componentProductId);
    const sub = subRecipes.get(line.componentProductId);
    let unitCost: number;

    if (sub) {
      const subCost = rollupRecipeCost(sub, components, subRecipes, trail, depth + 1);
      if (!subCost.ok) return subCost;
      unitCost = subCost.unitCost;
    } else if (component) {
      unitCost = Number(component.cost) || 0;
    } else {
      return { ok: false, reason: 'UNKNOWN_COMPONENT', componentProductId: line.componentProductId };
    }

    const qty = Number(line.quantity) || 0;
    const waste = Math.max(0, Number(line.wastePct) || 0);
    // Waste uplift first, then cost: 100g at 8% waste buys 108g.
    const effectiveQty = round4(qty * (1 + waste / 100));
    const cost = round4(effectiveQty * unitCost);
    batchCost += cost;

    lines.push({
      componentProductId: line.componentProductId,
      name: component?.name ?? line.componentProductId,
      quantity: round4(qty),
      unit: line.unit ?? component?.unit ?? 'EACH',
      wastePct: round2(waste),
      cost,
      composed: Boolean(sub),
    });
  }

  const yieldQty = Number(recipe.yieldQty) > 0 ? Number(recipe.yieldQty) : 1;
  return {
    ok: true,
    productId: recipe.productId,
    yieldQty,
    batchCost: round4(batchCost),
    unitCost: round4(batchCost / yieldQty),
    lines,
  };
}

export interface DepletionLine {
  componentProductId: string;
  quantity: number;
  unit: string;
}

/**
 * Explode a sale into inventory movements. `soldQty` is in sellable units, so a
 * recipe yielding 10 portions sold 3 times depletes 3/10 of the batch.
 * Waste is part of the depletion: you cannot un-throw-away the trim.
 */
export function explodeRecipe(recipe: RecipeInput, soldQty: number): DepletionLine[] {
  const yieldQty = Number(recipe.yieldQty) > 0 ? Number(recipe.yieldQty) : 1;
  const multiplier = (Number(soldQty) || 0) / yieldQty;
  // Keyed by product AND unit: the same ingredient can legitimately appear as
  // `100 G` on one line and `0.02 KG` on another. Keying by product alone would
  // let the second line overwrite the first and under-deplete stock; keeping
  // both lets the caller convert each draw to the balance's unit.
  const merged = new Map<string, DepletionLine>();

  for (const line of recipe.lines) {
    const qty = Number(line.quantity) || 0;
    const waste = Math.max(0, Number(line.wastePct) || 0);
    const amount = round4(qty * (1 + waste / 100) * multiplier);
    if (amount <= 0) continue;

    const unit = line.unit ?? 'EACH';
    const key = `${line.componentProductId}::${unit}`;
    const existing = merged.get(key);
    if (existing) existing.quantity = round4(existing.quantity + amount);
    else merged.set(key, { componentProductId: line.componentProductId, quantity: amount, unit });
  }

  return [...merged.values()];
}

/** Food cost as a percentage of the sale price. Null when the price is 0. */
export function foodCostPct(unitCost: number, salePrice: number): number | null {
  const price = Number(salePrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  return round2((Number(unitCost) || 0) / price * 100);
}

export type FoodCostBand = 'HEALTHY' | 'WATCH' | 'HIGH';

/**
 * Band a food-cost percentage against a target. Anything up to the target is
 * healthy, up to target+5pp is worth watching, beyond that it is losing money
 * on volume.
 */
export function classifyFoodCost(pct: number | null, targetPct = 35): FoodCostBand {
  if (pct === null) return 'WATCH';
  if (pct <= targetPct) return 'HEALTHY';
  if (pct <= targetPct + 5) return 'WATCH';
  return 'HIGH';
}

/** Gross margin per unit and as a percentage of price. */
export function margin(unitCost: number, salePrice: number): { amount: number; pct: number | null } {
  const price = Number(salePrice) || 0;
  const amount = round2(price - (Number(unitCost) || 0));
  return { amount, pct: price > 0 ? round2((amount / price) * 100) : null };
}
