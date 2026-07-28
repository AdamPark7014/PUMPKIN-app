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
import { requireJwtSecret } from '../auth/jwt-secret';
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
    holdIds?: string[];
    items?: { offerId: string; holdIds: string[] }[];
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
    isComp?: boolean;
    compReason?: string;
    posOps?: Record<string, unknown>;
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

    const lineGroups = await this.resolveOrderLines(dto);
    const holdIds = lineGroups.flatMap((g) => g.holdIds);
    const holds = lineGroups.flatMap((g) => g.holds);
    if (!holds.length) throw new BadRequestException('Invalid or expired holds');

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

    const pricedLines: {
      offerId: string;
      holdIds: string[];
      holds: (typeof holds)[number][];
      quantity: number;
      unitPrice: number;
      unitFees: number;
      subtotal: number;
      fees: number;
      taxes: number;
      total: number;
      discount: number;
      appliedRules: unknown;
    }[] = [];

    let subtotal = 0;
    let fees = 0;
    let taxAmount = 0;
    let totalAmount = 0;
    let discountAmount = 0;
    const appliedRules: unknown[] = [];

    for (const group of lineGroups) {
      const offer =
        event.offers.find((o) => o.id === group.offerId) ??
        (await this.prisma.offer.findFirst({
          where: { id: group.offerId, eventId: event.id, isAvailable: true },
        }));
      if (!offer) throw new BadRequestException(`Offer ${group.offerId} not available`);

      const pricingResult = await this.pricing.calculatePrice({
        eventId: dto.eventId,
        offerId: offer.id,
        quantity: group.holds.length,
        promotionCode: dto.promotionCode,
      });
      const lineSubtotal = Number(pricingResult.subtotal);
      const lineFees = Number(pricingResult.fees);
      const lineTaxes = Number(pricingResult.taxes);
      const lineTotal = Number(pricingResult.total);
      const lineDiscount = Number(pricingResult.discount);
      const qty = group.holds.length;
      pricedLines.push({
        offerId: offer.id,
        holdIds: group.holdIds,
        holds: group.holds,
        quantity: qty,
        unitPrice: qty ? lineSubtotal / qty : 0,
        unitFees: qty ? lineFees / qty : 0,
        subtotal: lineSubtotal,
        fees: lineFees,
        taxes: lineTaxes,
        total: lineTotal,
        discount: lineDiscount,
        appliedRules: pricingResult.breakdown.appliedRules,
      });
      subtotal += lineSubtotal;
      fees += lineFees;
      taxAmount += lineTaxes;
      totalAmount += lineTotal;
      discountAmount += lineDiscount;
      appliedRules.push(...(pricingResult.breakdown.appliedRules ?? []));
    }

    let promotionId: string | undefined;
    if (dto.promotionCode) {
      const promo = await this.prisma.promotion.findUnique({ where: { code: dto.promotionCode } });
      if (promo) promotionId = promo.id;
    }

    const isComp =
      dto.isComp === true || (dto.paymentMethod ?? '').toUpperCase() === 'COMP';
    if (isComp) {
      discountAmount = subtotal + fees + taxAmount;
      fees = 0;
      taxAmount = 0;
      totalAmount = 0;
    }

    const publicId = `ORD-${Date.now().toString(36).toUpperCase()}`;

    const fraudResult = await this.fraud.analyzeFraud({
      userId,
      eventId: dto.eventId,
      buyerEmail: dto.buyerEmail,
      amount: totalAmount,
      currency: event.currency,
      channel: dto.channel,
      paymentMethod: isComp ? 'CASH' : dto.paymentMethod,
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

    const method = isComp ? 'CASH' : (dto.paymentMethod ?? 'CARD').toUpperCase();
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

    const posOps = {
      ...(dto.posOps ?? {}),
      ...(isComp ? { isComp: true, compReason: dto.compReason || 'house' } : {}),
    };

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
          discountAmount,
          promotionId,
          commissionAmount: isComp ? 0 : subtotal * 0.15,
          currency: event.currency,
          channel,
          cashierId: dto.cashierId,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          paymentMethod: payMethodEnum,
          ...(Object.keys(posOps).length
            ? ({ posOps } as Record<string, unknown>)
            : {}),
          items: {
            create: pricedLines.map((line) => ({
              offerId: line.offerId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              unitFees: line.unitFees,
              subtotal: line.subtotal,
            })),
          },
        } as Parameters<typeof tx.order.create>[0]['data'],
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
          metadata: { pricingRules: appliedRules as object[] },
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

      const itemByOffer = new Map(created.items.map((i) => [i.offerId, i]));
      for (const line of pricedLines) {
        const orderItem = itemByOffer.get(line.offerId);
        if (!orderItem) continue;
        for (const hold of line.holds) {
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
                offerId: line.offerId,
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
          where: { id: line.offerId },
          data: {
            soldQuantity: { increment: line.quantity },
            remainingQuantity: { decrement: line.quantity },
          },
        });
      }

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
            holdIds,
            items: pricedLines.map((l) => ({ offerId: l.offerId, holdIds: l.holdIds })),
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

  /** Group holds into offer lines (explicit items[] or legacy offerId + holdIds). */
  private async resolveOrderLines(dto: {
    eventId: string;
    offerId?: string;
    holdIds?: string[];
    items?: { offerId: string; holdIds: string[] }[];
  }) {
    const groups: {
      offerId: string;
      holdIds: string[];
      holds: Awaited<ReturnType<PrismaService['seatHold']['findMany']>>;
    }[] = [];

    if (dto.items?.length) {
      for (const item of dto.items) {
        if (!item.offerId || !item.holdIds?.length) continue;
        const holds = await this.prisma.seatHold.findMany({
          where: {
            id: { in: item.holdIds },
            eventId: dto.eventId,
            status: HoldStatus.ACTIVE,
            expiresAt: { gt: new Date() },
          },
        });
        if (holds.length !== item.holdIds.length) {
          throw new BadRequestException('Invalid or expired holds');
        }
        for (const hold of holds) {
          const offerId = await this.offerIdForHold(hold, item.offerId);
          if (offerId !== item.offerId) {
            throw new BadRequestException('Hold/offer mismatch');
          }
        }
        groups.push({ offerId: item.offerId, holdIds: item.holdIds, holds });
      }
      return groups;
    }

    const flatIds = dto.holdIds ?? [];
    if (!flatIds.length) throw new BadRequestException('holdIds or items required');
    const holds = await this.prisma.seatHold.findMany({
      where: {
        id: { in: flatIds },
        eventId: dto.eventId,
        status: HoldStatus.ACTIVE,
        expiresAt: { gt: new Date() },
      },
    });
    if (holds.length !== flatIds.length) {
      throw new BadRequestException('Invalid or expired holds');
    }

    const byOffer = new Map<string, typeof holds>();
    for (const hold of holds) {
      const offerId = await this.offerIdForHold(hold, dto.offerId);
      if (!offerId) throw new BadRequestException('Could not resolve offer for hold');
      const list = byOffer.get(offerId) ?? [];
      list.push(hold);
      byOffer.set(offerId, list);
    }
    for (const [offerId, list] of byOffer) {
      groups.push({ offerId, holdIds: list.map((h) => h.id), holds: list });
    }
    return groups;
  }

  private async offerIdForHold(
    hold: { seatId: string | null; offerId: string | null },
    fallback?: string,
  ) {
    if (hold.offerId) return hold.offerId;
    if (hold.seatId) {
      const ticket = await this.prisma.ticket.findFirst({
        where: { seatId: hold.seatId },
        select: { offerId: true },
      });
      if (ticket?.offerId) return ticket.offerId;
    }
    return fallback;
  }

  async getByPublicId(publicId: string) {
    const order = await this.prisma.order.findUnique({
      where: { publicId },
      include: {
        items: {
          include: {
            tickets: true,
            offer: { select: { id: true, name: true, zone: true, basePrice: true } },
          },
        },
        event: {
          include: {
            venue: { select: { name: true, city: true, address: true } },
          },
        },
        payment: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    const pendingIntent = await this.prisma.paymentIntent.findFirst({
      where: { orderId: order.id },
      orderBy: { createdAt: 'desc' },
    });
    return {
      ...order,
      pendingPayment: pendingIntent
        ? {
            reference: pendingIntent.externalId,
            status: pendingIntent.status,
            metadata: pendingIntent.metadata,
          }
        : null,
    };
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
        event: {
          select: {
            id: true,
            title: true,
            slug: true,
            startsAt: true,
            venue: { select: { name: true, city: true } },
          },
        },
        items: {
          select: {
            quantity: true,
            tickets: {
              select: {
                id: true,
                code: true,
                status: true,
                section: true,
                row: true,
                seatNumber: true,
              },
            },
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
    const secret = process.env.TICKET_QR_SECRET || requireJwtSecret();
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


