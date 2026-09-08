import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';

const router = Router();

// GET /api/employees
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const employees = await prisma.employee.findMany({
      where: { organizationId: req.user!.organizationId! },
      include: {
        user: { select: { name: true, email: true, role: true } },
        locations: { include: { location: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: employees });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/employees/:id
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: String(req.params.id) },
      include: {
        user: { select: { name: true, email: true, role: true } },
        locations: { include: { location: true } },
        orders: { orderBy: { createdAt: 'desc' }, take: 10 },
        sessions: { orderBy: { openedAt: 'desc' }, take: 10 },
        timeEntries: { orderBy: { clockIn: 'desc' }, take: 20 },
      },
    });
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    res.json({ success: true, data: employee });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/employees/:id
router.put('/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { department, position, hourlyRate, isActive, employeeNumber } = z.object({
      department: z.string().optional(),
      position: z.string().optional(),
      hourlyRate: z.number().optional(),
      isActive: z.boolean().optional(),
      employeeNumber: z.string().optional(),
    }).parse(req.body);

    const employee = await prisma.employee.update({
      where: { id: String(req.params.id) },
      data: { department, position, hourlyRate, isActive, employeeNumber },
    });
    res.json({ success: true, data: employee });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/employees/:id/time - Clock in/out
router.post('/:id/time', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { action } = z.object({
      action: z.enum(['CLOCK_IN', 'CLOCK_OUT', 'BREAK_START', 'BREAK_END']),
    }).parse(req.body);

    const employeeId = String(req.params.id);

    if (action === 'CLOCK_IN') {
      const entry = await prisma.timeEntry.create({
        data: { employeeId, clockIn: new Date() },
      });
      return res.json({ success: true, data: entry });
    }

    // For other actions, find the active entry
    const activeEntry = await prisma.timeEntry.findFirst({
      where: { employeeId, clockOut: null },
      orderBy: { clockIn: 'desc' },
    });
    if (!activeEntry) return res.status(400).json({ success: false, message: 'No active time entry' });

    const updateData: any = {};
    if (action === 'CLOCK_OUT') updateData.clockOut = new Date();
    if (action === 'BREAK_START') updateData.breakStart = new Date();
    if (action === 'BREAK_END') updateData.breakEnd = new Date();

    const entry = await prisma.timeEntry.update({
      where: { id: activeEntry.id },
      data: updateData,
    });
    res.json({ success: true, data: entry });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/employees/:id/time-entries
router.get('/:id/time-entries', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const entries = await prisma.timeEntry.findMany({
      where: { employeeId: String(req.params.id) },
      orderBy: { clockIn: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: entries });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
