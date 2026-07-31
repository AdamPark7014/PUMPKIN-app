import { Injectable } from '@nestjs/common';
import { PrismaService } from '../modules/prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(params: {
    action: string;
    entityType: string;
    entityId?: string;
    organizationId?: string;
    userId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const metadata = {
      ...params.metadata,
      ...(params.userAgent ? { userAgent: params.userAgent.slice(0, 512) } : {}),
    };
    return this.prisma.auditEvent.create({
      data: {
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        organizationId: params.organizationId,
        userId: params.userId,
        metadata,
        ipAddress: params.ipAddress,
      },
    });
  }
}


