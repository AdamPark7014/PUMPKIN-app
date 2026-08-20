import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  HoldStatus,
  OrderStatus,
  PaymentGateway,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  SalesChannel,
  TicketStatus,
} from '@prisma/client';
import { buildQrPayload, generateTicketCode } from '@boletera/crypto';
import {
  initDefaultProviders,
  getProvider,
  onlinePaymentProviderId,
  BanorteProvider,
} from '@boletera/payments';
import QRCode from 'qrcode';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { requireJwtSecret } from '../auth/jwt-secret';
import { PricingService } from '../pricing/pricing.service';
import { FraudService } from '../fraud/fraud.service';
import { NotificationService } from '../notification/notification.service';
import { CampaignExecutionService } from '../campaign-execution/campaign-execution.service';
import { ChannelQuotaService } from '../channel-management/channel-quota.service';
import { TicketPdfService } from '../notification/ticket-pdf.service';
import { BillingService } from '../billing/billing.service';
import { InventoryService } from '../inventory/inventory.service';
import type {
  CreateOrderInput,
  HoldLookup,
  OrderLineGroup,
  PricedLine,
} from './orders.types';

initDefaultProviders();

const ORDER_TTL_MS = 30 * 60 * 1000;
/** Hold + orden pendientes con Mercado Pago (OXXO/SPEI pueden tardar horas). */
const MP_PENDING_TTL_MS = (() => {
  const fromEnv = Number(process.env.MP_PENDING_TTL_HOURS);
  const hours = Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 24;
  return hours * 60 * 60 * 1000;
})();
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

