import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Currency,
  PaymentGateway,
  PaymentMethod,
  PaymentStatus,
  OrderStatus,
  TicketStatus,
  HoldStatus,
} from '@prisma/client';
import {
  getProvider,
  initDefaultProviders,
  BanorteProvider,
  getBanorteConfig,
  validateBanorteProductionConfig,
} from '@boletera/payments';
import { generateTicketCode } from '@boletera/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignExecutionService } from '../campaign-execution/campaign-execution.service';
import { NotificationService } from '../notification/notification.service';

initDefaultProviders();

@Injectable()
export class PaymentService {
  private logger = new Logger(PaymentService.name);
  private banorte = getProvider('banorte') as BanorteProvider;

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationService,
    private campaigns: CampaignExecutionService,
  ) {}

  async createPaymentIntent(data: {
    orderId: string;
    amount: number;
    currency: string;
    buyerEmail: string;
    buyerName: string;
    paymentMethod?: string;
    publicId?: string;
  }) {
    const order = await this.prisma.order.findUnique({
      where: { id: data.orderId },
      include: { event: true },
    });
    if (!order) throw new BadRequestException('Order not found');
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Order must be PENDING');
    }

    const method = (data.paymentMethod ?? order.paymentMethod ?? 'CARD').toUpperCase();
    const intent = await this.banorte.createIntent({
      amount: Number(data.amount),
      currency: data.currency,
      orderId: data.orderId,
      channel: 'WEB',
      buyerEmail: data.buyerEmail,
      buyerName: data.buyerName,
      paymentMethod: method as 'CARD' | 'SPEI' | 'OXXO',
      metadata: { publicId: data.publicId ?? order.publicId },
    });

    await this.prisma.paymentIntent.create({
      data: {
        orderId: data.orderId,
        provider: PaymentGateway.BANORTE,
        externalId: intent.externalId ?? intent.intentId,
        amount: data.amount,
        currency: order.currency,
        status: PaymentStatus.PENDING,
        channel: order.channel,
        metadata: { intentId: intent.intentId, ...(intent.metadata as object) },
      },
    });

    return {
      intentId: intent.intentId,
      status: intent.status,
      redirectUrl: intent.redirectUrl,
      reference: intent.reference,
      metadata: intent.metadata,
      gateway: 'BANORTE',
      settlement: 'Cuenta Banorte del comercio',
    };
  }

  async confirmBanortePayment(data: {
    orderId: string;
    intentId?: string;
    externalId?: string;
  }) {
    const order = await this.prisma.order.findUnique({
      where: { id: data.orderId },
      include: { items: true, event: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === OrderStatus.COMPLETED) {
      return { order, alreadyCompleted: true };
    }

    const cfg = getBanorteConfig();
    if (cfg.isDemo) {
      return this.completeOrder(order.id, data.externalId ?? data.intentId ?? `banorte_demo_${order.id}`);
    }

    throw new BadRequestException(
      'En producción la confirmación llega vía IPN Banorte (webhook).',
    );
  }

  async completeOrder(orderId: string, externalId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: { include: { offer: true } }, event: true },
      });
      if (!order) throw new NotFoundException('Order not found');
      if (order.status === OrderStatus.COMPLETED) {
        return { order, payment: await tx.payment.findFirst({ where: { id: order.paymentId ?? '' } }) };
      }

      const pendingIntent = await tx.paymentIntent.findFirst({
        where: { orderId },
        orderBy: { createdAt: 'desc' },
      });
      const intentMeta = (pendingIntent?.metadata as Record<string, unknown>) ?? {};
      const holdIds = Array.isArray(intentMeta.holdIds) ? (intentMeta.holdIds as string[]) : [];

      const payment = await tx.payment.create({
        data: {
          gateway: PaymentGateway.BANORTE,
          externalId,
          status: PaymentStatus.COMPLETED,
          amount: order.totalAmount,
          currency: order.currency,
          method: order.paymentMethod,
          processedAt: new Date(),
          metadata: { source: 'banorte_direct' },
        },
      });

      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.COMPLETED,
          paymentId: payment.id,
          completedAt: new Date(),
        },
        include: { items: true },
      });

      const tickets = [];
      const orderItem = updatedOrder.items[0];

      if (holdIds.length > 0) {
        const holds = await tx.seatHold.findMany({
          where: { id: { in: holdIds }, eventId: order.eventId },
        });
        for (const hold of holds) {
          await tx.seatHold.update({
            where: { id: hold.id },
            data: { status: HoldStatus.CONVERTED },
          });
          if (hold.seatId) {
            await tx.ticket.updateMany({
              where: { eventId: order.eventId, seatId: hold.seatId },
              data: {
                status: TicketStatus.SOLD,
                buyerEmail: order.buyerEmail,
                buyerName: order.buyerName,
                code: generateTicketCode(),
                orderItemId: orderItem?.id,
              },
            });
          }
        }
      }

      for (const item of updatedOrder.items) {
        const existing = await tx.ticket.count({
          where: { orderItemId: item.id, status: TicketStatus.SOLD },
        });
        const toCreate = item.quantity - existing;
        for (let i = 0; i < toCreate; i++) {
          const ticket = await tx.ticket.create({
            data: {
              code: generateTicketCode(),
              eventId: order.eventId,
              offerId: item.offerId,
              status: TicketStatus.SOLD,
              orderItemId: item.id,
              buyerName: order.buyerName,
              buyerEmail: order.buyerEmail,
            },
          });
          tickets.push(ticket);
        }
        if (toCreate > 0) {
          await tx.offer.update({
            where: { id: item.offerId },
            data: {
              soldQuantity: { increment: toCreate },
              remainingQuantity: { decrement: toCreate },
            },
          });
        }
      }

      this.logger.log(`Banorte: order ${orderId} completed, ${tickets.length} tickets`);
      return { order: updatedOrder, payment, tickets };
    }).then(async (result) => {
      await this.notifications.enqueueOrderConfirmation(
        result.order.id,
        result.order.buyerEmail,
        result.order.buyerName,
      );
      if (result.order.promotionId) {
        const promo = await this.prisma.promotion.findUnique({
          where: { id: result.order.promotionId },
        });
        if (promo) {
          await this.campaigns.recordPromotionUse(result.order.eventId, promo.code);
        }
      }
      return result;
    });
  }

  async createRefund(data: {
    orderId: string;
    reason: string;
    amount?: number;
    notes?: string;
    requestedBy?: string;
  }) {
    const order = await this.prisma.order.findUnique({
      where: { id: data.orderId },
      include: { payment: true },
    });
    if (!order?.payment) throw new BadRequestException('No payment found');
    if (
      order.status !== OrderStatus.COMPLETED &&
      order.status !== OrderStatus.PARTIALLY_REFUNDED
    ) {
      throw new BadRequestException('Only completed orders can be refunded');
    }

    const refundAmount = data.amount ?? Number(order.totalAmount);
    const result = await this.banorte.refund(order.payment.externalId, refundAmount);
    const requestedBy = data.requestedBy ?? 'admin';

    const refund = await this.prisma.refund.create({
      data: {
        orderId: data.orderId,
        amount: refundAmount,
        reason: 'CUSTOMER_REQUEST',
        status: result.success ? 'COMPLETED' : 'PENDING',
        requestedBy,
        processedAt: result.success ? new Date() : undefined,
        notes:
          data.notes ||
          result.error ||
          (result.success
            ? 'Refund completed via Banorte'
            : 'Pending manual Banorte portal refund — call POST /payments/refunds/:id/complete when done'),
      },
    });

    await this.prisma.auditEvent.create({
      data: {
        action: result.success ? 'REFUND_COMPLETED' : 'REFUND_REQUESTED',
        entityType: 'Refund',
        entityId: refund.id,
        organizationId: order.organizationId,
        metadata: {
          orderId: order.id,
          amount: refundAmount,
          banorteSuccess: result.success,
          banorteError: result.error,
          requestedBy,
        },
      },
    });

    if (result.success) {
      await this.applyRefundInventory(order.id, refundAmount >= Number(order.totalAmount));
    }

    return {
      refund,
      banorte: result,
      nextStep: result.success
        ? null
        : 'Process refund in Banorte portal, then POST /api/v1/payments/refunds/' +
          refund.id +
          '/complete',
    };
  }

  /** After staff completes Banorte portal refund, finalize order + inventory. */
  async completeManualRefund(
    refundId: string,
    processedBy: string,
    banorteReference?: string,
  ) {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: { order: true },
    });
    if (!refund) throw new NotFoundException('Refund not found');
    if (refund.status === 'COMPLETED') {
      return { refund, alreadyCompleted: true };
    }

    const full = Number(refund.amount) >= Number(refund.order.totalAmount);
    const updated = await this.prisma.refund.update({
      where: { id: refundId },
      data: {
        status: 'COMPLETED',
        processedBy,
        processedAt: new Date(),
        notes: [refund.notes, banorteReference ? `Banorte ref: ${banorteReference}` : null]
          .filter(Boolean)
          .join(' | '),
      },
    });

    await this.applyRefundInventory(refund.orderId, full);

    await this.prisma.auditEvent.create({
      data: {
        action: 'REFUND_MANUAL_COMPLETED',
        entityType: 'Refund',
        entityId: refundId,
        organizationId: refund.order.organizationId,
        metadata: { processedBy, banorteReference },
      },
    });

    return { refund: updated, inventoryReleased: true };
  }

  private async applyRefundInventory(orderId: string, fullRefund: boolean) {
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: fullRefund ? OrderStatus.REFUNDED : OrderStatus.PARTIALLY_REFUNDED,
          refundedAt: new Date(),
        },
      });

      if (fullRefund) {
        const items = await tx.orderItem.findMany({
          where: { orderId },
          select: { id: true },
        });
        const itemIds = items.map((i) => i.id);
        if (itemIds.length) {
          await tx.ticket.updateMany({
            where: { orderItemId: { in: itemIds } },
            data: {
              status: TicketStatus.AVAILABLE,
              orderItemId: null,
              buyerName: null,
              buyerEmail: null,
              checkedInAt: null,
              usedAt: null,
            },
          });
        }
      }
    });
  }

  async handleBanorteWebhook(payload: unknown, signature?: string) {
    const result = await this.banorte.handleWebhook!(payload, signature);
    if (!result.orderId) {
      this.logger.warn('Banorte webhook without orderId');
      return { received: true };
    }

    let order = await this.prisma.order.findUnique({ where: { id: result.orderId } });
    if (!order) {
      order = await this.prisma.order.findFirst({
        where: { publicId: { contains: String(result.orderId) } },
      });
    }

    if (!order) {
      this.logger.warn(`Banorte webhook: order not found ${result.orderId}`);
      return { received: true };
    }

    if (result.status === 'completed') {
      await this.completeOrder(order.id, result.intentId ?? `banorte_${order.id}`);
    } else if (result.status === 'failed') {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.FAILED },
      });
    }

    return { received: true, status: result.status };
  }

  getBanortePublicConfig() {
    const cfg = getBanorteConfig();
    const validation = validateBanorteProductionConfig();
    return {
      gateway: 'BANORTE',
      demo: cfg.isDemo,
      productionReady: validation.ready,
      methods: ['CARD', 'SPEI', 'OXXO'],
      settlement: 'Depósito directo en cuenta Banorte empresarial',
      accountClabeMasked: cfg.accountClabe
        ? `${cfg.accountClabe.slice(0, 4)}…${cfg.accountClabe.slice(-4)}`
        : null,
      validation,
    };
  }

  validateBanorteSetup() {
    return validateBanorteProductionConfig();
  }
}


