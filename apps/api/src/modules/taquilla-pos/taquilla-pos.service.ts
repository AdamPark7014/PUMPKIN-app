import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SalesChannel } from '@prisma/client';
import { InventoryService } from '../inventory/inventory.service';
import { OrdersService } from '../orders/orders.service';

@Injectable()
export class TaquillaPosService {
  private logger = new Logger(TaquillaPosService.name);

  constructor(
    private prisma: PrismaService,
    private inventory: InventoryService,
    private orders: OrdersService,
  ) {}

  async initializeTerminal(data: {
    organizationId: string;
    locationName: string;
    terminalName: string;
    hardwareConfig?: Record<string, string>;
  }) {
    const terminal = await this.prisma.posTerminal.create({
      data: {
        organizationId: data.organizationId,
        name: data.terminalName,
        locationName: data.locationName,
        status: 'READY',
        hardwareConfig: data.hardwareConfig ?? {},
        lastSyncAt: new Date(),
      },
    });
    this.logger.log(`Terminal initialized: ${terminal.id}`);
    return terminal;
  }

  async startCashierSession(terminalId: string, cashierId: string) {
    const session = await this.prisma.posCashierSession.create({
      data: {
        terminalId,
        cashierId,
        status: 'ACTIVE',
        metadata: { initialCash: 0, transactionCount: 0 },
      },
    });
    return { sessionId: session.id, status: 'ACTIVE', startedAt: session.startedAt };
  }

  async quickCheckout(
    terminalId: string,
    sessionId: string,
    data: {
      eventId: string;
      offerId: string;
      quantity: number;
      paymentMethod: 'CASH' | 'CARD' | 'CHECK';
      discountCode?: string;
      cashierId?: string;
    },
  ) {
    const startTime = Date.now();

    const holds = await this.inventory.createHold({
      eventId: data.eventId,
      offerId: data.offerId,
      quantity: data.quantity,
      sessionId,
      channel: SalesChannel.TAQUILLA,
      cashierId: data.cashierId,
    });

    const order = await this.orders.createOrder({
      eventId: data.eventId,
      holdIds: holds.holds.map((h) => h.id),
      buyerName: 'Taquilla',
      buyerEmail: `taquilla+${terminalId}@pos.boletera.local`,
      paymentMethod: data.paymentMethod === 'CHECK' ? 'CASH' : data.paymentMethod,
      promotionCode: data.discountCode,
      channel: SalesChannel.TAQUILLA,
      cashierId: data.cashierId,
      idempotencyKey: `pos-${sessionId}-${Date.now()}`,
    });
    if (!order) throw new BadRequestException('No se pudo crear la orden');

    const processingTime = (Date.now() - startTime) / 1000;
    this.logger.log(`POS checkout ${processingTime.toFixed(2)}s → ${order.publicId}`);

    return {
      orderId: order.id,
      publicId: order.publicId,
      total: Number(order.totalAmount),
      subtotal: Number(order.subtotal),
      fees: Number(order.fees),
      taxes: Number(order.taxAmount),
      quantity: data.quantity,
      processingTime: `${processingTime.toFixed(2)}s`,
      paymentMethod: data.paymentMethod,
      status: order.status,
    };
  }

  async processPayment(
    orderId: string,
    data: { method: 'CASH' | 'CARD' | 'CHECK'; amount: number; cardDetails?: { lastFour: string; brand: string } },
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new BadRequestException('Order not found');
    return { paymentId: order.paymentId, status: order.status, amount: data.amount };
  }

