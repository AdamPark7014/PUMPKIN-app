import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventStatus, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

type EventMetadata = Record<string, unknown>;

@Injectable()
export class EventManagementService {
  private logger = new Logger(EventManagementService.name);

  constructor(private prisma: PrismaService) {}

  private slugify(text: string) {
    return `${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}`;
  }

  private async mergeMetadata(eventId: string, patch: EventMetadata) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new BadRequestException('Event not found');
    const current = (event.metadata as EventMetadata) ?? {};
    return this.prisma.event.update({
      where: { id: eventId },
      data: { metadata: { ...current, ...patch } as Prisma.InputJsonValue },
      include: { venue: true, organization: true },
    });
  }

  async createEvent(
    orgId: string,
    data: {
      title: string;
      description: string;
      type: 'single' | 'series' | 'residency';
      startDate: Date;
      endDate?: Date;
      venueId: string;
      capacity: number;
      basePrice: number;
      imageUrl?: string;
      timezone?: string;
    },
  ) {
    const event = await this.prisma.event.create({
      data: {
        title: data.title,
        description: data.description,
        slug: this.slugify(data.title),
        organizationId: orgId,
        venueId: data.venueId,
        startsAt: new Date(data.startDate),
        endsAt: data.endDate ? new Date(data.endDate) : undefined,
        timezone: data.timezone ?? 'America/Mexico_City',
        status: EventStatus.DRAFT,
        image: data.imageUrl,
        totalCapacity: data.capacity,
        minPrice: new Decimal(data.basePrice),
        maxPrice: new Decimal(data.basePrice * 2.5),
        metadata: {
          eventKind: data.type,
          basePrice: data.basePrice,
          createdFrom: 'admin_panel',
        },
      },
      include: { venue: true, organization: true },
    });

    this.logger.log(`Event created: ${event.id} (${event.title})`);
    return event;
  }

  async createEventSeries(
    orgId: string,
    data: {
      seriesName: string;
      description: string;
      venueId: string;
      occurrences: Array<{
        date: Date;
        title?: string;
        capacity?: number;
        basePrice?: number;
      }>;
    },
  ) {
    const occurrences = [];

    for (let i = 0; i < data.occurrences.length; i++) {
      const occ = data.occurrences[i];
      const basePrice = occ.basePrice ?? 100;
      const event = await this.prisma.event.create({
        data: {
          title: occ.title || data.seriesName,
          description: data.description,
          slug: this.slugify(`${data.seriesName}-${occ.date.toISOString()}`),
          organizationId: orgId,
          venueId: data.venueId,
          startsAt: new Date(occ.date),
          timezone: 'America/Mexico_City',
          status: EventStatus.SCHEDULED,
          totalCapacity: occ.capacity ?? 5000,
          minPrice: new Decimal(basePrice),
          maxPrice: new Decimal(basePrice * 2.5),
          metadata: {
            eventKind: 'series',
            seriesName: data.seriesName,
            seriesOrder: i + 1,
          },
        },
      });
      occurrences.push(event);
    }

    this.logger.log(`Event series created: ${data.seriesName} (${occurrences.length})`);
    return { seriesName: data.seriesName, occurrences, totalEvents: occurrences.length };
  }

  async createResidency(
    orgId: string,
    data: {
      name: string;
      venueId: string;
      startDate: Date;
      frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
      occurrenceCount: number;
      capacity: number;
      basePrice: number;
      exceptions?: Date[];
    },
  ) {
    const events = [];
    let currentDate = new Date(data.startDate);
    const dayInMs = 24 * 60 * 60 * 1000;
    let created = 0;

    while (created < data.occurrenceCount) {
      if (data.exceptions?.some((d) => d.toDateString() === currentDate.toDateString())) {
        currentDate = new Date(currentDate.getTime() + dayInMs);
        continue;
      }

      const event = await this.prisma.event.create({
        data: {
          title: `${data.name} — ${currentDate.toLocaleDateString('es-MX')}`,
          description: `Residencia: ${data.name}`,
          slug: this.slugify(`${data.name}-${currentDate.toISOString()}`),
          organizationId: orgId,
          venueId: data.venueId,
          startsAt: new Date(currentDate),
          timezone: 'America/Mexico_City',
          status: EventStatus.SCHEDULED,
          totalCapacity: data.capacity,
          minPrice: new Decimal(data.basePrice),
          maxPrice: new Decimal(data.basePrice * 2),
          metadata: {
            eventKind: 'residency',
            residencyName: data.name,
            frequency: data.frequency,
            occurrenceNumber: created + 1,
          },
        },
      });
      events.push(event);
      created++;

      if (data.frequency === 'daily') currentDate = new Date(currentDate.getTime() + dayInMs);
      else if (data.frequency === 'weekly') currentDate = new Date(currentDate.getTime() + 7 * dayInMs);
      else if (data.frequency === 'biweekly') currentDate = new Date(currentDate.getTime() + 14 * dayInMs);
      else currentDate.setMonth(currentDate.getMonth() + 1);
    }

    return { name: data.name, frequency: data.frequency, events };
  }

  async setPricingRules(
    eventId: string,
    data: {
      basePrice: number;
      dynamicPricingEnabled: boolean;
      surgeTiers?: Array<{ occupancy: number; multiplier: number }>;
      timeBasedRules?: Array<{ daysUntilEvent: number; multiplier: number }>;
      segmentPricing?: Record<string, number>;
      customZonePricing?: Record<string, number>;
    },
  ) {
    const event = await this.mergeMetadata(eventId, {
      pricingRules: data,
      basePrice: data.basePrice,
    });

    if (data.dynamicPricingEnabled) {
      await this.prisma.event.update({
        where: { id: eventId },
        data: { enableDynamic: true },
      });
    }

    await this.prisma.event.update({
      where: { id: eventId },
      data: {
        minPrice: new Decimal(data.basePrice),
        maxPrice: new Decimal(data.basePrice * 3),
      },
    });

    return event;
  }

  async updateOffer(
    eventId: string,
    offerId: string,
    data: { basePrice?: number; name?: string; isAvailable?: boolean },
  ) {
    const offer = await this.prisma.offer.findFirst({ where: { id: offerId, eventId } });
    if (!offer) throw new BadRequestException('Offer not found');

    const updated = await this.prisma.offer.update({
      where: { id: offerId },
      data: {
        ...(data.name != null ? { name: data.name } : {}),
        ...(data.basePrice != null ? { basePrice: new Decimal(data.basePrice) } : {}),
        ...(data.isAvailable != null ? { isAvailable: data.isAvailable } : {}),
      },
    });

    if (data.basePrice != null) {
      const min = await this.prisma.offer.aggregate({
        where: { eventId, isAvailable: true },
        _min: { basePrice: true },
      });
      if (min._min.basePrice) {
        await this.prisma.event.update({
          where: { id: eventId },
          data: { minPrice: min._min.basePrice },
        });
      }
    }

    return updated;
  }

  async allocateChannels(
    eventId: string,
    data: {
      web: { enabled: boolean; allocation: number; discount?: number };
      taquilla: { enabled: boolean; allocation: number; locations?: string[] };
      api: { enabled: boolean; allocation: number; partners?: string[] };
      phone?: { enabled: boolean; allocation: number };
    },
  ) {
    const total =
      (data.web?.allocation || 0) +
      (data.taquilla?.allocation || 0) +
      (data.api?.allocation || 0) +
      (data.phone?.allocation || 0);

    if (total !== 100) {
      throw new BadRequestException(`Channel allocation must equal 100%, got ${total}%`);
    }

    return this.mergeMetadata(eventId, {
      channelAllocation: { ...data, strategy: 'fixed', lastUpdated: new Date().toISOString() },
    });
  }

  async createCampaign(
    eventId: string,
    data: {
      name: string;
      type: 'presale' | 'early_bird' | 'vip' | 'group' | 'loyalty';
      startDate: Date;
      endDate: Date;
      code?: string;
      allocation: number;
      discountType: 'percentage' | 'fixed';
      discountValue: number;
      quantityPerUser?: number;
      requiresApproval?: boolean;
    },
  ) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new BadRequestException('Event not found');

    const presaleCode =
      data.type === 'presale' ? data.code || `PRESALE${Math.random().toString(36).substring(2, 8).toUpperCase()}` : data.code;

    const campaigns = ((event.metadata as EventMetadata)?.campaigns as unknown[]) ?? [];
    const campaign = {
      id: `camp_${Date.now()}`,
      eventId,
      name: data.name,
      type: data.type,
      startsAt: data.startDate,
      endsAt: data.endDate,
      code: presaleCode,
      allocation: data.allocation,
      discountType: data.discountType,
      discountValue: data.discountValue,
      quantityPerUser: data.quantityPerUser ?? 4,
      status: 'DRAFT',
      requiresApproval: data.requiresApproval ?? false,
      redemptions: 0,
    };

    campaigns.push(campaign);

    await this.mergeMetadata(eventId, { campaigns });
    this.logger.log(`Campaign created for event ${eventId}: ${data.type}`);
    return campaign;
  }

  async getEventCalendar(orgId: string, month: number, year: number) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const events = await this.prisma.event.findMany({
      where: {
        organizationId: orgId,
        startsAt: { gte: startDate, lte: endDate },
      },
      orderBy: { startsAt: 'asc' },
      include: { venue: true },
    });

    const calendar: Record<string, unknown[]> = {};
    events.forEach((event) => {
      const d = event.startsAt;
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!calendar[dateKey]) calendar[dateKey] = [];
      calendar[dateKey].push({
        id: event.id,
        title: event.title,
        startTime: event.startsAt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
        venue: event.venue.name,
        capacity: event.totalCapacity,
        status: event.status,
        kind: (event.metadata as EventMetadata)?.eventKind ?? 'single',
      });
    });

    return { month, year, calendar, totalEvents: events.length };
  }

  async bulkUpdatePricing(eventIds: string[], priceMultiplier: number) {
    for (const id of eventIds) {
      const event = await this.prisma.event.findUnique({ where: { id } });
      if (!event) continue;
      const base = Number(event.minPrice) * priceMultiplier;
      await this.prisma.event.update({
        where: { id },
        data: {
          minPrice: new Decimal(base),
          maxPrice: new Decimal(base * 2.5),
          metadata: {
            ...((event.metadata as EventMetadata) ?? {}),
            priceMultiplier,
          },
        },
      });
    }
    return { updated: eventIds.length };
  }

  async searchEvents(
    orgId: string,
    filters: {
      dateRange?: { start: Date; end: Date };
      venueId?: string;
      type?: string;
      status?: string;
      minCapacity?: number;
      maxCapacity?: number;
    },
  ) {
    const whereClause: Prisma.EventWhereInput = {
      organizationId: orgId,
      ...(filters.dateRange && {
        startsAt: { gte: filters.dateRange.start, lte: filters.dateRange.end },
      }),
      ...(filters.venueId && { venueId: filters.venueId }),
      ...(filters.status && { status: filters.status as EventStatus }),
      ...(filters.minCapacity && { totalCapacity: { gte: filters.minCapacity } }),
      ...(filters.maxCapacity && { totalCapacity: { lte: filters.maxCapacity } }),
    };

    const events = await this.prisma.event.findMany({
      where: whereClause,
      include: {
        venue: true,
        _count: { select: { tickets: true, orders: true } },
      },
      orderBy: { startsAt: 'desc' },
    });

    if (filters.type) {
      return events.filter(
        (e) => (e.metadata as EventMetadata)?.eventKind === filters.type,
      );
    }
    return events;
  }

  async getEventHub(eventId: string, orgId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId: orgId },
      include: {
        venue: { select: { id: true, name: true, slug: true } },
        offers: true,
        seatMap: true,
        _count: { select: { tickets: true, orders: true } },
      },
    });
    if (!event) throw new BadRequestException('Event not found');

    const sold = await this.prisma.ticket.count({
      where: { eventId, status: 'SOLD' },
    });
    const held = await this.prisma.ticket.count({
      where: { eventId, status: 'HELD' },
    });

    const channelOrders = await this.prisma.order.groupBy({
      by: ['channel'],
      where: { eventId, status: 'COMPLETED' },
      _sum: { totalAmount: true },
      _count: true,
    });

    return {
      event,
      inventory: {
        total: event.totalCapacity,
        sold,
        held,
        available: Math.max(0, event.totalCapacity - sold - held),
        occupancyPercent: event.totalCapacity
          ? Math.round((sold / event.totalCapacity) * 100)
          : 0,
      },
      channels: channelOrders,
      metadata: event.metadata,
    };
  }
}


