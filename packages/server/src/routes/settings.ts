import { Router, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { CURRENCY_CATALOG, isValidCurrency, normalizeCurrency } from '../data/currencies.js';

const router = Router();

// Allowed media types for the branding library (base64 data URLs — no multer dep).
const ALLOWED_MEDIA = [
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
  'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon', 'application/pdf',
];
const MAX_MEDIA_BYTES = 5 * 1024 * 1024; // 5 MB per item
const MAX_MEDIA_ITEMS = 24;

const socialLinksSchema = z.object({
  facebook: z.string().optional().nullable(),
  instagram: z.string().optional().nullable(),
  x: z.string().optional().nullable(),
  linkedin: z.string().optional().nullable(),
  youtube: z.string().optional().nullable(),
  tiktok: z.string().optional().nullable(),
}).optional().nullable();

const settingsSchema = z.object({
  storeName: z.string().min(1),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  phoneDialCode: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  receiptFooter: z.string().optional().nullable(),
  lowStockAlertEnabled: z.boolean().default(true),
  // Branding & business customization
  tagline: z.string().optional().nullable(),
  businessDescription: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  logoUrl: z.string().optional().nullable(),
  faviconUrl: z.string().optional().nullable(),
  coverUrl: z.string().optional().nullable(),
  brandPrimaryColor: z.string().optional().nullable(),
  brandSecondaryColor: z.string().optional().nullable(),
  socialLinks: socialLinksSchema,
  // Structured worldwide address
  streetAddress: z.string().optional().nullable(),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  countryCode: z.string().optional().nullable(),
  timezone: z.string().optional().nullable(),
  // ISO 4217 — any active world currency; normalised to upper-case on save.
  currency: z.string().optional().nullable()
    .refine((c) => c == null || isValidCurrency(c), 'Currency must be a valid ISO 4217 code (e.g. USD, EUR, NGN)'),
  taxId: z.string().optional().nullable(),
});

async function ensureSettings(orgId: string) {
  let settings = await prisma.storeSettings.findFirst({ where: { organizationId: orgId } });
  if (!settings) {
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    settings = await prisma.storeSettings.create({
      data: {
        organizationId: orgId,
        storeName: org?.name || 'My Store',
        phone: org?.phone,
        email: org?.email,
        address: org?.address,
        country: org?.country,
        countryCode: org?.countryCode,
        currency: org?.currency,
      },
    });
  }
  return settings;
}

// GET /api/settings
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const settings = await ensureSettings(req.user!.organizationId!);
    res.json({ success: true, data: settings });
  } catch (error) { handleError(error, res); }
});

// GET /api/settings/currencies — full ISO 4217 catalog (every active world currency)
router.get('/currencies', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, data: CURRENCY_CATALOG });
  } catch (error) { handleError(error, res); }
});

// PUT /api/settings
router.put('/', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), validateRequest(settingsSchema), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await ensureSettings(req.user!.organizationId!);
    // Build an explicit payload so unknown keys never reach Prisma.
    const {
      storeName, address, phone, phoneDialCode, email, receiptFooter, lowStockAlertEnabled,
      tagline, businessDescription, website, logoUrl, faviconUrl, coverUrl,
      brandPrimaryColor, brandSecondaryColor, socialLinks,
      streetAddress, addressLine2, city, state, postalCode, country, countryCode, timezone, currency, taxId,
    } = req.body;
    const data = {
      storeName, address, phone, phoneDialCode, email, receiptFooter, lowStockAlertEnabled,
      tagline, businessDescription, website, logoUrl, faviconUrl, coverUrl,
      brandPrimaryColor, brandSecondaryColor,
      socialLinks: socialLinks === undefined ? undefined : (socialLinks as any),
      streetAddress, addressLine2, city, state, postalCode, country, countryCode, timezone,
      currency: currency == null ? currency : normalizeCurrency(currency), taxId,
    };
    const settings = await prisma.storeSettings.update({ where: { id: existing.id }, data: data as any });
    res.json({ success: true, data: settings });
  } catch (error) { handleError(error, res); }
});

// POST /api/settings/media - upload a logo/graphic/media item (base64 data URL)
router.post('/media', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, dataUrl } = z.object({
      name: z.string().min(1),
      dataUrl: z.string().min(1),
    }).parse(req.body);

    const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
    if (!match) {
      return res.status(400).json({ success: false, message: 'Invalid media: expected a base64 data URL' });
    }
    const mime = match[1].toLowerCase();
    const base64 = match[2];
    if (!ALLOWED_MEDIA.includes(mime)) {
      return res.status(400).json({ success: false, message: `Unsupported media type: ${mime}` });
    }
    const sizeBytes = Math.ceil((base64.length * 3) / 4);
    if (sizeBytes > MAX_MEDIA_BYTES) {
      return res.status(400).json({ success: false, message: 'Media too large (max 5 MB per item)' });
    }

    const settings = await ensureSettings(req.user!.organizationId!);
    const existingMedia = Array.isArray(settings.media) ? (settings.media as any[]) : [];
    if (existingMedia.length >= MAX_MEDIA_ITEMS) {
      return res.status(400).json({ success: false, message: `Media library is full (max ${MAX_MEDIA_ITEMS} items)` });
    }
    const item = {
      id: crypto.randomUUID(),
      name,
      type: mime,
      dataUrl,
      size: sizeBytes,
      uploadedAt: new Date().toISOString(),
    };
    const media = [...existingMedia, item];
    const updated = await prisma.storeSettings.update({ where: { id: settings.id }, data: { media: media as any } });
    res.status(201).json({ success: true, data: { media, settings: updated } });
  } catch (error) { handleError(error, res); }
});

// DELETE /api/settings/media/:mediaId - remove a media item
router.delete('/media/:mediaId', authMiddleware, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const settings = await ensureSettings(req.user!.organizationId!);
    const existingMedia = Array.isArray(settings.media) ? (settings.media as any[]) : [];
    const mediaId = String(req.params.mediaId);
    if (!existingMedia.some((m) => m?.id === mediaId)) {
      return res.status(404).json({ success: false, message: 'Media item not found' });
    }
    const media = existingMedia.filter((m) => m?.id !== mediaId);
    const updated = await prisma.storeSettings.update({ where: { id: settings.id }, data: { media: media as any } });
    res.json({ success: true, data: { media, settings: updated } });
  } catch (error) { handleError(error, res); }
});

export default router;
