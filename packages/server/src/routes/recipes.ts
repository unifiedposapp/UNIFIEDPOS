/**
 * Recipe / BOM routes (§17).
 *
 * Mounted at /api/recipes (and /api/v1/recipes). Every handler is org-scoped and
 * the costing is delegated to the pure `services/recipes.ts` module, so a menu
 * engineer can change a yield without touching a total.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { rollupRecipeCost, foodCostPct, classifyFoodCost, margin, type RecipeInput } from '../services/recipes.js';
import { depleteForOrder } from '../services/depletion.js';

const router = Router();

const lineSchema = z.object({
  componentProductId: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().default('EACH'),
  wastePct: z.number().min(0).max(100).default(0),
  sortOrder: z.number().int().optional(),
});

const recipeSchema = z.object({
  name: z.string().min(1).max(200),
  yieldQty: z.number().positive().default(1),
  yieldUnit: z.string().default('EACH'),
  targetFoodCostPct: z.number().min(0).max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
  lines: z.array(lineSchema).min(1),
});

/**
 * Load the cost basis for an org in two queries: the component products and
 * every recipe (so sub-recipes resolve without N+1).
 */
async function loadCostBasis(organizationId: string) {
  const [products, allRecipes] = await Promise.all([
    prisma.product.findMany({
      where: { organizationId },
      select: { id: true, name: true, costPrice: true, unitOfMeasure: true, price: true },
    }),
    prisma.recipe.findMany({ where: { organizationId }, include: { lines: true } }),
  ]);

  const components = new Map(
    products.map((p) => [
      p.id,
      { id: p.id, name: p.name, cost: Number(p.costPrice), unit: p.unitOfMeasure, price: Number(p.price) } as any,
    ]),
  );

  const recipeMap = new Map<string, RecipeInput>(
    allRecipes.map((r) => [
      r.productId,
      {
        productId: r.productId,
        yieldQty: Number(r.yieldQty),
        lines: r.lines.map((l) => ({
          componentProductId: l.componentProductId,
          quantity: Number(l.quantity),
          unit: l.unit,
          wastePct: Number(l.wastePct),
        })),
      },
    ]),
  );

  return { products, allRecipes, components, recipeMap };
}

function costOf(recipe: RecipeInput, components: Map<string, any>, recipeMap: Map<string, RecipeInput>) {
  // Sub-recipes are everything except the one being costed.
  const subs = new Map(recipeMap);
  subs.delete(recipe.productId);
  return rollupRecipeCost(recipe, components, subs);
}

// GET /api/recipes — every recipe with plate cost and margin
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const { products, allRecipes, components, recipeMap } = await loadCostBasis(organizationId);
    const productById = new Map(products.map((p) => [p.id, p]));

    const data = allRecipes.map((r) => {
      const input: RecipeInput = {
        productId: r.productId,
        yieldQty: Number(r.yieldQty),
        lines: r.lines.map((l) => ({
          componentProductId: l.componentProductId,
          quantity: Number(l.quantity),
          unit: l.unit,
          wastePct: Number(l.wastePct),
        })),
      };
      const cost = costOf(input, components, recipeMap);
      const product = productById.get(r.productId);
      const salePrice = Number(product?.price ?? 0);
      const unitCost = cost.ok ? cost.unitCost : 0;
      const pct = foodCostPct(unitCost, salePrice);

      return {
        id: r.id,
        productId: r.productId,
        productName: product?.name ?? r.name,
        name: r.name,
        yieldQty: Number(r.yieldQty),
        yieldUnit: r.yieldUnit,
        targetFoodCostPct: r.targetFoodCostPct === null ? null : Number(r.targetFoodCostPct),
        isActive: r.isActive,
        lineCount: r.lines.length,
        unitCost,
        salePrice,
        foodCostPct: pct,
        band: classifyFoodCost(pct, Number(r.targetFoodCostPct ?? 35)),
        margin: margin(unitCost, salePrice),
        error: cost.ok ? null : cost.reason,
      };
    });

    res.json({ success: true, data });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/recipes/food-cost?target=35 — menu engineering view
