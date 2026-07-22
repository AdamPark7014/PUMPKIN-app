import { Injectable, NotFoundException } from '@nestjs/common';
import { EventStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DiscoveryService {
  constructor(private prisma: PrismaService) {}

  async listEvents(params: { orgId?: string; q?: string; limit?: number }) {
    const where = {
      status: { in: [EventStatus.SCHEDULED, EventStatus.LIVE] as EventStatus[] },
      ...(params.orgId ? { organizationId: params.orgId } : {}),
      ...(params.q
        ? {
            OR: [
              { title: { contains: params.q, mode: 'insensitive' as const } },
              { slug: { contains: params.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    return this.prisma.event.findMany({
      where,
      take: params.limit ?? 20,
      orderBy: { startsAt: 'asc' },
      include: {
        venue: { select: { name: true, city: true, slug: true } },
        organization: { select: { name: true, slug: true } },
        offers: {
          where: { isAvailable: true },
          select: { id: true, basePrice: true, zone: true },
        },
      },
    });
  }

  async getBySlug(slug: string) {
    const event = await this.prisma.event.findUnique({
      where: { slug },
      include: {
        venue: true,
        organization: { include: { tenantTheme: true } },
        offers: { where: { isAvailable: true } },
        seatMap: true,
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }
}


