// ─── Vertical solutions: turn a generic POS into a trade-specific one ─────────
// A pharmacy and a hardware shop do not want the same terminal. Each solution is
// a declarative manifest - capabilities, POS hints, defaults - applied on top of
// the core. Two rules keep this safe: an install only writes the settings it
// whitelisted (everything else lives in its own config row, so retiring is
// clean), and installing twice is a no-op rather than a duplicate side effect.

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { toJson } from '../utils/json.js';
import {
  VERTICAL_SOLUTIONS,
  solutionByCode,
  solutionsForIndustry,
  recommendSolutions,
  solutionConflicts,
  planInstall,
  mergeInstallations,
  capabilityIndex,
  allCapabilities,
  type Capability,
} from '../data/verticalSolutions.js';

const router = Router();

/** Settings a vertical may change. Anything outside this list is ignored. */
const APPLYABLE_SETTINGS = new Set(['lowStockAlertEnabled', 'registerIdleLockMinutes', 'receiptFooter', 'tagline']);

async function installedCapabilities(organizationId: string): Promise<{ codes: string[]; capabilities: Capability[] }> {
  const rows = await prisma.verticalInstallation.findMany({ where: { organizationId, status: 'INSTALLED' } });
  const capabilities: Capability[] = [];
  for (const row of rows) for (const c of (row.features as Capability[] | null) || []) capabilities.push(c);
  return { codes: rows.map((r) => r.solutionCode), capabilities };
}

