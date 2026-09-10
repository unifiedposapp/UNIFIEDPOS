import { prisma } from '../db/client.js';
import { publishRealtime } from './realtime.js';
import { notifySubscribers } from './webpush.js';

export interface BusinessEvent {
  organizationId: string;
  event: string;
  data: any;
  metadata?: any;
}

/**
 * Core event bus — implements the Definition of Done (§53) event propagation:
 * ORDER.COMPLETED → PAYMENT.CAPTURE → INVENTORY.CHANGED → CUSTOMER.UPDATED →
 * EMPLOYEE.SALES_UPDATED → ACCOUNTING.ENTRY_CREATED → ANALYTICS.UPDATED →
 * LOYALTY.POINTS_EARNED → MARKETING.UPDATED → AI.DATASET_UPDATED
 */
export async function emitEvent(event: BusinessEvent): Promise<void> {
  try {
    // Store event in database for audit trail
    await prisma.businessEvent.create({
      data: {
        organizationId: event.organizationId,
        event: event.event,
        data: event.data,
        metadata: event.metadata || {},
        status: 'PENDING',
      },
    });

    // Find all webhooks that subscribe to this event
    const webhooks = await prisma.webhook.findMany({
      where: {
        organizationId: event.organizationId,
        isActive: true,
        events: { has: event.event },
      },
    });

    // Deliver to each webhook
    for (const webhook of webhooks) {
      await deliverWebhook(webhook, event);
    }

    // Trigger internal event handlers
    await handleInternalEvent(event);

    // Fan out notable events to the Notification center (§5 Notification domain)
    await notifyFromEvent(event);

    // Stream the event to connected browsers over SSE (real-time UI updates).
    // In-process + non-blocking: a dropped socket never affects business logic.
    publishRealtime(event.organizationId, event.event, event.data);
  } catch (error) {
    console.error('Failed to emit event:', error);
    // Don't throw - event failures shouldn't break business operations
  }
}

/**
 * Notification fan-out rules (§5). Maps high-signal §27 business events to an
 * org-wide notification (userId = null) so every user in the tenant sees it in
 * their notification inbox / bell badge.
 */
const NOTIFICATION_RULES: Record<string, { type: string; severity: string; title: string; message: (d: any) => string }> = {
  'inventory.low_stock': { type: 'LOW_STOCK', severity: 'WARNING', title: 'Low stock alert', message: (d) => `Stock for ${d.productName || d.productId || 'an item'} is at or below its reorder point (${d.quantity ?? '?'} left).` },
  'inventory.out_of_stock': { type: 'OUT_OF_STOCK', severity: 'CRITICAL', title: 'Out of stock', message: (d) => `${d.productName || d.productId || 'An item'} is out of stock.` },
  'payment.failed': { type: 'PAYMENT_FAILED', severity: 'WARNING', title: 'Payment failed', message: (d) => `A payment of ${d.amount ?? ''} ${d.currency || ''} failed (${d.reason || 'declined'}).` },
  'chargeback.created': { type: 'CHARGEBACK', severity: 'CRITICAL', title: 'Chargeback received', message: (d) => `Chargeback ${d.id || ''} opened for ${d.amount ?? ''} ${d.currency || ''}.` },
  'dispute.created': { type: 'DISPUTE', severity: 'WARNING', title: 'Payment dispute', message: (d) => `Dispute ${d.id || ''} opened (${d.reason || 'under review'}).` },
  'device.offline': { type: 'DEVICE_OFFLINE', severity: 'WARNING', title: 'Device went offline', message: (d) => `Device ${d.deviceName || d.deviceId || ''} is offline.` },
  'register.closed': { type: 'SYSTEM', severity: 'INFO', title: 'Register closed', message: (d) => `A register session was closed (cash variance ${d.variance ?? 0}).` },
};

