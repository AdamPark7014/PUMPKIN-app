import { OrderStatus } from '@prisma/client';
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import { NotificationService } from '../notification/notification.service';
import { PaymentService } from '../payment/payment.service';

@Injectable()
export class AdminService {
  private logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private payments: PaymentService,
    private notifications: NotificationService,
  ) {}

  // ==================== ADMIN DASHBOARD ====================

  async dashboard(orgId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [ordersToday, activeEvents, activeHolds, dailyRevenue, fraudFlags, totalUsers] =
      await Promise.all([
        this.prisma.order.count({
          where: { organizationId: orgId, createdAt: { gte: today }, status: 'COMPLETED' },
        }),
        this.prisma.event.count({ where: { organizationId: orgId, status: 'SCHEDULED' } }),
        this.prisma.ticket.count({
          where: { event: { organizationId: orgId }, status: 'HELD' },
        }),
        this.prisma.order.aggregate({
          where: { organizationId: orgId, status: 'COMPLETED', createdAt: { gte: today } },
          _sum: { totalAmount: true },
        }),
        this.prisma.fraudFlag.count({
          where: { order: { organizationId: orgId }, status: 'FLAGGED' },
        }),
        this.prisma.user.count(),
      ]);

    const channelBreakdown = await this.prisma.order.groupBy({
      by: ['channel'],
      where: { organizationId: orgId, status: 'COMPLETED', createdAt: { gte: today } },
      _sum: { totalAmount: true },
      _count: true,
    });

    let taquillaTerminals = 0;
    try {
      taquillaTerminals = await this.prisma.posTerminal.count({
        where: { organizationId: orgId },
      });
    } catch {
      taquillaTerminals = 0;
    }

    return {
      ordersToday,
      activeEvents,
      activeHolds,
      revenueToday: Number(dailyRevenue._sum.totalAmount ?? 0),
      fraudFlags,
      totalUsers,
      taquillaTerminals,
      channelBreakdown: channelBreakdown.map((c) => ({
        channel: c.channel,
        orders: c._count,
        revenue: Number(c._sum.totalAmount ?? 0),
      })),
      timestamp: new Date(),
    };
  }

  async platformOverview(orgId: string) {
    const [dashboard, events, venues, salesByChannel, recentOrders] = await Promise.all([
      this.dashboard(orgId),
      this.prisma.event.count({ where: { organizationId: orgId } }),
      this.prisma.venue.count({ where: { organizationId: orgId } }),
      this.salesReport(orgId),
      this.prisma.order.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          publicId: true,
          status: true,
          channel: true,
          totalAmount: true,
          createdAt: true,
          event: { select: { title: true } },
        },
      }),
    ]);

    return {
      ...dashboard,
      totalEvents: events,
      totalVenues: venues,
      salesByChannel,
      recentOrders: recentOrders.map((o) => ({
        publicId: o.publicId,
        status: o.status,
        channel: o.channel,
        totalAmount: String(o.totalAmount),
        eventTitle: o.event.title,
        createdAt: o.createdAt,
      })),
    };
  }

  // ==================== EVENT MANAGEMENT ====================

  async listEvents(orgId: string) {
    return await this.prisma.event.findMany({
      where: { organizationId: orgId },
      orderBy: { startsAt: 'desc' },
      include: { venue: true, _count: { select: { orders: true } } },
    });
  }

  async listVenues(orgId: string) {
    return await this.prisma.venue.findMany({
      where: { organizationId: orgId },
      include: {
        layouts: { where: { isActive: true } },
        _count: { select: { events: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getTheme(orgId: string) {
    return (
      (await this.prisma.tenantTheme.findUnique({ where: { organizationId: orgId } })) ?? {
        primaryColor: '#171717',
        subdomain: 'demo',
      }
    );
  }

  async updateTheme(orgId: string, data: { primaryColor?: string; logoUrl?: string; subdomain?: string }) {
    return await this.prisma.tenantTheme.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, ...data },
      update: data,
    });
  }

  // ==================== ORDER MANAGEMENT ====================

  async listOrders(orgId: string, limit = 50) {
    return await this.prisma.order.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        event: { select: { title: true, slug: true } },
        payment: { select: { status: true, gateway: true } },
        items: true,
      },
    });
  }

  async getOrder(orgId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { organizationId: orgId, OR: [{ id: orderId }, { publicId: orderId }] },
      include: {
        event: { select: { id: true, title: true, slug: true } },
        payment: true,
        refunds: { orderBy: { requestedAt: 'desc' } },
        items: {
          include: {
            tickets: { select: { id: true, code: true, status: true, section: true, row: true, seatNumber: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async requestRefund(
    orgId: string,
    orderId: string,
    data: { reason?: string; amount?: number; notes?: string; requestedBy: string },
  ) {
    const order = await this.getOrder(orgId, orderId);
    return this.payments.createRefund({
      orderId: order.id,
      reason: data.reason || 'CUSTOMER_REQUEST',
      amount: data.amount,
      notes: data.notes,
      requestedBy: data.requestedBy,
    });
  }

  async resendOrderEmail(orgId: string, orderId: string) {
    const order = await this.getOrder(orgId, orderId);
    await this.notifications.enqueueOrderConfirmation(order.id, order.buyerEmail, order.buyerName);
    await this.notifications.enqueueTicketPDF(order.id, order.buyerEmail);
    return { ok: true, email: order.buyerEmail };
  }

  async cancelOrderForOrg(orgId: string, orderId: string, reason: string) {
    const order = await this.getOrder(orgId, orderId);
    if (order.status === 'COMPLETED' || order.status === 'REFUNDED') {
      throw new BadRequestException('Use refund for completed orders');
    }
    this.logger.log(`Cancel order ${order.id}: ${reason}`);
    return this.prisma.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED' },
    });
  }

  async manualRefund(orderId: string, amount?: number, reason?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { refunds: true },
    });

    if (!order) throw new BadRequestException('Order not found');

    const refundAmount = amount || Number(order.totalAmount);
    const totalRefunded = order.refunds.reduce((sum, r) => sum + Number(r.amount), 0);

    if (totalRefunded + refundAmount > Number(order.totalAmount)) {
      throw new BadRequestException('Refund exceeds order total');
    }

    await this.prisma.refund.create({
      data: {
        orderId,
        amount: new Decimal(refundAmount),
        reason: (reason as import('@prisma/client').RefundReason) || 'CUSTOMER_REQUEST',
        status: 'COMPLETED',
        requestedBy: 'admin',
        processedAt: new Date(),
      },
    });

    const newStatus: OrderStatus =
      totalRefunded + refundAmount === Number(order.totalAmount)
        ? OrderStatus.REFUNDED
        : OrderStatus.PARTIALLY_REFUNDED;
    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: newStatus },
    });

    this.logger.log(`Manual refund for ${orderId}: ${refundAmount}`);
  }

  async cancelOrder(orderId: string, reason: string) {
    return await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    });
  }

  // ==================== FRAUD MANAGEMENT ====================

  async listPayouts(orgId: string) {
    const [byChannel, payouts] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['channel', 'currency'],
        where: { organizationId: orgId, status: 'COMPLETED' },
        _sum: { totalAmount: true, commissionAmount: true },
        _count: true,
      }),
      this.prisma.promoterPayout.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    return { byChannel, payouts };
  }

  async markPayoutProcessing(orgId: string, payoutId: string, referenceId?: string) {
    const payout = await this.prisma.promoterPayout.findFirst({
      where: { id: payoutId, organizationId: orgId },
    });
    if (!payout) throw new NotFoundException('Payout not found');
    return this.prisma.promoterPayout.update({
      where: { id: payoutId },
      data: {
        status: 'PROCESSING',
        referenceId: referenceId ?? payout.referenceId,
        processedAt: new Date(),
      },
    });
  }

  async markPayoutCompleted(orgId: string, payoutId: string, referenceId: string) {
    const payout = await this.prisma.promoterPayout.findFirst({
      where: { id: payoutId, organizationId: orgId },
    });
    if (!payout) throw new NotFoundException('Payout not found');
    return this.prisma.promoterPayout.update({
      where: { id: payoutId },
      data: {
        status: 'COMPLETED',
        referenceId,
        processedAt: new Date(),
      },
    });
  }

  // ==================== SALES REPORTS ====================

  async salesReport(orgId: string, from?: string, to?: string) {
    const start = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = to ? new Date(to) : new Date();
    return await this.prisma.order.groupBy({
      by: ['channel'],
      where: {
        organizationId: orgId,
        status: 'COMPLETED',
        createdAt: { gte: start, lte: end },
      },
      _sum: { totalAmount: true },
      _count: true,
    });
  }

  // ==================== AI LAYOUT SUGGESTION ====================

  suggestLayoutFromPlan(_venueId: string, planDescription: string) {
    return {
      suggested: true,
      sections: [
        {
          id: 'suggested-a',
          name: 'Sección A (sugerida)',
          slug: 'a',
          color: '#404040',
          seats: Array.from({ length: 10 }, (_, i) => ({
            id: `sug-${i}`,
            label: `A-${i + 1}`,
            x: 50 + (i % 5) * 40,
            y: 100 + Math.floor(i / 5) * 40,
            tier: 'standard',
          })),
        },
      ],
      note: `Sugerencia basada en: ${planDescription.slice(0, 200)}. Revisar en editor antes de publicar.`,
    };
  }
}


