import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AllocateChannelsDto,
  BulkPricingDto,
  CreateCampaignDto,
  CreateEventDto,
  CreateEventSeriesDto,
  CreateResidencyDto,
  SearchEventsQueryDto,
  SetPricingRulesDto,
  UpdateOfferDto,
} from './event-management.dto';

type EventMetadata = Record<string, unknown>;

type CampaignRecord = {
  id: string;
  eventId: string;
  name: string;
  type: CreateCampaignDto['type'];
  startsAt: string;
  endsAt: string;
  code?: string;
  allocation: number;
  discountType: CreateCampaignDto['discountType'];
  discountValue: number;
  quantityPerUser: number;
  status: string;
  requiresApproval: boolean;
  redemptions: number;
};

@Injectable()
export class EventManagementService {
  private readonly logger = new Logger(EventManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private slugify(text: string): string {
    const base = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60);
    return `${base || 'evento'}-${Date.now().toString(36)}`;
  }

  /** Tenant-bound org for writes; SUPER_ADMIN may use JWT org as fallback. */
  private scopedOrganizationId(fallbackOrgId?: string): string {
    const ctx = this.tenant.current();
    if (ctx.privileged) {
      const organizationId = fallbackOrgId ?? ctx.organizationId;
      if (!organizationId) {
        throw new BadRequestException(
          'Se requiere una organización en el contexto del inquilino',
        );
      }
      return organizationId;
    }
    return this.tenant.requireOrganization();
  }

  private actorUserId(): string | undefined {
    return this.tenant.current().userId;
  }