async function notifyFromEvent(event: BusinessEvent): Promise<void> {
  try {
    const rule = NOTIFICATION_RULES[event.event];
    if (!rule) return;
    const data = event.data || {};
    const message = rule.message(data);
    await prisma.notification.create({
      data: {
        organizationId: event.organizationId,
        userId: null,
        type: rule.type,
        severity: rule.severity,
        title: rule.title,
        message,
        data: event.data ?? undefined,
        sourceEvent: event.event,
      },
    });
    // Mirror high-signal notifications to web push (env-gated no-op when VAPID
    // is not configured). Org-wide since the in-app notification is org-wide.
    await notifySubscribers(event.organizationId, { title: rule.title, body: message, tag: rule.type, url: '/notifications' });
  } catch (error) {
    console.error('Failed to create notification from event:', error);
  }
}

async function deliverWebhook(webhook: any, event: BusinessEvent): Promise<void> {
  try {
    const payload = {
      event: event.event,
      data: event.data,
      timestamp: new Date().toISOString(),
      organizationId: event.organizationId,
    };

    const signature = await signPayload(JSON.stringify(payload), webhook.secret);

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': event.event,
      },
      body: JSON.stringify(payload),
    });

    await prisma.webhookDelivery.create({
      data: {
        webhookId: webhook.id,
        event: event.event,
        payload: payload,
        responseStatus: response.status,
        success: response.ok,
      },
    });

    await prisma.webhook.update({
      where: { id: webhook.id },
      data: {
        lastTriggeredAt: new Date(),
        successCount: response.ok ? { increment: 1 } : undefined,
        failureCount: !response.ok ? { increment: 1 } : undefined,
      },
    });
  } catch (error) {
    console.error('Webhook delivery failed:', error);

    await prisma.webhookDelivery.create({
      data: {
        webhookId: webhook.id,
        event: event.event,
        payload: { event: event.event, data: event.data },
        responseStatus: 0,
        success: false,
        errorMessage: String(error),
      },
    });

    await prisma.webhook.update({
      where: { id: webhook.id },
      data: { failureCount: { increment: 1 } },
    });
  }
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const crypto = await import('crypto');
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  return hmac.digest('hex');
}

/**
 * Internal event handler — routes events to domain-specific handlers.
 * Implements the full Definition of Done propagation chain.
 */
async function handleInternalEvent(event: BusinessEvent): Promise<void> {
  switch (event.event) {
    // ── ORDER EVENTS (§27) ──
    case 'order.created':
      await handleOrderCreated(event);
      break;

    case 'order.updated':
      await emitAnalyticsEvent(event.organizationId, 'order.updated', event.data);
      break;

    case 'order.completed':
      // Definition of Done: Full propagation chain
      await handleOrderCompleted(event);
      break;

    case 'order.cancelled':
      await handleOrderCancelled(event);
      break;

    // ── PAYMENT EVENTS (§27) ──
    case 'payment.created':
    case 'payment.authorized':
    case 'payment.captured':
      await createAccountingEntry(event.organizationId, event.data);
      await emitAnalyticsEvent(event.organizationId, event.event, event.data);
      break;

    case 'payment.completed':
      await createAccountingEntry(event.organizationId, event.data);
      break;

    case 'payment.failed':
      await emitAnalyticsEvent(event.organizationId, 'payment.failed', event.data);
      break;

    case 'payment.refunded':
      await handlePaymentRefunded(event);
      break;

    case 'payment.settled':
      await emitAnalyticsEvent(event.organizationId, 'payment.settled', event.data);
      break;

    // ── INVENTORY EVENTS (§27) ──
    case 'inventory.changed':
      if (event.data.quantity <= event.data.reorderPoint) {
        await emitEvent({
          organizationId: event.organizationId,
          event: 'inventory.low_stock',
          data: event.data,
        });
      }
      break;

    case 'inventory.low_stock':
      await emitAnalyticsEvent(event.organizationId, 'inventory.low_stock', event.data);
      break;

    case 'inventory.out_of_stock':
      await emitAnalyticsEvent(event.organizationId, 'inventory.out_of_stock', event.data);
      break;

    // ── CUSTOMER EVENTS (§27) ──
    case 'customer.created':
      if (event.data.id) {
        await updateCustomerStats(event.data.id);
      }
      await emitAnalyticsEvent(event.organizationId, 'customer.created', event.data);
      break;

    case 'customer.updated':
      if (event.data.id) {
        await updateCustomerStats(event.data.id);
      }
      await emitAnalyticsEvent(event.organizationId, 'customer.updated', event.data);
      break;

    // ── EMPLOYEE EVENTS (§27) ──
    case 'employee.updated':
      await emitAnalyticsEvent(event.organizationId, 'employee.updated', event.data);
      break;

    // ── LOYALTY EVENTS (§27) ──
    case 'loyalty.points_earned':
    case 'loyalty.reward_redeemed':
      await emitAnalyticsEvent(event.organizationId, event.event, event.data);
      break;

    // ── REFUND EVENTS (§27) ──
    case 'refund.created':
      await emitAnalyticsEvent(event.organizationId, 'refund.created', event.data);
      break;

    // ── REGISTER EVENTS (§27) ──
    case 'register.opened':
    case 'register.closed':
      // Already handled in route, just logged via BusinessEvent
      break;

    // ── DEVICE EVENTS (§27) ──
    case 'device.online':
    case 'device.offline':
      await emitAnalyticsEvent(event.organizationId, event.event, event.data);
      break;
  }
}

