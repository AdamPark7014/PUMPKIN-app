import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SalesChannel } from '@prisma/client';
import { buildQrPayload, verifyTicketSignature } from '@boletera/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../../common/audit.service';
import { requireJwtSecret } from '../auth/jwt-secret';

@Injectable()
export class AccessService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async scanTicket(params: {
    ticketCode?: string;
    qrPayload?: string;
    zoneId?: string;
    scannedBy: string;
    channel: string;
  }) {
    let ticketId: string | undefined;
    if (params.qrPayload) {
      try {
        const parsed = JSON.parse(params.qrPayload) as { t: string; e: string; s: string };
        ticketId = parsed.t;
        const secret = process.env.TICKET_QR_SECRET || requireJwtSecret();
        const valid = verifyTicketSignature(parsed.t, parsed.e, parsed.s, secret);
        if (!valid) {
          await this.recordScan('', params, false, 'Invalid rotating signature');
          throw new BadRequestException('Invalid or expired QR');
        }
      } catch {
        throw new BadRequestException('Malformed QR payload');
      }
    }

    const ticket = await this.prisma.ticket.findFirst({
      where: params.ticketCode ? { code: params.ticketCode } : { id: ticketId },
      include: { event: true },
    });

    if (!ticket) {
      await this.recordScan(ticketId ?? '', params, false, 'Ticket not found');
      throw new NotFoundException('Ticket not found');
    }

    if (ticket.status === 'USED') {
      await this.recordScan(ticket.id, params, false, 'Already used');
      throw new BadRequestException('Ticket already scanned');
    }

    if (ticket.status !== 'SOLD') {
      await this.recordScan(ticket.id, params, false, `Invalid status: ${ticket.status}`);
      throw new BadRequestException('Ticket not valid for entry');
    }

    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: 'USED', usedAt: new Date(), checkedInAt: new Date() },
    });

    await this.recordScan(ticket.id, params, true);

    await this.audit.log({
      action: 'ticket.scan',
      entityType: 'Ticket',
      entityId: ticket.id,
      metadata: { zoneId: params.zoneId, channel: params.channel },
    });

    return {
      success: true,
      ticket: {
        code: ticket.code,
        section: ticket.section,
        row: ticket.row,
        seatNumber: ticket.seatNumber,
        eventTitle: ticket.event.title,
      },
    };
  }

  async getQrForTicket(ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    const secret = process.env.TICKET_QR_SECRET || process.env.JWT_SECRET || 'dev-ticket-secret';
    return { payload: buildQrPayload(ticket.id, ticket.eventId, secret) };
  }

  private async recordScan(
    ticketId: string,
    params: { zoneId?: string; scannedBy: string; channel: string },
    success: boolean,
    reason?: string,
  ) {
    if (!ticketId) return;
    await this.prisma.ticketScan.create({
      data: {
        ticketId,
        zoneId: params.zoneId,
        scannedBy: params.scannedBy,
        channel: (params.channel?.toUpperCase() === 'TAQUILLA'
          ? SalesChannel.TAQUILLA
          : SalesChannel.WEB) as SalesChannel,
        success,
        reason,
      },
    });
  }
}


