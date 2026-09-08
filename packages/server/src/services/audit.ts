import { prisma } from '../db/client.js';

export async function createAuditEvent(params: {
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
  return prisma.auditEvent.create({ data: params });
}
