import { prisma } from '../db/client.js';

export async function createAuditEvent(data: {
  organizationId: string;
  actorId?: string;
  deviceId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  previousValue?: any;
  newValue?: any;
  metadata?: any;
}) {
  try {
    await prisma.auditEvent.create({ data });
  } catch (error) {
    console.error('Failed to create audit event:', error);
    // Don't throw - audit failures shouldn't break business operations
  }
}
