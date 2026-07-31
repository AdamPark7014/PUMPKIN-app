import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SalesChannel } from '@prisma/client';
import { Observable, from, map, mergeMap, timer } from 'rxjs';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  commissionCentavos,
  fromCentavos,
  roundMxn,
  toCentavos,
} from './reporting.money';

type SettlementPeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY';

type DayBucketRow = {
  day: Date;
  revenue: Prisma.Decimal | number | null;
  orders: number | bigint;
};

@Injectable()
export class ReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Resolve tenant org for a route `:organizationId`. SUPER_ADMIN may use the
   * route org; tenant users must match `requireOrganization()`.
   */
  resolveOrganizationId(routeOrgId: string): string {
    const ctx = this.tenant.current();
    if (ctx.privileged) {
      if (!routeOrgId) {
        throw new BadRequestException('organizationId is required');
      }
      return routeOrgId;
    }
    const organizationId = this.tenant.requireOrganization();
    this.tenant.assertOrganization(routeOrgId);
    return organizationId;
  }

  /** Load event via compound `{ id, organizationId }` after tenant assert. */
  private async requireEventInOrg(
    organizationId: string,
    eventId: string,
    select: { title?: boolean; startsAt?: boolean } = {},
  ) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId },
      select: {
        id: true,
        organizationId: true,
        title: select.title ?? false,
        startsAt: select.startsAt ?? false,
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    this.tenant.assertOrganization(event.organizationId);
    return event;
  }

  /** Resolve org from event for event-only routes (heatmap / predict). */
  private async resolveOrgFromEvent(eventId: string): Promise<{
    organizationId: string;
    eventId: string;
    title: string;
    startsAt: Date;
  }> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        organizationId: true,
        title: true,
        startsAt: true,
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    this.tenant.assertOrganization(event.organizationId);
    return {
      organizationId: event.organizationId,
      eventId: event.id,
      title: event.title,
      startsAt: event.startsAt,
    };
  }

  // ==================== REAL-TIME DASHBOARD ====================

  async getRealtimeDashboard(routeOrgId: string, eventId?: string) {
    const organizationId = this.resolveOrganizationId(routeOrgId);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);

    if (eventId) {
      await this.requireEventInOrg(organizationId, eventId, { title: true });
    }

    const orderScope = {
      organizationId,
      ...(eventId ? { eventId } : {}),
      status: 'COMPLETED' as const,
    };

    const [
      event,
      todayAgg,
      weekAgg,
      previousWeekAgg,
      channelSales,
      ticketCounts,
    ] = await Promise.all([
      eventId
        ? this.prisma.event.findFirst({
            where: { id: eventId, organizationId },
            select: { id: true, title: true },
          })
        : Promise.resolve(null),
      this.prisma.order.aggregate({
        where: { ...orderScope, createdAt: { gte: today } },
        _sum: { totalAmount: true },
        _count: { _all: true },
        _avg: { totalAmount: true },
      }),
      this.prisma.order.aggregate({
        where: { ...orderScope, createdAt: { gte: weekAgo } },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      this.prisma.order.aggregate({
        where: {
          ...orderScope,
          createdAt: { gte: twoWeeksAgo, lt: weekAgo },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.order.groupBy({
        by: ['channel'],
        where: { ...orderScope, createdAt: { gte: weekAgo } },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      eventId
        ? this.prisma.ticket.groupBy({
            by: ['status'],
            where: {
              eventId,
              event: { organizationId },
            },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ]);

    const todayRevenue = roundMxn(todayAgg._sum.totalAmount ?? 0);
    const todayOrders = todayAgg._count._all;
    const weekRevenue = roundMxn(weekAgg._sum.totalAmount ?? 0);
    const weekOrders = weekAgg._count._all;
    const avgOrderValue = roundMxn(todayAgg._avg.totalAmount ?? 0);
    const previousWeekRevenue = roundMxn(
      previousWeekAgg._sum.totalAmount ?? 0,
    );

    let totalTickets = 0;
    let soldTickets = 0;
    for (const row of ticketCounts) {
      totalTickets += row._count._all;
      if (row.status === 'SOLD' || row.status === 'HELD') {
        soldTickets += row._count._all;
      }
    }
    const occupancy =
      totalTickets > 0 ? roundMxn((soldTickets / totalTickets) * 100) : 0;

    const growthPct =
      previousWeekRevenue > 0
        ? (
            ((weekRevenue - previousWeekRevenue) / previousWeekRevenue) *
            100
          ).toFixed(1)
        : weekRevenue > 0
          ? '100.0'
          : '0.0';

    const channelData = channelSales.map((cs) => ({
      channel: cs.channel,
      orders: cs._count._all,
      revenue: roundMxn(cs._sum.totalAmount ?? 0),
    }));

    return {
      generatedAt: now,
      event: event ? { id: event.id, title: event.title } : null,
      metrics: {
        todayRevenue,
        todayOrders,
        weekRevenue,
        weekOrders,
        avgOrderValue,
        occupancy: Number(occupancy.toFixed(1)),
        soldTickets,
        totalTickets,
      },
      channels: channelData,
      trend: {
        previousWeekRevenue,
        growth: `${growthPct}%`,
      },
    };
  }

  // ==================== SETTLEMENT REPORTS ====================

  async generateSettlementReport(
    routeOrgId: string,
    period: SettlementPeriod,
  ) {
    const organizationId = this.resolveOrganizationId(routeOrgId);
    if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(period)) {
      throw new BadRequestException('Invalid settlement period');
    }

    const now = new Date();
    const dateFilter = this.settlementRange(now, period);

    const [orderAgg, organization, paymentGroups] = await Promise.all([
      this.prisma.order.aggregate({
        where: {
          organizationId,
          status: 'COMPLETED',
          createdAt: dateFilter,
        },
        _sum: { totalAmount: true },
        _count: { _all: true },
        _avg: { totalAmount: true },
      }),
      this.prisma.organization.findFirst({
        where: { id: organizationId },
        select: { id: true, commissionRate: true },
      }),
      this.prisma.$queryRaw<
        Array<{ gateway: string; count: bigint; amount: Prisma.Decimal }>
      >(Prisma.sql`
        SELECT p."gateway"::text AS gateway,
               COUNT(*)::bigint AS count,
               COALESCE(SUM(p."amount"), 0) AS amount
        FROM "Order" o
        INNER JOIN "Payment" p ON p."id" = o."paymentId"
        WHERE o."organizationId" = ${organizationId}
          AND o."status" = 'COMPLETED'
          AND o."createdAt" >= ${dateFilter.gte}
          AND o."createdAt" < ${dateFilter.lt}
          AND o."paymentId" IS NOT NULL
        GROUP BY p."gateway"
      `),
    ]);

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    this.tenant.assertOrganization(organization.id);

    const grossCentavos = toCentavos(orderAgg._sum.totalAmount ?? 0);
    const commissionRate = organization.commissionRate ?? 0.15;
    const commissionAmountCentavos = commissionCentavos(
      grossCentavos,
      commissionRate,
    );
    const netCentavos = grossCentavos - commissionAmountCentavos;
    const totalOrders = orderAgg._count._all;

    const paymentMethods: Record<string, { count: number; amount: number }> =
      {};
    for (const row of paymentGroups) {
      paymentMethods[row.gateway || 'unknown'] = {
        count: Number(row.count),
        amount: roundMxn(row.amount ?? 0),
      };
    }

    await this.audit.log({
      action: 'REPORTING_SETTLEMENT_GENERATED',
      entityType: 'Organization',
      entityId: organizationId,
      organizationId,
      userId: this.tenant.current().userId,
      metadata: {
        period,
        grossCentavos,
        commissionCentavos: commissionAmountCentavos,
        totalOrders,
      },
    });

    return {
      organizationId,
      period,
      dateRange: dateFilter,
      summary: {
        grossRevenue: fromCentavos(grossCentavos),
        commission: fromCentavos(commissionAmountCentavos),
        netRevenue: fromCentavos(netCentavos),
        totalOrders,
        avgOrderValue: roundMxn(orderAgg._avg.totalAmount ?? 0),
      },
      paymentMethods,
      generatedAt: now,
    };
  }

  private settlementRange(
    now: Date,
    period: SettlementPeriod,
  ): { gte: Date; lt: Date } {
    if (period === 'DAILY') {
      return {
        gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
        lt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
      };
    }
    if (period === 'WEEKLY') {
      const dayOfWeek = now.getDay();
      const startOfWeek = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - dayOfWeek,
      );
      return {
        gte: startOfWeek,
        lt: new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000),
      };
    }
    return {
      gte: new Date(now.getFullYear(), now.getMonth(), 1),
      lt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    };
  }

  // ==================== HEATMAP ANALYTICS ====================

  async getOccupancyHeatmap(eventId: string) {
    const { organizationId, eventId: id, title } =
      await this.resolveOrgFromEvent(eventId);

    const rows = await this.prisma.ticket.groupBy({
      by: ['section', 'status'],
      where: {
        eventId: id,
        event: { organizationId },
      },
      _count: { _all: true },
    });

    const heatmap: Record<
      string,
      { sold: number; total: number; percentage: number }
    > = {};

    for (const row of rows) {
      const section = row.section || 'general';
      if (!heatmap[section]) {
        heatmap[section] = { sold: 0, total: 0, percentage: 0 };
      }
      heatmap[section].total += row._count._all;
      if (row.status === 'SOLD') {
        heatmap[section].sold += row._count._all;
      }
    }

    for (const section of Object.keys(heatmap)) {
      const cell = heatmap[section];
      cell.percentage =
        cell.total > 0
          ? Number(((cell.sold / cell.total) * 100).toFixed(2))
          : 0;
    }

    return {
      eventId: id,
      eventTitle: title,
      heatmap,
      generatedAt: new Date(),
    };
  }

  // ==================== PREDICTIVE ANALYTICS ====================

  async predictOccupancy(eventId: string): Promise<{
    predictedOccupancy: number;
    confidence: number;
    recommendation: string;
  }> {
    const { organizationId, eventId: id, startsAt } =
      await this.resolveOrgFromEvent(eventId);

    const [ticketAgg, soldAgg] = await Promise.all([
      this.prisma.ticket.count({
        where: { eventId: id, event: { organizationId } },
      }),
      this.prisma.ticket.count({
        where: {
          eventId: id,
          event: { organizationId },
          status: { in: ['SOLD', 'HELD'] },
        },
      }),
    ]);

    if (ticketAgg === 0) {
      return {
        predictedOccupancy: 0,
        confidence: 0,
        recommendation: 'Event has no ticket inventory',
      };
    }

    const currentOccupancy = (soldAgg / ticketAgg) * 100;
    const daysUntil = Math.ceil(
      (startsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );

    let predictedOccupancy = currentOccupancy;
    let confidence = 0;

    if (daysUntil > 60) {
      predictedOccupancy = currentOccupancy + daysUntil * 0.5;
      confidence = 0.4;
    } else if (daysUntil > 14) {
      predictedOccupancy = currentOccupancy + daysUntil * 1.5;
      confidence = 0.65;
    } else if (daysUntil > 0) {
      predictedOccupancy = currentOccupancy + daysUntil * 3;
      confidence = 0.85;
    } else {
      predictedOccupancy = currentOccupancy;
      confidence = 0.95;
    }

    predictedOccupancy = Math.min(predictedOccupancy, 100);

    let recommendation: string;
    if (predictedOccupancy > 85) {
      recommendation =
        'Event trending towards SOLD OUT. Consider price increase or demand-based pricing.';
    } else if (predictedOccupancy > 60) {
      recommendation =
        'Event on track for strong sales. Monitor and optimize marketing.';
    } else if (predictedOccupancy > 30) {
      recommendation =
        'Moderate sales. Consider promotional campaigns or price reductions.';
    } else {
      recommendation =
        'Low occupancy predicted. Urgent action required - evaluate pricing, marketing, or event details.';
    }

    return {
      predictedOccupancy: Number(predictedOccupancy.toFixed(1)),
      confidence: Number(confidence.toFixed(2)),
      recommendation,
    };
  }

  // ==================== CHANNEL PERFORMANCE ====================

  async getChannelPerformance(routeOrgId: string, eventId?: string) {
    const organizationId = this.resolveOrganizationId(routeOrgId);
    if (eventId) {
      await this.requireEventInOrg(organizationId, eventId);
    }

    const groups = await this.prisma.order.groupBy({
      by: ['channel'],
      where: {
        organizationId,
        ...(eventId ? { eventId } : {}),
        status: 'COMPLETED',
      },
      _sum: { totalAmount: true },
      _count: { _all: true },
      _avg: { totalAmount: true },
    });

    const byChannel = new Map(
      groups.map((g) => [
        g.channel,
        {
          orders: g._count._all,
          revenue: roundMxn(g._sum.totalAmount ?? 0),
          avgOrderValue: roundMxn(g._avg.totalAmount ?? 0),
        },
      ]),
    );

    const channels: SalesChannel[] = [
      SalesChannel.WEB,
      SalesChannel.TAQUILLA,
      SalesChannel.API,
      SalesChannel.ADMIN,
    ];

    const performance = channels.map((channel) => {
      const row = byChannel.get(channel);
      return {
        channel,
        orders: row?.orders ?? 0,
        revenue: row?.revenue ?? 0,
        avgOrderValue: row?.avgOrderValue ?? 0,
        percentage: 0,
      };
    });

    const totalRevenueCentavos = performance.reduce(
      (sum, p) => sum + toCentavos(p.revenue),
      0,
    );

    for (const p of performance) {
      p.percentage =
        totalRevenueCentavos > 0
          ? Number(
              (
                (toCentavos(p.revenue) / totalRevenueCentavos) *
                100
              ).toFixed(2),
            )
          : 0;
    }

    return {
      channels: performance,
      totalRevenue: fromCentavos(totalRevenueCentavos),
      generatedAt: new Date(),
    };
  }

  // ==================== CUSTOMER ANALYTICS ====================

  async getCustomerAnalytics(routeOrgId: string) {
    const organizationId = this.resolveOrganizationId(routeOrgId);

    const customerOrders = await this.prisma.order.groupBy({
      by: ['userId'],
      where: { organizationId, status: 'COMPLETED' },
      _count: { _all: true },
      _sum: { totalAmount: true },
    });

    let repeatCustomers = 0;
    let newCustomers = 0;
    let totalSpentCentavos = 0;

    for (const co of customerOrders) {
      if (co._count._all >= 2) repeatCustomers += 1;
      else newCustomers += 1;
      totalSpentCentavos += toCentavos(co._sum.totalAmount ?? 0);
    }

    const uniqueCustomers = customerOrders.length;
    const avgCustomerValue =
      uniqueCustomers > 0
        ? fromCentavos(Math.round(totalSpentCentavos / uniqueCustomers))
        : 0;

    return {
      uniqueCustomers,
      repeatCustomers,
      newCustomers,
      repeatRate:
        uniqueCustomers > 0
          ? Number(((repeatCustomers / uniqueCustomers) * 100).toFixed(2))
          : 0,
      totalSpent: fromCentavos(totalSpentCentavos),
      avgCustomerValue,
    };
  }

  // ==================== REVENUE FORECAST ====================

  async generateRevenueForecast(routeOrgId: string, days = 30) {
    const organizationId = this.resolveOrganizationId(routeOrgId);
    const forecastDays = Math.min(Math.max(Math.trunc(days) || 30, 1), 90);
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + forecastDays * 24 * 60 * 60 * 1000);

    const buckets = await this.prisma.$queryRaw<DayBucketRow[]>(Prisma.sql`
      SELECT DATE_TRUNC('day', o."createdAt") AS day,
             COALESCE(SUM(o."totalAmount"), 0) AS revenue,
             COUNT(*)::int AS orders
      FROM "Order" o
      WHERE o."organizationId" = ${organizationId}
        AND o."status" = 'COMPLETED'
        AND o."createdAt" >= ${start}
        AND o."createdAt" < ${end}
      GROUP BY 1
      ORDER BY 1
    `);

    const byDay = new Map<string, number>();
    for (const row of buckets) {
      const key = new Date(row.day).toISOString().slice(0, 10);
      byDay.set(key, roundMxn(row.revenue ?? 0));
    }

    const forecast: Array<{
      date: string;
      actual: number;
      predicted: number;
    }> = [];

    for (let i = 0; i < forecastDays; i++) {
      const date = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
      const key = date.toISOString().slice(0, 10);
      const actual = byDay.get(key) ?? 0;
      const predicted = roundMxn(actual * 1.05);
      forecast.push({ date: key, actual, predicted });
    }

    return {
      organizationId,
      forecastDays,
      forecast,
      generatedAt: now,
    };
  }

  // ==================== STREAM / EXPORT ====================

  streamRealtimeDashboard(
    routeOrgId: string,
    eventId?: string,
  ): Observable<MessageEvent> {
    return timer(0, 10_000).pipe(
      mergeMap(() => from(this.getRealtimeDashboard(routeOrgId, eventId))),
      map((data) => ({ data: JSON.stringify(data) }) as MessageEvent),
    );
  }

  async exportSalesCsv(
    routeOrgId: string,
    from?: Date,
    to?: Date,
    page = 1,
    pageSize = 5000,
  ) {
    const organizationId = this.resolveOrganizationId(routeOrgId);

    if (from && Number.isNaN(from.getTime())) {
      throw new BadRequestException('Invalid "from" date');
    }
    if (to && Number.isNaN(to.getTime())) {
      throw new BadRequestException('Invalid "to" date');
    }
    if (from && to && from > to) {
      throw new BadRequestException('"from" must be before "to"');
    }

    const take = Math.min(Math.max(pageSize, 1), 5000);
    const skip = (Math.max(page, 1) - 1) * take;

    const orders = await this.prisma.order.findMany({
      where: {
        organizationId,
        status: 'COMPLETED',
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      select: {
        publicId: true,
        channel: true,
        totalAmount: true,
        currency: true,
        createdAt: true,
        buyerEmail: true,
        event: { select: { title: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });

    const header =
      'publicId,event,channel,total,currency,createdAt,buyerEmail';
    const rows = orders.map((o) => {
      const title = o.event.title.replace(/"/g, '""');
      return `${o.publicId},"${title}",${o.channel},${roundMxn(o.totalAmount).toFixed(2)},${o.currency},${o.createdAt.toISOString()},${o.buyerEmail}`;
    });

    await this.audit.log({
      action: 'REPORTING_SALES_CSV_EXPORT',
      entityType: 'Organization',
      entityId: organizationId,
      organizationId,
      userId: this.tenant.current().userId,
      metadata: {
        rowCount: orders.length,
        page,
        pageSize: take,
        from: from?.toISOString(),
        to: to?.toISOString(),
      },
    });

    return {
      filename: `ventas-${organizationId}-${Date.now()}.csv`,
      csv: [header, ...rows].join('\n'),
    };
  }
}