type TxClient = Prisma.TransactionClient;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly fraud: FraudService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    private readonly campaigns: CampaignExecutionService,
    private readonly quotas: ChannelQuotaService,
    private readonly ticketPdf: TicketPdfService,
    private readonly billing: BillingService,
    private readonly tenant: TenantContextService,
    private readonly inventory: InventoryService,
  ) {}

  private assertTenantIfPresent(organizationId: string): void {
    const ctx = this.tenant.current();
    if (!ctx.organizationId && !ctx.privileged) return;
    this.tenant.assertOrganization(organizationId);
  }

  async createOrder(dto: CreateOrderInput) {
    if (dto.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(dto.idempotencyKey);
      if (existing) return existing;
    }

    await this.inventory.expireStaleHolds(dto.eventId);

    const lineGroups = await this.resolveOrderLines(dto);
    const holdIds = lineGroups.flatMap((g) => g.holdIds);
    const holds = lineGroups.flatMap((g) => g.holds);
    if (!holds.length) throw new BadRequestException('Invalid or expired holds');

    const event = await this.prisma.event.findFirst({
      where: { id: dto.eventId },
      select: {
        id: true,
        organizationId: true,
        currency: true,
        title: true,
        offers: {
          where: { isAvailable: true },
          select: {
            id: true,
            name: true,
            basePrice: true,
            fees: true,
            isAvailable: true,
          },
        },
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    this.assertTenantIfPresent(event.organizationId);

    const userId = await this.resolveBuyerUserId(dto);
    const pricedLines = await this.priceLines(dto, event, lineGroups);

    let subtotal = pricedLines.reduce((s, l) => s + l.subtotal, 0);
    let fees = pricedLines.reduce((s, l) => s + l.fees, 0);
    let taxAmount = pricedLines.reduce((s, l) => s + l.taxes, 0);
    let totalAmount = pricedLines.reduce((s, l) => s + l.total, 0);
    let discountAmount = pricedLines.reduce((s, l) => s + l.discount, 0);
    const appliedRules = pricedLines.flatMap((l) =>
      Array.isArray(l.appliedRules) ? l.appliedRules : [],
    );

    let promotionId: string | undefined;
    if (dto.promotionCode) {
      const promo = await this.prisma.promotion.findFirst({
        where: { code: dto.promotionCode },
        select: { id: true },
      });
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
    // Efectivo y TODO lo presencial (canal TAQUILLA) van a 'cash': en taquilla
    // la terminal bancaria física ya cobró y aquí sólo se registra el voucher
    // (cardLast4/cardAuthCode en posOps) — pasar por la pasarela online
    // duplicaría el cobro o reventaría sin credenciales. Lo online lo decide
    // el registro de pasarelas (Mercado Pago si está configurado, si no Banorte).
    const providerId =
      method === 'CASH' || channel === SalesChannel.TAQUILLA
        ? 'cash'
        : onlinePaymentProviderId();
    const provider = getProvider(providerId);
    const gatewayEnum =
      providerId === 'mercadopago'
        ? PaymentGateway.MERCADOPAGO
        : providerId === 'banorte'
          ? PaymentGateway.BANORTE
          : PaymentGateway.CASH;
    const payMethodEnum = this.toPaymentMethod(method);

    const posOps = {
      ...(dto.posOps ?? {}),
      ...(isComp ? { isComp: true, compReason: dto.compReason || 'house' } : {}),
    };

    const asyncBanorte =
      providerId === 'mercadopago' ||
      (providerId === 'banorte' &&
      (provider as BanorteProvider).requiresAsyncCapture({
        amount: totalAmount,
        currency: event.currency,
        orderId: 'pending',
        channel: channel as 'WEB' | 'TAQUILLA' | 'API' | 'ADMIN',
        buyerEmail: dto.buyerEmail,
        buyerName: dto.buyerName,
        paymentMethod: method as 'CARD' | 'SPEI' | 'OXXO',
      }));

    // MP: OXXO/SPEI no liquidan en el redirect; el hold debe vivir hasta el webhook.
    const pendingTtlMs =
      providerId === 'mercadopago' ? MP_PENDING_TTL_MS : ORDER_TTL_MS;

    // Claim idempotency key before mutating holds so concurrent retries share one order.
    if (dto.idempotencyKey) {
      try {
        await this.prisma.paymentIntent.create({
          data: {
            provider: gatewayEnum,
            externalId: `pending_${dto.idempotencyKey}`,
            amount: totalAmount,
            currency: event.currency,
            status: PaymentStatus.PENDING,
            channel,
            idempotencyKey: dto.idempotencyKey,
            expiresAt: new Date(Date.now() + pendingTtlMs),
            metadata: {
              holdIds,
              items: pricedLines.map((l) => ({
                offerId: l.offerId,
                holdIds: l.holdIds,
              })),
              placeholder: true,
            },
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          // La taquilla reclama la key ANTES de llamar aquí (PosIdempotencyService
          // crea un intent placeholder con phase='claimed' y sin orden). Ese
          // registro es de ESTA misma venta, no de una concurrente: se adopta
          // y se sigue. Sólo si la key ya tiene orden (replay) o es un claim
          // ajeno en vuelo se espera / se rechaza.
          const claimed = await this.prisma.paymentIntent.findFirst({
            where: { idempotencyKey: dto.idempotencyKey },
            select: { id: true, orderId: true, metadata: true },
          });
          const isPosClaim =
            claimed &&
            !claimed.orderId &&
            (claimed.metadata as { phase?: string } | null)?.phase === 'claimed';

          if (!isPosClaim) {
            const existing = await this.waitForIdempotentOrder(dto.idempotencyKey);
            if (existing) return existing;
            throw new ConflictException('Order is already being processed');
          }

          await this.prisma.paymentIntent.update({
            where: { id: claimed.id },
            data: {
              provider: gatewayEnum,
              externalId: `pending_${dto.idempotencyKey}`,
              amount: totalAmount,
              currency: event.currency,
              channel,
              expiresAt: new Date(Date.now() + pendingTtlMs),
              metadata: {
                ...((claimed.metadata as object) ?? {}),
                holdIds,
                items: pricedLines.map((l) => ({
                  offerId: l.offerId,
                  holdIds: l.holdIds,
                })),
                placeholder: true,
              },
            },
          });
        } else {
          throw error;
        }
      }
    }

    let order;
    try {
      order = await this.prisma.$transaction(
        async (tx) => {
          // Convert holds atomically — prevents double-sell across concurrent checkouts.
          for (const hold of holds) {
            const converted = await tx.seatHold.updateMany({
              where: {
                id: hold.id,
                eventId: event.id,
                status: HoldStatus.ACTIVE,
                expiresAt: { gt: new Date() },
              },
              data: {
                status: asyncBanorte ? HoldStatus.ACTIVE : HoldStatus.CONVERTED,
                ...(asyncBanorte
                  ? { expiresAt: new Date(Date.now() + pendingTtlMs) }
                  : {}),
              },
            });
            if (converted.count === 0) {
              throw new ConflictException('Hold expired or already converted');
            }
          }

          const created = await tx.order.create({
            data: {
              publicId,
              organizationId: event.organizationId,
              eventId: event.id,
              userId,
              status: OrderStatus.PENDING,
              buyerEmail: dto.buyerEmail.toLowerCase().trim(),
              buyerName: dto.buyerName.trim(),
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
              expiresAt: new Date(Date.now() + pendingTtlMs),
              paymentMethod: payMethodEnum,
              ...(Object.keys(posOps).length
                ? { posOps: posOps as Prisma.InputJsonValue }
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
            },
            include: { items: true },
          });

          if (dto.idempotencyKey) {
            await tx.paymentIntent.updateMany({
              where: { idempotencyKey: dto.idempotencyKey },
              data: {
                orderId: created.id,
                externalId: `pending_${created.id}`,
                metadata: {
                  holdIds,
                  items: pricedLines.map((l) => ({
                    offerId: l.offerId,
                    holdIds: l.holdIds,
                  })),
                  placeholder: true,
                },
              },
            });
          }

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
              gateway: gatewayEnum,
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
            where: { id: created.id, organizationId: event.organizationId },
            data: {
              status: OrderStatus.COMPLETED,
              paymentId: payment.id,
              completedAt: new Date(),
            },
          });

          if (dto.idempotencyKey) {
            await tx.paymentIntent.updateMany({
              where: { orderId: created.id, idempotencyKey: dto.idempotencyKey },
              data: {
                status: PaymentStatus.COMPLETED,
                externalId: capture.externalId,
                metadata: {
                  holdIds,
                  items: pricedLines.map((l) => ({
                    offerId: l.offerId,
                    holdIds: l.holdIds,
                  })),
                  intentId: intent.intentId,
                },
              },
            });
          }

          await this.fulfillInventory(tx, {
            eventId: event.id,
            buyerEmail: dto.buyerEmail,
            buyerName: dto.buyerName,
            pricedLines,
            orderItems: created.items,
          });

          return created;
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      if (dto.idempotencyKey) {
        await this.prisma.paymentIntent
          .deleteMany({
            where: {
              idempotencyKey: dto.idempotencyKey,
              orderId: null,
              status: PaymentStatus.PENDING,
            },
          })
          .catch(() => undefined);
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        dto.idempotencyKey
      ) {
        const existing = await this.waitForIdempotentOrder(dto.idempotencyKey);
        if (existing) return existing;
      }
      throw error;
    }

    await this.quotas.consume(dto.eventId, channel, holds.length);

    if (asyncBanorte) {
      // `provider` es la pasarela online activa (MP o Banorte): ambas
      // devuelven redirectUrl en este camino.
      const intent = await provider.createIntent({
        amount: totalAmount,
        currency: event.currency,
        orderId: order.id,
        channel: 'WEB',
        buyerEmail: dto.buyerEmail,
        buyerName: dto.buyerName,
        paymentMethod: method as 'CARD' | 'SPEI' | 'OXXO',
        metadata: {
          publicId: order.publicId,
          eventId: event.id,
          eventName: event.title ?? 'Evento',
          eventDate: event.startsAt.toISOString(),
          ticketQty: String(holds.length),
        },
        idempotencyKey: dto.idempotencyKey,
      });

      if (dto.idempotencyKey) {
        await this.prisma.paymentIntent.updateMany({
          where: {
            orderId: order.id,
            idempotencyKey: dto.idempotencyKey,
          },
          data: {
            provider: gatewayEnum,
            externalId: intent.externalId ?? intent.intentId,
            status: PaymentStatus.PENDING,
            metadata: {
              intentId: intent.intentId,
              holdIds,
              items: pricedLines.map((l) => ({ offerId: l.offerId, holdIds: l.holdIds })),
              ...(intent.metadata as object),
            },
          },
        });
      } else {
        await this.prisma.paymentIntent.create({
          data: {
            orderId: order.id,
            provider: gatewayEnum,
            externalId: intent.externalId ?? intent.intentId,
            amount: totalAmount,
            currency: event.currency,
            status: PaymentStatus.PENDING,
            channel,
            metadata: {
              intentId: intent.intentId,
              holdIds,
              items: pricedLines.map((l) => ({ offerId: l.offerId, holdIds: l.holdIds })),
              ...(intent.metadata as object),
            },
          },
        });
      }

      const full = await this.prisma.order.findFirst({
        where: { id: order.id, organizationId: event.organizationId },
        include: { items: true, event: true },
      });

      return {
        ...full,
        paymentAction: {
          gateway: providerId.toUpperCase(),
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

    return this.prisma.order.findFirst({
      where: { id: order.id, organizationId: event.organizationId },
      include: { items: { include: { tickets: true } }, payment: true, event: true },
    });
  }

  private async findByIdempotencyKey(idempotencyKey: string) {
    const existing = await this.prisma.paymentIntent.findUnique({
      where: { idempotencyKey },
      select: { orderId: true },
    });
    if (!existing?.orderId) return null;
    return this.prisma.order.findFirst({
      where: { id: existing.orderId },
      include: { items: { include: { tickets: true } }, payment: true, event: true },
    });
  }

  private async waitForIdempotentOrder(idempotencyKey: string) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const existing = await this.findByIdempotencyKey(idempotencyKey);
      if (existing) return existing;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  }

  private async resolveBuyerUserId(dto: CreateOrderInput): Promise<string> {
    if (dto.userId) {
      const linked = await this.prisma.user.findFirst({
        where: { id: dto.userId },
        select: { id: true },
      });
      if (linked) return linked.id;
    }
    const email = dto.buyerEmail.toLowerCase().trim();
    const existing = await this.prisma.user.findFirst({
      where: { email },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.user.create({
      data: {
        email,
        firstName: dto.buyerName.split(' ')[0] ?? 'Guest',
        lastName: dto.buyerName.split(' ').slice(1).join(' ') || 'Buyer',
      },
      select: { id: true },
    });
    return created.id;
  }

  private async priceLines(
    dto: CreateOrderInput,
    event: {
      id: string;
      offers: Array<{ id: string; isAvailable: boolean }>;
    },
    lineGroups: OrderLineGroup[],
  ): Promise<PricedLine[]> {
    const pricedLines: PricedLine[] = [];
    for (const group of lineGroups) {
      const offer =
        event.offers.find((o) => o.id === group.offerId) ??
        (await this.prisma.offer.findFirst({
          where: { id: group.offerId, eventId: event.id, isAvailable: true },
          select: { id: true, isAvailable: true },
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
    }
    return pricedLines;
  }

  private async fulfillInventory(
    tx: TxClient,
    opts: {
      eventId: string;
      buyerEmail: string;
      buyerName: string;
      pricedLines: PricedLine[];
      orderItems: Array<{ id: string; offerId: string }>;
    },
  ): Promise<void> {
    const itemByOffer = new Map(opts.orderItems.map((i) => [i.offerId, i]));
    for (const line of opts.pricedLines) {
      const orderItem = itemByOffer.get(line.offerId);
      if (!orderItem) continue;

      for (const hold of line.holds) {
        if (hold.status !== HoldStatus.CONVERTED) {
          await tx.seatHold.updateMany({
            where: { id: hold.id, status: HoldStatus.ACTIVE },
            data: { status: HoldStatus.CONVERTED },
          });
        }

        if (hold.seatId) {
          const sold = await tx.ticket.updateMany({
            where: {
              eventId: opts.eventId,
              seatId: hold.seatId,
              status: TicketStatus.HELD,
            },
            data: {
              status: TicketStatus.SOLD,
              buyerEmail: opts.buyerEmail,
              buyerName: opts.buyerName,
              code: generateTicketCode(),
              orderItemId: orderItem.id,
            },
          });
          if (sold.count === 0) {
            throw new ConflictException(`Seat ${hold.seatId} could not be sold`);
          }
        } else {
          const available = await tx.ticket.findFirst({
            where: {
              eventId: opts.eventId,
              offerId: line.offerId,
              status: TicketStatus.HELD,
              seatId: null,
            },
            select: { id: true },
            orderBy: { updatedAt: 'asc' },
          });
          if (!available) {
            throw new ConflictException('Held GA ticket missing');
          }
          const sold = await tx.ticket.updateMany({
            where: { id: available.id, status: TicketStatus.HELD },
            data: {
              status: TicketStatus.SOLD,
              buyerEmail: opts.buyerEmail,
              buyerName: opts.buyerName,
              code: generateTicketCode(),
              orderItemId: orderItem.id,
            },
          });
          if (sold.count === 0) {
            throw new ConflictException('GA ticket conflict');
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
  }

  private toPaymentMethod(method: string): PaymentMethod {
    if (method === 'SPEI') return PaymentMethod.SPEI;
    if (method === 'OXXO') return PaymentMethod.OXXO;
    if (method === 'CASH') return PaymentMethod.CASH;
    return PaymentMethod.CARD;
  }

  /** Group holds into offer lines (explicit items[] or legacy offerId + holdIds). */
  private async resolveOrderLines(dto: {
    eventId: string;
    offerId?: string;
    holdIds?: string[];
    items?: { offerId: string; holdIds: string[] }[];
  }): Promise<OrderLineGroup[]> {
    const groups: OrderLineGroup[] = [];
    const now = new Date();

    if (dto.items?.length) {
      const allHoldIds = dto.items.flatMap((i) => i.holdIds);
      const holds = await this.loadActiveHolds(dto.eventId, allHoldIds, now);
      const byId = new Map(holds.map((h) => [h.id, h]));
      const seatOfferMap = await this.buildSeatOfferMap(dto.eventId, holds);

      for (const item of dto.items) {
        if (!item.offerId || !item.holdIds?.length) continue;
        const itemHolds: typeof holds = [];
        for (const hid of item.holdIds) {
          const hold = byId.get(hid);
          if (!hold) throw new BadRequestException('Invalid or expired holds');
          const offerId = await this.offerIdForHold(hold, item.offerId, seatOfferMap);
          if (offerId !== item.offerId) {
            throw new BadRequestException('Hold/offer mismatch');
          }
          itemHolds.push(hold);
        }
        groups.push({ offerId: item.offerId, holdIds: item.holdIds, holds: itemHolds });
      }
      return groups;
    }

    const flatIds = dto.holdIds ?? [];
    if (!flatIds.length) throw new BadRequestException('holdIds or items required');
    const holds = await this.loadActiveHolds(dto.eventId, flatIds, now);
    if (holds.length !== flatIds.length) {
      throw new BadRequestException('Invalid or expired holds');
    }

    const seatOfferMap = await this.buildSeatOfferMap(dto.eventId, holds);
    const byOffer = new Map<string, typeof holds>();
    for (const hold of holds) {
      const offerId = await this.offerIdForHold(hold, dto.offerId, seatOfferMap);
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

  private async loadActiveHolds(eventId: string, holdIds: string[], now: Date) {
    const unique = [...new Set(holdIds)];
    return this.prisma.seatHold.findMany({
      where: {
        id: { in: unique },
        eventId,
        status: HoldStatus.ACTIVE,
        expiresAt: { gt: now },
      },
    });
  }

  private async offerIdForHold(
    hold: HoldLookup,
    fallback?: string,
    seatOfferMap?: Map<string, string>,
  ): Promise<string | undefined> {
    if (hold.offerId) return hold.offerId;
    if (hold.seatId) {
      const fromMap = seatOfferMap?.get(hold.seatId);
      if (fromMap) return fromMap;
      const ticket = await this.prisma.ticket.findFirst({
        where: { eventId: hold.eventId, seatId: hold.seatId },
        select: { offerId: true },
      });
      if (ticket?.offerId) return ticket.offerId;
    }
    return fallback;
  }

  private async buildSeatOfferMap(eventId: string, holds: HoldLookup[]) {
    const seatIds = [
      ...new Set(holds.filter((h) => !h.offerId && h.seatId).map((h) => h.seatId!)),
    ];
    if (!seatIds.length) return new Map<string, string>();
    const tickets = await this.prisma.ticket.findMany({
      where: { eventId, seatId: { in: seatIds } },
      select: { seatId: true, offerId: true },
    });
    const map = new Map<string, string>();
    for (const t of tickets) {
      if (t.seatId) map.set(t.seatId, t.offerId);
    }
    return map;
  }

  async getByPublicId(publicId: string) {
    const order = await this.prisma.order.findFirst({
      where: { publicId },
      include: {
        items: {
          include: {
            tickets: {
              select: {
                id: true,
                code: true,
                status: true,
                section: true,
                row: true,
                seatNumber: true,
                seatId: true,
              },
            },
            offer: { select: { id: true, name: true, zone: true, basePrice: true } },
          },
        },
        event: {
          select: {
            id: true,
            title: true,
            slug: true,
            startsAt: true,
            endsAt: true,
            organizationId: true,
            venue: { select: { name: true, city: true, address: true } },
          },
        },
        payment: {
          select: {
            id: true,
            status: true,
            method: true,
            gateway: true,
            amount: true,
            currency: true,
            processedAt: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    this.assertTenantIfPresent(order.organizationId);

    const pendingIntent = await this.prisma.paymentIntent.findFirst({
      where: { orderId: order.id },
      orderBy: { createdAt: 'desc' },
      select: {
        externalId: true,
        status: true,
        metadata: true,
      },
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
    const order = await this.prisma.order.findFirst({
      where: { publicId },
      select: {
        publicId: true,
        status: true,
        totalAmount: true,
        paymentMethod: true,
        completedAt: true,
        createdAt: true,
        organizationId: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    this.assertTenantIfPresent(order.organizationId);
    const { organizationId: _org, ...publicFields } = order;
    return publicFields;
  }

  async listForUser(userId: string, limit = DEFAULT_PAGE_SIZE, offset = 0) {
    const take = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
    const skip = Math.max(offset, 0);
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
      select: { id: true, email: true },
    });
    const where: Prisma.OrderWhereInput = user
      ? { OR: [{ userId }, { buyerEmail: user.email }] }
      : { userId };

    // Keep array contract for GET /orders/mine (web cuenta).
    return this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      select: {
        id: true,
        publicId: true,
        status: true,
        totalAmount: true,
        currency: true,
        createdAt: true,
        completedAt: true,
        paymentMethod: true,
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
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) throw new BadRequestException('User required');
    const order = await this.getByPublicId(publicId);
    if (order.status !== OrderStatus.COMPLETED) {
      throw new BadRequestException('Order not completed');
    }
    const owns =
      order.userId === userId ||
      order.buyerEmail.toLowerCase() === user.email.toLowerCase();
    if (!owns) throw new ForbiddenException('Not your order');

    return this.billing.stampOrderInvoice(order.organizationId, {
      orderId: order.id,
      receptorRfc: data.receptorRfc,
      receptorNombre: data.receptorNombre,
      receptorUsoCfdi: data.receptorUsoCfdi,
    });
  }
}
