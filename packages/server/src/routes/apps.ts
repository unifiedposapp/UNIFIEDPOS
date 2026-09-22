// ─── Ecosystem: partner apps, honest scopes, tenant custom fields ────────────
// Two promises hold an open platform together. First: an app only ever gets the
// scopes its manifest declares - the grant list is filtered against the catalog,
// the API token is stored as a digest, and uninstalling revokes it. Second: a
// merchant's custom fields are typed at the edge, so a "yes" can never land in
// a number column and quietly break next quarter's report.

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { jsonOrNull } from '../utils/json.js';
import {
  APP_CATALOG,
  ALL_SCOPES,
  appByCode,
  appCategories,
  appsForMarket,
  highestRiskScope,
  impliedScopes,
  type AppScope,
  type CatalogApp,
} from '../data/appCatalog.js';
import {
  CUSTOM_DATA_TYPES,
  CUSTOM_ENTITIES,
  validateDefinition,
  applyValues,
  serializeValues,
  defaultValues,
  issueAppToken,
  verifyAppToken,
  scopesSatisfy,
  type FieldDefinition,
  type CustomEntity,
  type CustomDataType,
} from '../services/customFields.js';

const router = Router();

function definitionFromRow(row: {
  fieldKey: string;
  label: string;
  dataType: string;
  required: boolean;
  options: unknown;
  validation: unknown;
  defaultValue: string | null;
  active: boolean;
  sortOrder: number;
  entity: string;
  id?: string;
}): FieldDefinition & { id?: string } {
  return {
    id: row.id,
    fieldKey: row.fieldKey,
    label: row.label,
    dataType: row.dataType as FieldDefinition['dataType'],
    entity: row.entity as FieldDefinition['entity'],
    required: row.required,
    options: Array.isArray(row.options) ? (row.options as string[]) : null,
    validation: (row.validation as FieldDefinition['validation']) || null,
    defaultValue: row.defaultValue,
    active: row.active,
    sortOrder: row.sortOrder,
  };
}

// ─── catalog ──────────────────────────────────────────────────────────────────