// ── ORDER HANDLERS ────────────────────────────────────────────────

async function handleOrderCreated(event: BusinessEvent): Promise<void> {
  // Emit analytics event for the new order
  await emitAnalyticsEvent(event.organizationId, 'order.created', event.data);
}

async function handleOrderCompleted(event: BusinessEvent): Promise<void> {
  const { customerId, employeeId, items, orderId, totalAmount } = event.data;
  const orgId = event.organizationId;

  // 1. INVENTORY DECREASED — Check inventory levels after sale
  if (items?.length) {
    await checkInventoryLevels(orgId, items);
  }

  // 2. CUSTOMER PROFILE UPDATED — Update customer stats (totalSpent, totalOrders, avgOrderValue)
  if (customerId) {
    await updateCustomerStats(customerId);
    await updateCustomerLastVisit(customerId);
  }

  // 3. EMPLOYEE SALES UPDATED — Track employee performance
  if (employeeId) {
    await updateEmployeeSales(employeeId, totalAmount);
  }

  // 4. ACCOUNTING ENTRY CREATED — Create financial record
  await createAccountingEntry(orgId, {
    id: orderId,
    amount: totalAmount,
    method: event.data.paymentMethod || 'CASH',
    currency: event.data.currency || 'USD',
  });

  // 5. ANALYTICS UPDATED — Record for BI
  await emitAnalyticsEvent(orgId, 'order.completed', event.data);

  // 6. LOYALTY POINTS EARNED — Award loyalty points
  if (customerId) {
    await awardLoyaltyPoints(orgId, customerId, totalAmount);
  }

  // 7. MARKETING DATA UPDATED — Update segment data
  await emitMarketingUpdate(orgId, event.data);

  // 8. AI DATASET UPDATED — Update AI feature data
  await emitAIUpdate(orgId, 'order.completed', event.data);
}

async function handleOrderCancelled(event: BusinessEvent): Promise<void> {
  // Restore inventory if order had items reserved
  if (event.data.items?.length) {
    for (const item of event.data.items) {
      const balance = await prisma.inventoryBalance.findFirst({
        where: { productId: item.productId, locationId: event.data.locationId },
      });
      if (balance) {
        await prisma.inventoryBalance.update({
          where: { id: balance.id },
          data: { quantity: { increment: item.quantity } },
        });
        await prisma.inventoryMovement.create({
          data: {
            balanceId: balance.id,
            type: 'RETURN',
            quantity: item.quantity,
            reference: event.data.orderId,
          },
        });
      }
    }
  }
  await emitAnalyticsEvent(event.organizationId, 'order.cancelled', event.data);
}

