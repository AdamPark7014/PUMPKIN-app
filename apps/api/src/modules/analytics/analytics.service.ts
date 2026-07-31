import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type {
  EventDashboardMetrics,
  MetricsDateRange,
  PromoterDashboardMetrics,
} from '@boletera/shared';
import { PrismaService } from '../prisma/prisma.service';

type SettlementEventBreakdown = {
  eventId: string;
  eventTitle: string;
  orders: number;
  ticketsSold: number;
  revenue: number;
};

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  assertOrgAccess(
    userOrgId: string | null | undefined,
    requestedOrgId: string,
    role?: string,
  ): void {
    if (role === 'SUPER_ADMIN' || role === 'ADMIN') return;
    if (!userOrgId || userOrgId !== requestedOrgId) {
      throw new ForbiddenException('Organization access denied');
    }
  }

  // ==================== EVENT DASHBOARD ====================
  // Complexity: O(1) parallel counts + 1 aggregate — no N+1

  async getEventDashboard(
    eventId: string,
    organizationId: string,
  ): Promise<EventDashboardMetrics> {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId },
      include: {
        organization: { select: { commissionRate: true, currency: true } },
        offers: {
          select: {
            id: true,
            name: true,
            basePrice: true,
            totalQuantity: true,
            remainingQuantity: true,
          },
        },
        venue: { select: { name: true } },
      },
    });

    if (!event) throw new NotFoundException('Evento no encontrado');

    const [
      completedOrders,
      failedOrders,
      totalTickets,
      soldTickets,
      refundedTickets,
      fraudFlags,
      revenueAgg,
    ] = await Promise.all([
      this.prisma.order.count({
        where: { eventId, organizationId, status: 'COMPLETED' },
      }),
      this.prisma.order.count({
        where: { eventId, organizationId, status: 'FAILED' },
      }),
      this.prisma.ticket.count({ where: { eventId } }),
      this.prisma.ticket.count({
        where: { eventId, status: { in: ['SOLD', 'USED', 'TRANSFERRED'] } },
      }),
      this.prisma.ticket.count({ where: { eventId, status: 'REFUNDED' } }),
      this.prisma.fraudFlag.count({
        where: { eventId, status: 'FLAGGED' },
      }),
      this.prisma.order.aggregate({
        where: { eventId, organizationId, status: 'COMPLETED' },
        _sum: { totalAmount: true },
      }),
    ]);

    const totalRevenue = Number(revenueAgg._sum.totalAmount ?? 0);
    const commission = totalRevenue * event.organization.commissionRate;
    const soldPercent = totalTickets > 0 ? (soldTickets / totalTickets) * 100 : 0;

    return {
      eventId: event.id,
      organizationId,
      title: event.title,
      status: event.status,
      startsAt: event.startsAt.toISOString(),
      venue: { name: event.venue?.name ?? 'N/A' },
      metrics: {
        completedOrders,
        failedOrders,
        totalTickets,
        soldTickets,
        soldPercent: Number(soldPercent.toFixed(2)),
        refundedTickets,
        fraudFlags,
      },
      revenue: {
        gross: totalRevenue,
        commission,
        net: totalRevenue - commission,
        currency: event.currency,
      },
      offers: event.offers.map((o) => ({
        id: o.id,
        name: o.name,
        basePrice: Number(o.basePrice),
        totalQuantity: o.totalQuantity,
        remainingQuantity: o.remainingQuantity,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  // ==================== PROMOTER DASHBOARD ====================
  // Complexity: O(1) aggregates + 1 raw top-events query

  async getPromoterDashboard(
    organizationId: string,
    period?: 'DAY' | 'WEEK' | 'MONTH',
  ): Promise<PromoterDashboardMetrics> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, commissionRate: true, currency: true },
    });
    if (!org) throw new NotFoundException('Organización no encontrada');

    const now = new Date();
    const startDate = this.getPeriodStartDate(now, period);

    const [orderAgg, ticketRows, topEvents] = await Promise.all([
      this.prisma.order.aggregate({
        where: {
          organizationId,
          createdAt: { gte: startDate },
          status: 'COMPLETED',
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
      this.prisma.$queryRaw<Array<{ qty: bigint | number }>>`
        SELECT COALESCE(SUM(oi.quantity), 0) AS qty
        FROM "OrderItem" oi
        INNER JOIN "Order" o ON o.id = oi."orderId"
        WHERE o."organizationId" = ${organizationId}
          AND o.status = 'COMPLETED'
          AND o."createdAt" >= ${startDate}
      `,
      this.getTopEvents(organizationId, startDate),
    ]);

    const totalRevenue = Number(orderAgg._sum.totalAmount ?? 0);
    const commission = totalRevenue * org.commissionRate;
    const dateRange: MetricsDateRange = {
      from: startDate.toISOString(),
      to: now.toISOString(),
    };

    return {
      organizationId: org.id,
      name: org.name,
      period: period || 'MONTH',
      dateRange,
      metrics: {
        totalOrders: orderAgg._count,
        totalTicketsSold: Number(ticketRows[0]?.qty ?? 0),
        totalRevenue,
        commission,
        netRevenue: totalRevenue - commission,
        currency: org.currency,
      },
      topEvents,
      generatedAt: new Date().toISOString(),
    };
  }

  // ==================== SETTLEMENT REPORT ====================
  // Complexity: O(1) aggregates + 1 groupBy event + 1 event title lookup

  async generateSettlementReport(organizationId: string, month: number, year: number) {
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('month debe ser 1-12');
    }
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('year inválido');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        commissionRate: true,
        currency: true,
        paypalEmail: true,
        bankAccountNumber: true,
      },
    });
    if (!org) throw new NotFoundException('Organización no encontrada');

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const [orderAgg, ticketByEvent, refundAgg, disputedRefunds] = await Promise.all([
      this.prisma.order.aggregate({
        where: {
          organizationId,
          status: 'COMPLETED',
          completedAt: { gte: startDate, lte: endDate },
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
      this.prisma.order.groupBy({
        by: ['eventId'],
        where: {
          organizationId,
          status: 'COMPLETED',
          completedAt: { gte: startDate, lte: endDate },
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
      this.prisma.refund.aggregate({
        where: {
          status: 'COMPLETED',
          processedAt: { gte: startDate, lte: endDate },
          order: { organizationId },
        },
        _sum: { amount: true },
      }),
      this.prisma.refund.count({
        where: {
          status: 'DISPUTED',
          requestedAt: { gte: startDate, lte: endDate },
          order: { organizationId },
        },
      }),
    ]);

    const eventIds = ticketByEvent.map((e) => e.eventId);
    const events =
      eventIds.length === 0
        ? []
        : await this.prisma.event.findMany({
            where: { id: { in: eventIds }, organizationId },
            select: { id: true, title: true },
          });
    const titleMap = new Map(events.map((e) => [e.id, e.title]));

    const ticketQty =
      eventIds.length === 0
        ? []
        : await this.prisma.$queryRaw<
            Array<{ eventId: string; qty: bigint | number }>
          >`
            SELECT o."eventId", COALESCE(SUM(oi.quantity), 0) AS qty
            FROM "OrderItem" oi
            INNER JOIN "Order" o ON o.id = oi."orderId"
            WHERE o."organizationId" = ${organizationId}
              AND o.status = 'COMPLETED'
              AND o."completedAt" >= ${startDate}
              AND o."completedAt" <= ${endDate}
            GROUP BY o."eventId"
          `;
    const qtyMap = new Map(ticketQty.map((t) => [t.eventId, Number(t.qty)]));

    const eventBreakdown: SettlementEventBreakdown[] = ticketByEvent.map((row) => ({
      eventId: row.eventId,
      eventTitle: titleMap.get(row.eventId) ?? row.eventId,
      orders: row._count,
      ticketsSold: qtyMap.get(row.eventId) ?? 0,
      revenue: Number(row._sum.totalAmount ?? 0),
    }));

    const grossRevenue = Number(orderAgg._sum.totalAmount ?? 0);
    const refundAmount = Number(refundAgg._sum.amount ?? 0);
    const commissionAmount = (grossRevenue - refundAmount) * org.commissionRate;
    const netAmount = grossRevenue - refundAmount - commissionAmount;

    const payout = await this.prisma.promoterPayout.create({
      data: {
        organizationId,
        periodStart: startDate,
        periodEnd: endDate,
        grossRevenue: new Decimal(grossRevenue),
        commission: new Decimal(commissionAmount),
        netAmount: new Decimal(netAmount),
        status: 'PENDING',
      },
    });

    this.logger.log(`Settlement report generated for ${org.name}: ${netAmount.toFixed(2)}`);

    return {
      payoutId: payout.id,
      organizationId: org.id,
      organizationName: org.name,
      period: `${month}/${year}`,
      summary: {
        grossRevenue,
        refunds: refundAmount,
        chargebacks: disputedRefunds,
        commission: commissionAmount,
        netAmount,
        currency: org.currency,
      },
      eventBreakdown,
      paymentDetails: {
        method: org.paypalEmail ? 'PayPal' : 'Bank Transfer',
        bankAccount: org.bankAccountNumber
          ? `****${org.bankAccountNumber.slice(-4)}`
          : undefined,
      },
    };
  }

  // ==================== CUSTOMER ANALYTICS ====================
  // Complexity: O(C) customers via groupBy + limited top list — no full order hydrate

  async getCustomerAnalytics(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!org) throw new NotFoundException('Organización no encontrada');

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [customerGroups, newCustomers, spendRows] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['userId'],
        where: { organizationId, status: 'COMPLETED' },
        _count: true,
        _sum: { totalAmount: true },
      }),
      this.prisma.user.count({
        where: {
          createdAt: { gte: thirtyDaysAgo },
          orders: { some: { organizationId, status: 'COMPLETED' } },
        },
      }),
      this.prisma.$queryRaw<
        Array<{
          userId: string;
          email: string;
          orderCount: bigint | number;
          totalSpend: Prisma.Decimal | number;
        }>
      >`
        SELECT u.id AS "userId", u.email,
               COUNT(o.id)::bigint AS "orderCount",
               COALESCE(SUM(o."totalAmount"), 0) AS "totalSpend"
        FROM "User" u
        INNER JOIN "Order" o ON o."userId" = u.id
        WHERE o."organizationId" = ${organizationId}
          AND o.status = 'COMPLETED'
        GROUP BY u.id, u.email
        ORDER BY "totalSpend" DESC
        LIMIT 10
      `,
    ]);

    const totalCustomers = customerGroups.length;
    const repeatCustomers = customerGroups.filter((c) => c._count > 1).length;
    const totalLtv = customerGroups.reduce(
      (s, c) => s + Number(c._sum.totalAmount ?? 0),
      0,
    );
    const avgCustomerLTV = totalCustomers > 0 ? totalLtv / totalCustomers : 0;

    return {
      totalCustomers,
      newCustomers30Days: newCustomers,
      repeatCustomers,
      avgCustomerLTV,
      topCustomers: spendRows.map((r) => ({
        id: r.userId,
        email: r.email,
        orderCount: Number(r.orderCount),
        totalSpend: Number(r.totalSpend),
      })),
    };
  }

  // ==================== FRAUD ANALYTICS ====================
  // Complexity: O(1) counts + groupBy scoped via relation filters

  async getFraudAnalytics(organizationId: string) {
    const orgScope = {
      OR: [{ order: { organizationId } }, { event: { organizationId } }],
    };

    const [totalFlags, criticalFlags, blockedOrders, flagsByType, falsePositives] =
      await Promise.all([
        this.prisma.fraudFlag.count({ where: orgScope }),
        this.prisma.fraudFlag.count({
          where: { ...orgScope, severity: 'CRITICAL' },
        }),
        this.prisma.order.count({
          where: { organizationId, status: 'FAILED' },
        }),
        this.prisma.fraudFlag.groupBy({
          by: ['type'],
          where: orgScope,
          _count: true,
        }),
        this.prisma.fraudFlag.count({
          where: { ...orgScope, status: 'FALSE_POSITIVE' },
        }),
      ]);

    const falsePositiveRate =
      totalFlags > 0 ? Number(((falsePositives / totalFlags) * 100).toFixed(1)) : 0;

    return {
      organizationId,
      summary: {
        totalFlags,
        criticalFlags,
        blockedOrders,
        falsePositiveRate,
      },
      flagsByType: flagsByType.map((item) => ({
        type: item.type,
        count: item._count,
      })),
    };
  }

  // ==================== HELPERS ====================

  private async getTopEvents(organizationId: string, startDate: Date) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        eventId: string;
        eventTitle: string;
        orders: bigint | number;
        revenue: Prisma.Decimal | number;
      }>
    >`
      SELECT e.id AS "eventId", e.title AS "eventTitle",
             COUNT(o.id)::bigint AS orders,
             COALESCE(SUM(o."totalAmount"), 0) AS revenue
      FROM "Order" o
      INNER JOIN "Event" e ON e.id = o."eventId"
      WHERE o."organizationId" = ${organizationId}
        AND o.status = 'COMPLETED'
        AND o."createdAt" >= ${startDate}
      GROUP BY e.id, e.title
      ORDER BY revenue DESC
      LIMIT 5
    `;

    return rows.map((r) => ({
      eventId: r.eventId,
      eventTitle: r.eventTitle,
      orders: Number(r.orders),
      revenue: Number(r.revenue),
    }));
  }

  private getPeriodStartDate(now: Date, period?: string): Date {
    const start = new Date(now);
    switch (period) {
      case 'DAY':
        start.setHours(0, 0, 0, 0);
        return start;
      case 'WEEK':
        start.setDate(start.getDate() - start.getDay());
        start.setHours(0, 0, 0, 0);
        return start;
      case 'MONTH':
      default:
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        return start;
    }
  }
}
