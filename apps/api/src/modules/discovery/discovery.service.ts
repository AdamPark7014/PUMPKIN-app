import { Injectable, NotFoundException } from '@nestjs/common';
import { EventCategory, EventStatus, Prisma, SalePhaseStatus } from '@prisma/client';
import { resolveSaleStatus } from '@boletera/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Sale-phase columns needed to derive the storefront sale state. */
const SALE_PHASE_SELECT = {
  where: { status: { not: SalePhaseStatus.CANCELLED } },
  select: { id: true, name: true, kind: true, startsAt: true, endsAt: true, code: true },
  orderBy: { startsAt: 'asc' as const },
};

type SaleWindowFields = {
  status: EventStatus;
  startsAt: Date;
  endsAt: Date | null;
  announceAt: Date | null;
  publishAt: Date | null;
  salesStartAt: Date | null;
  salesEndAt: Date | null;
  salePhases: {
    id: string;
    name: string;
    kind: 'PRESALE' | 'MEMBERS' | 'PUBLIC' | 'LAST_MINUTE' | 'DOOR';
    startsAt: Date;
    endsAt: Date;
    code: string | null;
  }[];
};

const CATEGORIES = new Set<string>(Object.values(EventCategory));
const PUBLIC_STATUSES: EventStatus[] = [
  EventStatus.SCHEDULED,
  EventStatus.LIVE,
  EventStatus.RESCHEDULED,
];
const SUGGEST_STATUSES: EventStatus[] = [EventStatus.SCHEDULED, EventStatus.LIVE];

type OrgScope = string | string[];

type ListParams = {
  orgId: OrgScope;
  q?: string;
  city?: string;
  category?: string;
  venueSlug?: string;
  when?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
};

type PosterMetadata = { posterAspect?: string } | null;

@Injectable()
export class DiscoveryService {
  constructor(private readonly prisma: PrismaService) {}

  private orgWhere(orgId: OrgScope): string | { in: string[] } {
    return Array.isArray(orgId) ? { in: orgId } : orgId;
  }

  /** Events scheduled to be announced later must stay out of the storefront. */
  private announcedFilter(now = new Date()): Prisma.EventWhereInput {
    return { OR: [{ announceAt: null }, { announceAt: { lte: now } }] };
  }

  private saleStateOf(event: SaleWindowFields, now = new Date()) {
    const status = resolveSaleStatus(
      {
        status: event.status,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        announceAt: event.announceAt,
        publishAt: event.publishAt,
        salesStartAt: event.salesStartAt,
        salesEndAt: event.salesEndAt,
        phases: event.salePhases,
      },
      now,
    );
    return {
      state: status.state,
      canPurchase: status.canPurchase,
      requiresCode: status.gatedPhases.length > 0,
      nextChangeAt: status.nextChangeAt ?? null,
      activePhase: status.activePhase
        ? { id: status.activePhase.id, name: status.activePhase.name, kind: status.activePhase.kind }
        : null,
    };
  }

  private whenRange(when?: string): { gte?: Date; lte?: Date } | undefined {
    if (!when || when === 'ALL') return undefined;
    const now = new Date();
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const monthEnd = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
    if (when === 'WEEK') return { gte: now, lte: weekEnd };
    if (when === 'MONTH') return { gte: now, lte: monthEnd };
    if (when === 'WEEKEND') return { gte: now, lte: weekEnd };
    return undefined;
  }

  private clampLimit(limit: number | undefined, fallback: number, max: number): number {
    if (limit == null || Number.isNaN(limit)) return fallback;
    return Math.min(Math.max(Math.trunc(limit), 1), max);
  }

  private posterAspectOf(metadata: unknown): string | undefined {
    const posterAspect = (metadata as PosterMetadata)?.posterAspect;
    return typeof posterAspect === 'string' ? posterAspect : undefined;
  }

