import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { PosAccessService } from './pos-access.service';
import { asPosOps, seatLabel, WILLCALL_PAGE_SIZE } from './types';

@Injectable()
export class WillcallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PosAccessService,
    private readonly audit: AuditService,
    private readonly tenant: TenantContextService,
  ) {}

  async willcallLookup(q: string, organizationId?: string) {
    const needle = q.trim();
    if (!needle) throw new BadRequestException('Query required');

    const orgId = this.access.resolveOrganizationId(organizationId);

    const orders = await this.prisma.order.findMany({
      where: {
        organizationId: orgId,
        status: OrderStatus.COMPLETED,
        OR: [
          { publicId: { contains: needle, mode: 'insensitive' } },
          { buyerEmail: { contains: needle, mode: 'insensitive' } },
          { buyerName: { contains: needle, mode: 'insensitive' } },
          { items: { some: { tickets: { some: { code: needle } } } } },
        ],
      },
      take: WILLCALL_PAGE_SIZE,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        publicId: true,
        buyerName: true,
        buyerEmail: true,
        totalAmount: true,
        channel: true,
        posOps: true,
        event: { select: { id: true, title: true, startsAt: true } },
        items: {
          select: {
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

    return orders.map((order) => {
      const ops = asPosOps(order.posOps);
      return {
        orderId: order.id,
        publicId: order.publicId,
        buyerName: order.buyerName,
        buyerEmail: order.buyerEmail,
        total: Number(order.totalAmount),
        eventTitle: order.event.title,
        eventStartsAt: order.event.startsAt,
        channel: order.channel,
        pickedUpAt: ops.pickedUpAt || null,
        pickedUpBy: ops.pickedUpBy || null,
        tickets: order.items.flatMap((item) =>
          item.tickets.map((ticket) => ({
            code: ticket.code,
            status: ticket.status,
            seatInfo: seatLabel(ticket.section, ticket.row, ticket.seatNumber),
          })),
        ),
      };
    });
  }

  async willcallFulfill(orderId: string, cashierId: string, terminalId?: string) {
    const actorId = this.access.actorUserId();
    const order = await this.access.requireOrder(orderId);
    if (order.status !== OrderStatus.COMPLETED) {
      throw new BadRequestException('Completed order required');
    }

    if (terminalId) {
      await this.access.requireTerminal(terminalId, order.organizationId);
    }

    const prev = asPosOps(order.posOps);
    if (prev.pickedUpAt) {
      return {
        orderId: order.id,
        publicId: order.publicId,
        pickedUpAt: prev.pickedUpAt,
        pickedUpBy: prev.pickedUpBy,
        pickupTerminalId: prev.pickupTerminalId,
        idempotent: true as const,
      };
    }

    const posOps = {
      ...prev,
      pickedUpAt: new Date().toISOString(),
      pickedUpBy: cashierId || actorId,
      pickupTerminalId: terminalId,
    };

    await this.prisma.order.update({
      where: { id: order.id },
      data: { posOps: posOps as Prisma.InputJsonValue },
    });

    await this.audit.log({
      action: 'pos.willcall.fulfill',
      entityType: 'Order',
      entityId: order.id,
      organizationId: order.organizationId,
      userId: actorId,
      metadata: { publicId: order.publicId, terminalId },
    });

    return { orderId: order.id, publicId: order.publicId, ...posOps };
  }

  async generateReceipt(orderId: string, terminalId: string) {
    const order = await this.access.requireOrder(orderId);
    if (terminalId && terminalId !== 'terminal') {
      await this.access.requireTerminal(terminalId, order.organizationId);
    }

    const venue = order.event.venue;
    const venueLabel = [venue?.name, venue?.city].filter(Boolean).join(' · ') || null;
    const startsAt = order.event.startsAt
      ? new Date(order.event.startsAt).toISOString()
      : null;

    return {
      receiptNumber: `RCP-${order.publicId}`,
      orderId: order.id,
      /** Localizador de orden — lo que el cliente/staff busca en will-call. */
      publicId: order.publicId,
      localizador: order.publicId,
      timestamp: new Date().toISOString(),
      terminalId,
      eventName: order.event.title,
      eventStartsAt: startsAt,
      venueLabel,
      buyerName: order.buyerName,
      quantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
      subtotal: Number(order.subtotal),
      fees: Number(order.fees),
      taxes: Number(order.taxAmount),
      total: Number(order.totalAmount),
      paymentMethod: order.paymentMethod,
      ticketCodes: order.items.flatMap((item) =>
        item.tickets.map((ticket) => ({
          barcode: ticket.code,
          seatInfo: seatLabel(ticket.section, ticket.row, ticket.seatNumber),
        })),
      ),
    };
  }

  async scanBarcode(terminalId: string, barcode: string) {
    const organizationId = this.access.resolveOrganizationId();
    if (terminalId && terminalId !== 'unknown') {
      await this.access.requireTerminal(terminalId, organizationId);
    }

    const trimmed = barcode.trim();
    if (!trimmed) throw new BadRequestException('Barcode required');

    const ticket = await this.prisma.ticket.findFirst({
      where: {
        OR: [{ code: trimmed }, { id: trimmed }],
        event: { organizationId },
      },
      select: {
        id: true,
        status: true,
        eventId: true,
        section: true,
        row: true,
        seatNumber: true,
        event: { select: { title: true } },
        orderItem: {
          select: {
            order: {
              select: {
                id: true,
                publicId: true,
                paymentMethod: true,
                totalAmount: true,
                status: true,
                cashierId: true,
                organizationId: true,
              },
            },
          },
        },
      },
    });

    if (ticket) {
      if (ticket.orderItem?.order) {
        this.tenant.assertOrganization(ticket.orderItem.order.organizationId);
      }
      return {
        ticketId: ticket.id,
        status: ticket.status,
        eventId: ticket.eventId,
        eventTitle: ticket.event.title,
        seatInfo: seatLabel(ticket.section, ticket.row, ticket.seatNumber),
        valid: ticket.status === 'SOLD',
        orderId: ticket.orderItem?.order?.id,
        publicId: ticket.orderItem?.order?.publicId,
        paymentMethod: ticket.orderItem?.order?.paymentMethod,
        total: ticket.orderItem?.order
          ? Number(ticket.orderItem.order.totalAmount)
          : undefined,
      };
    }

    const order = await this.prisma.order.findFirst({
      where: {
        organizationId,
        OR: [{ publicId: trimmed }, { id: trimmed }],
      },
      select: {
        id: true,
        publicId: true,
        status: true,
        eventId: true,
        paymentMethod: true,
        totalAmount: true,
        organizationId: true,
        event: { select: { title: true } },
        items: {
          select: {
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
    if (!order) throw new BadRequestException('Ticket or order not found');
    this.tenant.assertOrganization(order.organizationId);

    const first = order.items.flatMap((item) => item.tickets)[0];
    return {
      ticketId: first?.id,
      status: order.status,
      eventId: order.eventId,
      eventTitle: order.event.title,
      seatInfo: 'ORDER',
      valid: order.status === OrderStatus.COMPLETED,
      orderId: order.id,
      publicId: order.publicId,
      paymentMethod: order.paymentMethod,
      total: Number(order.totalAmount),
      tickets: order.items.flatMap((item) =>
        item.tickets.map((ticket) => ({
          code: ticket.code,
          status: ticket.status,
          seatInfo: seatLabel(ticket.section, ticket.row, ticket.seatNumber),
        })),
      ),
    };
  }
}
