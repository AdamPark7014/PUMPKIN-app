import { Injectable, Logger } from '@nestjs/common';
import { EventCategory, EventStatus, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface SearchFilters {
  organizationId: string;
  query?: string;
  dateRange?: { start: Date; end: Date };
  categories?: string[];
  cities?: string[];
  venues?: string[];
  limit?: number;
}

type RankingFactors = {
  contentMatching: number;
  personalization: number;
  demandSignals: number;
  businessValue: number;
};

type RankableEvent = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  category: EventCategory;
  startsAt: Date;
  minPrice: Prisma.Decimal;
  currency: string;
  venue: { name: string; city: string; slug: string };
  _count: { orders: number };
};

const PUBLIC_STATUSES: EventStatus[] = [EventStatus.SCHEDULED, EventStatus.LIVE];
const CATEGORIES = new Set<string>(Object.values(EventCategory));

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(private readonly prisma: PrismaService) {}

  private clampLimit(limit: number | undefined, fallback: number, max: number): number {
    if (limit == null || Number.isNaN(limit)) return fallback;
    return Math.min(Math.max(Math.trunc(limit), 1), max);
  }

  private parseCategories(categories?: string[]): EventCategory[] | undefined {
    if (!categories?.length) return undefined;
    const valid = categories.filter((value): value is EventCategory => CATEGORIES.has(value));
    return valid.length ? valid : undefined;
  }

  private baseWhere(filters: SearchFilters): Prisma.EventWhereInput {
    const categories = this.parseCategories(filters.categories);
    const query = filters.query?.trim();
    return {
      organizationId: filters.organizationId,
      status: { in: PUBLIC_STATUSES },
      ...(filters.dateRange && {
        startsAt: { gte: filters.dateRange.start, lte: filters.dateRange.end },
      }),
      ...(categories?.length ? { category: { in: categories } } : {}),
      ...(filters.cities?.length
        ? { venue: { city: { in: filters.cities, mode: 'insensitive' } } }
        : {}),
      ...(filters.venues?.length ? { venueId: { in: filters.venues } } : {}),
      ...(query
        ? {
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } },
              { venue: { name: { contains: query, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
  }

  private rankingFactors(
    event: RankableEvent,
    query: string,
    categoryAffinity: Map<EventCategory, number>,
  ): RankingFactors {
    const q = query.trim().toLowerCase();
    let contentMatching = 40;
    if (!q) contentMatching = 50;
    else if (event.title.toLowerCase().includes(q)) contentMatching = 95;
    else if (event.description?.toLowerCase().includes(q)) contentMatching = 70;
    else if (event.venue.name.toLowerCase().includes(q)) contentMatching = 55;

    const past = categoryAffinity.get(event.category) ?? 0;
    const personalization = past > 0 ? Math.min(100, 50 + past * 10) : 50;
    const demandSignals = Math.min(100, 30 + event._count.orders * 2);
    const businessValue = 60;
    return { contentMatching, personalization, demandSignals, businessValue };
  }

  private async categoryAffinity(
    organizationId: string,
    userId?: string,
  ): Promise<Map<EventCategory, number>> {
    const affinity = new Map<EventCategory, number>();
    if (!userId) return affinity;

    const rows = await this.prisma.order.findMany({
      where: {
        organizationId,
        userId,
        status: OrderStatus.COMPLETED,
      },
      take: 100,
      orderBy: { createdAt: 'desc' },
      select: { event: { select: { category: true } } },
    });

    for (const row of rows) {
      const category = row.event.category;
      affinity.set(category, (affinity.get(category) ?? 0) + 1);
    }
    return affinity;
  }

  async searchEvents(filters: SearchFilters, userId?: string) {
    const take = this.clampLimit(filters.limit, 24, 100);
    const where = this.baseWhere(filters);
    const [events, affinity] = await Promise.all([
      this.prisma.event.findMany({
        where,
        take,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          title: true,
          slug: true,
          description: true,
          category: true,
          startsAt: true,
          minPrice: true,
          currency: true,
          venue: { select: { name: true, city: true, slug: true } },
          _count: { select: { orders: true } },
        },
      }),
      this.categoryAffinity(filters.organizationId, userId),
    ]);

    const ranked = events.map((event) => {
      const factors = this.rankingFactors(event, filters.query ?? '', affinity);
      const score =
        factors.contentMatching * 0.3 +
        factors.personalization * 0.35 +
        factors.demandSignals * 0.25 +
        factors.businessValue * 0.1;
      return {
        eventId: event.id,
        title: event.title,
        slug: event.slug,
        score: Math.round(score * 10) / 10,
        rankingFactors: factors,
        event: {
          id: event.id,
          title: event.title,
          slug: event.slug,
          startsAt: event.startsAt,
          minPrice: event.minPrice,
          currency: event.currency,
          venue: event.venue,
          category: event.category,
        },
      };
    });

    ranked.sort((a, b) => b.score - a.score || a.eventId.localeCompare(b.eventId));
    this.logger.log(`Search: ${ranked.length} results for "${filters.query ?? '*'}"`);
    return ranked;
  }

  async getSearchFacets(filters: SearchFilters) {
    const where = this.baseWhere(filters);
    const [events, priceAgg] = await Promise.all([
      this.prisma.event.findMany({
        where,
        select: {
          category: true,
          venue: { select: { city: true } },
        },
        take: 1000,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.event.aggregate({
        where,
        _min: { minPrice: true },
        _max: { maxPrice: true },
      }),
    ]);

    const cities = [
      ...new Set(
        events
          .map((event) => event.venue.city?.trim())
          .filter((city): city is string => Boolean(city)),
      ),
    ].sort((a, b) => a.localeCompare(b));
    const categories = [...new Set(events.map((event) => event.category))].sort();

    const min = priceAgg._min.minPrice != null ? Number(priceAgg._min.minPrice) : null;
    const max = priceAgg._max.maxPrice != null ? Number(priceAgg._max.maxPrice) : null;

    return {
      cities,
      categories,
      priceRange: {
        min: min != null && Number.isFinite(min) ? min : 0,
        max: max != null && Number.isFinite(max) ? max : 0,
      },
    };
  }

  async getAutocomplete(query: string | undefined, organizationId: string) {
    const q = query?.trim() ?? '';
    if (q.length < 2) return [];
    return this.prisma.event.findMany({
      where: {
        organizationId,
        status: { in: PUBLIC_STATUSES },
        title: { contains: q, mode: 'insensitive' },
      },
      take: 8,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      select: { id: true, title: true, slug: true, startsAt: true },
    });
  }

  async getTrendingEvents(organizationId: string, limit = 10) {
    const take = this.clampLimit(limit, 10, 50);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const now = new Date();
    const events = await this.prisma.event.findMany({
      where: {
        organizationId,
        status: { in: PUBLIC_STATUSES },
        startsAt: { gte: now },
      },
      include: {
        venue: true,
        _count: {
          select: {
            orders: {
              where: { createdAt: { gte: weekAgo }, status: OrderStatus.COMPLETED },
            },
          },
        },
      },
      take: Math.min(take * 3, 150),
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });

    return events
      .sort((a, b) => b._count.orders - a._count.orders || a.id.localeCompare(b.id))
      .slice(0, take)
      .map((event) => ({
        eventId: event.id,
        title: event.title,
        slug: event.slug,
        score: event._count.orders,
        event,
      }));
  }

  async getSmartRecommendations(organizationId: string, userId?: string) {
    if (userId) {
      const lastOrder = await this.prisma.order.findFirst({
        where: {
          organizationId,
          userId,
          status: OrderStatus.COMPLETED,
        },
        orderBy: { createdAt: 'desc' },
        select: { event: { select: { category: true } } },
      });
      if (lastOrder?.event) {
        return this.searchEvents(
          {
            organizationId,
            categories: [lastOrder.event.category],
            limit: 8,
          },
          userId,
        );
      }
    }
    return this.getTrendingEvents(organizationId, 8);
  }
}