  async listEvents(params: ListParams) {
    const range = this.whenRange(params.when);
    const from = params.from ? new Date(params.from) : range?.gte;
    const to = params.to ? new Date(params.to) : range?.lte;
    const take = this.clampLimit(params.limit, 40, 100);

    const where: Prisma.EventWhereInput = {
      organizationId: this.orgWhere(params.orgId),
      status: { in: PUBLIC_STATUSES },
      AND: [this.announcedFilter()],
      ...(params.city
        ? { venue: { city: { equals: params.city, mode: 'insensitive' } } }
        : {}),
      ...(params.venueSlug ? { venue: { slug: params.venueSlug } } : {}),
      ...(params.category && CATEGORIES.has(params.category)
        ? { category: params.category as EventCategory }
        : {}),
      ...(from || to
        ? {
            startsAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      ...(params.q?.trim()
        ? {
            OR: [
              { title: { contains: params.q.trim(), mode: 'insensitive' } },
              { slug: { contains: params.q.trim(), mode: 'insensitive' } },
              { venue: { name: { contains: params.q.trim(), mode: 'insensitive' } } },
              { venue: { city: { contains: params.q.trim(), mode: 'insensitive' } } },
              { genre: { contains: params.q.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    let events = await this.prisma.event.findMany({
      where,
      take: params.when === 'WEEKEND' ? Math.min(take * 3, 120) : take,
      ...(params.cursor ? { skip: 1, cursor: { id: params.cursor } } : {}),
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        image: true,
        bannerImage: true,
        metadata: true,
        startsAt: true,
        endsAt: true,
        doorsAt: true,
        status: true,
        announceAt: true,
        publishAt: true,
        salesStartAt: true,
        salesEndAt: true,
        category: true,
        genre: true,
        currency: true,
        maxPrice: true,
        venue: { select: { name: true, city: true, slug: true } },
        organization: { select: { name: true, slug: true } },
        offers: {
          where: { isAvailable: true },
          select: {
            id: true,
            name: true,
            zone: true,
            basePrice: true,
            remainingQuantity: true,
            isAvailable: true,
          },
        },
        salePhases: SALE_PHASE_SELECT,
      },
    });

    if (params.when === 'WEEKEND') {
      events = events
        .filter((e) => {
          const d = e.startsAt.getDay();
          return d === 5 || d === 6 || d === 0;
        })
        .slice(0, take);
    }

    return events.map((e) => {
      const prices = e.offers.map((o) => Number(o.basePrice)).filter((n) => !Number.isNaN(n));
      const minPrice = prices.length ? Math.min(...prices) : 0;
      return {
        id: e.id,
        slug: e.slug,
        title: e.title,
        description: e.description,
        image: e.image,
        bannerImage: e.bannerImage,
        posterAspect: this.posterAspectOf(e.metadata),
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        doorsAt: e.doorsAt,
        status: e.status,
        sale: this.saleStateOf(e),
        salesStartAt: e.salesStartAt,
        salesEndAt: e.salesEndAt,
        category: e.category,
        genre: e.genre,
        currency: e.currency ?? 'MXN',
        minPrice,
        maxPrice: e.maxPrice != null ? Number(e.maxPrice) : null,
        venue: e.venue,
        organization: e.organization,
        offerCount: e.offers.length,
        offers: e.offers.map((o) => ({
          id: o.id,
          name: o.name,
          zone: o.zone,
          basePrice: o.basePrice,
          remainingQuantity: o.remainingQuantity,
          isAvailable: o.isAvailable,
        })),
      };
    });
  }

  async getBySlug(slug: string, orgId: OrgScope) {
    const event = await this.prisma.event.findFirst({
      where: {
        slug,
        organizationId: this.orgWhere(orgId),
        AND: [this.announcedFilter()],
      },
      include: {
        venue: true,
        organization: { include: { tenantTheme: true } },
        offers: { where: { isAvailable: true } },
        seatMap: true,
        salePhases: SALE_PHASE_SELECT,
        series: { select: { id: true, name: true, kind: true } },
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    return {
      ...event,
      posterAspect: this.posterAspectOf(event.metadata),
      sale: this.saleStateOf(event),
    };
  }

  /** Lightweight typeahead rows for discovery search. */
  async suggest(params: { orgId: OrgScope; q: string; limit?: number }) {
    const q = params.q.trim();
    if (q.length < 2) return [];
    const take = this.clampLimit(params.limit, 8, 12);
    const events = await this.prisma.event.findMany({
      where: {
        organizationId: this.orgWhere(params.orgId),
        status: { in: SUGGEST_STATUSES },
        AND: [this.announcedFilter()],
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } },
          { venue: { name: { contains: q, mode: 'insensitive' } } },
          { venue: { city: { contains: q, mode: 'insensitive' } } },
          { genre: { contains: q, mode: 'insensitive' } },
        ],
      },
      take,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        slug: true,
        title: true,
        startsAt: true,
        category: true,
        venue: { select: { name: true, city: true } },
      },
    });
    return events.map((e) => ({
      id: e.id,
      slug: e.slug,
      title: e.title,
      startsAt: e.startsAt,
      category: e.category,
      venue: e.venue,
      subtitle: [e.venue?.name, e.venue?.city].filter(Boolean).join(' · '),
    }));
  }

  async facets(orgId: OrgScope) {
    const events = await this.prisma.event.findMany({
      where: {
        organizationId: this.orgWhere(orgId),
        status: { in: SUGGEST_STATUSES },
        AND: [this.announcedFilter()],
      },
      select: {
        category: true,
        venue: { select: { city: true } },
      },
      take: 2000,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });

    const cityMap = new Map<string, number>();
    const categoryMap = new Map<string, number>();
    for (const e of events) {
      const city = e.venue?.city?.trim();
      if (city) cityMap.set(city, (cityMap.get(city) ?? 0) + 1);
      if (e.category) categoryMap.set(e.category, (categoryMap.get(e.category) ?? 0) + 1);
    }

    return {
      cities: Array.from(cityMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      categories: Array.from(categoryMap.entries())
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    };
  }

  async listVenues(params: { orgId: OrgScope; limit?: number; city?: string }) {
    const take = this.clampLimit(params.limit, 24, 60);
    const venues = await this.prisma.venue.findMany({
      where: {
        organizationId: this.orgWhere(params.orgId),
        ...(params.city
          ? { city: { equals: params.city, mode: 'insensitive' } }
          : {}),
        events: {
          some: {
            status: { in: SUGGEST_STATUSES },
            AND: [this.announcedFilter()],
          },
        },
      },
      take,
      orderBy: { events: { _count: 'desc' } },
      select: {
        id: true,
        slug: true,
        name: true,
        city: true,
        state: true,
        address: true,
        image: true,
        _count: {
          select: {
            events: {
              where: {
                status: { in: SUGGEST_STATUSES },
                AND: [this.announcedFilter()],
              },
            },
          },
        },
      },
    });

    return venues.map((v) => ({
      id: v.id,
      slug: v.slug,
      name: v.name,
      city: v.city,
      state: v.state,
      address: v.address,
      image: v.image,
      eventCount: v._count.events,
    }));
  }

  async getVenueBySlug(slug: string, orgId: OrgScope) {
    const venue = await this.prisma.venue.findFirst({
      where: {
        slug,
        organizationId: this.orgWhere(orgId),
      },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        address: true,
        city: true,
        state: true,
        country: true,
        postalCode: true,
        latitude: true,
        longitude: true,
        phone: true,
        website: true,
        image: true,
        totalCapacity: true,
      },
    });
    if (!venue) throw new NotFoundException('Venue not found');

    const events = await this.listEvents({
      orgId,
      venueSlug: slug,
      limit: 40,
    });

    return {
      ...venue,
      eventCount: events.length,
      events,
    };
  }
}
