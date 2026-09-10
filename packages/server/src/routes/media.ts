// ─── Media asset library (§ product/branding/media uploads) ──────────────────
// A thin CRUD over the MediaAsset table via the storage adapter. Uploads accept a
// base64 data URL (the same shape Settings branding already posts) and are stored
// in S3 when configured, else inline in the DB. Reads return a resolved URL (a
// fresh S3 presign, or the stored data URL) so the SPA never handles raw bytes.

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError, HttpError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';
import { storeMedia, resolveMediaUrl, deleteMedia, mediaBackend } from '../services/mediaStorage.js';

const router = Router();

// Reject anything larger than ~10MB of base64 to protect the DB fallback.
const MAX_DATA_URL = 14_000_000;

const uploadSchema = z.object({
  name: z.string().optional(),
  mimeType: z.string().min(3),
  dataUrl: z.string().min(10).refine((s) => s.length <= MAX_DATA_URL, 'File too large'),
  folder: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

/** Shape a row for the API: resolved URL, never the raw DB data URL for S3. */
function present(a: any) {
  return {
    id: a.id,
    name: a.name,
    mimeType: a.mimeType,
    size: a.size,
    width: a.width,
    height: a.height,
    folder: a.folder,
    storage: a.storage,
    url: resolveMediaUrl(a),
    createdAt: a.createdAt,
  };
}

// GET /api/media/backend — which storage backend is active
router.get('/backend', authMiddleware, (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: mediaBackend() });
});

// GET /api/media?folder=general — list assets
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const where: any = { organizationId: orgId };
    if (req.query.folder) where.folder = String(req.query.folder);
    const assets = await prisma.mediaAsset.findMany({ where, orderBy: { createdAt: 'desc' }, take: 500 });
    res.json({ success: true, data: assets.map(present) });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/media — upload an asset
router.post('/', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(uploadSchema), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const { name, mimeType, dataUrl, folder, width, height } = req.body;
    const asset = await storeMedia({ organizationId: orgId, name, mimeType, dataUrl, folder, width, height, uploadedBy: req.user!.employeeId ?? req.user!.id });
    await createAuditEvent({ organizationId: orgId, actorId: req.user!.employeeId, action: 'MEDIA_UPLOADED', resourceType: 'MEDIA_ASSET', resourceId: asset.id, newValue: { mimeType, size: asset.size, storage: asset.storage } });
    res.status(201).json({ success: true, data: present(asset) });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/media/:id — one asset (with a fresh resolved URL)
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const asset = await prisma.mediaAsset.findFirst({ where: { id: String(req.params.id), organizationId: req.user!.organizationId! } });
    if (!asset) throw new HttpError(404, 'Media asset not found');
    res.json({ success: true, data: present(asset) });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/media/:id — remove bytes + row
router.delete('/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const asset = await prisma.mediaAsset.findFirst({ where: { id: String(req.params.id), organizationId: orgId } });
    if (!asset) throw new HttpError(404, 'Media asset not found');
    await deleteMedia(asset);
    await createAuditEvent({ organizationId: orgId, actorId: req.user!.employeeId, action: 'MEDIA_DELETED', resourceType: 'MEDIA_ASSET', resourceId: asset.id });
    res.json({ success: true, message: 'Media asset deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