// GET /api/verticals - the catalogue, this tenant's installs and what fits its trade
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { industry: true, countryCode: true } });
    const installed = await prisma.verticalInstallation.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } });
    const activeCodes = installed.filter((i) => i.status === 'INSTALLED').map((i) => i.solutionCode);
    res.json({
      success: true,
      data: {
        industry: org?.industry || 'RETAIL',
        countryCode: org?.countryCode || null,
        solutions: VERTICAL_SOLUTIONS.map((s) => ({
          code: s.code,
          name: s.name,
          tagline: s.tagline,
          version: s.version,
          industries: s.industries,
          capabilities: s.capabilities,
          installCount: 0,
          installed: activeCodes.includes(s.code),
          confirmations: s.confirmations || [],
        })),
        installed,
        recommendations: recommendSolutions(org?.industry, org?.countryCode),
        conflicts: solutionConflicts(activeCodes),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/verticals/capabilities - which switches belong to which solution
router.get('/capabilities', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, data: { capabilities: allCapabilities(), index: capabilityIndex() } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/verticals/pos/hints - the merged behaviour the POS screen must honour
router.get('/pos/hints', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const installs = await prisma.verticalInstallation.findMany({ where: { organizationId, status: 'INSTALLED' } });
    const merged = mergeInstallations(
      installs.map((i) => ({ solutionCode: i.solutionCode, features: i.features ?? undefined, posHints: i.posHints ?? undefined }))
    );
    res.json({ success: true, data: { ...merged, installed: installs.map((i) => i.solutionCode) } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/verticals/market/fit - what comparable tenants in this market run
router.get('/market/fit', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { industry: true, countryCode: true } });
    const fits = solutionsForIndustry(org?.industry);
    const installedCodes = new Set((await installedCapabilities(organizationId)).codes);
    res.json({
      success: true,
      data: {
        industry: org?.industry || 'RETAIL',
        countryCode: org?.countryCode || null,
        fits: fits.map((s) => ({ code: s.code, name: s.name, tagline: s.tagline, installed: installedCodes.has(s.code), strongMarket: (s.strongMarkets || []).includes(String(org?.countryCode || '').toUpperCase()) })),
        recommendations: recommendSolutions(org?.industry, org?.countryCode),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/verticals/:code - one manifest plus what installing it would change
router.get('/:code', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const solution = solutionByCode(req.params.code);
    if (!solution) return res.status(404).json({ success: false, message: `Unknown vertical solution ${req.params.code}` });
    const active = await installedCapabilities(organizationId);
    // Preview through the same planner the install uses, so the UI cannot
    // promise something the write path will not do.
    const preview = planInstall(solution.code, active.capabilities, active.codes);
    const installation = await prisma.verticalInstallation.findUnique({
      where: { organizationId_solutionCode: { organizationId, solutionCode: solution.code } },
    });
    res.json({
      success: true,
      data: {
        solution,
        installation,
        preview: {
          added: preview.added,
          alreadyActive: preview.alreadyActive,
          settingsDelta: preview.settingsDelta,
          wouldApply: Object.keys(preview.settingsDelta).filter((k) => APPLYABLE_SETTINGS.has(k)),
          conflicts: solutionConflicts([...new Set([...active.codes, solution.code])]).filter((c) => c.codes.length > 1),
        },
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

const installSchema = z.object({
  /**
   * Confirmation strings are matched verbatim against the pack's manifest, which
   * spells out regulated obligations in full sentences — so the ceiling has to
   * clear the longest one, otherwise the 428 gate could never be satisfied.
   */
  confirmations: z.array(z.string().max(300)).max(20).optional(),
  config: z.record(z.any()).optional(),
});

// POST /api/verticals/:code/install - apply a solution to this tenant
router.post('/:code/install', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const solution = solutionByCode(req.params.code);
    if (!solution) return res.status(404).json({ success: false, message: `Unknown vertical solution ${req.params.code}` });
    const parsed = installSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: 'Validation failed', details: parsed.error.errors.map((e) => ({ field: e.path.join('.'), message: e.message })) });

    const active = await installedCapabilities(organizationId);
    const plan = planInstall(solution.code, active.capabilities, active.codes);

    const missing = (solution.confirmations || []).filter((c) => !(parsed.data.confirmations || []).includes(c));
    if (missing.length) {
      return res.status(428).json({ success: false, message: 'This solution needs an explicit confirmation before it can be installed', data: { required: missing } });
    }

    const appliedDelta: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(plan.settingsDelta || {})) {
      if (!APPLYABLE_SETTINGS.has(key)) continue;
      appliedDelta[key] = value;
    }
    if (Object.keys(appliedDelta).length) {
      const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
      await prisma.storeSettings.upsert({
        where: { organizationId },
        create: { organizationId, storeName: org?.name || 'Store', ...appliedDelta },
        update: appliedDelta,
      });
    }

    const config = { ...plan.defaults, ...(parsed.data.config || {}) };
    const installation = await prisma.verticalInstallation.upsert({
      where: { organizationId_solutionCode: { organizationId, solutionCode: solution.code } },
      create: {
        organizationId,
        solutionCode: solution.code,
        version: solution.version,
        status: 'INSTALLED',
        features: plan.capabilities,
        config: toJson(config),
        posHints: toJson(plan.posHints),
        appliedDelta: toJson(appliedDelta),
        enabledBy: req.user!.id,
      },
      update: {
        version: solution.version,
        status: 'INSTALLED',
        features: plan.capabilities,
        config: toJson(config),
        posHints: toJson(plan.posHints),
        appliedDelta: toJson(appliedDelta),
        enabledBy: req.user!.id,
      },
    });

    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'VERTICAL_INSTALLED',
      resourceType: 'VERTICAL_INSTALLATION',
      resourceId: installation.id,
      newValue: { solutionCode: solution.code, version: solution.version, added: plan.added, appliedDelta },
    });
    res.status(plan.alreadyActive.length === plan.capabilities.length ? 200 : 201).json({
      success: true,
      data: {
        installation,
        added: plan.added,
        alreadyActive: plan.alreadyActive,
        appliedDelta,
        posHints: plan.posHints,
        unchanged: plan.added.length === 0,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/verticals/:code/retire - reverse exactly what the install changed
router.post('/:code/retire', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const installation = await prisma.verticalInstallation.findUnique({
      where: { organizationId_solutionCode: { organizationId, solutionCode: String(req.params.code).toUpperCase() } },
    });
    if (!installation) return res.status(404).json({ success: false, message: 'That solution is not installed' });
    if (installation.status !== 'INSTALLED') return res.json({ success: true, data: { alreadyRetired: true } });

    // Undo the settings it applied, but only the ones still set to its value:
    // a later manual change by the merchant is never overwritten.
    const delta = (installation.appliedDelta || {}) as Record<string, unknown>;
    const revert: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(delta)) {
      if (!APPLYABLE_SETTINGS.has(key)) continue;
      const current = await prisma.storeSettings.findUnique({ where: { organizationId }, select: { [key]: true } as never });
      const currentValue = (current as Record<string, unknown> | null)?.[key];
      if (JSON.stringify(currentValue) === JSON.stringify(value)) {
        revert[key] = key === 'receiptFooter' || key === 'tagline' ? null : key === 'registerIdleLockMinutes' ? 5 : true;
      }
    }
    if (Object.keys(revert).length) await prisma.storeSettings.update({ where: { organizationId }, data: revert });

    const updated = await prisma.verticalInstallation.update({ where: { id: installation.id }, data: { status: 'RETIRED', appliedDelta: toJson(revert) } });
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'VERTICAL_RETIRED',
      resourceType: 'VERTICAL_INSTALLATION',
      resourceId: installation.id,
      previousValue: { status: 'INSTALLED', appliedDelta: delta },
      newValue: { status: 'RETIRED', reverted: revert },
    });
    res.json({ success: true, data: { installation: updated, reverted: revert } });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/verticals/:code/config - tune a solution without touching its switches
router.put('/:code/config', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const code = String(req.params.code).toUpperCase();
    const patch = req.body;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return res.status(400).json({ success: false, message: 'Send an object of config values' });
    const installation = await prisma.verticalInstallation.findUnique({ where: { organizationId_solutionCode: { organizationId, solutionCode: code } } });
    if (!installation) return res.status(404).json({ success: false, message: 'That solution is not installed' });
    const solution = solutionByCode(code);
    // Namespaced keys only: a solution may not write an arbitrary settings column.
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
      if (solution?.defaults && Object.prototype.hasOwnProperty.call(solution.defaults, key)) clean[key] = value;
    }
    const updated = await prisma.verticalInstallation.update({
      where: { id: installation.id },
      data: { config: toJson({ ...(installation.config as Record<string, unknown> | null), ...clean }) },
    });
    await createAuditEvent({ organizationId, actorId: req.user!.employeeId, action: 'VERTICAL_CONFIGURED', resourceType: 'VERTICAL_INSTALLATION', resourceId: installation.id, newValue: { keys: Object.keys(clean) } });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
