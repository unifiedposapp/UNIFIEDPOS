import { Router, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { createAuditEvent } from '../utils/audit.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// DEVICE LIFECYCLE (§38)
// ═══════════════════════════════════════════════════════════════

// GET /api/devices - List all devices
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const devices = await prisma.device.findMany({
      where: { organizationId: req.user!.organizationId! },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: devices });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/devices - Register a new device (§38)
router.post('/', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, type, locationId, registerId } = z.object({
      name: z.string().min(1),
      type: z.enum(['POS_TERMINAL', 'MOBILE', 'KIOSK', 'KITCHEN_DISPLAY']).default('POS_TERMINAL'),
      locationId: z.string().optional(),
      registerId: z.string().optional(),
    }).parse(req.body);

    // Generate device credential
    const deviceCredential = `dc_${crypto.randomBytes(32).toString('hex')}`;

    const device = await prisma.device.create({
      data: {
        organizationId: req.user!.organizationId!,
        name,
        type,
        locationId,
        registerId,
        deviceCredential,
        status: 'ONLINE',
        softwareVersion: '1.0.0',
      },
    });

    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: 'DEVICE_REGISTERED',
      resourceType: 'DEVICE',
      resourceId: device.id,
      newValue: { name, type, locationId, registerId },
    });

    res.status(201).json({
      success: true,
      data: {
        id: device.id,
        name: device.name,
        type: device.type,
        deviceCredential, // Only returned once
        status: device.status,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/devices/:id/assign - Assign device to location/register
router.put('/:id/assign', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { locationId, registerId } = z.object({
      locationId: z.string().optional(),
      registerId: z.string().optional(),
    }).parse(req.body);

    const device = await prisma.device.update({
      where: { id: String(req.params.id) },
      data: { locationId, registerId },
    });

    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: 'DEVICE_ASSIGNED',
      resourceType: 'DEVICE',
      resourceId: device.id,
      newValue: { locationId, registerId },
    });

    res.json({ success: true, data: device });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/devices/:id/status - Update device status
router.put('/:id/status', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { status } = z.object({
      status: z.enum(['ONLINE', 'OFFLINE', 'MAINTENANCE', 'RETIRED']),
    }).parse(req.body);

    const device = await prisma.device.update({
      where: { id: String(req.params.id) },
      data: { status },
    });

    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: `DEVICE_${status.toUpperCase()}`,
      resourceType: 'DEVICE',
      resourceId: device.id,
    });

    res.json({ success: true, data: device });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/devices/:id - Retire a device
router.delete('/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const device = await prisma.device.update({
      where: { id: String(req.params.id) },
      data: { status: 'RETIRED', deviceCredential: null },
    });

    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: 'DEVICE_RETIRED',
      resourceType: 'DEVICE',
      resourceId: device.id,
    });

    res.json({ success: true, data: device });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/devices/:id/heartbeat - Device heartbeat
router.post('/:id/heartbeat', async (req: AuthRequest, res: Response) => {
  try {
    const { softwareVersion, configVersion } = z.object({
      softwareVersion: z.string().optional(),
      configVersion: z.string().optional(),
    }).parse(req.body);

    await prisma.device.update({
      where: { id: String(req.params.id) },
      data: {
        lastHeartbeatAt: new Date(),
        status: 'ONLINE',
        softwareVersion,
        configVersion,
      },
    });

    res.json({ success: true, data: { status: 'ok', nextHeartbeatIn: 60 } });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/devices/:id/sync-config - Get device sync configuration
router.get('/:id/sync-config', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const device = await prisma.device.findUnique({
      where: { id: String(req.params.id) },
    });

    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

    // Get store settings for this device
    const settings = await prisma.storeSettings.findFirst({
      where: { organizationId: req.user!.organizationId! },
    });

    // Get latest config version
    const configVersion = crypto.createHash('md5')
      .update(JSON.stringify({ settings, updatedAt: new Date().toISOString() }))
      .digest('hex')
      .substring(0, 8);

    // Update last sync
    await prisma.device.update({
      where: { id: device.id },
      data: { lastSyncAt: new Date(), configVersion },
    });

    res.json({
      success: true,
      data: {
        configVersion,
        settings: {
          storeName: settings?.storeName,
          taxRate: 0, // Will be filled from org
          receiptFooter: settings?.receiptFooter,
          lowStockAlertEnabled: settings?.lowStockAlertEnabled,
        },
        syncInterval: 30000, // 30 seconds
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/devices/:id/revoke - Revoke device credential
router.post('/:id/revoke', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const device = await prisma.device.update({
      where: { id: String(req.params.id) },
      data: { deviceCredential: null, status: 'OFFLINE' },
    });

    await createAuditEvent({
      organizationId: req.user!.organizationId!,
      actorId: req.user!.employeeId,
      action: 'DEVICE_REVOKED',
      resourceType: 'DEVICE',
      resourceId: device.id,
    });

    res.json({ success: true, data: device });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/devices/overview - Device status overview
router.get('/overview', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const devices = await prisma.device.findMany({
      where: { organizationId: req.user!.organizationId! },
    });

    const summary = {
      total: devices.length,
      online: devices.filter(d => d.status === 'ONLINE').length,
      offline: devices.filter(d => d.status === 'OFFLINE').length,
      maintenance: devices.filter(d => d.status === 'MAINTENANCE').length,
      retired: devices.filter(d => d.status === 'RETIRED').length,
      byType: devices.reduce((acc, d) => {
        acc[d.type] = (acc[d.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };

    res.json({ success: true, data: { devices, summary } });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
