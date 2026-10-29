/**
 * Recipe-driven inventory depletion (§17 / §12).
 *
 * When a composed product sells, its ingredients leave the shelf — not the
 * finished good. This service turns sold lines into inventory draws, expanding
 * one level of sub-recipe (a sauce component that is itself a recipe) and writing
 * the balance + movement rows in one transaction.
 *
 * Deliberately post-commit-tolerant: a missing balance row is created, not an
 * error, because a kitchen that never tracked an ingredient should still be able
 * to sell the dish while it catches up.
 */

import { prisma } from '../db/client.js';
import { explodeRecipe } from './recipes.js';

export interface SoldLine {
  productId: string;
  quantity: number;
}

export interface DepletionResult {
  applied: { componentProductId: string; quantity: number; unit: string }[];
  skipped: { productId: string; reason: string }[];
}

/**
 * Deplete inventory for a set of sold lines at one location.
 *
 * `transferUnit` converts a recipe line unit into the component's stocking unit
 * (`G` on a recipe line vs a `KG` balance). Components stocked in the same unit
 * are the common case; the conversion table is intentionally small and explicit.
 */
export async function depleteForOrder(
  organizationId: string,
  locationId: string | null,
  lines: SoldLine[],
  reference: string,
  performedBy?: string | null,
): Promise<DepletionResult> {
  const result: DepletionResult = { applied: [], skipped: [] };
  if (!locationId || !lines || lines.length === 0) return result;

  const productIds = [...new Set(lines.map((l) => l.productId))];
  const recipes = await prisma.recipe.findMany({
    where: { organizationId, isActive: true, productId: { in: productIds } },
    include: { lines: true },
  });
  if (recipes.length === 0) return result;

  // Sub-recipes (a component that is itself composed) are expanded one level.
  const subProductIds = [...new Set(recipes.flatMap((r) => r.lines.map((l) => l.componentProductId)))];
  const subRecipes = await prisma.recipe.findMany({
    where: { organizationId, isActive: true, productId: { in: subProductIds } },
    include: { lines: true },
  });
  const subMap = new Map(subRecipes.map((r) => [r.productId, r]));

  const recipeByProduct = new Map(recipes.map((r) => [r.productId, r]));

  for (const sold of lines) {
    const recipe = recipeByProduct.get(sold.productId);
    if (!recipe) continue;

    const soldQty = Number(sold.quantity) || 0;
    if (soldQty <= 0) continue;

    const primary = explodeRecipe(
      {
        productId: recipe.productId,
        yieldQty: Number(recipe.yieldQty),
        lines: recipe.lines.map((l) => ({
          componentProductId: l.componentProductId,
          quantity: Number(l.quantity),
          unit: l.unit,
          wastePct: Number(l.wastePct),
        })),
      },
      soldQty,
    );

    for (const draw of primary) {
      const sub = subMap.get(draw.componentProductId);
      if (sub) {
        // Expand the sub-recipe by the amount of the component that was used.
        const subDraws = explodeRecipe(
          {
            productId: sub.productId,
            yieldQty: Number(sub.yieldQty),
            lines: sub.lines.map((l) => ({
              componentProductId: l.componentProductId,
              quantity: Number(l.quantity),
              unit: l.unit,
              wastePct: Number(l.wastePct),
            })),
          },
          draw.quantity,
        );
        for (const nested of subDraws) {
          const ok = await applyDraw(organizationId, locationId, nested, reference, performedBy);
          if (ok) result.applied.push(nested);
        }
      } else {
        const ok = await applyDraw(organizationId, locationId, draw, reference, performedBy);
        if (ok) result.applied.push(draw);
        else result.skipped.push({ productId: draw.componentProductId, reason: 'NO_BALANCE' });
      }
    }
  }

  return result;
}

/** Decrement one balance and record the movement. */
async function applyDraw(
  organizationId: string,
  locationId: string,
  draw: { componentProductId: string; quantity: number; unit: string },
  reference: string,
  performedBy?: string | null,
): Promise<boolean> {
  const product = await prisma.product.findFirst({
    where: { id: draw.componentProductId, organizationId },
    select: { id: true, unitOfMeasure: true },
  });
  if (!product) return false;

  // Recipe units are frequently grams against a kilogram balance.
  let qty = Number(draw.quantity) || 0;
  const lineUnit = String(draw.unit ?? 'EACH').toUpperCase();
  const stockUnit = String(product.unitOfMeasure ?? 'EACH').toUpperCase();
  if (lineUnit === 'G' && stockUnit === 'KG') qty = qty / 1000;
  if (lineUnit === 'ML' && stockUnit === 'L') qty = qty / 1000;
  if (qty <= 0) return false;

  const balance = await prisma.inventoryBalance.upsert({
    where: { productId_locationId: { productId: product.id, locationId } },
    create: { productId: product.id, locationId, quantity: 0 },
    update: {},
    select: { id: true, quantity: true },
  });

  const current = Number(balance.quantity) || 0;
  // Never drive a balance negative: a stock-out is a reconciliation task, not a
  // licence to invent inventory.
  const next = Math.max(0, Math.round((current - qty) * 1000) / 1000);

  await prisma.$transaction([
    prisma.inventoryBalance.update({ where: { id: balance.id }, data: { quantity: next } }),
    prisma.inventoryMovement.create({
      data: {
        balanceId: balance.id,
        type: 'SALE',
        quantity: -Math.round(qty * 1000) / 1000,
        reference,
        notes: `Recipe depletion (${lineUnit}→${stockUnit})`,
        performedBy: performedBy ?? null,
      },
    }),
  ]);

  return true;
}