router.get('/food-cost', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const target = Number(req.query.target) > 0 ? Number(req.query.target) : 35;
    const { products, allRecipes, components, recipeMap } = await loadCostBasis(organizationId);
    const productById = new Map(products.map((p) => [p.id, p]));

    const rows = allRecipes.map((r) => {
      const cost = costOf(
        {
          productId: r.productId,
          yieldQty: Number(r.yieldQty),
          lines: r.lines.map((l) => ({
            componentProductId: l.componentProductId,
            quantity: Number(l.quantity),
            unit: l.unit,
            wastePct: Number(l.wastePct),
          })),
        },
        components,
        recipeMap,
      );
      const salePrice = Number(productById.get(r.productId)?.price ?? 0);
      const unitCost = cost.ok ? cost.unitCost : 0;
      const pct = foodCostPct(unitCost, salePrice);
      return {
        productId: r.productId,
        name: productById.get(r.productId)?.name ?? r.name,
        salePrice,
        unitCost,
        foodCostPct: pct,
        band: classifyFoodCost(pct, target),
        margin: margin(unitCost, salePrice),
      };
    });

    res.json({
      success: true,
      data: {
        target,
        rows: rows.sort((a, b) => (b.foodCostPct ?? 0) - (a.foodCostPct ?? 0)),
        aboveTarget: rows.filter((r) => r.band !== 'HEALTHY').length,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/recipes/:productId — one recipe with per-line contribution
router.get('/:productId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const productId = String(req.params.productId);

    const recipe = await prisma.recipe.findFirst({
      where: { productId, organizationId },
      include: { lines: true },
    });
    if (!recipe) return res.status(404).json({ success: false, message: 'Recipe not found' });

    const { components, recipeMap, products } = await loadCostBasis(organizationId);
    const product = products.find((p) => p.id === productId);
    const cost = costOf(
      {
        productId,
        yieldQty: Number(recipe.yieldQty),
        lines: recipe.lines.map((l) => ({
          componentProductId: l.componentProductId,
          quantity: Number(l.quantity),
          unit: l.unit,
          wastePct: Number(l.wastePct),
        })),
      },
      components,
      recipeMap,
    );

    res.json({
      success: true,
      data: {
        recipe: {
          ...recipe,
          yieldQty: Number(recipe.yieldQty),
          targetFoodCostPct: recipe.targetFoodCostPct === null ? null : Number(recipe.targetFoodCostPct),
          lines: recipe.lines.map((l) => ({
            ...l,
            quantity: Number(l.quantity),
            wastePct: Number(l.wastePct),
          })),
        },
        cost,
        salePrice: Number(product?.price ?? 0),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/recipes/:productId — create or replace a recipe
router.put('/:productId', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const productId = String(req.params.productId);
    const body = recipeSchema.parse(req.body);

    const product = await prisma.product.findFirst({ where: { id: productId, organizationId }, select: { id: true, name: true } });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    // Every component must belong to the same tenant — a foreign product id would
    // otherwise leak another merchant's cost basis into this recipe.
    const componentIds = [...new Set(body.lines.map((l) => l.componentProductId))];
    const owned = await prisma.product.count({ where: { id: { in: componentIds }, organizationId } });
    if (owned !== componentIds.length) {
      return res.status(400).json({ success: false, message: 'One or more components do not belong to this organization' });
    }
    if (componentIds.includes(productId)) {
      return res.status(400).json({ success: false, message: 'A recipe cannot contain its own product' });
    }

    const saved = await prisma.$transaction(async (tx) => {
      const existing = await tx.recipe.findUnique({ where: { productId } });
      const data = {
        name: body.name,
        yieldQty: body.yieldQty,
        yieldUnit: body.yieldUnit,
        targetFoodCostPct: body.targetFoodCostPct ?? null,
        notes: body.notes ?? null,
        isActive: body.isActive ?? true,
      };

      let recipeId: string;
      if (existing) {
        recipeId = existing.id;
        await tx.recipe.update({ where: { id: existing.id }, data });
        await tx.recipeLine.deleteMany({ where: { recipeId: existing.id } });
      } else {
        const created = await tx.recipe.create({ data: { ...data, productId, organizationId } });
        recipeId = created.id;
      }

      await tx.recipeLine.createMany({
        data: body.lines.map((l, i) => ({
          recipeId,
          componentProductId: l.componentProductId,
          quantity: l.quantity,
          unit: l.unit,
          wastePct: l.wastePct,
          sortOrder: l.sortOrder ?? i,
        })),
      });

      return tx.recipe.findUnique({ where: { id: recipeId }, include: { lines: true } });
    });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'RECIPE_SAVED',
      resourceType: 'PRODUCT',
      resourceId: productId,
      newValue: { name: body.name, lines: body.lines.length },
    });

    res.json({ success: true, data: saved });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/recipes/:productId
router.delete('/:productId', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const productId = String(req.params.productId);

    const recipe = await prisma.recipe.findFirst({ where: { productId, organizationId }, select: { id: true } });
    if (!recipe) return res.status(404).json({ success: false, message: 'Recipe not found' });

    await prisma.recipe.delete({ where: { id: recipe.id } });
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'RECIPE_DELETED',
      resourceType: 'PRODUCT',
      resourceId: productId,
    });

    res.json({ success: true });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/recipes/:productId/depletion-preview?qty=3 — what a sale would draw
router.get('/:productId/depletion-preview', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const productId = String(req.params.productId);
    const qty = Number(req.query.qty) > 0 ? Number(req.query.qty) : 1;

    const recipe = await prisma.recipe.findFirst({
      where: { productId, organizationId, isActive: true },
      include: { lines: true },
    });
    if (!recipe) return res.status(404).json({ success: false, message: 'No active recipe for this product' });

    const { explodeRecipe } = await import('../services/recipes.js');
    const plan = explodeRecipe(
      {
        productId,
        yieldQty: Number(recipe.yieldQty),
        lines: recipe.lines.map((l) => ({
          componentProductId: l.componentProductId,
          quantity: Number(l.quantity),
          unit: l.unit,
          wastePct: Number(l.wastePct),
        })),
      },
      qty,
    );

    res.json({ success: true, data: { quantity: qty, draws: plan } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/recipes/:productId/deplete — apply the draw now (waste/spoilage)
router.post('/:productId/deplete', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const productId = String(req.params.productId);
    const { quantity, locationId } = z
      .object({ quantity: z.number().positive(), locationId: z.string().min(1) })
      .parse(req.body);

    const location = await prisma.location.findFirst({ where: { id: locationId, organizationId }, select: { id: true } });
    if (!location) return res.status(404).json({ success: false, message: 'Location not found' });

    const result = await depleteForOrder(
      organizationId,
      locationId,
      [{ productId, quantity }],
      `manual:${productId}`,
      req.user!.employeeId,
    );

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'RECIPE_DEPLETED',
      resourceType: 'PRODUCT',
      resourceId: productId,
      newValue: { quantity, locationId, applied: result.applied },
    });

    res.json({ success: true, data: result });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
