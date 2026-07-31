import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  HoldStatus,
  OrderStatus,
  PaymentGateway,
  PaymentStatus,
  Prisma,
  RefundReason,
  RefundStatus,
  TicketStatus,
} from '@prisma/client';
import {
  getProvider,
  initDefaultProviders,
  BanorteProvider,
  getBanorteConfig,
  getBanorteIpnEndpoints,
  validateBanorteProductionConfig,
} from '@boletera/payments';
import { generateTicketCode } from '@boletera/crypto';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignExecutionService } from '../campaign-execution/campaign-execution.service';
import { NotificationService } from '../notification/notification.service';

initDefaultProviders();

type TxClient = Prisma.TransactionClient;

type IntentMeta = {
  holdIds?: string[];
  items?: Array<{ offerId: string; holdIds: string[] }>;
  intentId?: string;
};

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly banorte = getProvider('banorte') as BanorteProvider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly campaigns: CampaignExecutionService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private assertTenantIfPresent(organizationId: string): void {
    const ctx = this.tenant.current();
    if (!ctx.organizationId && !ctx.privileged) return;
    this.tenant.assertOrganization(organizationId);
  }

  private resolveStaffOrganization(orderOrganizationId: string): string {
    const ctx = this.tenant.current();
    if (ctx.privileged) {
      this.tenant.assertOrganization(orderOrganizationId);
      return orderOrganizationId;
    }
    const organizationId = this.tenant.requireOrganization();
    this.tenant.assertOrganization(orderOrganizationId);
    return organizationId;
  }

  async createPaymentIntent(data: {
    orderId: string;
    amount: number;
    currency: string;
    buyerEmail: string;
    buyerName: string;
    paymentMethod?: string;
    publicId?: string;
    idempotencyKey?: string;
  }) {
    if (data.idempotencyKey) {
      const existing = await this.prisma.paymentIntent.findUnique({
        where: { idempotencyKey: data.idempotencyKey },
      });
      if (existing) {
        const meta = (existing.metadata as Record<string, unknown> | null) ?? {};
        return {
          intentId: String(meta.intentId ?? existing.externalId ?? existing.id),
          status: existing.status,
          redirectUrl: typeof meta.redirectUrl === 'string' ? meta.redirectUrl : undefined,
          reference: existing.externalId ?? undefined,
          metadata: existing.metadata,
          gateway: 'BANORTE' as const,
          settlement: 'Cuenta Banorte del comercio',
          reused: true,
        };
      }
    }

    const order = await this.prisma.order.findFirst({
      where: { id: data.orderId },
      select: {
        id: true,
        publicId: true,
        status: true,
        totalAmount: true,
        currency: true,
        channel: true,
        paymentMethod: true,
        organizationId: true,
        buyerEmail: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    this.assertTenantIfPresent(order.organizationId);
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Order must be PENDING');
    }

    const amount = Number(data.amount);
    if (Math.abs(amount - Number(order.totalAmount)) > 0.009) {
      throw new BadRequestException('Amount does not match order total');
    }

    const method = (data.paymentMethod ?? order.paymentMethod ?? 'CARD').toUpperCase();
    const intent = await this.banorte.createIntent({
      amount,
      currency: data.currency,
      orderId: data.orderId,
      channel: 'WEB',
      buyerEmail: data.buyerEmail,
      buyerName: data.buyerName,
      paymentMethod: method as 'CARD' | 'SPEI' | 'OXXO',
      metadata: { publicId: data.publicId ?? order.publicId },
      idempotencyKey: data.idempotencyKey,
    });

    try {
      await this.prisma.paymentIntent.create({
        data: {
          orderId: data.orderId,
          provider: PaymentGateway.BANORTE,
          externalId: intent.externalId ?? intent.intentId,
          amount: data.amount,
          currency: order.currency,
          status: PaymentStatus.PENDING,
          channel: order.channel,
          idempotencyKey: data.idempotencyKey,
          metadata: {
            intentId: intent.intentId,
            redirectUrl: intent.redirectUrl,
            ...(intent.metadata as object),
          },
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        data.idempotencyKey
      ) {
        return this.createPaymentIntent(data);
      }
      throw error;
    }

    await this.audit.log({
      action: 'payment.intent.created',
      entityType: 'PaymentIntent',
      entityId: intent.intentId,
      organizationId: order.organizationId,
      userId: this.tenant.current().userId,
      metadata: { orderId: order.id, amount, method },
    });

    return {
      intentId: intent.intentId,
      status: intent.status,
      redirectUrl: intent.redirectUrl,
      reference: intent.reference,
      metadata: intent.metadata,
      gateway: 'BANORTE' as const,
      settlement: 'Cuenta Banorte del comercio',
    };
  }

  async confirmBanortePayment(data: {
    orderId: string;
    intentId?: string;
    externalId?: string;
  }) {
    const order = await this.prisma.order.findFirst({
      where: { id: data.orderId },
      select: { id: true, status: true, organizationId: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    this.assertTenantIfPresent(order.organizationId);
    if (order.status === OrderStatus.COMPLETED) {
      return { orderId: order.id, alreadyCompleted: true };
    }

    const cfg = getBanorteConfig();
    if (cfg.isDemo) {
      return this.completeOrder(
        order.id,
        data.externalId ?? data.intentId ?? `banorte_demo_${order.id}`,
      );
    }

    throw new BadRequestException(
      'En producción la confirmación llega vía IPN Banorte (webhook).',
    );
  }

  /**
   * Idempotent order completion. Uses a conditional PENDING→COMPLETED update so
   * concurrent webhooks/reconciles cannot double-fulfill inventory.
   */
  async completeOrder(orderId: string, externalId: string) {
    const prefetched = await this.prisma.order.findFirst({
      where: { id: orderId },
      select: { id: true, organizationId: true, status: true },
    });
    if (!prefetched) throw new NotFoundException('Order not found');
    this.assertTenantIfPresent(prefetched.organizationId);

    if (prefetched.status === OrderStatus.COMPLETED) {
      const payment = await this.prisma.payment.findFirst({
        where: { orders: { some: { id: orderId } } },
      });
      return { order: prefetched, payment, alreadyCompleted: true };
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.order.updateMany({
          where: {
            id: orderId,
            organizationId: prefetched.organizationId,
            status: OrderStatus.PENDING,
          },
          data: {
            status: OrderStatus.COMPLETED,
            completedAt: new Date(),
          },
        });
        if (claimed.count === 0) {
          const current = await tx.order.findFirst({
            where: { id: orderId, organizationId: prefetched.organizationId },
            include: { items: true },
          });
          return {
            order: current,
            payment: current?.paymentId
              ? await tx.payment.findFirst({ where: { id: current.paymentId } })
              : null,
            alreadyCompleted: true as const,
            tickets: [] as Array<{ id: string }>,
          };
        }

        const order = await tx.order.findFirst({
          where: { id: orderId, organizationId: prefetched.organizationId },
          include: { items: true, event: { select: { id: true, organizationId: true } } },
        });
        if (!order) throw new NotFoundException('Order not found');

        const existingPayment = await tx.payment.findFirst({
          where: { externalId },
          select: { id: true },
        });
        const payment =
          existingPayment ??
          (await tx.payment.create({
            data: {
              gateway: PaymentGateway.BANORTE,
              externalId,
              status: PaymentStatus.COMPLETED,
              amount: order.totalAmount,
              currency: order.currency,
              method: order.paymentMethod,
              processedAt: new Date(),
              metadata: { source: 'banorte_complete' },
            },
          }));

        await tx.order.update({
          where: { id: orderId },
          data: { paymentId: payment.id },
        });

        const pendingIntent = await tx.paymentIntent.findFirst({
          where: { orderId, status: { in: [PaymentStatus.PENDING, PaymentStatus.COMPLETED] } },
          orderBy: { createdAt: 'desc' },
        });
        const intentMeta = (pendingIntent?.metadata as IntentMeta | null) ?? {};
        const holdIds = Array.isArray(intentMeta.holdIds) ? intentMeta.holdIds : [];

        await this.fulfillFromHolds(tx, {
          order,
          holdIds,
          metaItems: Array.isArray(intentMeta.items) ? intentMeta.items : [],
        });

        if (pendingIntent && pendingIntent.status === PaymentStatus.PENDING) {
          await tx.paymentIntent.update({
            where: { id: pendingIntent.id },
            data: {
              status: PaymentStatus.COMPLETED,
              externalId: pendingIntent.externalId ?? externalId,
            },
          });
        }

        this.logger.log(`Banorte: order ${orderId} completed`);
        return {
          order: { ...order, status: OrderStatus.COMPLETED, paymentId: payment.id },
          payment,
          alreadyCompleted: false as const,
          tickets: [] as Array<{ id: string }>,
        };
      },
      { timeout: 30_000 },
    );

    if (!result.alreadyCompleted && result.order) {
      await this.notifications.enqueueOrderConfirmation(
        result.order.id,
        result.order.buyerEmail,
        result.order.buyerName,
      );
      if (result.order.promotionId) {
        const promo = await this.prisma.promotion.findFirst({
          where: { id: result.order.promotionId },
          select: { code: true },
        });
        if (promo) {
          await this.campaigns.recordPromotionUse(result.order.eventId, promo.code);
        }
      }
      await this.audit.log({
        action: 'payment.order.completed',
        entityType: 'Order',
        entityId: result.order.id,
        organizationId: prefetched.organizationId,
        userId: this.tenant.current().userId,
        metadata: { externalId },
      });
    }

    return result;
  }

  private async fulfillFromHolds(
    tx: TxClient,
    opts: {
      order: {
        id: string;
        eventId: string;
        buyerEmail: string;
        buyerName: string;
        items: Array<{ id: string; offerId: string; quantity: number }>;
      };
      holdIds: string[];
      metaItems: Array<{ offerId: string; holdIds: string[] }>;
    },
  ): Promise<void> {
    const itemByOffer = new Map(opts.order.items.map((i) => [i.offerId, i]));
    const holdToOffer = new Map<string, string>();
    for (const item of opts.metaItems) {
      for (const hid of item.holdIds ?? []) holdToOffer.set(hid, item.offerId);
    }

    if (!opts.holdIds.length) {
      throw new ConflictException('Payment intent missing holdIds — cannot fulfill safely');
    }

    const holds = await tx.seatHold.findMany({
      where: {
        id: { in: opts.holdIds },
        eventId: opts.order.eventId,
        status: { in: [HoldStatus.ACTIVE, HoldStatus.CONVERTED] },
      },
    });
    if (holds.length !== opts.holdIds.length) {
      throw new ConflictException('Holds missing or expired for paid order');
    }

    const offerIncrements = new Map<string, number>();

    for (const hold of holds) {
      await tx.seatHold.updateMany({
        where: {
          id: hold.id,
          status: { in: [HoldStatus.ACTIVE, HoldStatus.CONVERTED] },
        },
        data: { status: HoldStatus.CONVERTED },
      });

      let offerId = holdToOffer.get(hold.id) || hold.offerId || undefined;
      if (!offerId && hold.seatId) {
        const ticket = await tx.ticket.findFirst({
          where: { eventId: opts.order.eventId, seatId: hold.seatId },
          select: { offerId: true },
        });
        offerId = ticket?.offerId;
      }
      const orderItem = offerId ? itemByOffer.get(offerId) : undefined;
      if (!orderItem || !offerId) {
        throw new ConflictException('Could not map hold to order item');
      }

      let newlySold = 0;

      if (hold.seatId) {
        const alreadySold = await tx.ticket.count({
          where: {
            eventId: opts.order.eventId,
            seatId: hold.seatId,
            status: TicketStatus.SOLD,
            orderItemId: orderItem.id,
          },
        });
        if (alreadySold === 0) {
          const sold = await tx.ticket.updateMany({
            where: {
              eventId: opts.order.eventId,
              seatId: hold.seatId,
              status: TicketStatus.HELD,
            },
            data: {
              status: TicketStatus.SOLD,
              buyerEmail: opts.order.buyerEmail,
              buyerName: opts.order.buyerName,
              code: generateTicketCode(),
              orderItemId: orderItem.id,
            },
          });
          if (sold.count === 0) {
            throw new ConflictException(`Seat ${hold.seatId} unavailable after payment`);
          }
          newlySold = sold.count;
        }
      } else {
        const soldForLine = await tx.ticket.count({
          where: {
            orderItemId: orderItem.id,
            offerId,
            status: TicketStatus.SOLD,
            seatId: null,
          },
        });
        if (soldForLine >= orderItem.quantity) {
          newlySold = 0;
        } else {
          const held = await tx.ticket.findFirst({
            where: {
              eventId: opts.order.eventId,
              offerId,
              status: TicketStatus.HELD,
              seatId: null,
            },
            select: { id: true },
            orderBy: { updatedAt: 'asc' },
          });
          if (!held) {
            throw new ConflictException('Held GA ticket missing after payment');
          }
          const sold = await tx.ticket.updateMany({
            where: { id: held.id, status: TicketStatus.HELD },
            data: {
              status: TicketStatus.SOLD,
              buyerEmail: opts.order.buyerEmail,
              buyerName: opts.order.buyerName,
              code: generateTicketCode(),
              orderItemId: orderItem.id,
            },
          });
          if (sold.count === 0) {
            throw new ConflictException('GA ticket conflict after payment');
          }
          newlySold = sold.count;
        }
      }

      if (newlySold > 0) {
        offerIncrements.set(offerId, (offerIncrements.get(offerId) ?? 0) + newlySold);
      }
    }

    for (const [offerId, qty] of offerIncrements) {
      if (qty <= 0) continue;
      await tx.offer.update({
        where: { id: offerId },
        data: {
          soldQuantity: { increment: qty },
          remainingQuantity: { decrement: qty },
        },
      });
    }
  }

  async createRefund(data: {
    orderId: string;
    reason: string;
    amount?: number;
    notes?: string;
    requestedBy?: string;
    reasonCode?: RefundReason;
    idempotencyKey?: string;
  }) {
    const order = await this.prisma.order.findFirst({
      where: { id: data.orderId },
      include: {
        payment: true,
        refunds: {
          where: { status: { in: [RefundStatus.PENDING, RefundStatus.COMPLETED] } },
          select: { id: true, amount: true, status: true, notes: true },
        },
      },
    });
    if (!order?.payment) throw new BadRequestException('No payment found');
    const organizationId = this.resolveStaffOrganization(order.organizationId);

    if (
      order.status !== OrderStatus.COMPLETED &&
      order.status !== OrderStatus.PARTIALLY_REFUNDED
    ) {
      throw new BadRequestException('Only completed orders can be refunded');
    }

    if (data.idempotencyKey) {
      const prior = order.refunds.find((r) =>
        String(r.notes ?? '').includes(`idempotency:${data.idempotencyKey}`),
      );
      if (prior) {
        return {
          refund: prior,
          banorte: { success: prior.status === RefundStatus.COMPLETED, refundId: prior.id },
          nextStep: null,
          reused: true,
        };
      }
    }

    const refundAmount = data.amount ?? Number(order.totalAmount);
    if (refundAmount <= 0) throw new BadRequestException('Invalid refund amount');
    if (refundAmount > Number(order.totalAmount) + 0.009) {
      throw new BadRequestException('Refund exceeds order total');
    }

    const alreadyRefunded = order.refunds
      .filter((r) => r.status === RefundStatus.COMPLETED)
      .reduce((s, r) => s + Number(r.amount), 0);
    if (alreadyRefunded + refundAmount > Number(order.totalAmount) + 0.009) {
      throw new ConflictException('Refund would exceed remaining refundable amount');
    }

    const result = await this.banorte.refund(order.payment.externalId, refundAmount);
    const requestedBy = data.requestedBy ?? 'admin';
    const reasonCode = data.reasonCode ?? RefundReason.CUSTOMER_REQUEST;
    const notes = [
      data.notes,
      data.reason,
      data.idempotencyKey ? `idempotency:${data.idempotencyKey}` : null,
      result.error,
      result.success
        ? 'Refund completed via Banorte'
        : 'Pending manual Banorte portal refund — call POST /payments/refunds/:id/complete when done',
    ]
      .filter(Boolean)
      .join(' | ');

    const refund = await this.prisma.refund.create({
      data: {
        orderId: order.id,
        amount: refundAmount,
        reason: reasonCode,
        status: result.success ? RefundStatus.COMPLETED : RefundStatus.PENDING,
        requestedBy,
        processedAt: result.success ? new Date() : undefined,
        notes,
      },
    });

    await this.audit.log({
      action: result.success ? 'REFUND_COMPLETED' : 'REFUND_REQUESTED',
      entityType: 'Refund',
      entityId: refund.id,
      organizationId,
      userId: this.tenant.current().userId,
      metadata: {
        orderId: order.id,
        amount: refundAmount,
        banorteSuccess: result.success,
        banorteError: result.error,
        requestedBy,
        idempotencyKey: data.idempotencyKey ?? null,
      },
    });

    if (result.success) {
      const full =
        alreadyRefunded + refundAmount >= Number(order.totalAmount) - 0.009;
      await this.applyRefundInventory(order.id, organizationId, full);
    }

    return {
      refund,
      banorte: result,
      nextStep: result.success
        ? null
        : `Process refund in Banorte portal, then POST /api/v1/payments/refunds/${refund.id}/complete`,
    };
  }

  async completeManualRefund(
    refundId: string,
    processedBy: string,
    banorteReference?: string,
  ) {
    const refund = await this.prisma.refund.findFirst({
      where: { id: refundId },
      include: {
        order: { select: { id: true, organizationId: true, totalAmount: true, status: true } },
      },
    });
    if (!refund) throw new NotFoundException('Refund not found');
    const organizationId = this.resolveStaffOrganization(refund.order.organizationId);

    if (refund.status === RefundStatus.COMPLETED) {
      return { refund, alreadyCompleted: true };
    }

    const claimed = await this.prisma.refund.updateMany({
      where: { id: refundId, status: RefundStatus.PENDING },
      data: {
        status: RefundStatus.COMPLETED,
        processedBy,
        processedAt: new Date(),
        notes: [refund.notes, banorteReference ? `Banorte ref: ${banorteReference}` : null]
          .filter(Boolean)
          .join(' | '),
      },
    });
    if (claimed.count === 0) {
      const current = await this.prisma.refund.findFirst({ where: { id: refundId } });
      return { refund: current, alreadyCompleted: true };
    }

    const completedRefunds = await this.prisma.refund.aggregate({
      where: {
        orderId: refund.orderId,
        status: RefundStatus.COMPLETED,
      },
      _sum: { amount: true },
    });
    const refundedTotal = Number(completedRefunds._sum.amount ?? 0);
    const full = refundedTotal >= Number(refund.order.totalAmount) - 0.009;
    await this.applyRefundInventory(refund.orderId, organizationId, full);

    await this.audit.log({
      action: 'REFUND_MANUAL_COMPLETED',
      entityType: 'Refund',
      entityId: refundId,
      organizationId,
      userId: this.tenant.current().userId,
      metadata: { processedBy, banorteReference },
    });

    const updated = await this.prisma.refund.findFirst({ where: { id: refundId } });
    return { refund: updated, inventoryReleased: true };
  }

  private async applyRefundInventory(
    orderId: string,
    organizationId: string,
    fullRefund: boolean,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, organizationId },
        select: { id: true, status: true, eventId: true },
      });
      if (!order) throw new NotFoundException('Order not found');
      if (order.status === OrderStatus.REFUNDED) return;

      await tx.order.updateMany({
        where: {
          id: orderId,
          organizationId,
          status: { in: [OrderStatus.COMPLETED, OrderStatus.PARTIALLY_REFUNDED] },
        },
        data: {
          status: fullRefund ? OrderStatus.REFUNDED : OrderStatus.PARTIALLY_REFUNDED,
          refundedAt: new Date(),
        },
      });

      if (!fullRefund) return;

      const items = await tx.orderItem.findMany({
        where: { orderId },
        select: { id: true, offerId: true, quantity: true },
      });
      const itemIds = items.map((i) => i.id);

      for (const item of items) {
        const released = await tx.ticket.updateMany({
          where: {
            orderItemId: item.id,
            eventId: order.eventId,
            status: { in: [TicketStatus.SOLD, TicketStatus.USED] },
          },
          data: {
            status: TicketStatus.AVAILABLE,
            orderItemId: null,
            buyerName: null,
            buyerEmail: null,
            checkedInAt: null,
            usedAt: null,
          },
        });
        if (released.count > 0) {
          await tx.offer.update({
            where: { id: item.offerId },
            data: {
              soldQuantity: { decrement: released.count },
              remainingQuantity: { increment: released.count },
            },
          });
        }
      }

      if (itemIds.length === 0) {
        // no-op — order had no line items
      }

      await tx.paymentIntent.updateMany({
        where: {
          orderId,
          status: { in: [PaymentStatus.PENDING, PaymentStatus.COMPLETED] },
        },
        data: { status: PaymentStatus.REFUNDED },
      });
    });
  }

  async handleBanorteWebhook(payload: unknown, signature?: string) {
    let result;
    try {
      result = await this.banorte.handleWebhook!(payload, signature);
    } catch (error) {
      this.logger.warn(`Banorte webhook rejected: ${error instanceof Error ? error.message : error}`);
      throw new BadRequestException('Invalid Banorte webhook');
    }

    if (!result.orderId) {
      this.logger.warn('Banorte webhook without orderId');
      return { received: true };
    }

    // Exact match on order id or publicId — never substring contains().
    let order = await this.prisma.order.findFirst({
      where: { id: result.orderId },
      select: { id: true, organizationId: true, status: true },
    });
    if (!order) {
      order = await this.prisma.order.findFirst({
        where: { publicId: String(result.orderId) },
        select: { id: true, organizationId: true, status: true },
      });
    }

    if (!order) {
      this.logger.warn(`Banorte webhook: order not found ${result.orderId}`);
      return { received: true };
    }

    if (result.status === 'completed') {
      await this.completeOrder(order.id, result.intentId ?? `banorte_${order.id}`);
    } else if (result.status === 'failed') {
      await this.prisma.order.updateMany({
        where: {
          id: order.id,
          organizationId: order.organizationId,
          status: OrderStatus.PENDING,
        },
        data: { status: OrderStatus.FAILED },
      });
      await this.audit.log({
        action: 'payment.order.failed',
        entityType: 'Order',
        entityId: order.id,
        organizationId: order.organizationId,
        metadata: { source: 'banorte_webhook' },
      });
    }

    return { received: true, status: result.status };
  }

  getBanortePublicConfig() {
    const cfg = getBanorteConfig();
    const validation = validateBanorteProductionConfig();
    const ipn = getBanorteIpnEndpoints();
    const demo = cfg.isDemo;
    return {
      gateway: 'BANORTE',
      demo,
      mode: demo ? ('demo' as const) : ('live' as const),
      productionReady: validation.ready && !demo,
      methods: ['CARD', 'SPEI', 'OXXO'],
      settlement: demo
        ? 'Modo demo — no hay cobro real ni liquidación Banorte'
        : 'Depósito directo en cuenta Banorte empresarial del promotor',
      buyerNote: demo
        ? 'Entorno de prueba: puedes completar el flujo sin cargo real. No uses datos de tarjeta reales.'
        : 'El cobro se procesa con Banorte Payworks / SPEI / OXXO hacia la cuenta del promotor.',
      accountClabeMasked:
        !demo && cfg.accountClabe
          ? `${cfg.accountClabe.slice(0, 4)}…${cfg.accountClabe.slice(-4)}`
          : null,
      validation: {
        ready: validation.ready,
        demo: validation.demo,
        missing: validation.missing,
        warnings: validation.warnings,
      },
      ipn: {
        webhookUrl: ipn.webhookUrl,
        returnUrlBase: ipn.returnUrlBase,
        cancelUrl: ipn.cancelUrl,
        webhookSecretConfigured: ipn.webhookSecretConfigured,
        signatureHeaders: [...ipn.signatureHeaders],
      },
    };
  }

  validateBanorteSetup() {
    // Staff-only: require a tenant (or privileged) context.
    const ctx = this.tenant.current();
    if (!ctx.privileged) {
      this.tenant.requireOrganization();
    }
    const validation = validateBanorteProductionConfig();
    const ipn = getBanorteIpnEndpoints();
    return {
      ...validation,
      checkedAt: new Date().toISOString(),
      ipn: {
        webhookUrl: ipn.webhookUrl,
        returnUrlBase: ipn.returnUrlBase,
        cancelUrl: ipn.cancelUrl,
        webhookSecretConfigured: ipn.webhookSecretConfigured,
        signatureHeaders: [...ipn.signatureHeaders],
        registerHint:
          'Registra la URL IPN en el portal Banorte Payworks y firma con BANORTE_WEBHOOK_SECRET.',
      },
    };
  }
}