  private asMetadata(value: unknown): EventMetadata {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as EventMetadata;
    }
    return {};
  }

  private parseDate(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`Fecha inválida en ${field}`);
    }
    return date;
  }

  private async requireVenue(organizationId: string, venueId: string) {
    const venue = await this.prisma.venue.findFirst({
      where: { id: venueId, organizationId },
      select: { id: true, name: true, timezone: true, totalCapacity: true },
    });
    if (!venue) {
      throw new NotFoundException('Recinto no encontrado para esta organización');
    }
    this.tenant.assertOrganization(organizationId);
    return venue;
  }

  private async requireEvent(eventId: string, organizationId?: string) {
    const orgId = organizationId ?? this.scopedOrganizationId();
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId: orgId },
    });
    if (!event) {
      throw new NotFoundException('Evento no encontrado');
    }
    this.tenant.assertOrganization(event.organizationId);
    return event;
  }

  private async mergeMetadata(
    organizationId: string,
    eventId: string,
    patch: EventMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: eventId, organizationId },
        select: { id: true, organizationId: true, metadata: true },
      });
      if (!event) {
        throw new NotFoundException('Evento no encontrado');
      }
      this.tenant.assertOrganization(event.organizationId);
      const current = this.asMetadata(event.metadata);
      return tx.event.update({
        where: { id: event.id },
        data: { metadata: { ...current, ...patch } as Prisma.InputJsonValue },
        include: { venue: true, organization: true },
      });
    });
  }

  async createEvent(fallbackOrgId: string | undefined, data: CreateEventDto) {
    const organizationId = this.scopedOrganizationId(fallbackOrgId);
    await this.requireVenue(organizationId, data.venueId);

    const startDate = this.parseDate(data.startDate, 'startDate');
    const endDate = data.endDate ? this.parseDate(data.endDate, 'endDate') : undefined;
    if (endDate && endDate < startDate) {
      throw new BadRequestException('endDate debe ser posterior a startDate');
    }
    if (data.capacity < 1) {
      throw new BadRequestException('capacity debe ser al menos 1');
    }

    const event = await this.prisma.event.create({
      data: {
        title: data.title.trim(),
        description: data.description,
        slug: this.slugify(data.title),
        organizationId,
        venueId: data.venueId,
        startsAt: startDate,
        endsAt: endDate,
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

    await this.audit.log({
      action: 'EVENT_CREATED',
      entityType: 'Event',
      entityId: event.id,
      organizationId,
      userId: this.actorUserId(),
      metadata: {
        title: event.title,
        venueId: event.venueId,
        type: data.type,
        capacity: data.capacity,
        basePrice: data.basePrice,
      },
    });

    this.logger.log(`Evento creado: ${event.id} (${event.title})`);
    return event;
  }

  async createEventSeries(
    fallbackOrgId: string | undefined,
    data: CreateEventSeriesDto,
  ) {
    const organizationId = this.scopedOrganizationId(fallbackOrgId);
    await this.requireVenue(organizationId, data.venueId);

    const occurrences = await this.prisma.$transaction(async (tx) => {
      const created: Array<{
        id: string;
        title: string;
        startsAt: Date;
        status: EventStatus;
      }> = [];

      for (let i = 0; i < data.occurrences.length; i++) {
        const occ = data.occurrences[i];
        const basePrice = occ.basePrice ?? 100;
        const startsAt = this.parseDate(occ.date, `occurrences[${i}].date`);
        const event = await tx.event.create({
          data: {
            title: (occ.title || data.seriesName).trim(),
            description: data.description,
            slug: this.slugify(`${data.seriesName}-${startsAt.toISOString()}`),
            organizationId,
            venueId: data.venueId,
            startsAt,
            timezone: 'America/Mexico_City',
            status: EventStatus.SCHEDULED,
            publishedAt: new Date(),
            totalCapacity: occ.capacity ?? 5000,
            minPrice: new Decimal(basePrice),
            maxPrice: new Decimal(basePrice * 2.5),
            metadata: {
              eventKind: 'series',
              seriesName: data.seriesName,
              seriesOrder: i + 1,
            },
          },
          select: { id: true, title: true, startsAt: true, status: true },
        });
        created.push(event);
      }
      return created;
    });

    await this.audit.log({
      action: 'EVENT_SERIES_LEGACY_CREATED',
      entityType: 'EventSeries',
      entityId: occurrences[0]?.id,
      organizationId,
      userId: this.actorUserId(),
      metadata: {
        seriesName: data.seriesName,
        totalEvents: occurrences.length,
        venueId: data.venueId,
      },
    });

    this.logger.log(
      `Serie creada: ${data.seriesName} (${occurrences.length} eventos)`,
    );
    return {
      seriesName: data.seriesName,
      occurrences,
      totalEvents: occurrences.length,
    };
  }

  async createResidency(
    fallbackOrgId: string | undefined,
    data: CreateResidencyDto,
  ) {
    const organizationId = this.scopedOrganizationId(fallbackOrgId);
    await this.requireVenue(organizationId, data.venueId);

    const exceptionKeys = new Set(
      (data.exceptions ?? []).map((value) =>
        this.parseDate(value, 'exceptions').toDateString(),
      ),
    );
    const dayInMs = 24 * 60 * 60 * 1000;
    let currentDate = this.parseDate(data.startDate, 'startDate');
    const events: Array<{
      id: string;
      title: string;
      startsAt: Date;
      status: EventStatus;
    }> = [];

    await this.prisma.$transaction(async (tx) => {
      let created = 0;
      let guard = 0;
      while (created < data.occurrenceCount && guard++ < data.occurrenceCount * 8) {
        if (exceptionKeys.has(currentDate.toDateString())) {
          currentDate = new Date(currentDate.getTime() + dayInMs);
          continue;
        }

        const event = await tx.event.create({
          data: {
            title: `${data.name} — ${currentDate.toLocaleDateString('es-MX')}`,
            description: `Residencia: ${data.name}`,
            slug: this.slugify(`${data.name}-${currentDate.toISOString()}`),
            organizationId,
            venueId: data.venueId,
            startsAt: new Date(currentDate),
            timezone: 'America/Mexico_City',
            status: EventStatus.SCHEDULED,
            publishedAt: new Date(),
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
          select: { id: true, title: true, startsAt: true, status: true },
        });
        events.push(event);
        created += 1;

        if (data.frequency === 'daily') {
          currentDate = new Date(currentDate.getTime() + dayInMs);
        } else if (data.frequency === 'weekly') {
          currentDate = new Date(currentDate.getTime() + 7 * dayInMs);
        } else if (data.frequency === 'biweekly') {
          currentDate = new Date(currentDate.getTime() + 14 * dayInMs);
        } else {
          currentDate = new Date(currentDate);
          currentDate.setMonth(currentDate.getMonth() + 1);
        }
      }

      if (created < data.occurrenceCount) {
        throw new BadRequestException(
          'No se pudieron generar todas las fechas de la residencia',
        );
      }
    });

    await this.audit.log({
      action: 'EVENT_RESIDENCY_CREATED',
      entityType: 'Event',
      entityId: events[0]?.id,
      organizationId,
      userId: this.actorUserId(),
      metadata: {
        name: data.name,
        frequency: data.frequency,
        totalEvents: events.length,
        venueId: data.venueId,
      },
    });

    return { name: data.name, frequency: data.frequency, events };
  }

  async setPricingRules(eventId: string, data: SetPricingRulesDto) {
    const organizationId = this.scopedOrganizationId();
    await this.requireEvent(eventId, organizationId);

    const event = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.event.findFirst({
        where: { id: eventId, organizationId },
        select: { id: true, organizationId: true, metadata: true },
      });
      if (!existing) {
        throw new NotFoundException('Evento no encontrado');
      }
      const current = this.asMetadata(existing.metadata);
      return tx.event.update({
        where: { id: existing.id },
        data: {
          metadata: {
            ...current,
            pricingRules: data,
            basePrice: data.basePrice,
          } as unknown as Prisma.InputJsonValue,
          enableDynamic: data.dynamicPricingEnabled,
          minPrice: new Decimal(data.basePrice),
          maxPrice: new Decimal(data.basePrice * 3),
        },
        include: { venue: true, organization: true },
      });
    });

    await this.audit.log({
      action: 'EVENT_PRICING_RULES_UPDATED',
      entityType: 'Event',
      entityId: eventId,
      organizationId,
      userId: this.actorUserId(),
      metadata: {
        basePrice: data.basePrice,
        dynamicPricingEnabled: data.dynamicPricingEnabled,
      },
    });

    return event;
  }

  async updateOffer(eventId: string, offerId: string, data: UpdateOfferDto) {
    const organizationId = this.scopedOrganizationId();
    await this.requireEvent(eventId, organizationId);

    if (
      data.basePrice === undefined &&
      data.name === undefined &&
      data.isAvailable === undefined
    ) {
      throw new BadRequestException('Se requiere al menos un campo para actualizar');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const offer = await tx.offer.findFirst({
        where: {
          id: offerId,
          eventId,
          event: { organizationId },
        },
      });
      if (!offer) {
        throw new NotFoundException('Oferta no encontrada');
      }

      const next = await tx.offer.update({
        where: { id: offer.id },
        data: {
          ...(data.name != null ? { name: data.name.trim() } : {}),
          ...(data.basePrice != null ? { basePrice: new Decimal(data.basePrice) } : {}),
          ...(data.isAvailable != null ? { isAvailable: data.isAvailable } : {}),
        },
      });

      if (data.basePrice != null) {
        const min = await tx.offer.aggregate({
          where: { eventId, isAvailable: true, event: { organizationId } },
          _min: { basePrice: true },
        });
        if (min._min.basePrice) {
          await tx.event.updateMany({
            where: { id: eventId, organizationId },
            data: { minPrice: min._min.basePrice },
          });
        }
      }

      return next;
    });

    await this.audit.log({
      action: 'EVENT_OFFER_UPDATED',
      entityType: 'Offer',
      entityId: offerId,
      organizationId,
      userId: this.actorUserId(),
      metadata: { eventId, ...data },
    });

    return updated;
  }

  async allocateChannels(eventId: string, data: AllocateChannelsDto) {
    const organizationId = this.scopedOrganizationId();
    await this.requireEvent(eventId, organizationId);

    const total =
      (data.web?.allocation || 0) +
      (data.taquilla?.allocation || 0) +
      (data.api?.allocation || 0) +
      (data.phone?.allocation || 0);

    if (total !== 100) {
      throw new BadRequestException(
        `La asignación de canales debe sumar 100%, se recibió ${total}%`,
      );
    }

    const event = await this.mergeMetadata(organizationId, eventId, {
      channelAllocation: {
        ...data,
        strategy: 'fixed',
        lastUpdated: new Date().toISOString(),
      },
    });

    await this.audit.log({
      action: 'EVENT_CHANNELS_ALLOCATED',
      entityType: 'Event',
      entityId: eventId,
      organizationId,
      userId: this.actorUserId(),
      metadata: { total, channels: Object.keys(data) },
    });

    return event;
  }

  async createCampaign(eventId: string, data: CreateCampaignDto) {
    const organizationId = this.scopedOrganizationId();
    const event = await this.requireEvent(eventId, organizationId);

    const startDate = this.parseDate(data.startDate, 'startDate');
    const endDate = this.parseDate(data.endDate, 'endDate');
    if (startDate >= endDate) {
      throw new BadRequestException('startDate debe ser anterior a endDate');
    }
    if (data.discountType === 'percentage' && data.discountValue > 100) {
      throw new BadRequestException(
        'discountValue no puede superar 100 para descuentos porcentuales',
      );
    }

    const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    const presaleCode =
      data.type === 'presale'
        ? data.code || `PRESALE${randomSuffix}`
        : data.code;

    const campaign: CampaignRecord = {
      id: `camp_${Date.now()}`,
      eventId,
      name: data.name.trim(),
      type: data.type,
      startsAt: startDate.toISOString(),
      endsAt: endDate.toISOString(),
      code: presaleCode,
      allocation: data.allocation,
      discountType: data.discountType,
      discountValue: data.discountValue,
      quantityPerUser: data.quantityPerUser ?? 4,
      status: 'DRAFT',
      requiresApproval: data.requiresApproval ?? false,
      redemptions: 0,
    };

    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.event.findFirst({
        where: { id: event.id, organizationId },
        select: { id: true, metadata: true },
      });
      if (!locked) {
        throw new NotFoundException('Evento no encontrado');
      }
      const current = this.asMetadata(locked.metadata);
      const campaigns = Array.isArray(current.campaigns)
        ? ([...current.campaigns] as CampaignRecord[])
        : [];
      campaigns.push(campaign);
      await tx.event.update({
        where: { id: locked.id },
        data: {
          metadata: { ...current, campaigns } as Prisma.InputJsonValue,
        },
      });
    });

    await this.audit.log({
      action: 'EVENT_CAMPAIGN_CREATED',
      entityType: 'Event',
      entityId: eventId,
      organizationId,
      userId: this.actorUserId(),
      metadata: {
        campaignId: campaign.id,
        type: campaign.type,
        code: campaign.code,
        allocation: campaign.allocation,
      },
    });

    this.logger.log(`Campaña creada para evento ${eventId}: ${data.type}`);
    return campaign;
  }

  async getEventCalendar(
    fallbackOrgId: string | undefined,
    month: number,
    year: number,
  ) {
    const organizationId = this.scopedOrganizationId(fallbackOrgId);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('month debe estar entre 1 y 12');
    }
    if (!Number.isInteger(year) || year < 2000 || year > 2200) {
      throw new BadRequestException('year fuera de rango permitido');
    }

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const events = await this.prisma.event.findMany({
      where: {
        organizationId,
        startsAt: { gte: startDate, lte: endDate },
      },
      orderBy: { startsAt: 'asc' },
      take: 2_000,
      select: {
        id: true,
        title: true,
        startsAt: true,
        totalCapacity: true,
        status: true,
        metadata: true,
        venue: { select: { name: true } },
      },
    });

    const calendar: Record<string, unknown[]> = {};
    for (const event of events) {
      const d = event.startsAt;
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!calendar[dateKey]) calendar[dateKey] = [];
      calendar[dateKey].push({
        id: event.id,
        title: event.title,
        startTime: event.startsAt.toLocaleTimeString('es-MX', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        venue: event.venue.name,
        capacity: event.totalCapacity,
        status: event.status,
        kind: this.asMetadata(event.metadata).eventKind ?? 'single',
      });
    }

    return { month, year, calendar, totalEvents: events.length };
  }

  async bulkUpdatePricing(data: BulkPricingDto) {
    const organizationId = this.scopedOrganizationId();
    const uniqueIds = [...new Set(data.eventIds)];

    const result = await this.prisma.$transaction(async (tx) => {
      const events = await tx.event.findMany({
        where: { id: { in: uniqueIds }, organizationId },
        select: { id: true, minPrice: true, metadata: true },
      });
      if (!events.length) {
        throw new NotFoundException('No se encontraron eventos para actualizar');
      }

      let updated = 0;
      for (const event of events) {
        const base = Number(event.minPrice) * data.priceMultiplier;
        await tx.event.update({
          where: { id: event.id },
          data: {
            minPrice: new Decimal(base),
            maxPrice: new Decimal(base * 2.5),
            metadata: {
              ...this.asMetadata(event.metadata),
              priceMultiplier: data.priceMultiplier,
            } as Prisma.InputJsonValue,
          },
        });
        updated += 1;
      }
      return { updated, matchedIds: events.map((event) => event.id) };
    });

    await this.audit.log({
      action: 'EVENT_BULK_PRICING_UPDATED',
      entityType: 'Event',
      organizationId,
      userId: this.actorUserId(),
      metadata: {
        requested: uniqueIds.length,
        updated: result.updated,
        priceMultiplier: data.priceMultiplier,
        eventIds: result.matchedIds,
      },
    });

    return { updated: result.updated };
  }

  async searchEvents(
    fallbackOrgId: string | undefined,
    filters: SearchEventsQueryDto,
  ) {
    const organizationId = this.scopedOrganizationId(fallbackOrgId);
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);

    if (filters.start && filters.end) {
      const start = this.parseDate(filters.start, 'start');
      const end = this.parseDate(filters.end, 'end');
      if (start > end) {
        throw new BadRequestException('start debe ser anterior o igual a end');
      }
    }
    if (
      filters.minCapacity != null &&
      filters.maxCapacity != null &&
      filters.minCapacity > filters.maxCapacity
    ) {
      throw new BadRequestException(
        'minCapacity no puede ser mayor que maxCapacity',
      );
    }

    let cursorWhere: Prisma.EventWhereInput = {};
    if (filters.cursor) {
      const cursorEvent = await this.requireEvent(filters.cursor, organizationId);
      cursorWhere = {
        OR: [
          { startsAt: { lt: cursorEvent.startsAt } },
          { startsAt: cursorEvent.startsAt, id: { lt: cursorEvent.id } },
        ],
      };
    }

    const where: Prisma.EventWhereInput = {
      organizationId,
      ...(filters.start || filters.end
        ? {
            startsAt: {
              ...(filters.start
                ? { gte: this.parseDate(filters.start, 'start') }
                : {}),
              ...(filters.end
                ? { lte: this.parseDate(filters.end, 'end') }
                : {}),
            },
          }
        : {}),
      ...(filters.venueId ? { venueId: filters.venueId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.minCapacity != null || filters.maxCapacity != null
        ? {
            totalCapacity: {
              ...(filters.minCapacity != null
                ? { gte: filters.minCapacity }
                : {}),
              ...(filters.maxCapacity != null
                ? { lte: filters.maxCapacity }
                : {}),
            },
          }
        : {}),
      ...(filters.type
        ? {
            metadata: {
              path: ['eventKind'],
              equals: filters.type,
            },
          }
        : {}),
      ...cursorWhere,
    };

    const events = await this.prisma.event.findMany({
      where,
      include: {
        venue: { select: { id: true, name: true, slug: true } },
        _count: { select: { tickets: true, orders: true } },
      },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const page = events.slice(0, limit);
    const nextCursor = events.length > limit ? page[page.length - 1]?.id : null;

    // Retrocompatible envelope: bare-array clients can read `.events` / `.items`.
    return {
      items: page,
      events: page,
      nextCursor,
      limit,
    };
  }

  async getEventHub(eventId: string, fallbackOrgId?: string) {
    const organizationId = this.scopedOrganizationId(fallbackOrgId);
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId },
      include: {
        venue: { select: { id: true, name: true, slug: true } },
        offers: true,
        seatMap: true,
        _count: { select: { tickets: true, orders: true } },
      },
    });
    if (!event) {
      throw new NotFoundException('Evento no encontrado');
    }
    this.tenant.assertOrganization(event.organizationId);

    const [sold, held, channelOrders] = await Promise.all([
      this.prisma.ticket.count({
        where: { eventId: event.id, status: 'SOLD', event: { organizationId } },
      }),
      this.prisma.ticket.count({
        where: { eventId: event.id, status: 'HELD', event: { organizationId } },
      }),
      this.prisma.order.groupBy({
        by: ['channel'],
        where: {
          eventId: event.id,
          organizationId,
          status: 'COMPLETED',
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
    ]);

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
