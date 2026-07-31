import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TicketStatus, TransferStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { NotificationService } from '../notification/notification.service';

const TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export interface TransferActor {
  userId: string;
  email: string;
}

export interface InitiateTransferCommand {
  ticketId: string;
  toEmail: string;
  message?: string;
}

const transferSelection = {
  id: true,
  ticketId: true,
  fromUserId: true,
  toEmail: true,
  toUserId: true,
  transferCode: true,
  status: true,
  message: true,
  acceptedAt: true,
  expiresAt: true,
  createdAt: true,
} satisfies Prisma.TicketTransferSelect;

const listedTransferSelection = {
  ...transferSelection,
  ticket: {
    select: {
      id: true,
      code: true,
      section: true,
      row: true,
      seatNumber: true,
      event: { select: { id: true, title: true, startsAt: true } },
    },
  },
} satisfies Prisma.TicketTransferSelect;

@Injectable()
export class TicketTransferService {
  private readonly logger = new Logger(TicketTransferService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly tenant: TenantContextService,
  ) {}

  async initiate(actor: TransferActor, command: InitiateTransferCommand) {
    const toEmail = command.toEmail.trim().toLowerCase();
    if (toEmail === actor.email.trim().toLowerCase()) {
      throw new BadRequestException('No puedes transferirte un boleto a ti mismo');
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: command.ticketId },
      select: {
        id: true,
        status: true,
        event: {
          select: {
            id: true,
            title: true,
            organizationId: true,
            transferAllowed: true,
            nonTransferable: true,
          },
        },
        orderItem: { select: { order: { select: { userId: true } } } },
      },
    });

    if (!ticket) throw new NotFoundException('Ticket not found');
    this.assertTenantIfScoped(ticket.event.organizationId);

    if (ticket.status !== TicketStatus.SOLD) {
      throw new BadRequestException('Solo se pueden transferir boletos activos');
    }
    if (!ticket.event.transferAllowed || ticket.event.nonTransferable) {
      throw new BadRequestException('Este evento no permite transferencias');
    }

    const holderId = await this.resolveHolder(ticket.id, ticket.orderItem?.order.userId);
    if (holderId !== actor.userId) {
      throw new ForbiddenException('No eres el dueño de este boleto');
    }

    // Replaying the same request returns the live transfer instead of flooding
    // the recipient with a second code.
    const pending = await this.prisma.ticketTransfer.findFirst({
      where: { ticketId: ticket.id, status: TransferStatus.PENDING, expiresAt: { gt: new Date() } },
      select: transferSelection,
    });
    if (pending) {
      if (pending.toEmail === toEmail && pending.fromUserId === actor.userId) return pending;
      throw new ConflictException('Este boleto ya tiene una transferencia pendiente');
    }

    const transfer = await this.createTransfer(actor.userId, ticket.id, toEmail, command.message);

    const webUrl = process.env.WEB_URL || 'http://localhost:3000';
    await this.notifications.enqueueEmail({
      to: toEmail,
      subject: `Te transfirieron un boleto — ${ticket.event.title}`,
      template: 'ticket-transfer',
      data: {
        eventTitle: ticket.event.title,
        transferCode: transfer.transferCode,
        acceptUrl: `${webUrl}/cuenta?transfer=${transfer.transferCode}`,
        message: command.message,
      },
    });

    await this.audit.log({
      action: 'TICKET_TRANSFER_INITIATED',
      entityType: 'TicketTransfer',
      entityId: transfer.id,
      organizationId: ticket.event.organizationId,
      userId: actor.userId,
      metadata: { ticketId: ticket.id, toEmail },
    });

    return transfer;
  }

  async accept(transferCode: string, actor: TransferActor) {
    const transfer = await this.prisma.ticketTransfer.findUnique({
      where: { transferCode },
      select: {
        ...transferSelection,
        ticket: { select: { id: true, status: true, event: { select: { organizationId: true } } } },
      },
    });

    if (!transfer) throw new NotFoundException('Transferencia no encontrada');
    this.assertTenantIfScoped(transfer.ticket.event.organizationId);

    const actorEmail = actor.email.trim().toLowerCase();
    if (actorEmail !== transfer.toEmail) {
      throw new ForbiddenException('El email de tu cuenta no coincide con la transferencia');
    }

    // A retried accept from the same recipient is answered with the original outcome.
    if (transfer.status === TransferStatus.ACCEPTED && transfer.toUserId === actor.userId) {
      return { ok: true as const, ticket: await this.loadTicketSummary(transfer.ticketId) };
    }
    if (transfer.status !== TransferStatus.PENDING) {
      throw new ConflictException('Esta transferencia ya fue procesada');
    }
    if (transfer.expiresAt <= new Date()) {
      await this.prisma.ticketTransfer.updateMany({
        where: { id: transfer.id, status: TransferStatus.PENDING },
        data: { status: TransferStatus.EXPIRED },
      });
      throw new BadRequestException('La transferencia expiró');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { email: true, firstName: true, lastName: true },
    });
    if (!user || user.email.trim().toLowerCase() !== transfer.toEmail) {
      throw new ForbiddenException('El email de tu cuenta no coincide con la transferencia');
    }

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      // Claim the transfer first: only one concurrent accept can flip PENDING.
      const claimed = await tx.ticketTransfer.updateMany({
        where: { id: transfer.id, status: TransferStatus.PENDING, expiresAt: { gt: now } },
        data: { status: TransferStatus.ACCEPTED, acceptedAt: now, toUserId: actor.userId },
      });
      if (claimed.count === 0) {
        throw new ConflictException('Esta transferencia ya fue procesada');
      }

      // The ticket must still be sellable: a checked-in or refunded ticket never moves.
      const moved = await tx.ticket.updateMany({
        where: { id: transfer.ticketId, status: TicketStatus.SOLD },
        data: {
          buyerEmail: user.email,
          buyerName: `${user.firstName} ${user.lastName}`.trim(),
        },
      });
      if (moved.count === 0) {
        throw new ConflictException('El boleto ya no está disponible para transferencia');
      }

      // Any other outstanding offer on the same ticket dies with this acceptance.
      await tx.ticketTransfer.updateMany({
        where: {
          ticketId: transfer.ticketId,
          status: TransferStatus.PENDING,
          id: { not: transfer.id },
        },
        data: { status: TransferStatus.CANCELLED },
      });
    });

    await this.audit.log({
      action: 'TICKET_TRANSFER_ACCEPTED',
      entityType: 'TicketTransfer',
      entityId: transfer.id,
      organizationId: transfer.ticket.event.organizationId,
      userId: actor.userId,
      metadata: { ticketId: transfer.ticketId, fromUserId: transfer.fromUserId },
    });

    return { ok: true as const, ticket: await this.loadTicketSummary(transfer.ticketId) };
  }

  async listByUser(actor: TransferActor, page: { limit?: number; offset?: number }) {
    const take = Math.min(Math.max(page.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const skip = Math.max(page.offset ?? 0, 0);
    const email = actor.email.trim().toLowerCase();

    const [sent, received] = await Promise.all([
      this.prisma.ticketTransfer.findMany({
        where: { fromUserId: actor.userId },
        select: listedTransferSelection,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.ticketTransfer.findMany({
        where: { toEmail: email },
        select: listedTransferSelection,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
    ]);

    return { sent, received };
  }

  async cancel(transferId: string, actor: TransferActor) {
    const transfer = await this.prisma.ticketTransfer.findUnique({
      where: { id: transferId },
      select: {
        ...transferSelection,
        ticket: { select: { event: { select: { organizationId: true } } } },
      },
    });
    if (!transfer || transfer.fromUserId !== actor.userId) {
      throw new NotFoundException('Transferencia no encontrada');
    }
    this.assertTenantIfScoped(transfer.ticket.event.organizationId);

    // Retrying a cancel that already landed is not an error.
    if (transfer.status === TransferStatus.CANCELLED) {
      return this.prisma.ticketTransfer.findUniqueOrThrow({
        where: { id: transferId },
        select: transferSelection,
      });
    }

    const result = await this.prisma.ticketTransfer.updateMany({
      where: { id: transferId, fromUserId: actor.userId, status: TransferStatus.PENDING },
      data: { status: TransferStatus.CANCELLED },
    });
    if (result.count === 0) {
      throw new ConflictException('Esta transferencia ya fue procesada');
    }

    await this.audit.log({
      action: 'TICKET_TRANSFER_CANCELLED',
      entityType: 'TicketTransfer',
      entityId: transferId,
      organizationId: transfer.ticket.event.organizationId,
      userId: actor.userId,
      metadata: { ticketId: transfer.ticketId },
    });

    return this.prisma.ticketTransfer.findUniqueOrThrow({
      where: { id: transferId },
      select: transferSelection,
    });
  }

  // ==================== INTERNALS ====================

  /**
   * Serializable so two concurrent initiations cannot both observe "no pending
   * transfer" and mint two live codes for the same ticket.
   */
  private async createTransfer(
    fromUserId: string,
    ticketId: string,
    toEmail: string,
    message?: string,
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const conflicting = await tx.ticketTransfer.findFirst({
            where: { ticketId, status: TransferStatus.PENDING, expiresAt: { gt: new Date() } },
            select: { id: true },
          });
          if (conflicting) {
            throw new ConflictException('Este boleto ya tiene una transferencia pendiente');
          }
          const stillSold = await tx.ticket.findFirst({
            where: { id: ticketId, status: TicketStatus.SOLD },
            select: { id: true },
          });
          if (!stillSold) {
            throw new ConflictException('El boleto ya no está disponible para transferencia');
          }
          return tx.ticketTransfer.create({
            data: {
              ticketId,
              fromUserId,
              toEmail,
              transferCode: this.generateCode(),
              message: message && message.length > 0 ? message : undefined,
              expiresAt: new Date(Date.now() + TRANSFER_TTL_MS),
            },
            select: transferSelection,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (this.isWriteConflict(error)) {
        this.logger.warn(`Serialization conflict initiating transfer for ticket ${ticketId}`);
        throw new ConflictException('Este boleto ya tiene una transferencia pendiente');
      }
      throw error;
    }
  }

  private isWriteConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2034' || error.code === 'P2002')
    );
  }

  private generateCode(): string {
    return `TRF-${randomBytes(8).toString('hex').toUpperCase()}`;
  }

  /** The holder is the buyer of the order unless an accepted transfer moved the ticket. */
  private async resolveHolder(
    ticketId: string,
    orderUserId: string | undefined,
  ): Promise<string | undefined> {
    const accepted = await this.prisma.ticketTransfer.findFirst({
      where: { ticketId, status: TransferStatus.ACCEPTED, toUserId: { not: null } },
      orderBy: { acceptedAt: 'desc' },
      select: { toUserId: true },
    });
    return accepted?.toUserId ?? orderUserId;
  }

  private async loadTicketSummary(ticketId: string) {
    return this.prisma.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      select: {
        id: true,
        code: true,
        status: true,
        section: true,
        row: true,
        seatNumber: true,
        buyerEmail: true,
        buyerName: true,
        event: { select: { id: true, title: true, startsAt: true } },
      },
    });
  }

  /** Customers carry no organization; staff tokens must stay inside their tenant. */
  private assertTenantIfScoped(organizationId: string): void {
    const context = this.tenant.current();
    if (!context.organizationId && !context.privileged) return;
    this.tenant.assertOrganization(organizationId);
  }
}
