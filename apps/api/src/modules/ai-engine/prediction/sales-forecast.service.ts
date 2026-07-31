import { Injectable, NotFoundException } from '@nestjs/common';
import { EventCategory, Prisma } from '@prisma/client';
import type {
  AiComparableEventRef,
  AiSalesForecastResponse,
} from '@boletera/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AiCacheService } from '../ai-cache.service';
import { MS_PER_DAY } from '../ai-range';
import {
  buildConfidenceInterval,
  clamp,
  cosineSimilarity,
  holtLinearForecast,
  mean,
  resampleSeries,
  round,
  sampleStd,
} from '../stats/stats';

const PACE_BINS = 20;
const MIN_PEERS_LIMITED = 2;
const MIN_PEERS_SUFFICIENT = 5;

type DailySoldRow = { day: Date; sold: number };

/**
 * Event sales & occupancy forecast.
 *
 * Method: blend of (1) Holt linear projection of the observed daily ticket
 * increments to event day, and (2) similarity-weighted final occupancy of
 * completed peer events (same org + category, capacity within 3×).
 * Confidence intervals from peer residual dispersion around the blended point.
 *
 * Complexity: O(P + D) peers + daily buckets; cached 60s.
 */
@Injectable()
export class SalesForecastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AiCacheService,
  ) {}

  async forecast(
    organizationId: string,
    eventId: string,
    from?: string,
    to?: string,
  ): Promise<AiSalesForecastResponse> {
    const cacheKey = this.cache.wrapKey([
      'ai-forecast',
      organizationId,
      eventId,
      from,
      to,
    ]);
    return this.cache.wrap(cacheKey, 60, () =>
      this.compute(organizationId, eventId, from, to),
    );
  }

  private async compute(
    organizationId: string,
    eventId: string,
    from?: string,
    to?: string,
  ): Promise<AiSalesForecastResponse> {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId },
      select: {
        id: true,
        title: true,
        startsAt: true,
        totalCapacity: true,
        category: true,
        salesStartAt: true,
        createdAt: true,
        status: true,
      },
    });
    if (!event) {
      throw new NotFoundException('Evento no encontrado en esta organización');
    }

    const saleStart = event.salesStartAt ?? event.createdAt;
    const observedFrom = from ? new Date(from) : saleStart;
    const observedTo = to ? new Date(to) : new Date();
    const now = observedTo.getTime();
    const daysUntil = Math.ceil((event.startsAt.getTime() - now) / MS_PER_DAY);

    const [ticketGroups, revenueAgg, dailySold] = await Promise.all([
      this.prisma.ticket.groupBy({
        by: ['status'],
        where: { eventId },
        _count: true,
      }),
      this.prisma.order.aggregate({
        where: { organizationId, eventId, status: 'COMPLETED' },
        _sum: { totalAmount: true },
      }),
      this.prisma.$queryRaw<DailySoldRow[]>(Prisma.sql`
        SELECT date_trunc('day', o."createdAt") AS day,
               COALESCE(SUM(oi.quantity), 0)::float AS sold
        FROM "OrderItem" oi
        INNER JOIN "Order" o ON o.id = oi."orderId"
        WHERE o."organizationId" = ${organizationId}
          AND o."eventId" = ${eventId}
          AND o.status = 'COMPLETED'
          AND o."createdAt" >= ${observedFrom}
          AND o."createdAt" < ${observedTo}
        GROUP BY 1
        ORDER BY 1
      `),
    ]);

    let ticketsSold = 0;
    let ticketCap = 0;
    for (const g of ticketGroups) {
      ticketCap += g._count;
      if (g.status === 'SOLD' || g.status === 'USED' || g.status === 'TRANSFERRED') {
        ticketsSold += g._count;
      }
    }
    const capacity = Math.max(event.totalCapacity, ticketCap, 1);
    const grossRevenue = Number(revenueAgg._sum.totalAmount ?? 0);
    const occupancyPercent = (ticketsSold / capacity) * 100;
    const avgTicketPrice = ticketsSold > 0 ? grossRevenue / ticketsSold : 0;

    const dailyIncrements = this.buildDailyIncrements(
      dailySold,
      observedFrom,
      observedTo,
    );
    const cumulative = this.toCumulative(dailyIncrements);
    const observedPace = cumulative.map((v, i) => ({
      dayIndex: i,
      cumulativeOccupancy: round(v / capacity, 4),
    }));

    const peers = await this.loadComparablePeers(
      organizationId,
      event.id,
      event.category,
      capacity,
    );

    const targetCurve = resampleSeries(
      cumulative.map((v) => v / capacity),
      PACE_BINS,
    );
    const scoredPeers: AiComparableEventRef[] = peers
      .map((p) => {
        const peerCurve = resampleSeries(
          p.pace.map((v) => v / Math.max(p.capacity, 1)),
          PACE_BINS,
        );
        const similarity = cosineSimilarity(targetCurve, peerCurve);
        return {
          eventId: p.eventId,
          title: p.title,
          category: p.category,
          similarity: round(similarity, 4),
          finalOccupancyPercent: round((p.finalSold / Math.max(p.capacity, 1)) * 100),
          finalGrossRevenue: round(p.finalRevenue),
        };
      })
      .filter((p) => p.similarity > 0.15)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 12);

    const remainingDays = Math.max(0, daysUntil);
    const holt = holtLinearForecast(dailyIncrements, Math.max(1, remainingDays), 0.45, 0.25);
    const holtAdditional = holt.forecast.reduce((s, v) => s + Math.max(0, v), 0);
    const holtTickets = clamp(ticketsSold + holtAdditional, ticketsSold, capacity);

    let peerOccupancy = occupancyPercent / 100;
    let peerWeightSum = 0;
    const peerFinals: number[] = [];
    for (const peer of scoredPeers) {
      const w = peer.similarity;
      peerOccupancy += w * (peer.finalOccupancyPercent / 100);
      peerWeightSum += w;
      peerFinals.push(peer.finalOccupancyPercent / 100);
    }
    if (peerWeightSum > 0) {
      peerOccupancy /= 1 + peerWeightSum;
    }

    const holtOccupancy = holtTickets / capacity;
    const blendWeight =
      scoredPeers.length >= MIN_PEERS_SUFFICIENT
        ? 0.55
        : scoredPeers.length >= MIN_PEERS_LIMITED
          ? 0.4
          : 0;
    const blendedOccupancy = clamp(
      (1 - blendWeight) * holtOccupancy + blendWeight * peerOccupancy,
      ticketsSold / capacity,
      1,
    );
    const projectedTickets = Math.round(blendedOccupancy * capacity);
    const projectedRevenue =
      avgTicketPrice > 0
        ? projectedTickets * avgTicketPrice
        : blendedOccupancy *
          mean(scoredPeers.map((p) => p.finalGrossRevenue).filter((v) => v > 0).concat([grossRevenue]));

    const peerResiduals = peerFinals.map((f) => (f - blendedOccupancy) * capacity);
    const residualStd =
      peerResiduals.length >= 2
        ? sampleStd(peerResiduals)
        : Math.max(capacity * 0.08, sampleStd(dailyIncrements) * Math.sqrt(Math.max(1, remainingDays)));

    const ticketCi = buildConfidenceInterval({
      point: projectedTickets,
      residualStd,
      sampleSize: scoredPeers.length,
      coverage: 0.8,
      minLimited: MIN_PEERS_LIMITED,
      minSufficient: MIN_PEERS_SUFFICIENT,
      clampMin: ticketsSold,
      clampMax: capacity,
    });

    const occupancyCi = buildConfidenceInterval({
      point: blendedOccupancy * 100,
      residualStd: (residualStd / capacity) * 100,
      sampleSize: scoredPeers.length,
      coverage: 0.8,
      minLimited: MIN_PEERS_LIMITED,
      minSufficient: MIN_PEERS_SUFFICIENT,
      clampMin: occupancyPercent,
      clampMax: 100,
    });

    const revenueResidual =
      avgTicketPrice > 0 ? residualStd * avgTicketPrice : residualStd * Math.max(1, avgTicketPrice || 100);
    const revenueCi = buildConfidenceInterval({
      point: projectedRevenue,
      residualStd: revenueResidual,
      sampleSize: scoredPeers.length,
      coverage: 0.8,
      minLimited: MIN_PEERS_LIMITED,
      minSufficient: MIN_PEERS_SUFFICIENT,
      clampMin: grossRevenue,
    });

    // If the event already finished, project = realized and mark high confidence.
    if (daysUntil < 0) {
      const realizedTickets = buildConfidenceInterval({
        point: ticketsSold,
        residualStd: 0,
        sampleSize: Math.max(scoredPeers.length, 8),
        coverage: 0.8,
        clampMin: ticketsSold,
        clampMax: ticketsSold,
      });
      return {
        organizationId,
        eventId: event.id,
        eventTitle: event.title,
        startsAt: event.startsAt.toISOString(),
        daysUntilEvent: daysUntil,
        totalCapacity: capacity,
        ticketsSold,
        grossRevenue: round(grossRevenue),
        occupancyPercent: round(occupancyPercent),
        currency: 'MXN',
        timezone: 'America/Mexico_City',
        method: {
          id: 'realized_outcome',
          name: 'Resultado realizado',
          rationale:
            'El evento ya ocurrió; se reporta el resultado observado sin proyección.',
        },
        projectedTicketsSold: { ...realizedTickets, level: 'high', sufficiency: 'sufficient' },
        projectedOccupancyPercent: {
          ...buildConfidenceInterval({
            point: occupancyPercent,
            residualStd: 0,
            sampleSize: 8,
            clampMin: occupancyPercent,
            clampMax: occupancyPercent,
          }),
          level: 'high',
          sufficiency: 'sufficient',
        },
        projectedGrossRevenue: {
          ...buildConfidenceInterval({
            point: grossRevenue,
            residualStd: 0,
            sampleSize: 8,
            clampMin: grossRevenue,
            clampMax: grossRevenue,
          }),
          level: 'high',
          sufficiency: 'sufficient',
        },
        comparables: scoredPeers,
        observedPace,
        generatedAt: new Date().toISOString(),
      };
    }

    return {
      organizationId,
      eventId: event.id,
      eventTitle: event.title,
      startsAt: event.startsAt.toISOString(),
      daysUntilEvent: daysUntil,
      totalCapacity: capacity,
      ticketsSold,
      grossRevenue: round(grossRevenue),
      occupancyPercent: round(occupancyPercent),
      currency: 'MXN',
      timezone: 'America/Mexico_City',
      method: {
        id: 'holt_peer_blend',
        name: 'Holt + pares similares',
        rationale:
          'Proyecta el ritmo diario con suavizado de Holt y lo corrige con la ocupación final de eventos comparables ponderados por similitud de curva (coseno).',
      },
      projectedTicketsSold: ticketCi,
      projectedOccupancyPercent: occupancyCi,
      projectedGrossRevenue: revenueCi,
      comparables: scoredPeers,
      observedPace,
      generatedAt: new Date().toISOString(),
    };
  }

  private buildDailyIncrements(
    rows: DailySoldRow[],
    from: Date,
    to: Date,
  ): number[] {
    const byDay = new Map<string, number>();
    for (const r of rows) {
      byDay.set(r.day.toISOString().slice(0, 10), Number(r.sold));
    }
    const start = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
    );
    const end = new Date(
      Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()),
    );
    const out: number[] = [];
    for (let t = start.getTime(); t < end.getTime(); t += MS_PER_DAY) {
      const key = new Date(t).toISOString().slice(0, 10);
      out.push(byDay.get(key) ?? 0);
    }
    if (out.length === 0) out.push(0);
    return out;
  }

  private toCumulative(increments: readonly number[]): number[] {
    const out: number[] = [];
    let acc = 0;
    for (const v of increments) {
      acc += v;
      out.push(acc);
    }
    return out;
  }

  private async loadComparablePeers(
    organizationId: string,
    excludeEventId: string,
    category: string,
    capacity: number,
  ): Promise<
    Array<{
      eventId: string;
      title: string;
      category: string;
      capacity: number;
      finalSold: number;
      finalRevenue: number;
      pace: number[];
    }>
  > {
    const minCap = Math.max(1, Math.floor(capacity / 3));
    const maxCap = capacity * 3;
    const completed = await this.prisma.event.findMany({
      where: {
        organizationId,
        id: { not: excludeEventId },
        category: category as EventCategory,
        status: 'COMPLETED',
        totalCapacity: { gte: minCap, lte: maxCap },
      },
      select: {
        id: true,
        title: true,
        category: true,
        totalCapacity: true,
        salesStartAt: true,
        createdAt: true,
        startsAt: true,
      },
      orderBy: { startsAt: 'desc' },
      take: 40,
    });
    if (completed.length === 0) return [];

    const ids = completed.map((e) => e.id);
    const [ticketGroups, revenueGroups, dailyRows] = await Promise.all([
      this.prisma.ticket.groupBy({
        by: ['eventId', 'status'],
        where: { eventId: { in: ids } },
        _count: true,
      }),
      this.prisma.order.groupBy({
        by: ['eventId'],
        where: {
          organizationId,
          eventId: { in: ids },
          status: 'COMPLETED',
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.$queryRaw<Array<{ eventId: string; day: Date; sold: number }>>(Prisma.sql`
        SELECT o."eventId" AS "eventId",
               date_trunc('day', o."createdAt") AS day,
               COALESCE(SUM(oi.quantity), 0)::float AS sold
        FROM "OrderItem" oi
        INNER JOIN "Order" o ON o.id = oi."orderId"
        WHERE o."organizationId" = ${organizationId}
          AND o."eventId" IN (${Prisma.join(ids)})
          AND o.status = 'COMPLETED'
        GROUP BY 1, 2
        ORDER BY 1, 2
      `),
    ]);

    const soldByEvent = new Map<string, number>();
    for (const g of ticketGroups) {
      if (g.status === 'SOLD' || g.status === 'USED' || g.status === 'TRANSFERRED') {
        soldByEvent.set(g.eventId, (soldByEvent.get(g.eventId) ?? 0) + g._count);
      }
    }
    const revenueByEvent = new Map(
      revenueGroups.map((r) => [r.eventId, Number(r._sum.totalAmount ?? 0)]),
    );
    const dailyByEvent = new Map<string, Array<{ day: Date; sold: number }>>();
    for (const row of dailyRows) {
      const list = dailyByEvent.get(row.eventId) ?? [];
      list.push({ day: row.day, sold: Number(row.sold) });
      dailyByEvent.set(row.eventId, list);
    }

    return completed.map((e) => {
      const saleStart = e.salesStartAt ?? e.createdAt;
      const increments = this.buildDailyIncrements(
        dailyByEvent.get(e.id) ?? [],
        saleStart,
        e.startsAt,
      );
      return {
        eventId: e.id,
        title: e.title,
        category: String(e.category),
        capacity: Math.max(e.totalCapacity, 1),
        finalSold: soldByEvent.get(e.id) ?? 0,
        finalRevenue: revenueByEvent.get(e.id) ?? 0,
        pace: this.toCumulative(increments),
      };
    });
  }
}