// ── PAYMENT HANDLERS ──────────────────────────────────────────────

async function handlePaymentRefunded(event: BusinessEvent): Promise<void> {
  const { orderId, amount, customerId } = event.data;
  // Create negative accounting entry for refund
  await prisma.accountingEntry.create({
    data: {
      organizationId: event.organizationId,
      type: 'REFUND',
      referenceType: 'REFUND',
      referenceId: orderId,
      amount: -Math.abs(amount),
      currency: 'USD',
      description: `Refund for order ${orderId}`,
      status: 'POSTED',
      postedAt: new Date(),
    },
  });

  // Update customer stats after refund
  if (customerId) {
    await updateCustomerStats(customerId);
  }

  await emitAnalyticsEvent(event.organizationId, 'refund.created', event.data);
}

// ── CUSTOMER HANDLERS ─────────────────────────────────────────────

async function updateCustomerStats(customerId: string): Promise<void> {
  const orders = await prisma.order.count({
    where: { customerId, status: { in: ['PAID', 'COMPLETED'] } },
  });

  const total = await prisma.order.aggregate({
    where: { customerId, status: { in: ['PAID', 'COMPLETED'] } },
    _sum: { totalAmount: true },
  });

  const totalSpent = Number(total._sum?.totalAmount || 0);
  const averageOrderValue = orders > 0 ? totalSpent / orders : 0;

  // Calculate visit frequency (orders per month since first order)
  const firstOrder = await prisma.order.findFirst({
    where: { customerId },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });

  let visitFrequency = 0;
  if (firstOrder) {
    const monthsSinceFirst = Math.max(1, Math.ceil((Date.now() - firstOrder.createdAt.getTime()) / (30 * 24 * 60 * 60 * 1000)));
    visitFrequency = orders / monthsSinceFirst;
  }

  await prisma.customer.update({
    where: { id: customerId },
    data: {
      totalOrders: orders,
      totalSpent,
      averageOrderValue,
      visitFrequency: Math.round(visitFrequency * 100) / 100,
      lastVisitAt: new Date(),
    },
  });
}

async function updateCustomerLastVisit(customerId: string): Promise<void> {
  await prisma.customer.update({
    where: { id: customerId },
    data: { lastVisitAt: new Date() },
  });
}

// ── EMPLOYEE HANDLERS ─────────────────────────────────────────────

async function updateEmployeeSales(employeeId: string, amount: number): Promise<void> {
  // Track employee total sales for performance metrics
  try {
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (employee) {
      // Update commission if applicable
      if (employee.commissionRate && Number(employee.commissionRate) > 0) {
        const commissionAmount = amount * (Number(employee.commissionRate) / 100);
        await prisma.commission.create({
          data: {
            organizationId: employee.organizationId,
            employeeId,
            orderId: '',
            amount: commissionAmount,
            rate: Number(employee.commissionRate),
            status: 'PENDING',
          },
        });
      }
    }
  } catch (e) {
    console.error('Failed to update employee sales:', e);
  }
}

// ── INVENTORY HANDLERS ────────────────────────────────────────────

async function checkInventoryLevels(organizationId: string, items: any[]): Promise<void> {
  for (const item of items) {
    const balance = await prisma.inventoryBalance.findFirst({
      where: { productId: item.productId },
    });

    if (balance) {
      if (balance.quantity <= 0) {
        await emitEvent({
          organizationId,
          event: 'inventory.out_of_stock',
          data: {
            productId: item.productId,
            quantity: balance.quantity,
            reorderPoint: balance.reorderPoint,
          },
        });
      } else if (balance.quantity <= balance.reorderPoint) {
        await emitEvent({
          organizationId,
          event: 'inventory.low_stock',
          data: {
            productId: item.productId,
            quantity: balance.quantity,
            reorderPoint: balance.reorderPoint,
          },
        });
      }
    }
  }
}

// ── ACCOUNTING HANDLERS ───────────────────────────────────────────

