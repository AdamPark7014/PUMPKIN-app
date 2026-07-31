import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  OrderStatus,
  Prisma,
  RefundReason,
  RefundStatus,
  TicketStatus,
} from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutService } from './checkout.service';
import { ManagerPinService } from './manager-pin.service';
import { PosAccessService } from './pos-access.service';
import { asPosOps, idempotencyKeyForVoid } from './types';

@Injectable()
export class VoidRefundService {
  private readonly logger = new Logger(VoidRefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PosAccessService,
    private readonly managerPin: ManagerPinService,
    private readonly checkout: CheckoutService,
    private readonly audit: AuditService,
    private readonly tenant: TenantContextService,
  ) {}

  async voidOrder(data: {
    orderId: string;
    sessionId?: string;
    cashierId?: string;
    reason?: string;
    managerPin?: string;
  }) {
    const actorId = this.access.actorUserId();
    const cashierId = data.cashierId || actorId;
    const order = await this.access.requireTaquillaOrder(data.orderId);
    this.access.assertCashierOwnsOrder(order, cashierId);
    this.access.assertVoidableStatus(order.status);

    await this.managerPin.assertManagerPin(order.organizationId, data.managerPin);

    if (data.sessionId) {
      const session = await this.access.requireActiveSession(
        data.sessionId,
        order.organizationId,
      );
      if (order.createdAt < session.startedAt) {
        throw new BadRequestException('Can only void sales from the current shift');
      }
    }

    const reason = data.reason?.trim() || 'Void desde taquilla';
    const voidKey = idempotencyKeyForVoid(order.organizationId, order.id, reason);

    const existingRefund = order.refunds.find(
      (refund) => refund.status === RefundStatus.COMPLETED,
    );
    if (existingRefund || order.status === OrderStatus.REFUNDED || order.status === OrderStatus.CANCELLED) {
      return {
        orderId: order.id,
        publicId: order.publicId,
        status: order.status === OrderStatus.PENDING ? OrderStatus.CANCELLED : order.status,
        idempotent: true,
      };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE
      `;

      const locked = await tx.order.findUnique({
        where: { id: order.id },
        include: {
          items: { include: { tickets: true } },
          refunds: { select: { id: true, status: true } },
        },
      });
      if (!locked) throw new BadRequestException('Order not found');

      if (
        locked.status === OrderStatus.REFUNDED ||
        locked.status === OrderStatus.CANCELLED ||
        locked.refunds.some((refund) => refund.status === RefundStatus.COMPLETED)
      ) {
        return {
          orderId: locked.id,
          publicId: locked.publicId,
          status: locked.status,
          idempotent: true as const,
        };
      }

      if (
        locked.status !== OrderStatus.COMPLETED &&
        locked.status !== OrderStatus.PENDING
      ) {
        throw new ConflictException(`Cannot void order in status ${locked.status}`);
      }

      const statusAfter =
        locked.status === OrderStatus.COMPLETED
          ? OrderStatus.REFUNDED
          : OrderStatus.CANCELLED;

      const prevOps = asPosOps(locked.posOps);
      const posOps = {
        ...prevOps,
        voidReason: reason,
        voidedAt: new Date().toISOString(),
        voidedBy: cashierId,
        voidIdempotencyKey: voidKey,
      };

      const updated = await tx.order.updateMany({
        where: {
          id: locked.id,
          status: { in: [OrderStatus.COMPLETED, OrderStatus.PENDING] },
        },
        data: {
          status: statusAfter,
          refundedAt: statusAfter === OrderStatus.REFUNDED ? new Date() : undefined,
          posOps: posOps as Prisma.InputJsonValue,
        },
      });
      if (updated.count === 0) {
        throw new ConflictException('Order was modified concurrently');
      }

      for (const item of locked.items) {
        for (const ticket of item.tickets) {
          if (ticket.status === TicketStatus.SOLD || ticket.status === TicketStatus.HELD) {
            await tx.ticket.updateMany({
              where: {
                id: ticket.id,
                status: { in: [TicketStatus.SOLD, TicketStatus.HELD] },
              },
              data: { status: TicketStatus.AVAILABLE, orderItemId: null },
            });
          }
        }
        if (item.offerId) {
          await tx.offer.update({
            where: { id: item.offerId },
            data: {
              soldQuantity: { decrement: item.quantity },
              remainingQuantity: { increment: item.quantity },
            },
          });
        }
      }

      if (locked.status === OrderStatus.COMPLETED && Number(locked.totalAmount) > 0) {
        await tx.refund.create({
          data: {
            orderId: locked.id,
            amount: locked.totalAmount,
            reason: RefundReason.CUSTOMER_CHANGED_MIND,
            status: RefundStatus.COMPLETED,
            notes: reason,
            requestedBy: cashierId,
            processedBy: actorId,
            processedAt: new Date(),
          },
        });
      }

      return {
        orderId: locked.id,
        publicId: locked.publicId,
        status: statusAfter,
        idempotent: false as const,
      };
    });

    await this.audit.log({
      action: 'pos.void',
      entityType: 'Order',
      entityId: order.id,
      organizationId: order.organizationId,
      userId: actorId,
      metadata: {
        publicId: order.publicId,
        reason,
        nextStatus: result.status,
        idempotent: result.idempotent,
      },
    });

    this.logger.log(`POS void ${order.publicId}: ${reason}`);
    return {
      orderId: result.orderId,
      publicId: result.publicId,
      status: result.status,
    };
  }

  async exchange(data: {
    orderId: string;
    sessionId: string;
    terminalId: string;
    cashierId: string;
    newOfferId?: string;
    newSeatIds?: string[];
    quantity?: number;
    paymentMethod: 'CASH' | 'CARD';
    managerPin?: string;
  }) {
    const old = await this.access.requireTaquillaOrder(data.orderId);
    if (old.status !== OrderStatus.COMPLETED) {
      throw new BadRequestException('Completed order required');
    }
    await this.managerPin.assertManagerPin(old.organizationId, data.managerPin);

    const voided = await this.voidOrder({
      orderId: old.id,
      sessionId: data.sessionId,
      cashierId: data.cashierId || this.access.actorUserId(),
      reason: 'Exchange / upgrade',
      managerPin: data.managerPin,
    });

    const offerId = data.newOfferId || old.items[0]?.offerId;
    if (!offerId) throw new BadRequestException('Offer required for exchange');

    const clientSaleId = `exch-${old.id}-${voided.orderId}`;
    const result = await this.checkout.quickCheckout(data.terminalId, data.sessionId, {
      eventId: old.eventId,
      offerId,
      seatIds: data.newSeatIds,
      quantity:
        data.quantity ||
        data.newSeatIds?.length ||
        old.items.reduce((sum, item) => sum + item.quantity, 0),
      paymentMethod: data.paymentMethod,
      cashierId: data.cashierId || this.access.actorUserId(),
      buyerName: old.buyerName,
      buyerEmail: old.buyerEmail,
      buyerPhone: old.buyerPhone || undefined,
      clientSaleId,
    });

    await this.audit.log({
      action: 'pos.exchange',
      entityType: 'Order',
      entityId: result.orderId,
      organizationId: old.organizationId,
      userId: this.tenant.current().userId,
      metadata: {
        exchangedFrom: old.publicId,
        newPublicId: result.publicId,
        previousTotal: Number(old.totalAmount),
        delta: result.total - Number(old.totalAmount),
      },
    });

    return {
      ...result,
      exchangedFrom: old.publicId,
      previousTotal: Number(old.totalAmount),
      delta: result.total - Number(old.totalAmount),
    };
  }
}
