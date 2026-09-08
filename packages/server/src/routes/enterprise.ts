import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import {
  GLOBAL_SUBREGIONS,
  GLOBAL_COUNTRY_COUNT,
  computeCoverage,
  subregionKey,
  subregionName,
} from '../data/globalRegions.js';

const router = Router();

const regionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

const warehouseSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  phone: z.string().optional(),
  manager: z.string().optional(),
});

// ─── Regions ─────────────────────────────────────────────────

router.get('/regions', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const regions = await prisma.region.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { locations: { select: { id: true, name: true, isActive: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: regions });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Global region coverage (§23 Multi-Location Enterprise, §46 Scalability) ─
// Provisions one region per UN geoscheme sub-region so that every nation and
// country on Earth (all 249 ISO codes) is covered — no country is left out.

async function buildCoverage(orgId: string) {
  const regions = await prisma.region.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, name: true, type: true, continent: true, subregion: true, countries: true, countryCount: true },
  });
  const covered: string[] = [];
  for (const r of regions) {
    if (Array.isArray(r.countries)) covered.push(...(r.countries as any[]).map(String));
  }
  const report = computeCoverage(covered);
  const globalRegions = regions
    .filter((r) => r.type === 'GLOBAL')
    .map((r) => ({ id: r.id, name: r.name, continent: r.continent, subregion: r.subregion, countryCount: r.countryCount ?? 0 }))
    .sort((a, b) => (a.continent || '').localeCompare(b.continent || '') || (a.subregion || '').localeCompare(b.subregion || ''));
  return { ...report, globalRegionCount: globalRegions.length, globalRegions };
}

// GET /api/enterprise/regions/coverage — worldwide coverage report (target 249/249)
router.get('/regions/coverage', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const report = await buildCoverage(req.user!.organizationId!);
    res.json({ success: true, data: report });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/enterprise/regions/provision-global — idempotently create/refresh the
// full set of global regions so every nation is covered.
router.post('/regions/provision-global', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const existing = await prisma.region.findMany({
      where: { organizationId: orgId, type: 'GLOBAL' },
      select: { id: true, continent: true, subregion: true },
    });
    const existingByKey = new Map<string, string>();
    for (const r of existing) {
      if (r.continent && r.subregion) existingByKey.set(subregionKey(r.continent, r.subregion), r.id);
    }

    let created = 0;
    let updated = 0;
    for (const s of GLOBAL_SUBREGIONS) {
      const name = subregionName(s.continent, s.subregion);
      const id = existingByKey.get(subregionKey(s.continent, s.subregion));
      if (id) {
        await prisma.region.update({
          where: { id },
          data: { name, type: 'GLOBAL', continent: s.continent, subregion: s.subregion, countries: s.countries, countryCount: s.countries.length, isActive: true },
        });
        updated++;
      } else {
        await prisma.region.create({
          data: {
            organizationId: orgId,
            name,
            description: `${s.continent} — ${s.subregion} (UN geoscheme)`,
            type: 'GLOBAL',
            continent: s.continent,
            subregion: s.subregion,
            countries: s.countries,
            countryCount: s.countries.length,
          },
        });
        created++;
      }
    }

    const coverage = await buildCoverage(orgId);
    res.json({ success: true, data: { created, updated, total: GLOBAL_COUNTRY_COUNT, coverage } });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/regions', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(regionSchema), async (req: AuthRequest, res: Response) => {
  try {
    const region = await prisma.region.create({
      data: { ...req.body, organizationId: req.user!.organizationId! },
    });
    res.status(201).json({ success: true, data: region });
  } catch (error) {
    handleError(error, res);
  }
});

router.put('/regions/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(regionSchema.partial()), async (req: AuthRequest, res: Response) => {
  try {
    const region = await prisma.region.update({
      where: { id: String(req.params.id) },
      data: req.body,
    });
    res.json({ success: true, data: region });
  } catch (error) {
    handleError(error, res);
  }
});