// GET /api/apps/catalog - everything a merchant could install, with grants visible
router.get('/catalog', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const [org, installations] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId }, select: { countryCode: true } }),
      prisma.appInstallation.findMany({ where: { organizationId, status: { not: 'UNINSTALLED' } }, take: 500 }),
    ]);
    const market = req.query.country ? String(req.query.country) : org?.countryCode || null;
    const installed = new Map(installations.map((i) => [i.appCode, i]));
    const listed = (req.query.all === 'true' ? APP_CATALOG : appsForMarket(market)).map((app) => {
      const at = installed.get(app.code);
      return {
        ...app,
        availableInMarket: appsForMarket(market).some((a) => a.code === app.code),
        installed: at ? { status: at.status, scopes: at.scopes, id: at.id, installedAt: at.createdAt } : null,
        risk: highestRiskScope(app.scopes),
      };
    });
    res.json({
      success: true,
      data: {
        apps: listed,
        categories: appCategories(),
        scopes: ALL_SCOPES,
        market,
        counts: { total: APP_CATALOG.length, installed: installations.filter((i) => i.status === 'INSTALLED').length },
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/apps/catalog/:code - one app's manifest, exactly what a grant would cover
router.get('/catalog/:code', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const app = appByCode(req.params.code);
    if (!app) return res.status(404).json({ success: false, message: 'Unknown app code' });
    res.json({ success: true, data: { app, implied: impliedScopes(app.scopes), risk: highestRiskScope(app.scopes) } });
  } catch (error) {
    handleError(error, res);
  }
});

const installSchema = z.object({
  appCode: z.string().min(2).max(64),
  scopes: z.array(z.string().max(40)).max(30).optional(),
  config: z.record(z.unknown()).optional().nullable(),
  acknowledgeScopes: z.boolean().optional(),
});

// POST /api/apps/install - grant exactly the manifest's scopes; token shown once
router.post('/install', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(installSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof installSchema>;
    const app = appByCode(body.appCode);
    if (!app) return res.status(404).json({ success: false, message: `No catalog entry for "${body.appCode}"` });
    // Asking for more than the manifest declares is refused, not trimmed: a
    // client that over-requests has a bug, and silence would hide it.
    const manifest = new Set(app.scopes as string[]);
    const requested = (body.scopes || app.scopes).map(String);
    const overreaching = requested.filter((s) => !manifest.has(s));
    if (overreaching.length) return res.status(400).json({ success: false, message: `Scopes not in the app manifest: ${overreaching.join(', ')}` });
    const highRisk = highestRiskScope(requested as AppScope[]);
    if (highRisk.risk === 'HIGH' && !body.acknowledgeScopes) {
      return res.status(428).json({
        success: false,
        message: `This grant includes ${highRisk.scope}; set acknowledgeScopes to confirm`,
        data: { risk: highRisk, scopes: impliedScopes(requested as AppScope[]) },
      });
    }

    const issued = issueAppToken(requested as AppScope[]);
    const data = {
      appName: app.name,
      publisher: app.publisher,
      categories: app.categories,
      scopes: issued.scopes,
      config: jsonOrNull(body.config),
      tokenHash: issued.tokenHash,
      status: 'INSTALLED',
      installedBy: req.user!.employeeId || null,
    };
    const installation = await prisma.appInstallation.upsert({
      where: { organizationId_appCode: { organizationId, appCode: app.code } },
      create: { organizationId, appCode: app.code, ...data },
      update: data,
    });
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'APP_INSTALLED',
      resourceType: 'APP_INSTALLATION',
      resourceId: installation.id,
      newValue: { appCode: app.code, scopes: issued.scopes },
    });
    res.status(201).json({
      success: true,
      data: {
        installation: { ...installation, tokenHash: undefined },
        // The only time the plaintext token exists anywhere but this response.
        token: issued.token,
        preview: issued.preview,
        endpoints: app.endpoints,
        events: app.events,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/apps/:code/uninstall - revocation, not deletion: the audit trail stays
router.post('/:code/uninstall', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const existing = await prisma.appInstallation.findUnique({ where: { organizationId_appCode: { organizationId, appCode: String(req.params.code) } } });
    if (!existing) return res.status(404).json({ success: false, message: 'That app is not installed' });
    const updated = await prisma.appInstallation.update({ where: { id: existing.id }, data: { status: 'UNINSTALLED', tokenHash: null } });
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'APP_UNINSTALLED',
      resourceType: 'APP_INSTALLATION',
      resourceId: existing.id,
      previousValue: { appCode: existing.appCode, scopes: existing.scopes },
    });
    res.json({ success: true, data: { ...updated, tokenHash: undefined } });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/apps/:code/token - rotate the API token without changing the grant
router.post('/:code/token', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const existing = await prisma.appInstallation.findUnique({ where: { organizationId_appCode: { organizationId, appCode: String(req.params.code) } }, });
    if (!existing) return res.status(404).json({ success: false, message: 'That app is not installed' });
    if (existing.status !== 'INSTALLED') return res.status(409).json({ success: false, message: `App is ${existing.status}; install it before issuing a token` });
    const issued = issueAppToken((Array.isArray(existing.scopes) ? existing.scopes : []) as AppScope[]);
    await prisma.appInstallation.update({ where: { id: existing.id }, data: { tokenHash: issued.tokenHash } });
    await createAuditEvent({ organizationId, actorId: req.user!.employeeId, action: 'APP_TOKEN_ROTATED', resourceType: 'APP_INSTALLATION', resourceId: existing.id });
    res.json({ success: true, data: { token: issued.token, preview: issued.preview, scopes: issued.scopes } });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/apps/:code/scopes - narrow a grant at any time; widening needs the manifest
const scopeSchema = z.object({ scopes: z.array(z.string().max(40)).min(1).max(30) });

router.put('/:code/scopes', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(scopeSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const existing = await prisma.appInstallation.findUnique({ where: { organizationId_appCode: { organizationId, appCode: String(req.params.code) } } });
    if (!existing) return res.status(404).json({ success: false, message: 'That app is not installed' });
    const app = appByCode(existing.appCode);
    const manifest = new Set((app?.scopes || []) as string[]);
    const wanted = (req.body as z.infer<typeof scopeSchema>).scopes.map(String);
    const outside = wanted.filter((s) => !manifest.has(s));
    if (outside.length) return res.status(400).json({ success: false, message: `Scopes outside ${existing.appCode}'s manifest: ${outside.join(', ')}` });
    const updated = await prisma.appInstallation.update({ where: { id: existing.id }, data: { scopes: impliedScopes(wanted as AppScope[]) } });
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'APP_SCOPES_CHANGED',
      resourceType: 'APP_INSTALLATION',
      resourceId: existing.id,
      previousValue: { scopes: existing.scopes },
      newValue: { scopes: updated.scopes },
    });
    res.json({ success: true, data: { ...updated, tokenHash: undefined } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/apps/installs - what is live, and what each token can touch
router.get('/installs', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const installations = await prisma.appInstallation.findMany({ where: { organizationId, status: { not: 'UNINSTALLED' } }, orderBy: { createdAt: 'desc' } });
    const rows = installations.map((i) => ({
      ...i,
      tokenHash: undefined,
      hasToken: Boolean(i.tokenHash),
      scopes: Array.isArray(i.scopes) ? (i.scopes as string[]) : [],
      risk: highestRiskScope((Array.isArray(i.scopes) ? i.scopes : []) as AppScope[]),
      live: appByCode(i.appCode) ? true : false,
    }));
    res.json({ success: true, data: { installations: rows, byStatus: rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {}) } });
  } catch (error) {
    handleError(error, res);
  }
});

const verifySchema = z.object({ token: z.string().min(10).max(128), appCode: z.string().max(64).optional(), requiredScopes: z.array(z.string().max(40)).max(30).optional() });

// POST /api/apps/verify-token - what a webhook receiver would ask before acting
router.post('/verify-token', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(verifySchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof verifySchema>;
    const where = body.appCode
      ? { organizationId, appCode: body.appCode, status: 'INSTALLED' }
      : { organizationId, status: 'INSTALLED' as const };
    const candidates = await prisma.appInstallation.findMany({ where, take: body.appCode ? 1 : 200 });
    const match = candidates.find((c) => verifyAppToken(body.token, c.tokenHash));
    if (!match) return res.status(401).json({ success: false, message: 'No active installation recognises that token' });
    const granted = (Array.isArray(match.scopes) ? match.scopes : []) as string[];
    const required = (body.requiredScopes || []) as AppScope[];
    res.json({
      success: true,
      data: {
        appCode: match.appCode,
        appName: match.appName,
        scopes: granted,
        risk: highestRiskScope(granted as AppScope[]),
        authorized: scopesSatisfy(granted, required),
        requiredScopes: required,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── custom fields ────────────────────────────────────────────────────────────

// GET /api/apps/fields?entity=ORDER - definitions plus ready-made defaults
router.get('/fields', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const entity = req.query.entity ? String(req.query.entity).toUpperCase() : null;
    const rows = await prisma.customFieldDefinition.findMany({
      where: { organizationId, ...(entity ? { entity } : {}) },
      orderBy: [{ entity: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
    });
    const defs = rows.map(definitionFromRow);
    res.json({
      success: true,
      data: {
        fields: rows,
        types: CUSTOM_DATA_TYPES,
        entities: CUSTOM_ENTITIES,
        defaults: defaultValues(defs.filter((d) => d.active)),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

const fieldSchema = z.object({
  entity: z.enum(CUSTOM_ENTITIES as unknown as [CustomEntity, ...CustomEntity[]]).optional(),
  fieldKey: z.string().max(60).optional(),
  label: z.string().min(1).max(80),
  dataType: z.enum(CUSTOM_DATA_TYPES as unknown as [CustomDataType, ...CustomDataType[]]).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string().max(60)).max(50).optional().nullable(),
  validation: z.object({ min: z.number().nullable().optional(), max: z.number().nullable().optional(), maxLength: z.number().int().positive().nullable().optional(), pattern: z.string().max(200).nullable().optional() }).optional().nullable(),
  defaultValue: z.union([z.string().max(200), z.number(), z.boolean()]).optional().nullable(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

// POST /api/apps/fields - create, or re-point an existing key
router.post('/fields', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(fieldSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof fieldSchema>;
    const check = validateDefinition({ ...body, entity: body.entity || 'ORDER' });
    if (!check.ok) return res.status(400).json({ success: false, message: 'Field definition rejected', data: { errors: check.errors } });
    const def = check.normalized;
    const data = {
      label: def.label,
      dataType: def.dataType,
      required: def.required,
      options: jsonOrNull(def.options),
      validation: jsonOrNull(def.validation),
      defaultValue: def.defaultValue == null ? null : String(def.defaultValue),
      active: def.active !== false,
      sortOrder: def.sortOrder,
    };
    const field = await prisma.customFieldDefinition.upsert({
      where: { organizationId_entity_fieldKey: { organizationId, entity: def.entity!, fieldKey: def.fieldKey } },
      create: { organizationId, entity: def.entity!, fieldKey: def.fieldKey, ...data },
      update: data,
    });
    await createAuditEvent({
      organizationId,
      actorId: req.user!.employeeId,
      action: 'CUSTOM_FIELD_SAVED',
      resourceType: 'CUSTOM_FIELD',
      resourceId: field.id,
      newValue: { entity: field.entity, fieldKey: field.fieldKey, dataType: field.dataType },
    });
    res.status(201).json({ success: true, data: field });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/apps/fields/:id - deactivate; stored answers stay for the audit trail
router.delete('/fields/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const existing = await prisma.customFieldDefinition.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Field not found' });
    const updated = await prisma.customFieldDefinition.update({ where: { id: existing.id }, data: { active: false } });
    await createAuditEvent({ organizationId, actorId: req.user!.employeeId, action: 'CUSTOM_FIELD_DEACTIVATED', resourceType: 'CUSTOM_FIELD', resourceId: existing.id, previousValue: { fieldKey: existing.fieldKey } });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/apps/fields/values/:entityUuid - one order/customer/product, filled in
router.get('/fields/values/:entityUuid', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const entityUuid = String(req.params.entityUuid);
    const entity = req.query.entity ? String(req.query.entity).toUpperCase() : null;
    const rows = await prisma.customFieldValue.findMany({ where: { organizationId, entityUuid }, take: 200 });
    const defs = await prisma.customFieldDefinition.findMany({
      where: { organizationId, id: { in: rows.map((r) => r.fieldId) }, ...(entity ? { entity } : {}) },
    });
    res.json({
      success: true,
      data: { entityUuid, values: serializeValues(defs.map(definitionFromRow), rows), stored: rows.length },
    });
  } catch (error) {
    handleError(error, res);
  }
});

const valuesSchema = z.object({ entityUuid: z.string().min(3).max(64), entity: z.enum(CUSTOM_ENTITIES as unknown as [CustomEntity, ...CustomEntity[]]).optional(), values: z.record(z.unknown()), partial: z.boolean().optional() });

// POST /api/apps/fields/values - coerce everything first; one bad key writes nothing
router.post('/fields/values', authMiddleware, validateRequest(valuesSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const body = req.body as z.infer<typeof valuesSchema>;
    const defs = await prisma.customFieldDefinition.findMany({ where: { organizationId, active: true, ...(body.entity ? { entity: body.entity } : {}) } });
    const result = applyValues(defs.map(definitionFromRow), body.values, { partial: body.partial });
    if (!result.ok) return res.status(422).json({ success: false, message: 'Custom field values rejected', data: { errors: result.errors, missing: result.missing } });
    const idByFieldKey = new Map(defs.map((d) => [d.fieldKey, d.id]));
    for (const value of result.values) {
      const fieldId = idByFieldKey.get(value.fieldKey);
      if (!fieldId) continue;
      await prisma.customFieldValue.upsert({
        where: { fieldId_entityUuid: { fieldId, entityUuid: body.entityUuid } },
        create: {
          organizationId,
          fieldId,
          entityUuid: body.entityUuid,
          textValue: value.storage.textValue ?? null,
          numberValue: value.storage.numberValue ?? undefined,
          boolValue: value.storage.boolValue ?? null,
          dateValue: value.storage.dateValue ?? null,
          updatedBy: req.user!.employeeId || null,
        },
        update: {
          textValue: value.storage.textValue ?? null,
          numberValue: value.storage.numberValue ?? undefined,
          boolValue: value.storage.boolValue ?? null,
          dateValue: value.storage.dateValue ?? null,
          updatedBy: req.user!.employeeId || null,
        },
      });
    }
    res.json({ success: true, data: { saved: result.values.length, entityUuid: body.entityUuid } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/apps/overview - the ecosystem page's header numbers
router.get('/overview', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const [org, installations, fields] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId }, select: { countryCode: true } }),
      prisma.appInstallation.findMany({ where: { organizationId, status: 'INSTALLED' }, take: 200 }),
      prisma.customFieldDefinition.count({ where: { organizationId, active: true } }),
    ]);
    const scopes = new Set(installations.flatMap((i) => (Array.isArray(i.scopes) ? (i.scopes as string[]) : [])));
    const risk = installations.map((i) => highestRiskScope((Array.isArray(i.scopes) ? i.scopes : []) as AppScope[]));
    const market = (req.query.country ? String(req.query.country) : org?.countryCode) || null;
    const available: CatalogApp[] = appsForMarket(market);
    res.json({
      success: true,
      data: {
        installed: installations.length,
        grantedScopes: [...scopes].sort(),
        highestRisk: risk.length ? risk.sort((a, b) => (a.risk === 'HIGH' ? -1 : b.risk === 'HIGH' ? 1 : 0))[0] : null,
        customFields: fields,
        market,
        availableInMarket: available.length,
        catalogSize: APP_CATALOG.length,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