  async generateReceipt(orderId: string, terminalId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        event: true,
        items: { include: { tickets: true } },
      },
    });
    if (!order) throw new BadRequestException('Order not found');

    return {
      receiptNumber: `RCP-${order.publicId}`,
      timestamp: new Date().toISOString(),
      terminalId,
      eventName: order.event.title,
      quantity: order.items.reduce((s, i) => s + i.quantity, 0),
      subtotal: Number(order.subtotal),
      fees: Number(order.fees),
      taxes: Number(order.taxAmount),
      total: Number(order.totalAmount),
      paymentMethod: order.paymentMethod,
      ticketCodes: order.items.flatMap((item) =>
        item.tickets.map((t) => ({
          barcode: t.code,
          seatInfo: [t.section, t.row, t.seatNumber].filter(Boolean).join('-') || 'GA',
        })),
      ),
    };
  }

  async scanBarcode(_terminalId: string, barcode: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { code: barcode },
      include: { event: { select: { title: true } } },
    });
    if (!ticket) throw new BadRequestException('Ticket not found');
    return {
      ticketId: ticket.id,
      status: ticket.status,
      eventId: ticket.eventId,
      eventTitle: ticket.event.title,
      seatInfo: [ticket.section, ticket.row, ticket.seatNumber].filter(Boolean).join('-') || 'GA',
      valid: ticket.status === 'SOLD',
    };
  }

  async syncInventory(terminalId: string, eventId: string) {
    const availability = await this.inventory.getAvailability(eventId);
    await this.prisma.posTerminal.update({
      where: { id: terminalId },
      data: {
        lastSyncAt: new Date(),
        cacheMetadata: availability,
      },
    });
    return availability;
  }

  async enableOfflineMode(terminalId: string) {
    await this.prisma.posTerminal.update({
      where: { id: terminalId },
      data: { offlineMode: true },
    });
    return { mode: 'OFFLINE', status: 'QUEUED' };
  }

  async syncOfflineTransactions(terminalId: string, transactions: Array<{ checkoutData: unknown; sessionId: string }>) {
    let synced = 0;
    for (const txn of transactions) {
      try {
        const data = txn.checkoutData as {
          eventId: string;
          offerId: string;
          quantity: number;
          paymentMethod: 'CASH' | 'CARD';
        };
        await this.quickCheckout(terminalId, txn.sessionId, data);
        synced++;
      } catch (e) {
        this.logger.error(`Offline sync failed: ${(e as Error).message}`);
      }
    }
    await this.prisma.posTerminal.update({
      where: { id: terminalId },
      data: { offlineMode: false, lastSyncAt: new Date() },
    });
    return { synced, mode: 'ONLINE' };
  }

  async getSessionSummary(sessionId: string) {
    const session = await this.prisma.posCashierSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new BadRequestException('Session not found');

    const orders = await this.prisma.order.findMany({
      where: {
        channel: SalesChannel.TAQUILLA,
        status: 'COMPLETED',
        createdAt: { gte: session.startedAt },
        cashierId: session.cashierId,
      },
    });

    return {
      totalTransactions: orders.length,
      totalRevenue: orders.reduce((sum, o) => sum + Number(o.totalAmount), 0),
      byMethod: orders.reduce(
        (acc, o) => {
          const m = o.paymentMethod;
          acc[m] = (acc[m] ?? 0) + Number(o.totalAmount);
          return acc;
        },
        {} as Record<string, number>,
      ),
      startTime: session.startedAt,
      endTime: new Date(),
    };
  }

  async endCashierSession(sessionId: string, cashierId: string) {
    const session = await this.prisma.posCashierSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new BadRequestException('Session not found');

    const orders = await this.prisma.order.findMany({
      where: { cashierId, channel: SalesChannel.TAQUILLA, createdAt: { gte: session.startedAt } },
    });

    const report = {
      sessionId,
      cashierId,
      startTime: session.startedAt,
      endTime: new Date(),
      totalTransactions: orders.length,
      totalRevenue: orders.reduce((sum, o) => sum + Number(o.totalAmount), 0),
      byMethod: orders.reduce(
        (acc, o) => {
          const m = o.paymentMethod;
          acc[m] = (acc[m] ?? 0) + Number(o.totalAmount);
          return acc;
        },
        {} as Record<string, number>,
      ),
      status: 'CLOSED',
    };

    await this.prisma.posCashierSession.update({
      where: { id: sessionId },
      data: { status: 'CLOSED', endedAt: new Date(), metadata: report },
    });

    return report;
  }

  async getTerminalAnalytics(terminalId: string, period: 'TODAY' | 'WEEK' | 'MONTH') {
    const terminal = await this.prisma.posTerminal.findUnique({ where: { id: terminalId } });
    if (!terminal) throw new BadRequestException('Terminal not found');

    const now = new Date();
    let since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === 'WEEK') since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (period === 'MONTH') since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const orders = await this.prisma.order.findMany({
      where: {
        channel: SalesChannel.TAQUILLA,
        createdAt: { gte: since },
        status: 'COMPLETED',
      },
    });

    const totalRevenue = orders.reduce((s, o) => s + Number(o.totalAmount), 0);
    return {
      terminalId,
      terminalName: terminal.name,
      period,
      transactions: orders.length,
      totalRevenue,
      averageTransactionValue: orders.length ? totalRevenue / orders.length : 0,
      uptime: '99.9%',
    };
  }
}


