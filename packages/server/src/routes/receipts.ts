import { Router, Response } from 'express';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { complianceFor, receiptFooterFor } from '../data/complianceProfiles.js';

const router = Router();

// GET /api/receipts/:orderId - Generate receipt data for an order
router.get('/:orderId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: String(req.params.orderId) },
      include: {
        items: {
          include: {
            product: true,
          },
        },
        payments: true,
        customer: true,
        employee: {
          include: {
            user: { select: { name: true, email: true } },
          },
        },
        location: true,
        register: true,
      },
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Get store settings
    const settings = await prisma.storeSettings.findFirst({
      where: { organizationId: req.user!.organizationId },
    });

    // Calculate totals
    const subtotal = Number(order.subtotal);
    const tax = Number(order.taxAmount);
    const discount = Number(order.discountAmount);
    const total = Number(order.totalAmount);
    const tip = Number(order.tipAmount);
    const paid = order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const change = paid - total;

    const receiptData = {
      // Store info
      storeName: settings?.storeName || 'POS Store',
      storeAddress: settings?.address || order.location?.address || '',
      storePhone: settings?.phone || order.location?.phone || '',
      storeEmail: settings?.email || '',
      
      // Receipt metadata
      orderNumber: order.orderNumber,
      orderDate: order.createdAt.toISOString(),
      orderStatus: order.status,
      
      // Location & Register
      locationName: order.location?.name || '',
      registerName: order.register?.name || '',
      
      // Employee
      cashierName: order.employee?.user.name || 'N/A',
      
      // Customer
      customerName: order.customer?.name || 'Walk-in Customer',
      customerEmail: order.customer?.email || '',
      customerPhone: order.customer?.phone || '',
      
      // Items
      items: order.items.map((item) => ({
        name: item.productName,
        variant: item.variantName || null,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        discount: Number(item.discountAmt),
        total: Number(item.totalAmount),
      })),
      
      // Totals
      subtotal,
      discount,
      tax,
      tip,
      total,
      
      // Payments
      payments: order.payments.map((p) => ({
        method: p.method,
        amount: Number(p.amount),
        status: p.status,
      })),
      
      paid,
      change: change > 0 ? change : 0,
      
      // Footer
      receiptFooter: settings?.receiptFooter || 'Thank you for your business!',

      // Regional compliance guidance (§ country compliance profiles): the
      // market's privacy law, tax-ID label and default legal receipt lines.
      compliance: (() => {
        const cc = settings?.countryCode;
        const prof = complianceFor(cc);
        return {
          countryCode: cc || null,
          privacyLaw: prof.privacyLaw,
          dataResidency: prof.dataResidency,
          taxIdLabel: prof.taxIdLabel,
          eInvoiceFormat: prof.eInvoiceFormat || null,
          legalFooter: receiptFooterFor(cc, { taxId: settings?.taxId || prof.taxIdLabel, receiptNumber: order.orderNumber }),
        };
      })(),
      
      // Currency
      currency: order.currency,
    };

    res.json({ success: true, data: receiptData });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
