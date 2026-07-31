import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsCacheService } from './metrics-cache.service';
import type {
  AccessAttendanceMetrics,
  CampaignFunnelMetrics,
  EventSalesPaceMetrics,
  EventSalesPaceRow,
  ExecutiveSummaryMetrics,
  FraudSignalsMetrics,
  InventoryMetrics,
  MetricsAlert,
  MetricsAlertsResponse,
  MetricsBreakdown,
  MetricsDateRange,
  MetricsDimensionRow,
  MetricsGranularity,
  MetricsKpi,
  MetricsTimeSeries,
  MetricsTimeSeriesResponse,
  OrdersPaymentsMetrics,
  ResaleMetrics,
  SettlementsMetrics,
  WaitlistMetrics,
} from '@boletera/shared';

const MX_TZ = 'America/Mexico_City';
const CURRENCY = 'MXN' as const;

type AuthUser = {
  organizationId?: string | null;
  role?: string;
  sub?: string;
};

type ResolvedRange = {
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  dateRange: MetricsDateRange;
  comparisonRange: MetricsDateRange;
};

type BucketRow = { bucket: Date; value: number };

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: MetricsCacheService,
  ) {}

  // ---------------------------------------------------------------------------
  // Org + range helpers
  // ---------------------------------------------------------------------------

  resolveOrganizationId(user: AuthUser, queryOrgId?: string): string {
    if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') {
      const orgId = queryOrgId ?? user.organizationId ?? undefined;
      if (!orgId) {
        throw new BadRequestException(
          'organizationId es requerido para administradores de plataforma',
        );
      }
      return orgId;
    }
    if (!user.organizationId) {
      throw new ForbiddenException('Usuario sin organización asignada');
    }
    if (queryOrgId && queryOrgId !== user.organizationId) {
      throw new ForbiddenException('Organization access denied');
    }
    return user.organizationId;
  }

  resolveRange(from?: string, to?: string): ResolvedRange {
    const end = to ? new Date(to) : new Date();
    if (Number.isNaN(end.getTime())) {
      throw new BadRequestException('Parámetro "to" inválido');
    }
    let start: Date;
    if (from) {
      start = new Date(from);
      if (Number.isNaN(start.getTime())) {
        throw new BadRequestException('Parámetro "from" inválido');
      }
    } else {
      start = this.startOfMonthMexico(end);
    }
    if (start >= end) {
      throw new BadRequestException('"from" debe ser anterior a "to"');
    }
    const maxSpanMs = 366 * 24 * 60 * 60 * 1000;
    if (end.getTime() - start.getTime() > maxSpanMs) {
      throw new BadRequestException('El rango máximo permitido es 366 días');
    }
    const span = end.getTime() - start.getTime();
    const previousTo = new Date(start);
    const previousFrom = new Date(start.getTime() - span);
    return {
      from: start,
      to: end,
      previousFrom,
      previousTo,
      dateRange: { from: start.toISOString(), to: end.toISOString() },
      comparisonRange: {
        from: previousFrom.toISOString(),
        to: previousTo.toISOString(),
      },
    };
  }

  private startOfMonthMexico(ref: Date): Date {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: MX_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(ref);
    const y = Number(parts.find((p) => p.type === 'year')?.value);
    const m = Number(parts.find((p) => p.type === 'month')?.value);
    // Approximate Mexico City midnight as UTC-6 (CST); good enough for range defaults.
    return new Date(Date.UTC(y, m - 1, 1, 6, 0, 0));
  }

  private kpi(
    key: string,
    label: string,
    value: number,
    previousValue: number,
    unit: MetricsKpi['unit'] = 'count',
  ): MetricsKpi {
    const delta = value - previousValue;
    const deltaPercent =
      previousValue === 0 ? (value === 0 ? 0 : null) : (delta / previousValue) * 100;
    return {
      key,
      label,
      value: this.round(value),
      previousValue: this.round(previousValue),
      delta: this.round(delta),
      deltaPercent: deltaPercent == null ? null : this.round(deltaPercent),
      unit,
      currency: unit === 'mxn' ? CURRENCY : undefined,
    };
  }

  private round(n: number, digits = 2): number {
    const f = 10 ** digits;
    return Math.round((n + Number.EPSILON) * f) / f;
  }

  private toNum(v: Prisma.Decimal | number | null | undefined): number {
    if (v == null) return 0;
    return typeof v === 'number' ? v : Number(v);
  }

  private async cached<T>(key: string, ttl: number, loader: () => Promise<T>): Promise<T> {
    const hit = this.cache.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await loader();
    this.cache.set(key, value, ttl);
    return value;
  }

  private granularityToTrunc(g: MetricsGranularity): string {
    switch (g) {
      case 'hour':
        return 'hour';
      case 'week':
        return 'week';
      case 'month':
        return 'month';
      case 'day':
      default:
        return 'day';
    }
  }

  private buildBreakdown(
    dimension: string,
    label: string,
    rows: Array<{ key: string; label: string; value: number; secondaryValue?: number }>,
  ): MetricsBreakdown {
    const total = rows.reduce((s, r) => s + r.value, 0);
    return {
      dimension,
      label,
      total: this.round(total),
      rows: rows.map((r) => ({
        key: r.key,
        label: r.label,
        value: this.round(r.value),
        secondaryValue: r.secondaryValue != null ? this.round(r.secondaryValue) : undefined,
        percentOfTotal: total > 0 ? this.round((r.value / total) * 100) : 0,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Executive summary
  // Complexity: O(1) parallel aggregates + 1 groupBy channel + 1 raw timeseries
  // ---------------------------------------------------------------------------

  async getExecutiveSummary(
    organizationId: string,
    from?: string,
    to?: string,
  ): Promise<ExecutiveSummaryMetrics> {
    const range = this.resolveRange(from, to);
    const cacheKey = this.cache.wrapKey([
      'exec',
      organizationId,
      range.from.toISOString(),
      range.to.toISOString(),
    ]);

    return this.cached(cacheKey, 45, async () => {
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { commissionRate: true },
      });
      if (!org) throw new BadRequestException('Organización no encontrada');

      const [
        currentAgg,
        previousAgg,
        currentTickets,
        previousTickets,
        currentOrdersAll,
        previousOrdersAll,
        channelGroup,
        seriesRows,
      ] = await Promise.all([
        this.prisma.order.aggregate({
          where: {
            organizationId,
            status: 'COMPLETED',
            createdAt: { gte: range.from, lt: range.to },
          },
          _sum: { totalAmount: true, commissionAmount: true },
          _count: true,
        }),
        this.prisma.order.aggregate({
          where: {
            organizationId,
            status: 'COMPLETED',
            createdAt: { gte: range.previousFrom, lt: range.previousTo },
          },
          _sum: { totalAmount: true, commissionAmount: true },
          _count: true,
        }),
        this.sumOrderItemQty(organizationId, range.from, range.to),
        this.sumOrderItemQty(organizationId, range.previousFrom, range.previousTo),
        this.prisma.order.count({
          where: { organizationId, createdAt: { gte: range.from, lt: range.to } },
        }),
        this.prisma.order.count({
          where: {
            organizationId,
            createdAt: { gte: range.previousFrom, lt: range.previousTo },
          },
        }),
        this.prisma.order.groupBy({
          by: ['channel'],
          where: {
            organizationId,
            status: 'COMPLETED',
            createdAt: { gte: range.from, lt: range.to },
          },
          _sum: { totalAmount: true },
          _count: true,
        }),
        this.revenueSeries(organizationId, range.from, range.to, 'day'),
      ]);

      const gross = this.toNum(currentAgg._sum.totalAmount);
      const prevGross = this.toNum(previousAgg._sum.totalAmount);
      const commission =
        this.toNum(currentAgg._sum.commissionAmount) || gross * org.commissionRate;
      const prevCommission =
        this.toNum(previousAgg._sum.commissionAmount) || prevGross * org.commissionRate;
      const net = gross - commission;
      const prevNet = prevGross - prevCommission;
      const avgTicket = currentTickets > 0 ? gross / currentTickets : 0;
      const prevAvgTicket = previousTickets > 0 ? prevGross / previousTickets : 0;
      const conversion = currentOrdersAll > 0 ? currentAgg._count / currentOrdersAll : 0;
      const prevConversion =
        previousOrdersAll > 0 ? previousAgg._count / previousOrdersAll : 0;

      const daysInPeriod = Math.max(
        1,
        (range.to.getTime() - range.from.getTime()) / (24 * 60 * 60 * 1000),
      );
      const daysElapsed = Math.min(
        daysInPeriod,
        Math.max(1, (Date.now() - range.from.getTime()) / (24 * 60 * 60 * 1000)),
      );
      const pace = daysElapsed / daysInPeriod;

      return {
        organizationId,
        dateRange: range.dateRange,
        comparisonRange: range.comparisonRange,
        currency: CURRENCY,
        timezone: MX_TZ,
        kpis: {
          grossRevenue: this.kpi('grossRevenue', 'Ingresos brutos', gross, prevGross, 'mxn'),
          netRevenue: this.kpi('netRevenue', 'Ingresos netos', net, prevNet, 'mxn'),
          ticketsSold: this.kpi('ticketsSold', 'Boletos vendidos', currentTickets, previousTickets),
          averageTicketPrice: this.kpi(
            'averageTicketPrice',
            'Ticket promedio',
            avgTicket,
            prevAvgTicket,
            'mxn',
          ),
          conversionRate: this.kpi(
            'conversionRate',
            'Tasa de conversión',
            conversion * 100,
            prevConversion * 100,
            'percent',
          ),
          ordersCompleted: this.kpi(
            'ordersCompleted',
            'Órdenes completadas',
            currentAgg._count,
            previousAgg._count,
          ),
        },
        revenueByChannel: this.buildBreakdown(
          'channel',
          'Ingresos por canal',
          channelGroup.map((c) => ({
            key: c.channel,
            label: c.channel,
            value: this.toNum(c._sum.totalAmount),
            secondaryValue: c._count,
          })),
        ),
        projection: {
          projectedGrossRevenue: this.round(pace > 0 ? gross / pace : gross),
          projectedTicketsSold: Math.round(pace > 0 ? currentTickets / pace : currentTickets),
          method: 'linear_pace',
          daysElapsed: this.round(daysElapsed, 1),
          daysInPeriod: this.round(daysInPeriod, 1),
        },
        series: [
          {
            key: 'revenue',
            label: 'Ingresos diarios',
            granularity: 'day',
            unit: 'mxn',
            points: seriesRows.map((r) => ({
              bucket: r.bucket.toISOString(),
              value: this.round(r.value),
            })),
          },
        ],
        generatedAt: new Date().toISOString(),
      };
    });
  }

  /**
   * Sum of OrderItem.quantity for completed orders in range.
   * Complexity: O(1) raw aggregate join — avoids loading order rows.
   */
  private async sumOrderItemQty(
    organizationId: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ qty: bigint | number }>>`
      SELECT COALESCE(SUM(oi.quantity), 0) AS qty
      FROM "OrderItem" oi
      INNER JOIN "Order" o ON o.id = oi."orderId"
      WHERE o."organizationId" = ${organizationId}
        AND o.status = 'COMPLETED'
        AND o."createdAt" >= ${from}
        AND o."createdAt" < ${to}
    `;
    return Number(rows[0]?.qty ?? 0);
  }

  /**
   * Revenue time series via date_trunc.
   * Complexity: O(n log n) sort of buckets; n = rows scanned in index range.
   */
  private async revenueSeries(
    organizationId: string,
    from: Date,
    to: Date,
    granularity: MetricsGranularity,
  ): Promise<BucketRow[]> {
    const trunc = this.granularityToTrunc(granularity);
    return this.prisma.$queryRaw<BucketRow[]>(Prisma.sql`
      SELECT date_trunc(${Prisma.raw(`'${trunc}'`)}, o."createdAt") AS bucket,
             COALESCE(SUM(o."totalAmount"), 0)::float AS value
      FROM "Order" o
      WHERE o."organizationId" = ${organizationId}
        AND o.status = 'COMPLETED'
        AND o."createdAt" >= ${from}
        AND o."createdAt" < ${to}
      GROUP BY 1
      ORDER BY 1
    `);
  }

  // ---------------------------------------------------------------------------
  // Events sales pace
  // Complexity: O(E) events + 2 groupBy (tickets, revenue) — no N+1
  // ---------------------------------------------------------------------------

  async getEventSalesPace(
    organizationId: string,
    from?: string,
    to?: string,
  ): Promise<EventSalesPaceMetrics> {
    const range = this.resolveRange(from, to);
    const cacheKey = this.cache.wrapKey([
      'pace',
      organizationId,
      range.from.toISOString(),
      range.to.toISOString(),
    ]);

    return this.cached(cacheKey, 60, async () => {
      const events = await this.prisma.event.findMany({
        where: {
          organizationId,
          status: { in: ['SCHEDULED', 'LIVE', 'DRAFT', 'RESCHEDULED'] },
          startsAt: { gte: range.from },
        },
        select: {
          id: true,
          title: true,
          status: true,
          startsAt: true,
          totalCapacity: true,
          salesStartAt: true,
          createdAt: true,
        },
        orderBy: { startsAt: 'asc' },
        take: 200,
      });

      const eventIds = events.map((e) => e.id);
      if (eventIds.length === 0) {
        return {
          organizationId,
          dateRange: range.dateRange,
          events: [],
          atRisk: [],
          topPerformers: [],
          generatedAt: new Date().toISOString(),
        };
      }

      const [ticketGroups, revenueGroups] = await Promise.all([
        this.prisma.ticket.groupBy({
          by: ['eventId', 'status'],
          where: { eventId: { in: eventIds } },
          _count: true,
        }),
        this.prisma.order.groupBy({
          by: ['eventId'],
          where: {
            organizationId,
            eventId: { in: eventIds },
            status: 'COMPLETED',
          },
          _sum: { totalAmount: true },
        }),
      ]);

      const soldByEvent = new Map<string, number>();
      const capacityCountByEvent = new Map<string, number>();
      for (const g of ticketGroups) {
        capacityCountByEvent.set(
          g.eventId,
          (capacityCountByEvent.get(g.eventId) ?? 0) + g._count,
        );
        if (g.status === 'SOLD' || g.status === 'USED' || g.status === 'TRANSFERRED') {
          soldByEvent.set(g.eventId, (soldByEvent.get(g.eventId) ?? 0) + g._count);
        }
      }
      const revenueByEvent = new Map(
        revenueGroups.map((r) => [r.eventId, this.toNum(r._sum.totalAmount)]),
      );

      const now = Date.now();
      const rows: EventSalesPaceRow[] = events.map((event) => {
        const sold = soldByEvent.get(event.id) ?? 0;
        const ticketCap = capacityCountByEvent.get(event.id) ?? 0;
        const capacity = Math.max(event.totalCapacity, ticketCap, 1);
        const occupancyPercent = (sold / capacity) * 100;
        const daysUntil = Math.ceil((event.startsAt.getTime() - now) / (24 * 60 * 60 * 1000));
        const saleStart = event.salesStartAt ?? event.createdAt;
        const saleWindowMs = Math.max(1, event.startsAt.getTime() - saleStart.getTime());
        const elapsedMs = Math.min(
          saleWindowMs,
          Math.max(0, now - saleStart.getTime()),
        );
        const expectedPace = elapsedMs / saleWindowMs;
        const actualPace = sold / capacity;
        const paceDelta = actualPace - expectedPace;
        let riskLevel: EventSalesPaceRow['riskLevel'] = 'on_track';
        if (daysUntil >= 0 && expectedPace > 0.15) {
          if (paceDelta < -0.35) riskLevel = 'critical';
          else if (paceDelta < -0.2) riskLevel = 'at_risk';
          else if (paceDelta < -0.1) riskLevel = 'watch';
        }

        return {
          eventId: event.id,
          title: event.title,
          status: event.status,
          startsAt: event.startsAt.toISOString(),
          daysUntilEvent: daysUntil,
          totalCapacity: capacity,
          ticketsSold: sold,
          occupancyPercent: this.round(occupancyPercent),
          remainingCapacity: Math.max(0, capacity - sold),
          grossRevenue: this.round(revenueByEvent.get(event.id) ?? 0),
          actualPace: this.round(actualPace, 4),
          expectedPace: this.round(expectedPace, 4),
          paceDelta: this.round(paceDelta, 4),
          riskLevel,
        };
      });

      const atRisk = rows
        .filter((r) => r.riskLevel === 'at_risk' || r.riskLevel === 'critical')
        .sort((a, b) => a.paceDelta - b.paceDelta);
      const topPerformers = [...rows]
        .filter((r) => r.paceDelta >= 0 && r.ticketsSold > 0)
        .sort((a, b) => b.paceDelta - a.paceDelta)
        .slice(0, 10);

      return {
        organizationId,
        dateRange: range.dateRange,
        events: rows,
        atRisk,
        topPerformers,
        generatedAt: new Date().toISOString(),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Inventory
  // Complexity: O(O) offers + 1 ticket groupBy + 1 hold count — no N+1
  // ---------------------------------------------------------------------------

  async getInventoryMetrics(
    organizationId: string,
    from?: string,
    to?: string,
    eventId?: string,
  ): Promise<InventoryMetrics> {
    const range = this.resolveRange(from, to);
    const cacheKey = this.cache.wrapKey([
      'inv',
      organizationId,
      eventId,
      range.from.toISOString(),
      range.to.toISOString(),
    ]);

    return this.cached(cacheKey, 45, async () => {
      const eventFilter = {
        organizationId,
        ...(eventId ? { id: eventId } : {}),
      };

      const offers = await this.prisma.offer.findMany({
        where: { event: eventFilter },
        select: {
          id: true,
          name: true,
          zone: true,
          totalQuantity: true,
          remainingQuantity: true,
          soldQuantity: true,
          holdQuantity: true,
          startDate: true,
          event: { select: { id: true, title: true } },
        },
        take: 500,
      });

      const [statusGroups, activeHolds, blocked] = await Promise.all([
        this.prisma.ticket.groupBy({
          by: ['status'],
          where: { event: eventFilter },
          _count: true,
        }),
        this.prisma.seatHold.count({
          where: {
            status: 'ACTIVE',
            expiresAt: { gt: new Date() },
            event: eventFilter,
          },
        }),
        this.prisma.ticket.count({
          where: {
            event: eventFilter,
            status: 'AVAILABLE',
            // Blocked = available but on offers marked unavailable
            offer: { isAvailable: false },
          },
        }),
      ]);

      const now = Date.now();
      const byZone = offers.map((o) => {
        const daysOnSale = Math.max(
          1,
          (now - o.startDate.getTime()) / (24 * 60 * 60 * 1000),
        );
        const velocity = o.soldQuantity / daysOnSale;
        const daysToSellOut =
          velocity > 0.01 ? this.round(o.remainingQuantity / velocity, 1) : null;
        return {
          eventId: o.event.id,
          eventTitle: o.event.title,
          offerId: o.id,
          zone: o.zone,
          tierName: o.name,
          totalQuantity: o.totalQuantity,
          remainingQuantity: o.remainingQuantity,
          soldQuantity: o.soldQuantity,
          holdQuantity: o.holdQuantity,
          availabilityPercent:
            o.totalQuantity > 0
              ? this.round((o.remainingQuantity / o.totalQuantity) * 100)
              : 0,
          sellThroughVelocity: this.round(velocity, 3),
          daysToSellOut,
        };
      });

      const countByStatus = Object.fromEntries(
        statusGroups.map((g) => [g.status, g._count]),
      ) as Record<string, number>;

      const totalCapacity = offers.reduce((s, o) => s + o.totalQuantity, 0);
      const available = offers.reduce((s, o) => s + o.remainingQuantity, 0);
      const held = countByStatus['HELD'] ?? 0;
      const sold =
        (countByStatus['SOLD'] ?? 0) +
        (countByStatus['USED'] ?? 0) +
        (countByStatus['TRANSFERRED'] ?? 0);

      return {
        organizationId,
        dateRange: range.dateRange,
        summary: {
          totalCapacity,
          available,
          held,
          sold,
          blocked,
          activeHolds,
        },
        byZone,
        statusBreakdown: this.buildBreakdown(
          'ticketStatus',
          'Inventario por estado',
          statusGroups.map((g) => ({
            key: g.status,
            label: g.status,
            value: g._count,
          })),
        ),
        generatedAt: new Date().toISOString(),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Orders & payments
  // Complexity: O(1) parallel groupBy/aggregate — no row hydration
  // ---------------------------------------------------------------------------

  async getOrdersPaymentsMetrics(
    organizationId: string,
    from?: string,
    to?: string,
  ): Promise<OrdersPaymentsMetrics> {
    const range = this.resolveRange(from, to);
    const cacheKey = this.cache.wrapKey([
      'orders',
      organizationId,
      range.from.toISOString(),
      range.to.toISOString(),
    ]);

    return this.cached(cacheKey, 45, async () => {
      const [
        statusGroup,
        prevStatusGroup,
        methodGroup,
        refundAgg,
        prevRefundAgg,
        chargebacks,
        prevChargebacks,
        revenueAgg,
        prevRevenueAgg,
      ] = await Promise.all([
        this.prisma.order.groupBy({
          by: ['status'],
          where: { organizationId, createdAt: { gte: range.from, lt: range.to } },
          _count: true,
          _sum: { totalAmount: true },
        }),
        this.prisma.order.groupBy({
          by: ['status'],
          where: {
            organizationId,
            createdAt: { gte: range.previousFrom, lt: range.previousTo },
          },
          _count: true,
        }),
        this.prisma.order.groupBy({
          by: ['paymentMethod'],
          where: {
            organizationId,
            status: 'COMPLETED',
            createdAt: { gte: range.from, lt: range.to },
          },
          _count: true,
          _sum: { totalAmount: true },
        }),
        this.prisma.refund.aggregate({
          where: {
            status: 'COMPLETED',
            requestedAt: { gte: range.from, lt: range.to },
            order: { organizationId },
          },
          _count: true,
          _sum: { amount: true },
        }),
        this.prisma.refund.aggregate({
          where: {
            status: 'COMPLETED',
            requestedAt: { gte: range.previousFrom, lt: range.previousTo },
            order: { organizationId },
          },
          _count: true,
        }),
        this.prisma.fraudFlag.count({
          where: {
            type: 'CHARGEBACK',
            createdAt: { gte: range.from, lt: range.to },
            OR: [
              { order: { organizationId } },
              { event: { organizationId } },
            ],
          },
        }),
        this.prisma.fraudFlag.count({
          where: {
            type: 'CHARGEBACK',
            createdAt: { gte: range.previousFrom, lt: range.previousTo },
            OR: [
              { order: { organizationId } },
              { event: { organizationId } },
            ],
          },
        }),
        this.prisma.order.aggregate({
          where: {
            organizationId,
            status: 'COMPLETED',
            createdAt: { gte: range.from, lt: range.to },
          },
          _sum: { totalAmount: true },
          _count: true,
        }),
        this.prisma.order.aggregate({
          where: {
            organizationId,
            status: 'COMPLETED',
            createdAt: { gte: range.previousFrom, lt: range.previousTo },
          },
          _sum: { totalAmount: true },
          _count: true,
        }),
      ]);

      const countMap = (groups: Array<{ status: string; _count: number }>) =>
        Object.fromEntries(groups.map((g) => [g.status, g._count])) as Record<
          string,
          number
        >;

      const cur = countMap(statusGroup);
      const prev = countMap(prevStatusGroup);
      const totalCur = Object.values(cur).reduce((a, b) => a + b, 0);
      const totalPrev = Object.values(prev).reduce((a, b) => a + b, 0);
      const completed = cur['COMPLETED'] ?? 0;
      const prevCompleted = prev['COMPLETED'] ?? 0;
      const approvalRate = totalCur > 0 ? (completed / totalCur) * 100 : 0;
      const prevApproval = totalPrev > 0 ? (prevCompleted / totalPrev) * 100 : 0;
      const refundRate = completed > 0 ? (refundAgg._count / completed) * 100 : 0;
      const prevRefundRate =
        prevCompleted > 0 ? (prevRefundAgg._count / prevCompleted) * 100 : 0;

      return {
        organizationId,
        dateRange: range.dateRange,
        comparisonRange: range.comparisonRange,
        volumeByStatus: this.buildBreakdown(
          'orderStatus',
          'Volumen por estado',
          statusGroup.map((g) => ({
            key: g.status,
            label: g.status,
            value: g._count,
            secondaryValue: this.toNum(g._sum.totalAmount),
          })),
        ),
        paymentMethodBreakdown: this.buildBreakdown(
          'paymentMethod',
          'Método de pago',
          methodGroup.map((g) => ({
            key: g.paymentMethod,
            label: g.paymentMethod,
            value: this.toNum(g._sum.totalAmount),
            secondaryValue: g._count,
          })),
        ),
        kpis: {
          approvalRate: this.kpi(
            'approvalRate',
            'Tasa de aprobación',
            approvalRate,
            prevApproval,
            'percent',
          ),
          refundRate: this.kpi(
            'refundRate',
            'Tasa de reembolso',
            refundRate,
            prevRefundRate,
            'percent',
          ),
          chargebackCount: this.kpi(
            'chargebackCount',
            'Contracargos',
            chargebacks,
            prevChargebacks,
          ),
          completedOrders: this.kpi(
            'completedOrders',
            'Órdenes completadas',
            revenueAgg._count,
            prevRevenueAgg._count,
          ),
          grossRevenue: this.kpi(
            'grossRevenue',
            'Ingresos brutos',
            this.toNum(revenueAgg._sum.totalAmount),
            this.toNum(prevRevenueAgg._sum.totalAmount),
            'mxn',
          ),
        },
        generatedAt: new Date().toISOString(),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Access / attendance
  // Complexity: 1 raw hourly series + 2 counts + 1 groupBy zone
  // ---------------------------------------------------------------------------

  async getAccessMetrics(
    organizationId: string,
    from?: string,
    to?: string,
    eventId?: string,
  ): Promise<AccessAttendanceMetrics> {
    const range = this.resolveRange(from, to);
    const cacheKey = this.cache.wrapKey([
      'access',
      organizationId,
      eventId,
      range.from.toISOString(),
      range.to.toISOString(),
    ]);

    return this.cached(cacheKey, 45, async () => {
      const eventWhere = eventId
        ? Prisma.sql`AND e.id = ${eventId}`
        : Prisma.empty;

      const hourly = await this.prisma.$queryRaw<
        Array<{ bucket: Date; value: number }>
      >`
        SELECT date_trunc('hour', ts."scannedAt") AS bucket,
               COUNT(*)::float AS value
        FROM "TicketScan" ts
        INNER JOIN "Ticket" t ON t.id = ts."ticketId"
        INNER JOIN "Event" e ON e.id = t."eventId"
        WHERE e."organizationId" = ${organizationId}
          AND ts.success = true
          AND ts."scannedAt" >= ${range.from}
          AND ts."scannedAt" < ${range.to}
          ${eventWhere}
        GROUP BY 1
        ORDER BY 1
      `;

      const soldStatuses: Array<'SOLD' | 'USED' | 'TRANSFERRED'> = [
        'SOLD',
        'USED',
        'TRANSFERRED',
      ];
      const ticketWhere = {
        event: {
          organizationId,
          ...(eventId ? { id: eventId } : {}),
        },
        status: { in: soldStatuses },
      };

      const [sold, checkedIn, zoneTraffic] = await Promise.all([
        this.prisma.ticket.count({ where: ticketWhere }),
        this.prisma.ticket.count({
          where: { ...ticketWhere, checkedInAt: { not: null } },
        }),
        this.prisma.$queryRaw<Array<{ zone: string; value: bigint | number }>>`
          SELECT COALESCE(az.name, 'Sin zona') AS zone,
                 COUNT(*)::bigint AS value
          FROM "TicketScan" ts
          INNER JOIN "Ticket" t ON t.id = ts."ticketId"
          INNER JOIN "Event" e ON e.id = t."eventId"
          LEFT JOIN "AccessZone" az ON az.id = ts."zoneId"
          WHERE e."organizationId" = ${organizationId}
            AND ts.success = true
            AND ts."scannedAt" >= ${range.from}
            AND ts."scannedAt" < ${range.to}
            ${eventWhere}
          GROUP BY 1
          ORDER BY 2 DESC
        `,
      ]);

      const noShow = Math.max(0, sold - checkedIn);
      const noShowRate = sold > 0 ? (noShow / sold) * 100 : 0;

      const checkInByHour: MetricsTimeSeries = {
        key: 'checkins',
        label: 'Check-ins por hora',
        granularity: 'hour',
        unit: 'count',
        points: hourly.map((h) => ({
          bucket: h.bucket.toISOString(),
          value: Number(h.value),
        })),
      };

      return {
        organizationId,
        dateRange: range.dateRange,
        eventId,
        checkInByHour,
        noShowRate: this.round(noShowRate),
        ticketsSold: sold,
        ticketsCheckedIn: checkedIn,
        ticketsNoShow: noShow,
        trafficByAccessPoint: this.buildBreakdown(
          'accessPoint',
          'Tráfico por punto de acceso',
          zoneTraffic.map((z) => ({
            key: z.zone,
            label: z.zone,
            value: Number(z.value),
          })),
        ),
        generatedAt: new Date().toISOString(),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Resale
  // ---------------------------------------------------------------------------

  async getResaleMetrics(
    organizationId: string,
    from?: string,
    to?: string,
  ): Promise<ResaleMetrics> {
    const range = this.resolveRange(from, to);
    const cacheKey = this.cache.wrapKey([
      'resale',
      organizationId,
      range.from.toISOString(),
      range.to.toISOString(),
    ]);

    return this.cached(cacheKey, 60, async () => {
      const listingWhere = {
        ticket: { event: { organizationId } },
        listedAt: { gte: range.from, lt: range.to },
      };

      const [statusGroup, soldAgg, activeCount, series] = await Promise.all([
        this.prisma.resaleListing.groupBy({
          by: ['status'],
          where: listingWhere,
          _count: true,
          _sum: { askingPrice: true, fee: true },
          _avg: { askingPrice: true },
        }),
        this.prisma.resaleListing.aggregate({
          where: { ...listingWhere, status: 'SOLD' },
          _sum: { askingPrice: true, fee: true },
          _avg: { askingPrice: true },
          _count: true,
        }),
        this.prisma.resaleListing.count({
          where: {
            ticket: { event: { organizationId } },
            status: 'ACTIVE',
          },
        }),
        this.prisma.$queryRaw<BucketRow[]>`
          SELECT date_trunc('day', rl."listedAt") AS bucket,
                 COUNT(*)::float AS value
          FROM "ResaleListing" rl
          INNER JOIN "Ticket" t ON t.id = rl."ticketId"
          INNER JOIN "Event" e ON e.id = t."eventId"
          WHERE e."organizationId" = ${organizationId}
            AND rl."listedAt" >= ${range.from}
            AND rl."listedAt" < ${range.to}
          GROUP BY 1
          ORDER BY 1
        `,
      ]);

      const cancelled =
        (statusGroup.find((s) => s.status === 'CANCELLED')?._count ?? 0) +
        (statusGroup.find((s) => s.status === 'DELISTED')?._count ?? 0);

      return {
        organizationId,
        dateRange: range.dateRange,
        summary: {
          activeListings: activeCount,
          soldListings: soldAgg._count,
          cancelledListings: cancelled,
          grossGmv: this.round(this.toNum(soldAgg._sum.askingPrice)),
          platformFees: this.round(this.toNum(soldAgg._sum.fee)),
          averageAskingPrice: this.round(
            this.toNum(
              statusGroup.reduce((s, g) => s + this.toNum(g._avg.askingPrice) * g._count, 0) /
                Math.max(
                  1,
                  statusGroup.reduce((s, g) => s + g._count, 0),
                ),
            ),
          ),
          averageSoldPrice: this.round(this.toNum(soldAgg._avg.askingPrice)),
        },
        statusBreakdown: this.buildBreakdown(
          'resaleStatus',
          'Listados por estado',
          statusGroup.map((g) => ({
            key: g.status,
            label: g.status,
            value: g._count,
            secondaryValue: this.toNum(g._sum.askingPrice),
          })),
        ),
        series: [
          {
            key: 'listings',
            label: 'Nuevos listados diarios',
            granularity: 'day',
            unit: 'count',
            points: series.map((r) => ({
              bucket: r.bucket.toISOString(),
              value: Number(r.value),
            })),
          },
        ],
        generatedAt: new Date().toISOString(),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Waitlist
  // ---------------------------------------------------------------------------

  async getWaitlistMetrics(
    organizationId: string,
    from?: string,
    to?: string,
  ): Promise<WaitlistMetrics> {
    const range = this.resolveRange(from, to);
    const cacheKey = this.cache.wrapKey([
      'waitlist',
      organizationId,
      range.from.toISOString(),
      range.to.toISOString(),
    ]);

    return this.cached(cacheKey, 60, async () => {
      const [statusGroup, byEvent] = await Promise.all([
        this.prisma.waitlistEntry.groupBy({
          by: ['status'],
          where: {
            event: { organizationId },
            createdAt: { gte: range.from, lt: range.to },
          },
          _count: true,
        }),
        this.prisma.$queryRaw<
          Array<{ eventId: string; title: string; value: bigint | number }>
        >`
          SELECT e.id AS "eventId", e.title, COUNT(*)::bigint AS value
          FROM "WaitlistEntry" w
          INNER JOIN "Event" e ON e.id = w."eventId"
          WHERE e."organizationId" = ${organizationId}
            AND w."createdAt" >= ${range.from}
            AND w."createdAt" < ${range.to}
          GROUP BY e.id, e.title
          ORDER BY value DESC
          LIMIT 25
        `,
      ]);

      const counts = Object.fromEntries(
        statusGroup.map((s) => [s.status, s._count]),
      ) as Record<string, number>;
      const pending = counts['PENDING'] ?? 0;
      const notified = counts['NOTIFIED'] ?? 0;
      const converted = counts['CONVERTED'] ?? 0;
      const expired = counts['EXPIRED'] ?? 0;
      const cancelled = counts['CANCELLED'] ?? 0;
      const top = pending + notified + converted + expired + cancelled;
      const conversionRate = top > 0 ? (converted / top) * 100 : 0;

      const stages = [
        { key: 'pending', label: 'En lista', count: pending + notified + converted },
        { key: 'notified', label: 'Notificados', count: notified + converted },
        { key: 'converted', label: 'Convertidos', count: converted },
      ];

      return {
        organizationId,
        dateRange: range.dateRange,
        summary: {
          pending,
          notified,
          converted,
          expired,
          cancelled,
          conversionRate: this.round(conversionRate),
        },
        byEvent: byEvent.map(
          (e): MetricsDimensionRow => ({
            key: e.eventId,
            label: e.title,
            value: Number(e.value),
          }),
        ),
        funnel: {
          key: 'waitlist',
          label: 'Embudo de lista de espera',
          stages: stages.map((s, i) => ({
            key: s.key,
            label: s.label,
            count: s.count,
            conversionFromPrevious:
              i === 0 || stages[i - 1].count === 0
                ? null
                : this.round((s.count / stages[i - 1].count) * 100),
            conversionFromTop:
              stages[0].count === 0 ? 0 : this.round((s.count / stages[0].count) * 100),
          })),
        },
        generatedAt: new Date().toISOString(),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Campaigns / promotions funnel
  // ---------------------------------------------------------------------------

  async getCampaignMetrics(
    organizationId: string,
    from?: string,
    to?: string,
  ): Promise<CampaignFunnelMetrics> {
    const range = this.resolveRange(from, to);
    const cacheKey = this.cache.wrapKey([
      'campaigns',
      organizationId,
      range.from.toISOString(),
      range.to.toISOString(),
    ]);

    return this.cached(cacheKey, 60, async () => {
      const promotions = await this.prisma.promotion.findMany({
        where: {
          organizationId,
          OR: [
            { startDate: { lte: range.to }, endDate: { gte: range.from } },
            { createdAt: { gte: range.from, lt: range.to } },
          ],
        },
        select: {
          id: true,
          code: true,
          name: true,
          usageCount: true,
          usageLimit: true,
        },
        take: 100,
      });

      const promoIds = promotions.map((p) => p.id);
      const orderStats =
        promoIds.length === 0
          ? []
          : await this.prisma.order.groupBy({
              by: ['promotionId'],
              where: {
                organizationId,
                promotionId: { in: promoIds },
                status: 'COMPLETED',
                createdAt: { gte: range.from, lt: range.to },
              },
              _count: true,
              _sum: { totalAmount: true, discountAmount: true },
            });

      const statsMap = new Map(
        orderStats
          .filter((o) => o.promotionId != null)
          .map((o) => [
            o.promotionId as string,
            {
              orders: o._count,
              revenue: this.toNum(o._sum.totalAmount),
              discount: this.toNum(o._sum.discountAmount),
            },
          ]),
      );

      const rows = promotions.map((p) => {
        const s = statsMap.get(p.id) ?? { orders: 0, revenue: 0, discount: 0 };
        const limit = p.usageLimit ?? Math.max(p.usageCount, 1);
        const conversionRate = limit > 0 ? (s.orders / limit) * 100 : 0;
        let performance: 'strong' | 'average' | 'poor' = 'average';
        if (conversionRate >= 40) performance = 'strong';
        else if (conversionRate < 10) performance = 'poor';
        return {
          promotionId: p.id,
          code: p.code,
          name: p.name,
          usageCount: p.usageCount,
          usageLimit: p.usageLimit,
          ordersAttributed: s.orders,
          revenueAttributed: this.round(s.revenue),
          discountGiven: this.round(s.discount),
          conversionRate: this.round(conversionRate),
          performance,
        };
      });

      const totalLimit = rows.reduce(
        (s, r) => s + (r.usageLimit ?? (r.usageCount || 1)),
        0,
      );
      const totalOrders = rows.reduce((s, r) => s + r.ordersAttributed, 0);

      const funnelStages = [
        { key: 'allocated', label: 'Cupo asignado', count: totalLimit },
        { key: 'redeemed', label: 'Canjes / órdenes', count: totalOrders },
        {
          key: 'revenue',
          label: 'Órdenes con ingreso',
          count: rows.filter((r) => r.revenueAttributed > 0).length,
        },
      ];

      return {
        organizationId,
        dateRange: range.dateRange,
        promotions: rows,
        funnel: {
          key: 'campaigns',
          label: 'Embudo de campañas',
          stages: funnelStages.map((s, i) => ({
            key: s.key,
            label: s.label,
            count: s.count,
            conversionFromPrevious:
              i === 0 || funnelStages[i - 1].count === 0
                ? null
                : this.round((s.count / funnelStages[i - 1].count) * 100),
            conversionFromTop:
              funnelStages[0].count === 0
                ? 0
                : this.round((s.count / funnelStages[0].count) * 100),
          })),
        },
        generatedAt: new Date().toISOString(),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Fraud
  // ---------------------------------------------------------------------------

  async getFraudMetrics(
    organizationId: string,
    from?: string,
    to?: string,
  ): Promise<FraudSignalsMetrics> {
    const range = this.resolveRange(from, to);
    const cacheKey = this.cache.wrapKey([
      'fraud',
      organizationId,
      range.from.toISOString(),
      range.to.toISOString(),
    ]);

    return this.cached(cacheKey, 45, async () => {
      const orgScope = {
        createdAt: { gte: range.from, lt: range.to },
        OR: [{ order: { organizationId } }, { event: { organizationId } }],
      };

      const [byType, bySeverity, summaryAgg, falsePositives, recent] =
        await Promise.all([
          this.prisma.fraudFlag.groupBy({
            by: ['type'],
            where: orgScope,
            _count: true,
          }),
          this.prisma.fraudFlag.groupBy({
            by: ['severity'],
            where: orgScope,
            _count: true,
          }),
          this.prisma.fraudFlag.aggregate({
            where: orgScope,
            _count: true,
            _avg: { score: true },
          }),
          this.prisma.fraudFlag.count({
            where: { ...orgScope, status: 'FALSE_POSITIVE' },
          }),
          this.prisma.fraudFlag.findMany({
            where: orgScope,
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: {
              id: true,
              type: true,
              severity: true,
              score: true,
              reason: true,
              status: true,
              orderId: true,
              eventId: true,
              createdAt: true,
            },
          }),
        ]);

      const [openFlags, criticalFlags, resolvedFlags] = await Promise.all([
        this.prisma.fraudFlag.count({
          where: {
            ...orgScope,
            status: { in: ['FLAGGED', 'INVESTIGATING'] },
          },
        }),
        this.prisma.fraudFlag.count({
          where: { ...orgScope, severity: 'CRITICAL' },
        }),
        this.prisma.fraudFlag.count({
          where: { ...orgScope, status: 'RESOLVED' },
        }),
      ]);

      return {
        organizationId,
        dateRange: range.dateRange,
        summary: {
          totalFlags: summaryAgg._count,
          openFlags,
          criticalFlags,
          averageRiskScore: this.round(summaryAgg._avg.score ?? 0),
          resolvedFlags,
          falsePositives,
        },
        byType: this.buildBreakdown(
          'fraudType',
          'Señales por tipo',
          byType.map((t) => ({ key: t.type, label: t.type, value: t._count })),
        ),
        bySeverity: this.buildBreakdown(
          'fraudSeverity',
          'Señales por severidad',
          bySeverity.map((s) => ({
            key: s.severity,
            label: s.severity,
            value: s._count,
          })),
        ),
        recentSignals: recent.map((f) => ({
          id: f.id,
          type: f.type,
          severity: f.severity,
          score: f.score,
          reason: f.reason,
          status: f.status,
          orderId: f.orderId,
          eventId: f.eventId,
          createdAt: f.createdAt.toISOString(),
        })),
        generatedAt: new Date().toISOString(),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Settlements / payouts
  // ---------------------------------------------------------------------------

  async getSettlementsMetrics(
    organizationId: string,
    from?: string,
    to?: string,
  ): Promise<SettlementsMetrics> {
    const range = this.resolveRange(from, to);
    const cacheKey = this.cache.wrapKey([
      'settle',
      organizationId,
      range.from.toISOString(),
      range.to.toISOString(),
    ]);

    return this.cached(cacheKey, 60, async () => {
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { commissionRate: true },
      });
      if (!org) throw new BadRequestException('Organización no encontrada');

      const [revenueAgg, refundAgg, payouts, byEvent] = await Promise.all([
        this.prisma.order.aggregate({
          where: {
            organizationId,
            status: 'COMPLETED',
            createdAt: { gte: range.from, lt: range.to },
          },
          _sum: { totalAmount: true, commissionAmount: true },
        }),
        this.prisma.refund.aggregate({
          where: {
            status: 'COMPLETED',
            processedAt: { gte: range.from, lt: range.to },
            order: { organizationId },
          },
          _sum: { amount: true },
        }),
        this.prisma.promoterPayout.findMany({
          where: {
            organizationId,
            periodStart: { lte: range.to },
            periodEnd: { gte: range.from },
          },
          orderBy: { periodStart: 'desc' },
          take: 50,
        }),
        this.prisma.order.groupBy({
          by: ['eventId'],
          where: {
            organizationId,
            status: 'COMPLETED',
            createdAt: { gte: range.from, lt: range.to },
          },
          _sum: { totalAmount: true },
          _count: true,
          orderBy: { _sum: { totalAmount: 'desc' } },
          take: 25,
        }),
      ]);

      const eventIds = byEvent.map((e) => e.eventId);
      const events =
        eventIds.length === 0
          ? []
          : await this.prisma.event.findMany({
              where: { id: { in: eventIds }, organizationId },
              select: { id: true, title: true },
            });
      const titleMap = new Map(events.map((e) => [e.id, e.title]));

      const gross = this.toNum(revenueAgg._sum.totalAmount);
      const refunds = this.toNum(refundAgg._sum.amount);
      const commission =
        this.toNum(revenueAgg._sum.commissionAmount) ||
        (gross - refunds) * org.commissionRate;
      const netPayable = gross - refunds - commission;

      return {
        organizationId,
        dateRange: range.dateRange,
        summary: {
          grossRevenue: this.round(gross),
          refunds: this.round(refunds),
          commission: this.round(commission),
          netPayable: this.round(netPayable),
          pendingPayouts: payouts.filter((p) => p.status === 'PENDING').length,
          completedPayouts: payouts.filter((p) => p.status === 'COMPLETED').length,
        },
        payouts: payouts.map((p) => ({
          id: p.id,
          periodStart: p.periodStart.toISOString(),
          periodEnd: p.periodEnd.toISOString(),
          grossRevenue: this.toNum(p.grossRevenue),
          commission: this.toNum(p.commission),
          netAmount: this.toNum(p.netAmount),
          status: p.status,
          referenceId: p.referenceId,
          processedAt: p.processedAt?.toISOString() ?? null,
        })),
        byEvent: byEvent.map((e) => ({
          key: e.eventId,
          label: titleMap.get(e.eventId) ?? e.eventId,
          value: this.round(this.toNum(e._sum.totalAmount)),
          secondaryValue: e._count,
        })),
        generatedAt: new Date().toISOString(),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Generic time series
  // ---------------------------------------------------------------------------

  async getTimeSeries(
    organizationId: string,
    metric: string,
    granularity: MetricsGranularity,
    from?: string,
    to?: string,
    eventId?: string,
  ): Promise<MetricsTimeSeriesResponse> {
    const range = this.resolveRange(from, to);
    const trunc = this.granularityToTrunc(granularity);
    const cacheKey = this.cache.wrapKey([
      'ts',
      organizationId,
      metric,
      trunc,
      eventId,
      range.from.toISOString(),
      range.to.toISOString(),
    ]);

    return this.cached(cacheKey, 30, async () => {
      const eventFilter = eventId
        ? Prisma.sql`AND o."eventId" = ${eventId}`
        : Prisma.empty;

      let rows: BucketRow[] = [];
      let label = 'Serie';
      let unit: MetricsTimeSeries['unit'] = 'count';

      switch (metric) {
        case 'revenue':
          label = 'Ingresos';
          unit = 'mxn';
          rows = await this.prisma.$queryRaw<BucketRow[]>(Prisma.sql`
            SELECT date_trunc(${Prisma.raw(`'${trunc}'`)}, o."createdAt") AS bucket,
                   COALESCE(SUM(o."totalAmount"), 0)::float AS value
            FROM "Order" o
            WHERE o."organizationId" = ${organizationId}
              AND o.status = 'COMPLETED'
              AND o."createdAt" >= ${range.from}
              AND o."createdAt" < ${range.to}
              ${eventFilter}
            GROUP BY 1 ORDER BY 1
          `);
          break;
        case 'orders':
          label = 'Órdenes';
          rows = await this.prisma.$queryRaw<BucketRow[]>(Prisma.sql`
            SELECT date_trunc(${Prisma.raw(`'${trunc}'`)}, o."createdAt") AS bucket,
                   COUNT(*)::float AS value
            FROM "Order" o
            WHERE o."organizationId" = ${organizationId}
              AND o.status = 'COMPLETED'
              AND o."createdAt" >= ${range.from}
              AND o."createdAt" < ${range.to}
              ${eventFilter}
            GROUP BY 1 ORDER BY 1
          `);
          break;
        case 'tickets':
          label = 'Boletos vendidos';
          rows = await this.prisma.$queryRaw<BucketRow[]>(Prisma.sql`
            SELECT date_trunc(${Prisma.raw(`'${trunc}'`)}, o."createdAt") AS bucket,
                   COALESCE(SUM(oi.quantity), 0)::float AS value
            FROM "OrderItem" oi
            INNER JOIN "Order" o ON o.id = oi."orderId"
            WHERE o."organizationId" = ${organizationId}
              AND o.status = 'COMPLETED'
              AND o."createdAt" >= ${range.from}
              AND o."createdAt" < ${range.to}
              ${eventFilter}
            GROUP BY 1 ORDER BY 1
          `);
          break;
        case 'refunds':
          label = 'Reembolsos';
          unit = 'mxn';
          rows = await this.prisma.$queryRaw<BucketRow[]>(Prisma.sql`
            SELECT date_trunc(${Prisma.raw(`'${trunc}'`)}, r."requestedAt") AS bucket,
                   COALESCE(SUM(r.amount), 0)::float AS value
            FROM "Refund" r
            INNER JOIN "Order" o ON o.id = r."orderId"
            WHERE o."organizationId" = ${organizationId}
              AND r.status = 'COMPLETED'
              AND r."requestedAt" >= ${range.from}
              AND r."requestedAt" < ${range.to}
              ${eventFilter}
            GROUP BY 1 ORDER BY 1
          `);
          break;
        case 'checkins':
          label = 'Check-ins';
          rows = await this.prisma.$queryRaw<BucketRow[]>(Prisma.sql`
            SELECT date_trunc(${Prisma.raw(`'${trunc}'`)}, ts."scannedAt") AS bucket,
                   COUNT(*)::float AS value
            FROM "TicketScan" ts
            INNER JOIN "Ticket" t ON t.id = ts."ticketId"
            INNER JOIN "Event" e ON e.id = t."eventId"
            WHERE e."organizationId" = ${organizationId}
              AND ts.success = true
              AND ts."scannedAt" >= ${range.from}
              AND ts."scannedAt" < ${range.to}
              ${eventId ? Prisma.sql`AND e.id = ${eventId}` : Prisma.empty}
            GROUP BY 1 ORDER BY 1
          `);
          break;
        default:
          throw new BadRequestException(
            `Métrica no soportada: ${metric}. Use revenue|orders|tickets|refunds|checkins`,
          );
      }

      return {
        organizationId,
        dateRange: range.dateRange,
        granularity,
        metric,
        series: [
          {
            key: metric,
            label,
            granularity,
            unit,
            points: rows.map((r) => ({
              bucket: r.bucket.toISOString(),
              value: this.round(Number(r.value)),
            })),
          },
        ],
        generatedAt: new Date().toISOString(),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Alerts & recommendations (derived from real aggregates)
  // ---------------------------------------------------------------------------

  async getAlerts(
    organizationId: string,
    from?: string,
    to?: string,
  ): Promise<MetricsAlertsResponse> {
    const range = this.resolveRange(from, to);
    const cacheKey = this.cache.wrapKey([
      'alerts',
      organizationId,
      range.from.toISOString(),
      range.to.toISOString(),
    ]);

    return this.cached(cacheKey, 60, async () => {
      const [pace, inventory, orders, campaigns, fraud] = await Promise.all([
        this.getEventSalesPace(organizationId, range.from.toISOString(), range.to.toISOString()),
        this.getInventoryMetrics(
          organizationId,
          range.from.toISOString(),
          range.to.toISOString(),
        ),
        this.getOrdersPaymentsMetrics(
          organizationId,
          range.from.toISOString(),
          range.to.toISOString(),
        ),
        this.getCampaignMetrics(
          organizationId,
          range.from.toISOString(),
          range.to.toISOString(),
        ),
        this.getFraudMetrics(
          organizationId,
          range.from.toISOString(),
          range.to.toISOString(),
        ),
      ]);

      const alerts: MetricsAlert[] = [];
      const now = new Date().toISOString();

      for (const e of pace.atRisk) {
        alerts.push({
          id: `pace-${e.eventId}`,
          domain: 'events',
          severity: e.riskLevel === 'critical' ? 'critical' : 'warning',
          title: `Ritmo de venta bajo: ${e.title}`,
          explanation: `El evento lleva ${this.round(e.actualPace * 100)}% de ocupación frente a un ritmo esperado de ${this.round(e.expectedPace * 100)}% (${e.daysUntilEvent} días para el evento).`,
          suggestedAction:
            'Activa una campaña de descuento, libera inventario de hold o refuerza canales WEB/TAQUILLA.',
          entityType: 'event',
          entityId: e.eventId,
          entityLabel: e.title,
          metricValue: e.paceDelta,
          threshold: -0.2,
          detectedAt: now,
        });
      }

      for (const z of inventory.byZone) {
        if (
          z.availabilityPercent > 70 &&
          z.daysToSellOut != null &&
          z.daysToSellOut > 45 &&
          z.totalQuantity >= 50
        ) {
          alerts.push({
            id: `inv-${z.offerId}`,
            domain: 'inventory',
            severity: 'warning',
            title: `Exceso de inventario: ${z.eventTitle} / ${z.zone}`,
            explanation: `Queda ${z.availabilityPercent}% disponible en ${z.tierName}; a la velocidad actual tardaría ~${z.daysToSellOut} días en agotarse.`,
            suggestedAction:
              'Considera bajar precio dinámico, mover cupo a otro canal o crear oferta flash.',
            entityType: 'offer',
            entityId: z.offerId,
            entityLabel: `${z.eventTitle} — ${z.zone}`,
            metricValue: z.availabilityPercent,
            threshold: 70,
            detectedAt: now,
          });
        }
      }

      if (
        orders.kpis.refundRate.value > 8 &&
        orders.kpis.refundRate.delta != null &&
        orders.kpis.refundRate.delta > 2
      ) {
        alerts.push({
          id: 'refunds-spike',
          domain: 'orders',
          severity: orders.kpis.refundRate.value > 15 ? 'critical' : 'warning',
          title: 'Pico anómalo de reembolsos',
          explanation: `La tasa de reembolso es ${orders.kpis.refundRate.value}% (periodo previo ${orders.kpis.refundRate.previousValue}%).`,
          suggestedAction:
            'Revisa motivos de reembolso, eventos cancelados y posibles abusos de fraude.',
          metricValue: orders.kpis.refundRate.value,
          threshold: 8,
          detectedAt: now,
        });
      }

      for (const c of campaigns.promotions.filter((p) => p.performance === 'poor')) {
        alerts.push({
          id: `camp-${c.promotionId}`,
          domain: 'campaigns',
          severity: 'info',
          title: `Campaña con bajo rendimiento: ${c.name}`,
          explanation: `El código ${c.code} convirtió solo ${c.conversionRate}% del cupo (${c.ordersAttributed} órdenes).`,
          suggestedAction:
            'Ajusta el valor del descuento, amplía canales de distribución o pausa la campaña.',
          entityType: 'promotion',
          entityId: c.promotionId,
          entityLabel: c.name,
          metricValue: c.conversionRate,
          threshold: 10,
          detectedAt: now,
        });
      }

      if (fraud.summary.criticalFlags > 0) {
        alerts.push({
          id: 'fraud-critical',
          domain: 'fraud',
          severity: 'critical',
          title: 'Señales de fraude críticas abiertas',
          explanation: `Hay ${fraud.summary.criticalFlags} banderas CRITICAL y ${fraud.summary.openFlags} señales abiertas en el periodo.`,
          suggestedAction:
            'Prioriza revisión manual de órdenes flaggeadas y considera bloquear IPs/dispositivos repetidos.',
          metricValue: fraud.summary.criticalFlags,
          detectedAt: now,
        });
      }

      if (inventory.summary.activeHolds > 100) {
        alerts.push({
          id: 'holds-high',
          domain: 'inventory',
          severity: 'info',
          title: 'Alto volumen de holds activos',
          explanation: `Hay ${inventory.summary.activeHolds} holds activos que pueden estar bloqueando inventario vendible.`,
          suggestedAction:
            'Revisa TTL de holds y libera asientos expirados o abandonados en taquilla.',
          metricValue: inventory.summary.activeHolds,
          threshold: 100,
          detectedAt: now,
        });
      }

      const countsBySeverity = {
        info: alerts.filter((a) => a.severity === 'info').length,
        warning: alerts.filter((a) => a.severity === 'warning').length,
        critical: alerts.filter((a) => a.severity === 'critical').length,
      };

      this.logger.debug(
        `Alerts generated for org ${organizationId}: ${alerts.length}`,
      );

      return {
        organizationId,
        dateRange: range.dateRange,
        alerts: alerts.sort((a, b) => {
          const rank = { critical: 0, warning: 1, info: 2 };
          return rank[a.severity] - rank[b.severity];
        }),
        countsBySeverity,
        generatedAt: now,
      };
    });
  }
}
