import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  PaymentGateway,
  PaymentMethod,
  PaymentStatus,
  SalesChannel,
  TicketStatus,
  HoldStatus,
} from '@prisma/client';
import { buildQrPayload, generateTicketCode } from '@boletera/crypto';
import { initDefaultProviders, getProvider, BanorteProvider } from '@boletera/payments';
import QRCode from 'qrcode';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { FraudService } from '../fraud/fraud.service';
import { NotificationService } from '../notification/notification.service';
import { CampaignExecutionService } from '../campaign-execution/campaign-execution.service';
import { ChannelQuotaService } from '../channel-management/channel-quota.service';
import { TicketPdfService } from '../notification/ticket-pdf.service';
import { BillingService } from '../billing/billing.service';

initDefaultProviders();

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
    private fraud: FraudService,
    private notifications: NotificationService,
    private audit: AuditService,
    private campaigns: CampaignExecutionService,
    private quotas: ChannelQuotaService,
    private ticketPdf: TicketPdfService,
    private billing: BillingService,
  ) {}

  async createOrder(dto: {
    eventId: string;
    offerId?: string;
    holdIds: string[];
    buyerName: string;
    buyerEmail: string;
    buyerPhone?: string;
    userId?: string;
    paymentMethod?: string;
    promotionCode?: string;
    channel?: SalesChannel;
    cashierId?: string;
    idempotencyKey?: string;
    ipAddress?: string;
    deviceFingerprint?: string;
  }) {
    if (dto.idempotencyKey) {
      const existing = await this.prisma.paymentIntent.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (existing?.orderId) {
        const order = await this.prisma.order.findUnique({
          where: { id: existing.orderId },
          include: { items: { include: { tickets: true } }, payment: true },
        });
        if (order) return order;
      }
    }

    const holds = await this.prisma.seatHold.findMany({
      where: {
        id: { in: dto.holdIds },
        eventId: dto.eventId,
        status: HoldStatus.ACTIVE,
        expiresAt: { gt: new Date() },
      },
    });
    if (holds.length !== dto.holdIds.length) {
      throw new BadRequestException('Invalid or expired holds');
    }

    const event = await this.prisma.event.findUnique({
      where: { id: dto.eventId },
      include: { offers: { where: { isAvailable: true } } },
    });
    if (!event) throw new NotFoundException('Event not found');

    let userId = dto.userId;
    if (userId) {
      const linked = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!linked) userId = undefined;
    }
    if (!userId) {
      let user = await this.prisma.user.findUnique({ where: { email: dto.buyerEmail } });
      if (!user) {
        user = await this.prisma.user.create({
          data: {
            email: dto.buyerEmail,
            firstName: dto.buyerName.split(' ')[0] ?? 'Guest',
            lastName: dto.buyerName.split(' ').slice(1).join(' ') || 'Buyer',
          },
        });
      }
      userId = user.id;
    }

    const offer =
      (dto.offerId
        ? event.offers.find((o) => o.id === dto.offerId) ??
          (await this.prisma.offer.findFirst({
            where: { id: dto.offerId, eventId: event.id, isAvailable: true },
          }))
        : null) ?? event.offers[0];
    if (!offer) throw new BadRequestException('No offers available');

    const pricingResult = await this.pricing.calculatePrice({
      eventId: dto.eventId,
      offerId: offer.id,
      quantity: holds.length,
      promotionCode: dto.promotionCode,
    });

    let promotionId: string | undefined;
    if (dto.promotionCode) {
      const promo = await this.prisma.promotion.findUnique({ where: { code: dto.promotionCode } });
      if (promo) promotionId = promo.id;
    }

    const subtotal = Number(pricingResult.subtotal);
    const fees = Number(pricingResult.fees);
    const taxAmount = Number(pricingResult.taxes);
    const totalAmount = Number(pricingResult.total);
    const unitPrice = subtotal / holds.length;

    const publicId = `ORD-${Date.now().toString(36).toUpperCase()}`;

    const fraudResult = await this.fraud.analyzeFraud({
      userId,
      eventId: dto.eventId,
      buyerEmail: dto.buyerEmail,
      amount: totalAmount,
      currency: event.currency,
      channel: dto.channel,
      paymentMethod: dto.paymentMethod,
      ipAddress: dto.ipAddress,
      deviceFingerprint: dto.deviceFingerprint,
    });

    if (fraudResult.recommendedAction === 'BLOCK') {
      for (const f of fraudResult.flags) {
        await this.fraud.createFlag({
          type: f.type,
          severity: fraudResult.severity,
          score: fraudResult.score,
          reason: f.reason,
          userId,
          eventId: dto.eventId,
          ipAddress: dto.ipAddress,
          deviceFingerprint: dto.deviceFingerprint,
        });
      }
      throw new ForbiddenException({
        message: 'Order blocked by fraud prevention',
        score: fraudResult.score,
      });
    }

    if (fraudResult.recommendedAction === 'REVIEW') {
      await this.notifications.enqueueFraudAlert(publicId, fraudResult.score, 'REVIEW');
    }

    const channel = dto.channel ?? SalesChannel.WEB;
    await this.quotas.assertAvailable(dto.eventId, channel, holds.length);

    const method = (dto.paymentMethod ?? 'CARD').toUpperCase();
    const providerId = method === 'CASH' ? 'cash' : 'banorte';
    const provider = getProvider(providerId);
    const banorte = provider as BanorteProvider;

    const payMethodEnum =
      method === 'SPEI'
        ? PaymentMethod.SPEI
        : method === 'OXXO'
          ? PaymentMethod.OXXO
          : method === 'CASH'
            ? PaymentMethod.CASH
            : PaymentMethod.CARD;

    const asyncBanorte =
      providerId === 'banorte' &&
      banorte.requiresAsyncCapture({
        amount: totalAmount,
        currency: event.currency,
        orderId: 'pending',
        channel: channel as 'WEB' | 'TAQUILLA' | 'API' | 'ADMIN',
        buyerEmail: dto.buyerEmail,
        buyerName: dto.buyerName,
        paymentMethod: method as 'CARD' | 'SPEI' | 'OXXO',
      });

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          publicId,
          organizationId: event.organizationId,
          eventId: event.id,
          userId,
          status: OrderStatus.PENDING,
          buyerEmail: dto.buyerEmail,
          buyerName: dto.buyerName,
          buyerPhone: dto.buyerPhone,
          subtotal,
          fees,
          taxAmount,
          totalAmount,
          discountAmount: Number(pricingResult.discount),
          promotionId,
          commissionAmount: subtotal * 0.15,
          currency: event.currency,
          channel,
          cashierId: dto.cashierId,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          paymentMethod: payMethodEnum,
          items: {
            create: {
              offerId: offer.id,
              quantity: holds.length,
              unitPrice,
              unitFees: fees / holds.length,
              subtotal,
            },
          },
        },
        include: { items: true },
      });

      if (asyncBanorte) {
        return created;
      }

      const intent = await provider.createIntent({
        amount: totalAmount,
        currency: event.currency,
        orderId: created.id,
        channel: channel as 'WEB' | 'TAQUILLA' | 'API' | 'ADMIN',
        buyerEmail: dto.buyerEmail,
        buyerName: dto.buyerName,
        paymentMethod: method as 'CARD' | 'SPEI' | 'OXXO' | 'CASH',
        metadata: { publicId: created.publicId },
        idempotencyKey: dto.idempotencyKey,
      });

      const capture = await provider.capture(intent.intentId, intent.externalId);
      if (!capture.success) {
        throw new BadRequestException(capture.error ?? 'Payment capture failed');
      }

      const payment = await tx.payment.create({
        data: {
          gateway:
            providerId === 'banorte' ? PaymentGateway.BANORTE : PaymentGateway.CASH,
          externalId: capture.externalId,
          status: PaymentStatus.COMPLETED,
          amount: totalAmount,
          currency: event.currency,
          method: payMethodEnum,
          processedAt: new Date(),
          metadata: { pricingRules: pricingResult.breakdown.appliedRules },
        },
      });

      await tx.order.update({
        where: { id: created.id },
        data: {
          status: OrderStatus.COMPLETED,
          paymentId: payment.id,
          completedAt: new Date(),
        },
      });

      const orderItem = created.items[0];
      for (const hold of holds) {
        await tx.seatHold.update({
          where: { id: hold.id },
          data: { status: HoldStatus.CONVERTED },
        });
        if (hold.seatId) {
          await tx.ticket.updateMany({
            where: { eventId: dto.eventId, seatId: hold.seatId },
            data: {
              status: TicketStatus.SOLD,
              buyerEmail: dto.buyerEmail,
              buyerName: dto.buyerName,
              code: generateTicketCode(),
              orderItemId: orderItem.id,
            },
          });
        } else {
          const available = await tx.ticket.findFirst({
            where: {
              eventId: dto.eventId,
              offerId: offer.id,
              status: TicketStatus.HELD,
            },
          });
          if (available) {
            await tx.ticket.update({
              where: { id: available.id },
              data: {
                status: TicketStatus.SOLD,
                buyerEmail: dto.buyerEmail,
                buyerName: dto.buyerName,
                code: generateTicketCode(),
                orderItemId: orderItem.id,
              },
            });
          }
        }
      }

      await tx.offer.update({
        where: { id: offer.id },
        data: {
          soldQuantity: { increment: holds.length },
          remainingQuantity: { decrement: holds.length },
        },
      });

      return created;
    });

    await this.quotas.consume(dto.eventId, channel, holds.length);

    if (asyncBanorte) {
      const intent = await banorte.createIntent({
        amount: totalAmount,
        currency: event.currency,
        orderId: order.id,
        channel: 'WEB',
        buyerEmail: dto.buyerEmail,
        buyerName: dto.buyerName,
        paymentMethod: method as 'CARD' | 'SPEI' | 'OXXO',
        metadata: { publicId: order.publicId },
        idempotencyKey: dto.idempotencyKey,
      });

      await this.prisma.paymentIntent.create({
        data: {
          orderId: order.id,
          provider: PaymentGateway.BANORTE,
          externalId: intent.externalId ?? intent.intentId,
          amount: totalAmount,
          currency: event.currency,
          status: PaymentStatus.PENDING,
          channel,
          idempotencyKey: dto.idempotencyKey,
          metadata: {
            intentId: intent.intentId,
            holdIds: dto.holdIds,
            ...(intent.metadata as object),
          },
        },
      });

      const full = await this.prisma.order.findUnique({
        where: { id: order.id },
        include: { items: true, event: true },
      });

      return {
        ...full,
        paymentAction: {
          gateway: 'BANORTE',
          intentId: intent.intentId,
          redirectUrl: intent.redirectUrl,
          reference: intent.reference,
          metadata: intent.metadata,
          status: 'PENDING_PAYMENT',
        },
      };
    }

    await this.audit.log({
      action: 'order.completed',
      entityType: 'Order',
      entityId: order.id,
      organizationId: event.organizationId,
      userId,
      metadata: { publicId, channel, totalAmount, fraudScore: fraudResult.score },
      ipAddress: dto.ipAddress,
    });

    await this.notifications.enqueueOrderConfirmation(
      order.id,
      dto.buyerEmail,
      dto.buyerName ?? 'Cliente',
    );

    if (dto.promotionCode) {
      await this.campaigns.recordPromotionUse(dto.eventId, dto.promotionCode);
    }

    return this.prisma.order.findUnique({
      where: { id: order.id },
      include: { items: { include: { tickets: true } }, payment: true, event: true },
    });
  }

  async getByPublicId(publicId: string) {
    const order = await this.prisma.order.findUnique({
      where: { publicId },
      include: { items: { include: { tickets: true } }, event: true, payment: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async getStatus(publicId: string) {
    const order = await this.prisma.order.findUnique({
      where: { publicId },
      select: {
        publicId: true,
        status: true,
        totalAmount: true,
        paymentMethod: true,
        completedAt: true,
        createdAt: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async listForUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return this.prisma.order.findMany({
      where: user
        ? { OR: [{ userId }, { buyerEmail: user.email }] }
        : { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        event: { select: { id: true, title: true, slug: true, startsAt: true } },
        items: {
          select: {
            quantity: true,
            tickets: { select: { id: true, code: true, status: true } },
          },
        },
      },
    });
  }

  async getQrCodesForOrder(publicId: string) {
    const order = await this.getByPublicId(publicId);
    if (order.status !== OrderStatus.COMPLETED) {
      throw new BadRequestException('Order not completed');
    }
    const secret = process.env.TICKET_QR_SECRET || process.env.JWT_SECRET || 'dev-ticket-secret';
    const tickets = order.items.flatMap((i) => i.tickets);
    const mapped = await Promise.all(
      tickets.map(async (t) => {
        const qrPayload = buildQrPayload(t.id, order.eventId, secret);
        const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 180, margin: 1 });
        return { id: t.id, code: t.code, qrPayload, qrDataUrl };
      }),
    );
    return {
      publicId: order.publicId,
      eventTitle: order.event.title,
      tickets: mapped,
    };
  }

  async buildTicketsPdf(publicId: string): Promise<Buffer> {
    const order = await this.getByPublicId(publicId);
    if (order.status !== OrderStatus.COMPLETED) {
      throw new BadRequestException('Order not completed');
    }
    const tickets = order.items.flatMap((i) =>
      i.tickets.map((t) => ({
        id: t.id,
        code: t.code,
        section: t.section,
        row: t.row,
        seatNumber: t.seatNumber,
      })),
    );
    return this.ticketPdf.buildPdfBuffer({
      eventTitle: order.event.title,
      publicId: order.publicId,
      buyerName: order.buyerName,
      eventId: order.eventId,
      tickets,
    });
  }

  async requestCfdiForBuyer(
    publicId: string,
    userId: string,
    data: { receptorRfc: string; receptorNombre: string; receptorUsoCfdi?: string },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User required');
    const order = await this.getByPublicId(publicId);
    if (order.status !== OrderStatus.COMPLETED) {
      throw new BadRequestException('Order not completed');
    }
    const owns =
      order.userId === userId ||
      order.buyerEmail.toLowerCase() === user.email.toLowerCase();
    if (!owns) throw new BadRequestException('Not your order');

    return this.billing.stampOrderInvoice(order.organizationId, {
      orderId: order.id,
      receptorRfc: data.receptorRfc,
      receptorNombre: data.receptorNombre,
      receptorUsoCfdi: data.receptorUsoCfdi,
    });
  }
}