router.delete('/regions/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const region = await prisma.region.findUnique({ where: { id }, select: { type: true } });
    if (!region) {
      res.status(404).json({ success: false, error: 'Region not found' });
      return;
    }
    if (region.type === 'GLOBAL') {
      res.status(400).json({ success: false, error: 'Global regions cannot be deleted — they guarantee worldwide coverage of every nation.' });
      return;
    }
    await prisma.region.delete({ where: { id } });
    res.json({ success: true, message: 'Region deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

// Assign location to region
router.put('/locations/:locationId/assign-region', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { regionId } = req.body;
    const location = await prisma.location.update({
      where: { id: String(req.params.locationId) },
      data: { regionId: regionId || null },
    });
    res.json({ success: true, data: location });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Warehouses ──────────────────────────────────────────────

router.get('/warehouses', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const warehouses = await prisma.warehouse.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: warehouses });
  } catch (error) {
    handleError(error, res);
  }
});

router.post('/warehouses', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(warehouseSchema), async (req: AuthRequest, res: Response) => {
  try {
    const warehouse = await prisma.warehouse.create({
      data: { ...req.body, organizationId: req.user!.organizationId! },
    });
    res.status(201).json({ success: true, data: warehouse });
  } catch (error) {
    handleError(error, res);
  }
});

router.put('/warehouses/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(warehouseSchema.partial()), async (req: AuthRequest, res: Response) => {
  try {
    const warehouse = await prisma.warehouse.update({
      where: { id: String(req.params.id) },
      data: req.body,
    });
    res.json({ success: true, data: warehouse });
  } catch (error) {
    handleError(error, res);
  }
});

router.delete('/warehouses/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.warehouse.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true, message: 'Warehouse deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/enterprises/overview - Enterprise overview
router.get('/overview', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const [regions, locations, warehouses] = await Promise.all([
      prisma.region.findMany({
        where: { organizationId: orgId },
        include: {
          locations: {
            select: { id: true, name: true, isActive: true },
          },
        },
      }),
      prisma.location.findMany({ where: { organizationId: orgId, isActive: true } }),
      prisma.warehouse.findMany({ where: { organizationId: orgId, isActive: true } }),
    ]);

    // Worldwide coverage across the org's active regions (should reach all 249).
    const coveredCodes: string[] = [];
    for (const r of regions) {
      if (r.isActive && Array.isArray(r.countries)) coveredCodes.push(...(r.countries as any[]).map(String));
    }
    const coverage = computeCoverage(coveredCodes);

    // Get stats per location
    const locationStats = [];
    for (const loc of locations) {
      const [orderCount, revenue] = await Promise.all([
        prisma.order.count({ where: { organizationId: orgId, locationId: loc.id, status: { in: ['PAID', 'COMPLETED'] } } }),
        prisma.order.aggregate({ where: { organizationId: orgId, locationId: loc.id, status: { in: ['PAID', 'COMPLETED'] } }, _sum: { totalAmount: true } }),
      ]);
      locationStats.push({
        id: loc.id,
        name: loc.name,
        orders: orderCount,
        revenue: Number(revenue._sum.totalAmount || 0),
        region: regions.find(r => r.locations.some(l => l.id === loc.id))?.name || 'Unassigned',
      });
    }

    res.json({
      success: true,
      data: {
        regions: regions.map(r => ({ id: r.id, name: r.name, locationCount: r.locations.length })),
        locations: locationStats,
        warehouses: warehouses.map(w => ({ id: w.id, name: w.name, manager: w.manager })),
        totalLocations: locations.length,
        totalRegions: regions.length,
        totalWarehouses: warehouses.length,
        globalCoverage: {
          total: coverage.total,
          covered: coverage.covered,
          complete: coverage.complete,
          uncoveredCount: coverage.uncovered.length,
        },
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
