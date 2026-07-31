import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ApiPartnerDto, ChannelConfigDto, TaquillaLocationDto } from './channel.dto';

type ChannelInventoryBucket = {
  tickets: number;
  available: number;
  allocated: number;
  sold: number;
};

type ChannelInventory = {
  web: ChannelInventoryBucket;
  taquilla: ChannelInventoryBucket;
  api: ChannelInventoryBucket;
  phone: ChannelInventoryBucket;
};

type ApiPartnerRecord = {
  id: string;
  name: string;
  apiKeyHash: string;
  allocation: number;
  commissionRate: number;
  rateLimit: number;
  active: boolean;
  createdAt: string;
};

type TaquillaLocationRecord = TaquillaLocationDto & { id: string; createdAt: string };

type OrderAggRow = {
  channel: string | null;
  status: string;
  totalAmount: unknown;
  createdAt: Date;
};

type EventMetadata = {
  channels?: ChannelConfigDto;
  channelInventory?: ChannelInventory;
  apiPartners?: ApiPartnerRecord[];
  taquillaLocations?: TaquillaLocationRecord[];
  channelConfiguredAt?: string;
  lastReallocationAt?: string;
  [key: string]: unknown;
};

@Injectable()
export class ChannelManagementService {
  private readonly logger = new Logger(ChannelManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private asMetadata(metadata: unknown): EventMetadata {
    return typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
      ? ({ ...(metadata as EventMetadata) } as EventMetadata)
      : {};
  }

  private async requireOwnedEvent(eventId: string) {
    const context = this.tenant.current();
    const event = await this.prisma.event.findFirst({
      where: context.privileged
        ? { id: eventId }
        : { id: eventId, organizationId: this.tenant.requireOrganization() },
      select: { id: true, organizationId: true, metadata: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');
    this.tenant.assertOrganization(event.organizationId);
    return event;
  }

  private emptyBucket(tickets: number): ChannelInventoryBucket {
    return { tickets, available: tickets, allocated: 0, sold: 0 };
  }

  private readChannelInventory(metadata: unknown): ChannelInventory {
    const inv = this.asMetadata(metadata).channelInventory;
    return {
      web: { ...this.emptyBucket(0), ...(inv?.web ?? {}) },
      taquilla: { ...this.emptyBucket(0), ...(inv?.taquilla ?? {}) },
      api: { ...this.emptyBucket(0), ...(inv?.api ?? {}) },
      phone: { ...this.emptyBucket(0), ...(inv?.phone ?? {}) },
    };
  }

  private readApiPartners(metadata: unknown): ApiPartnerRecord[] {
    const partners = this.asMetadata(metadata).apiPartners;
    return Array.isArray(partners) ? [...partners] : [];
  }

  private readTaquillaLocations(metadata: unknown): TaquillaLocationRecord[] {
    const locations = this.asMetadata(metadata).taquillaLocations;
    return Array.isArray(locations) ? [...locations] : [];
  }

  private hashApiKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  async configureChannels(eventId: string, config: ChannelConfigDto) {
    const totalAllocation =
      (config.web?.allocation || 0) +
      (config.taquilla?.allocation || 0) +
      (config.api?.allocation || 0) +
      (config.phone?.allocation || 0);

    if (totalAllocation !== 100) {
      throw new BadRequestException(
        `La asignación de canales debe sumar 100%; se recibió ${totalAllocation}%`,
      );
    }

    const existing = await this.requireOwnedEvent(eventId);
    const prev = this.asMetadata(existing.metadata);

    const event = await this.prisma.event.update({
      where: { id: eventId },
      data: {
        metadata: {
          ...prev,
          channels: {
            web: config.web,
            taquilla: config.taquilla,
            api: config.api,
            phone: config.phone,
          },
          channelConfiguredAt: new Date().toISOString(),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await this.audit.log({
      action: 'CHANNELS_CONFIGURED',
      entityType: 'Event',
      entityId: eventId,
      organizationId: existing.organizationId,
      userId: this.tenant.current().userId,
      metadata: { allocations: totalAllocation },
    });

    this.logger.log(`Channels configured for event ${eventId}`);
    return event;
  }

  async allocateInventoryToChannels(eventId: string, totalTickets: number) {
    if (!Number.isInteger(totalTickets) || totalTickets < 0) {
      throw new BadRequestException('El total de boletos debe ser un entero no negativo');
    }

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; organizationId: string; metadata: unknown }>>`
        SELECT id, "organizationId", metadata
        FROM "Event"
        WHERE id = ${eventId}
        FOR UPDATE
      `;
      const locked = rows[0];
      if (!locked) throw new NotFoundException('Evento no encontrado');
      this.tenant.assertOrganization(locked.organizationId);

      const context = this.tenant.current();
      if (!context.privileged && locked.organizationId !== context.organizationId) {
        throw new NotFoundException('Evento no encontrado');
      }

      const metadata = this.asMetadata(locked.metadata);
      const channels = (metadata.channels ?? {}) as Record<string, { allocation?: number }>;

      const allocation: ChannelInventory = {
        web: this.emptyBucket(Math.floor(totalTickets * ((channels.web?.allocation || 0) / 100))),
        taquilla: this.emptyBucket(
          Math.floor(totalTickets * ((channels.taquilla?.allocation || 0) / 100)),
        ),
        api: this.emptyBucket(Math.floor(totalTickets * ((channels.api?.allocation || 0) / 100))),
        phone: this.emptyBucket(
          Math.floor(totalTickets * ((channels.phone?.allocation || 0) / 100)),
        ),
      };

      const allocated = Object.values(allocation).reduce((sum, ch) => sum + ch.tickets, 0);
      const remainder = totalTickets - allocated;
      if (remainder > 0) {
        allocation.web.tickets += remainder;
        allocation.web.available += remainder;
      }

      await tx.event.update({
        where: { id: eventId },
        data: {
          metadata: {
            ...metadata,
            channelInventory: allocation,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      this.logger.log(`Inventory allocated to channels for event ${eventId}`);
      return { allocation, organizationId: locked.organizationId };
    }).then(async ({ allocation, organizationId }) => {
      await this.audit.log({
        action: 'CHANNEL_INVENTORY_ALLOCATED',
        entityType: 'Event',
        entityId: eventId,
        organizationId,
        userId: this.tenant.current().userId,
        metadata: { totalTickets },
      });
      return allocation;
    });
  }

  async getChannelHealth(eventId: string) {
    const event = await this.requireOwnedEvent(eventId);

    const [tickets, holds, orders, readyTerminals] = await Promise.all([
      this.prisma.ticket.groupBy({
        by: ['status'],
        where: { eventId },
        _count: true,
      }),
      this.prisma.seatHold.count({
        where: { eventId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      }),
      this.prisma.order.groupBy({
        by: ['channel'],
        where: { eventId, organizationId: event.organizationId },
        _count: true,
        _sum: { totalAmount: true },
      }),
      this.prisma.posTerminal.count({
        where: {
          status: 'READY',
          organizationId: event.organizationId,
        },
      }),
    ]);

    const channelStats: Record<
      string,
      { total: number; sold: number; held: number; orders: number; revenue: number }
    > = {
      WEB: { total: 0, sold: 0, held: 0, orders: 0, revenue: 0 },
      TAQUILLA: { total: 0, sold: 0, held: 0, orders: 0, revenue: 0 },
      API: { total: 0, sold: 0, held: 0, orders: 0, revenue: 0 },
      ADMIN: { total: 0, sold: 0, held: 0, orders: 0, revenue: 0 },
    };

    const soldCount = tickets.find((t) => t.status === 'SOLD')?._count ?? 0;
    const availCount = tickets.find((t) => t.status === 'AVAILABLE')?._count ?? 0;

    orders.forEach((o) => {
      const ch = channelStats[o.channel] ?? channelStats.WEB;
      ch.orders = o._count;
      ch.revenue = Number(o._sum.totalAmount ?? 0);
      ch.sold = o._count;
    });

    channelStats.WEB.total = soldCount + availCount;
    channelStats.WEB.held = holds;

    const inventory = this.readChannelInventory(event.metadata);
    const partners = this.readApiPartners(event.metadata);

    return {
      web: {
        status: 'healthy',
        responseTimeMs: 0,
        errorRate: 0,
        quota: inventory.web,
        ...channelStats.WEB,
      },
      taquilla: {
        status: 'healthy',
        syncLagSec: 0,
        activeTerminals: readyTerminals,
        errorRate: 0,
        quota: inventory.taquilla,
        ...channelStats.TAQUILLA,
      },
      api: {
        status: 'healthy',
        activePartners: partners.filter((partner) => partner.active).length,
        rateLimitUsage: 0,
        errorRate: 0,
        quota: inventory.api,
        ...channelStats.API,
      },
    };
  }

  async dynamicReallocate(eventId: string) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; organizationId: string; metadata: unknown }>>`
        SELECT id, "organizationId", metadata
        FROM "Event"
        WHERE id = ${eventId}
        FOR UPDATE
      `;
      const locked = rows[0];
      if (!locked) throw new NotFoundException('Evento no encontrado');
      this.tenant.assertOrganization(locked.organizationId);

      const context = this.tenant.current();
      if (!context.privileged && locked.organizationId !== context.organizationId) {
        throw new NotFoundException('Evento no encontrado');
      }

      const metadata = this.asMetadata(locked.metadata);
      const inventory = this.readChannelInventory(metadata);
      const occupancy =
        (inventory.web.sold || 0) / Math.max(inventory.web.tickets || 1, 1);

      if (occupancy < 0.3 && inventory.web.tickets >= 50) {
        this.logger.log(`Reallocating inventory: web occupancy is ${occupancy * 100}%`);
        inventory.web.tickets -= 50;
        inventory.web.available = Math.max(0, inventory.web.available - 50);
        inventory.taquilla.tickets += 50;
        inventory.taquilla.available += 50;
      }

      if (occupancy > 0.8 && inventory.taquilla.tickets >= 50) {
        this.logger.log(`High web occupancy: ${occupancy * 100}%`);
        inventory.taquilla.tickets -= 50;
        inventory.taquilla.available = Math.max(0, inventory.taquilla.available - 50);
        inventory.web.tickets += 50;
        inventory.web.available += 50;
      }

      await tx.event.update({
        where: { id: eventId },
        data: {
          metadata: {
            ...metadata,
            channelInventory: inventory,
            lastReallocationAt: new Date().toISOString(),
          } as unknown as Prisma.InputJsonValue,
        },
      });

      return {
        status: 'reallocated' as const,
        inventory,
        organizationId: locked.organizationId,
        occupancy,
      };
    }).then(async ({ status, inventory, organizationId, occupancy }) => {
      await this.audit.log({
        action: 'CHANNEL_REALLOCATED',
        entityType: 'Event',
        entityId: eventId,
        organizationId,
        userId: this.tenant.current().userId,
        metadata: { occupancy },
      });
      return { status, inventory };
    });
  }

  async getChannelAnalytics(eventId: string) {
    const event = await this.requireOwnedEvent(eventId);
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [allTime, last24h, last7days] = await Promise.all([
      this.prisma.order.findMany({
        where: { eventId, organizationId: event.organizationId },
        select: { channel: true, totalAmount: true, status: true, createdAt: true },
      }),
      this.prisma.order.findMany({
        where: {
          eventId,
          organizationId: event.organizationId,
          createdAt: { gte: oneDayAgo },
        },
        select: { channel: true, totalAmount: true, status: true, createdAt: true },
      }),
      this.prisma.order.findMany({
        where: {
          eventId,
          organizationId: event.organizationId,
          createdAt: { gte: sevenDaysAgo },
        },
        select: { channel: true, totalAmount: true, status: true, createdAt: true },
      }),
    ]);

    return {
      allTime: this.aggregateOrders(allTime),
      last24h: this.aggregateOrders(last24h),
      last7days: this.aggregateOrders(last7days),
    };
  }

  private aggregateOrders(orders: OrderAggRow[]) {
    const channels: Record<
      string,
      { orders: number; revenue: number; avgOrderValue: number; completionRate: number }
    > = {};
    const completedByChannel: Record<string, number> = {};

    for (const order of orders) {
      const channel = order.channel || 'WEB';
      if (!channels[channel]) {
        channels[channel] = {
          orders: 0,
          revenue: 0,
          avgOrderValue: 0,
          completionRate: 0,
        };
        completedByChannel[channel] = 0;
      }

      channels[channel].orders++;
      if (order.status === 'COMPLETED') {
        channels[channel].revenue += Number(order.totalAmount);
        completedByChannel[channel]++;
      }
    }

    for (const channel of Object.keys(channels)) {
      channels[channel].avgOrderValue =
        channels[channel].revenue / (channels[channel].orders || 1);
      channels[channel].completionRate =
        (completedByChannel[channel] / channels[channel].orders) * 100;
    }

    return channels;
  }

  async addApiPartner(eventId: string, partner: ApiPartnerDto) {
    const event = await this.requireOwnedEvent(eventId);
    const metadata = this.asMetadata(event.metadata);
    const partners = this.readApiPartners(metadata);
    const record: ApiPartnerRecord = {
      id: `partner_${Date.now()}`,
      name: partner.name.trim(),
      apiKeyHash: this.hashApiKey(partner.apiKey),
      allocation: partner.allocation ?? 10,
      commissionRate: partner.commissionRate ?? 5,
      rateLimit: partner.rateLimit ?? 1000,
      active: true,
      createdAt: new Date().toISOString(),
    };
    partners.push(record);

    await this.prisma.event.update({
      where: { id: eventId },
      data: {
        metadata: {
          ...metadata,
          apiPartners: partners,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await this.audit.log({
      action: 'CHANNEL_API_PARTNER_ADDED',
      entityType: 'Event',
      entityId: eventId,
      organizationId: event.organizationId,
      userId: this.tenant.current().userId,
      metadata: { partnerId: record.id, name: record.name },
    });

    this.logger.log(`API partner added: ${partner.name}`);
    return { partnerId: record.id };
  }

  async addTaquillaLocation(eventId: string, location: TaquillaLocationDto) {
    const event = await this.requireOwnedEvent(eventId);
    const metadata = this.asMetadata(event.metadata);
    const locations = this.readTaquillaLocations(metadata);
    const record: TaquillaLocationRecord = {
      id: `loc_${Date.now()}`,
      ...location,
      name: location.name.trim(),
      createdAt: new Date().toISOString(),
    };
    locations.push(record);

    await this.prisma.event.update({
      where: { id: eventId },
      data: {
        metadata: {
          ...metadata,
          taquillaLocations: locations,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await this.audit.log({
      action: 'TAQUILLA_LOCATION_ADDED',
      entityType: 'Event',
      entityId: eventId,
      organizationId: event.organizationId,
      userId: this.tenant.current().userId,
      metadata: { locationId: record.id, name: record.name },
    });

    return { locationId: record.id };
  }
}
