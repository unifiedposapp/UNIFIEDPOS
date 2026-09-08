import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// ROLES (§15)
// ═══════════════════════════════════════════════════════════════

// GET /api/permissions/roles
router.get('/roles', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const roles = await prisma.role.findMany({
      where: { organizationId: req.user!.organizationId! },
      include: {
        permissions: {
          include: { permission: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: roles });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/permissions/roles - Create a custom role
router.post('/roles', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, permissionIds } = z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      permissionIds: z.array(z.string()).optional(),
    }).parse(req.body);

    // Check if role name already exists for this org
    const existing = await prisma.role.findFirst({
      where: { organizationId: req.user!.organizationId!, name },
    });
    if (existing) return res.status(409).json({ success: false, message: 'Role name already exists' });

    const role = await prisma.role.create({
      data: {
        organizationId: req.user!.organizationId!,
        name,
        description,
        permissions: permissionIds
          ? { create: permissionIds.map(pid => ({ permissionId: pid })) }
          : undefined,
      },
      include: { permissions: { include: { permission: true } } },
    });

    res.status(201).json({ success: true, data: role });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/permissions/roles/:id
router.put('/roles/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { description, isActive } = z.object({
      description: z.string().optional(),
      isActive: z.boolean().optional(),
    }).parse(req.body);

    const role = await prisma.role.findFirst({
      where: { id: String(req.params.id), organizationId: req.user!.organizationId! },
    });
    if (!role) return res.status(404).json({ success: false, message: 'Role not found' });
    if (role.isSystem) return res.status(403).json({ success: false, message: 'Cannot modify system roles' });

    const updated = await prisma.role.update({
      where: { id: role.id },
      data: { description, isActive },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/permissions/roles/:id
router.delete('/roles/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const role = await prisma.role.findFirst({
      where: { id: String(req.params.id), organizationId: req.user!.organizationId! },
    });
    if (!role) return res.status(404).json({ success: false, message: 'Role not found' });
    if (role.isSystem) return res.status(403).json({ success: false, message: 'Cannot delete system roles' });

    await prisma.role.delete({ where: { id: role.id } });
    res.json({ success: true, message: 'Role deleted' });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/permissions/roles/:id/permissions - Set permissions for a role
router.put('/roles/:id/permissions', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { permissionIds } = z.object({
      permissionIds: z.array(z.string()),
    }).parse(req.body);

    const roleId = String(req.params.id);

    // Delete existing permissions and create new ones
    await prisma.rolePermission.deleteMany({ where: { roleId } });
    await prisma.rolePermission.createMany({
      data: permissionIds.map(pid => ({ roleId, permissionId: pid })),
    });

    const role = await prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: { include: { permission: true } } },
    });
    res.json({ success: true, data: role });
  } catch (error) {
    handleError(error, res);
  }
});

// ═══════════════════════════════════════════════════════════════
// PERMISSIONS (§15)
// ═══════════════════════════════════════════════════════════════

// GET /api/permissions - List all available permissions
router.get('/', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const permissions = await prisma.permission.findMany({
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    });
    res.json({ success: true, data: permissions });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/permissions/seed - Seed default permissions (admin only)
router.post('/seed', authMiddleware, requireRole('OWNER'), async (_req: AuthRequest, res: Response) => {
  try {
    const defaultPermissions = [
      // Order permissions
      { resource: 'ORDER', action: 'CREATE' },
      { resource: 'ORDER', action: 'READ' },
      { resource: 'ORDER', action: 'UPDATE' },
      { resource: 'ORDER', action: 'VOID' },
      { resource: 'ORDER', action: 'REFUND' },
      { resource: 'ORDER', action: 'DISCOUNT' },
      { resource: 'ORDER', action: 'HOLD' },
      // Payment permissions
      { resource: 'PAYMENT', action: 'CREATE' },
      { resource: 'PAYMENT', action: 'READ' },
      { resource: 'PAYMENT', action: 'REFUND' },
      { resource: 'PAYMENT', action: 'VOID' },
      // Product permissions
      { resource: 'PRODUCT', action: 'CREATE' },
      { resource: 'PRODUCT', action: 'READ' },
      { resource: 'PRODUCT', action: 'UPDATE' },
      { resource: 'PRODUCT', action: 'DELETE' },
      { resource: 'PRODUCT', action: 'PRICE_CHANGE' },
      // Inventory permissions
      { resource: 'INVENTORY', action: 'READ' },
      { resource: 'INVENTORY', action: 'ADJUST' },
      { resource: 'INVENTORY', action: 'TRANSFER' },
      { resource: 'INVENTORY', action: 'COUNT' },
      // Customer permissions
      { resource: 'CUSTOMER', action: 'CREATE' },
      { resource: 'CUSTOMER', action: 'READ' },
      { resource: 'CUSTOMER', action: 'UPDATE' },
      { resource: 'CUSTOMER', action: 'DELETE' },
      // Employee permissions
      { resource: 'EMPLOYEE', action: 'CREATE' },
      { resource: 'EMPLOYEE', action: 'READ' },
      { resource: 'EMPLOYEE', action: 'UPDATE' },
      { resource: 'EMPLOYEE', action: 'DELETE' },
      // Report permissions
      { resource: 'REPORT', action: 'READ' },
      { resource: 'REPORT', action: 'EXPORT' },
      // Settings permissions
      { resource: 'SETTINGS', action: 'READ' },
      { resource: 'SETTINGS', action: 'UPDATE' },
    ];

    const created = [];
    for (const perm of defaultPermissions) {
      const existing = await prisma.permission.findUnique({
        where: { resource_action: { resource: perm.resource, action: perm.action } },
      });
      if (!existing) {
        const p = await prisma.permission.create({ data: perm });
        created.push(p);
      }
    }

    // Create system roles if they don't exist
    const orgId = _req.user!.organizationId!;
    const systemRoles = ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'];
    for (const roleName of systemRoles) {
      const existing = await prisma.role.findFirst({
        where: { organizationId: orgId, name: roleName },
      });
      if (!existing) {
        await prisma.role.create({
          data: {
            organizationId: orgId,
            name: roleName,
            isSystem: true,
          },
        });
      }
    }

    res.json({ success: true, data: { created: created.length, message: 'Permissions and system roles seeded' } });
  } catch (error) {
    handleError(error, res);
  }
});

// ═══════════════════════════════════════════════════════════════
// EMPLOYEE ROLE ASSIGNMENT (§15)
// ═══════════════════════════════════════════════════════════════

// PUT /api/permissions/employees/:id/role - Assign role to employee
router.put('/employees/:id/role', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { roleId } = z.object({ roleId: z.string() }).parse(req.body);

    const employee = await prisma.employee.update({
      where: { id: String(req.params.id) },
      data: { roleId },
      include: { role: true },
    });
    res.json({ success: true, data: employee });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/permissions/check - Check if current user has a specific permission
router.get('/check', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { resource, action } = req.query;
    if (!resource || !action) {
      return res.status(400).json({ success: false, message: 'resource and action are required' });
    }

    const employeeId = req.user!.employeeId;
    if (!employeeId) return res.json({ success: true, data: { hasPermission: false } });

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });

    if (!employee || !employee.role) {
      return res.json({ success: true, data: { hasPermission: false } });
    }

    // System OWNER role has all permissions
    if (employee.role.name === 'OWNER') {
      return res.json({ success: true, data: { hasPermission: true } });
    }

    const hasPermission = employee.role.permissions.some(
      rp => rp.permission.resource === String(resource) && rp.permission.action === String(action)
    );

    res.json({ success: true, data: { hasPermission, role: employee.role.name } });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
