import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SalesChannel } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { InventoryService } from '../inventory/inventory.service';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { ManagerPinService } from './manager-pin.service';
import { PosAccessService } from './pos-access.service';
import { PosIdempotencyService } from './pos-idempotency.service';
import {
  mapPosPaymentMethod,
  type CheckoutResult,
  type HoldResult,
  type PosPaymentMethod,
} from './types';

type CheckoutInput = {
  eventId: string;
  offerId: string;
  quantity?: number;
  seatIds?: string[];
  paymentMethod: PosPaymentMethod;
  discountCode?: string;
  discountPercent?: number;
  cashierId?: string;
  buyerName?: string;
  buyerEmail?: string;
  buyerPhone?: string;
  isComp?: boolean;
  compReason?: string;
  managerPin?: string;
  clientSaleId?: string;
  holdIds?: string[];
};

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PosAccessService,
    private readonly inventory: InventoryService,
    private readonly orders: OrdersService,
    private readonly idempotency: PosIdempotencyService,
    private readonly managerPin: ManagerPinService,
    private readonly audit: AuditService,
    private readonly tenant: TenantContextService,
  ) {}

  async createPosHold(data: {
    terminalId: string;
    sessionId: string;
    eventId: string;
    offerId?: string;
    seatIds?: string[];
    quantity?: number;
    cashierId?: string;
  }): Promise<HoldResult> {
    const terminal = await this.access.requireTerminal(data.terminalId);
    await this.access.requireActiveSession(data.sessionId, terminal.organizationId);
    await this.access.requireEvent(data.eventId, terminal.organizationId);

    const result = await this.inventory.createHold({
      eventId: data.eventId,
      offerId: data.offerId,
      seatIds: data.seatIds,
      quantity: data.quantity,
      sessionId: data.sessionId,
      channel: SalesChannel.TAQUILLA,
      cashierId: data.cashierId || this.access.actorUserId(),
    });

    return {
      holdIds: result.holds.map((hold) => hold.id),
      expiresAt: result.expiresAt,
      ttlSeconds: Math.max(0, Math.floor((+result.expiresAt - Date.now()) / 1000)),
    };
  }

  async releaseHolds(holdIds: string[]) {
    if (!holdIds.length) return { released: 0 };

    const ctx = this.tenant.current();
    const holds = ctx.privileged
      ? await this.prisma.seatHold.findMany({
          where: { id: { in: holdIds } },
          select: { id: true, event: { select: { organizationId: true } } },
        })
      : await this.prisma.seatHold.findMany({
          where: {
            id: { in: holdIds },
            event: { organizationId: this.access.resolveOrganizationId() },
          },
          select: { id: true, event: { select: { organizationId: true } } },
        });

    const allowed = new Set<string>();
    for (const hold of holds) {
      this.tenant.assertOrganization(hold.event.organizationId);
      allowed.add(hold.id);
    }

    let released = 0;
    for (const id of holdIds) {
      if (!allowed.has(id)) continue;
      try {
        await this.inventory.releaseHold(id);
        released += 1;
      } catch {
        // already released / expired
      }
    }
    return { released };
  }

  async quickCheckout(
    terminalId: string,
    sessionId: string,
    data: CheckoutInput,
  ): Promise<CheckoutResult> {
    const startTime = Date.now();
    const terminal = await this.access.requireTerminal(terminalId);
    const session = await this.access.requireActiveSession(
      sessionId,
      terminal.organizationId,
    );
    const event = await this.access.requireEvent(data.eventId, terminal.organizationId);
    const actorId = this.access.actorUserId();
    const cashierId = data.cashierId || actorId;
    const isComp = Boolean(data.isComp || data.paymentMethod === 'COMP');

    if (isComp) {
      await this.managerPin.assertManagerPin(terminal.organizationId, data.managerPin);
    }

    const clientSaleId = data.clientSaleId?.trim() || randomUUID();
    const claim = await this.idempotency.claimSale(
      terminal.organizationId,
      clientSaleId,
      event.currency,
    );

    if (claim.alreadyExists) {
      return this.toCheckoutResult(claim.alreadyExists, data, isComp, startTime, new Date());
    }

    try {
      const holds = await this.resolveHolds(sessionId, cashierId, data, event.id);
      const buyerName =
        data.buyerName?.trim() || (isComp ? `Comp · ${data.compReason || 'house'}` : 'Taquilla');
      const buyerEmail =
        data.buyerEmail?.trim() || `taquilla+${terminal.id}@pos.boletera.local`;
      const paymentMethod = mapPosPaymentMethod(data.paymentMethod, isComp);

      const order = await this.orders.createOrder({
        eventId: data.eventId,
        offerId: data.offerId,
        holdIds: holds.holdIds,
        buyerName,
        buyerEmail,
        buyerPhone: data.buyerPhone,
        paymentMethod: paymentMethod === 'COMP' ? 'CASH' : paymentMethod,
        promotionCode: data.discountCode,
        channel: SalesChannel.TAQUILLA,
        cashierId,
        idempotencyKey: claim.key,
        isComp,
        compReason: data.compReason,
        posOps: {
          clientSaleId,
          terminalId: terminal.id,
          sessionId: session.id,
          seatIds: data.seatIds,
          discountPercent: data.discountPercent,
          ...(isComp ? { isComp: true, compReason: data.compReason || 'house' } : {}),
        },
      });
      if (!order?.id || !order.publicId) {
        throw new BadRequestException('No se pudo crear la orden');
      }

      const orderId = order.id;
      const publicId = order.publicId;
      const totalAmount = Number(order.totalAmount ?? 0);
      const subtotal = Number(order.subtotal ?? 0);
      const fees = Number(order.fees ?? 0);
      const taxes = Number(order.taxAmount ?? 0);
      const status = String(order.status ?? 'PENDING');

      await this.idempotency.bindSaleOrder(claim.key, orderId, totalAmount);

      await this.audit.log({
        action: 'pos.checkout',
        entityType: 'Order',
        entityId: orderId,
        organizationId: terminal.organizationId,
        userId: actorId,
        metadata: {
          publicId,
          clientSaleId,
          paymentMethod,
          isComp,
          terminalId: terminal.id,
          sessionId: session.id,
          totalAmount,
        },
      });

      const processingTime = (Date.now() - startTime) / 1000;
      this.logger.log(`POS checkout ${processingTime.toFixed(2)}s → ${publicId}`);

      return {
        orderId,
        publicId,
        total: totalAmount,
        subtotal,
        fees,
        taxes,
        quantity: data.seatIds?.length ?? data.quantity ?? holds.holdIds.length,
        processingTime: `${processingTime.toFixed(2)}s`,
        paymentMethod: isComp ? 'COMP' : data.paymentMethod,
        status,
        holdExpiresAt: holds.expiresAt,
        isComp,
      };
    } catch (error) {
      await this.idempotency.releaseClaim(claim.key);
      throw error;
    }
  }

  async syncOfflineTransactions(
    terminalId: string,
    transactions: Array<{
      checkoutData: CheckoutInput;
      sessionId: string;
      clientSaleId?: string;
    }>,
  ) {
    const terminal = await this.access.requireTerminal(terminalId);
    let synced = 0;
    const errors: string[] = [];

    for (const txn of transactions) {
      try {
        const clientSaleId = txn.clientSaleId || txn.checkoutData.clientSaleId;
        await this.quickCheckout(terminal.id, txn.sessionId, {
          ...txn.checkoutData,
          clientSaleId,
        });
        synced += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown sync error';
        errors.push(message);
        this.logger.error(`Offline sync failed: ${message}`);
      }
    }

    await this.prisma.posTerminal.update({
      where: { id: terminal.id },
      data: { offlineMode: false, lastSyncAt: new Date() },
    });

    await this.audit.log({
      action: 'pos.offline.sync',
      entityType: 'PosTerminal',
      entityId: terminal.id,
      organizationId: terminal.organizationId,
      userId: this.tenant.current().userId,
      metadata: { synced, failed: errors.length },
    });

    return {
      synced,
      failed: errors.length,
      errors,
      mode: 'ONLINE' as const,
    };
  }

  async processPayment(
    orderId: string,
    data: {
      method: 'CASH' | 'CARD' | 'CHECK';
      amount: number;
      cardDetails?: { lastFour: string; brand: string };
    },
  ) {
    const order = await this.access.requireOrder(orderId);
    if (order.status === 'COMPLETED') {
      return {
        paymentId: order.paymentId,
        status: order.status,
        amount: Number(order.totalAmount),
        legacy: true as const,
        note: 'Use POST /taquilla/checkout — payment is captured during order creation',
        method: data.method,
        requestedAmount: data.amount,
      };
    }
    throw new BadRequestException(
      'Order is not payable via legacy endpoint; use POST /taquilla/checkout',
    );
  }

  private async resolveHolds(
    sessionId: string,
    cashierId: string,
    data: CheckoutInput,
    eventId: string,
  ): Promise<{ holdIds: string[]; expiresAt: Date }> {
    if (data.holdIds?.length) {
      const { holds } = await this.access.requireActiveHolds(data.holdIds, eventId);
      return {
        holdIds: holds.map((hold) => hold.id),
        expiresAt: holds[0]?.expiresAt ?? new Date(),
      };
    }

    if (data.seatIds?.length) {
      const created = await this.inventory.createHold({
        eventId,
        offerId: data.offerId,
        seatIds: data.seatIds,
        sessionId,
        channel: SalesChannel.TAQUILLA,
        cashierId,
      });
      return {
        holdIds: created.holds.map((hold) => hold.id),
        expiresAt: created.expiresAt,
      };
    }

    const quantity = data.quantity ?? 1;
    if (quantity < 1) throw new BadRequestException('quantity must be >= 1');
    const created = await this.inventory.createHold({
      eventId,
      offerId: data.offerId,
      quantity,
      sessionId,
      channel: SalesChannel.TAQUILLA,
      cashierId,
    });
    return {
      holdIds: created.holds.map((hold) => hold.id),
      expiresAt: created.expiresAt,
    };
  }

  private toCheckoutResult(
    order: {
      id: string;
      publicId: string;
      totalAmount: { toString(): string } | number;
      subtotal: { toString(): string } | number;
      fees: { toString(): string } | number;
      taxAmount: { toString(): string } | number;
      status: string;
    },
    data: CheckoutInput,
    isComp: boolean,
    startTime: number,
    holdExpiresAt: Date,
  ): CheckoutResult {
    const processingTime = (Date.now() - startTime) / 1000;
    return {
      orderId: order.id,
      publicId: order.publicId,
      total: Number(order.totalAmount),
      subtotal: Number(order.subtotal),
      fees: Number(order.fees),
      taxes: Number(order.taxAmount),
      quantity: data.seatIds?.length ?? data.quantity ?? 0,
      processingTime: `${processingTime.toFixed(2)}s`,
      paymentMethod: isComp ? 'COMP' : data.paymentMethod,
      status: order.status,
      holdExpiresAt,
      isComp,
    };
  }
}