async function createAccountingEntry(organizationId: string, paymentData: any): Promise<void> {
  await prisma.accountingEntry.create({
    data: {
      organizationId,
      type: 'PAYMENT',
      referenceType: 'PAYMENT',
      referenceId: paymentData.id,
      amount: paymentData.amount,
      currency: paymentData.currency || 'USD',
      description: `Payment ${paymentData.id} - ${paymentData.method}`,
      status: 'POSTED',
      postedAt: new Date(),
    },
  });
}

// ── LOYALTY HANDLERS ──────────────────────────────────────────────

async function awardLoyaltyPoints(organizationId: string, customerId: string, amount: number): Promise<void> {
  try {
    const program = await prisma.loyaltyProgram.findFirst({
      where: { organizationId, isActive: true },
    });

    if (!program) return;

    const pointsEarned = Math.floor(amount * Number(program.pointsPerDollar)) + program.pointsPerVisit;
    if (pointsEarned <= 0) return;

    // Update customer loyalty points first so we can record the resulting balance.
    const updatedCustomer = await prisma.customer.update({
      where: { id: customerId },
      data: { loyaltyPoints: { increment: pointsEarned } },
      select: { loyaltyPoints: true },
    });

    // Create loyalty transaction. LoyaltyTransaction has no `type`/`description`
    // fields — it records a signed `points` delta, a `reason`, and `balanceAfter`.
    await prisma.loyaltyTransaction.create({
      data: {
        organizationId,
        customerId,
        programId: program.id,
        points: pointsEarned,
        reason: 'EARNED_FROM_PURCHASE',
        referenceType: 'ORDER',
        balanceAfter: updatedCustomer.loyaltyPoints,
      },
    });

    // Emit loyalty event
    await emitEvent({
      organizationId,
      event: 'loyalty.points_earned',
      data: { customerId, points: pointsEarned, amount },
    });
  } catch (e) {
    console.error('Failed to award loyalty points:', e);
  }
}

// ── ANALYTICS HANDLERS ────────────────────────────────────────────

async function emitAnalyticsEvent(organizationId: string, eventType: string, data: any): Promise<void> {
  // Analytics events are stored as business events for the analytics engine to consume
  // In a production system, this would push to a dedicated analytics store
  try {
    await prisma.businessEvent.updateMany({
      where: {
        organizationId,
        event: eventType,
        data: { equals: data },
      },
      data: { status: 'PROCESSED' },
    });
  } catch (e) {
    // Silent fail — analytics should never block business operations
  }
}

// ── MARKETING HANDLERS ────────────────────────────────────────────

async function emitMarketingUpdate(organizationId: string, orderData: any): Promise<void> {
  // Marketing data is implicitly updated through customer stats
  // This hook exists for future marketing automation triggers
  // e.g., abandoned cart recovery, repeat purchase campaigns
  try {
    if (orderData.customerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: orderData.customerId },
        select: { totalOrders: true, totalSpent: true, lastVisitAt: true },
      });

      if (customer) {
        // Check if customer qualifies for any automated segment
        // This is a placeholder for the marketing automation engine
        await emitEvent({
          organizationId,
          event: 'marketing.customer_activity',
          data: {
            customerId: orderData.customerId,
            totalOrders: customer.totalOrders,
            totalSpent: customer.totalSpent,
          },
        });
      }
    }
  } catch (e) {
    console.error('Marketing update failed:', e);
  }
}

// ── AI HANDLERS ───────────────────────────────────────────────────

async function emitAIUpdate(organizationId: string, eventType: string, _data: any): Promise<void> {
  // AI dataset is updated through business events that the AI copilot consumes
  // The copilot reads orders, inventory, customers directly from the database
  // This hook marks the event as processed for the AI pipeline
  try {
    await emitEvent({
      organizationId,
      event: 'ai.dataset_updated',
      data: { eventType, timestamp: new Date().toISOString() },
    });
  } catch (e) {
    // Silent fail
  }
}
