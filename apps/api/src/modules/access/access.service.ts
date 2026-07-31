import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TicketStatus, TransferStatus, UserRole } from '@prisma/client';
import type { SalesChannel } from '@prisma/client';
import { buildQrPayload, verifyTicketSignature } from '@boletera/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { requireJwtSecret } from '../auth/jwt-secret';

const SCAN_ACTION = 'ticket.scan';
const SCAN_DENIED_ACTION = 'ticket.scan.denied';
const QR_ISSUED_ACTION = 'ticket.qr.issued';

/** Roles allowed to mint an entry QR for a ticket they do not personally hold. */
const VENUE_STAFF_ROLES: ReadonlySet<UserRole> = new Set([
  UserRole.SCANNER,
  UserRole.TAQUILLA,
  UserRole.VENUE_MANAGER,
  UserRole.PROMOTER,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
]);

export interface ScanTicketCommand {
  ticketCode?: string;
  qrPayload?: string;
  zoneId?: string;
  /** Station label supplied by the client; never used as an identity. */
  station?: string;
  channel: SalesChannel;
  scannedByUserId: string;
  idempotencyKey?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ScanTicketResult {
  success: true;
  ticket: {
    code: string;
    section: string | null;
    row: string | null;
    seatNumber: string | null;
    eventTitle: string;
  };
  /** True when an idempotency key replayed an admission that was already granted. */
  replayed?: boolean;
}

export interface QrActor {
  userId: string;
  role: UserRole;
}

const ticketSelection = {
  id: true,
  code: true,
  status: true,
  eventId: true,
  section: true,
  row: true,
  seatNumber: true,
  event: { select: { id: true, title: true, organizationId: true, venueId: true } },
} satisfies Prisma.TicketSelect;

type ScannableTicket = Prisma.TicketGetPayload<{ select: typeof ticketSelection }>;

interface QrEnvelope {
  ticketId: string;
  eventId: string;
  signature: string;
}

@Injectable()
export class AccessService {
  private readonly logger = new Logger(AccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenant: TenantContextService,
  ) {}

  async scanTicket(command: ScanTicketCommand): Promise<ScanTicketResult> {
    const envelope = command.qrPayload ? this.parseQrPayload(command.qrPayload) : undefined;
    if (!envelope && !command.ticketCode) {
      throw new BadRequestException('ticketCode or qrPayload is required');
    }

    const ticket = await this.findScannableTicket(envelope?.ticketId, command.ticketCode);
    if (!ticket) {
      await this.auditDenial(command, undefined, undefined, 'Ticket not found');
      throw new NotFoundException('Ticket not found');
    }
    this.tenant.assertOrganization(ticket.event.organizationId);

    if (envelope) {
      await this.verifyQrEnvelope(envelope, ticket, command);
    }
    const zoneId = await this.resolveZone(ticket, command.zoneId);

    if (command.idempotencyKey) {
      const alreadyAdmitted = await this.hasAdmissionWithKey(ticket.id, command.idempotencyKey);
      if (alreadyAdmitted) return { ...this.buildResult(ticket), replayed: true };
    }

    if (ticket.status === TicketStatus.USED) {
      await this.rejectScan(ticket, command, zoneId, 'Already used', 'Ticket already scanned');
    }
    if (ticket.status !== TicketStatus.SOLD) {
      await this.rejectScan(
        ticket,
        command,
        zoneId,
        `Invalid status: ${ticket.status}`,
        'Ticket not valid for entry',
      );
    }

    const admittedAt = new Date();
    // Conditional update: only the request that observes SOLD flips the row, so
    // concurrent gates can never admit the same ticket twice.
    const admission = await this.prisma.ticket.updateMany({
      where: { id: ticket.id, status: TicketStatus.SOLD },
      data: { status: TicketStatus.USED, usedAt: admittedAt, checkedInAt: admittedAt },
    });
    if (admission.count === 0) {
      await this.rejectScan(
        ticket,
        command,
        zoneId,
        'Concurrent scan lost the admission race',
        'Ticket already scanned',
      );
    }

    await this.recordScan(ticket.id, command, zoneId, true);
    await this.audit.log({
      action: SCAN_ACTION,
      entityType: 'Ticket',
      entityId: ticket.id,
      organizationId: ticket.event.organizationId,
      userId: command.scannedByUserId,
      ipAddress: command.ipAddress,
      userAgent: command.userAgent,
      metadata: {
        zoneId,
        channel: command.channel,
        station: command.station,
        eventId: ticket.eventId,
        ...(command.idempotencyKey ? { idempotencyKey: command.idempotencyKey } : {}),
      },
    });

    return this.buildResult(ticket);
  }

  async getQrForTicket(ticketId: string, actor: QrActor): Promise<{ payload: string }> {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId },
      select: {
        id: true,
        status: true,
        eventId: true,
        event: { select: { organizationId: true } },
        orderItem: { select: { order: { select: { userId: true } } } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    await this.assertMayIssueQr(ticket.id, ticket.event.organizationId, ticket.orderItem?.order.userId, actor);

    if (ticket.status !== TicketStatus.SOLD) {
      throw new BadRequestException('Only active tickets have an entry QR');
    }

    const payload = buildQrPayload(ticket.id, ticket.eventId, this.qrSecret());
    await this.audit.log({
      action: QR_ISSUED_ACTION,
      entityType: 'Ticket',
      entityId: ticket.id,
      organizationId: ticket.event.organizationId,
      userId: actor.userId,
      metadata: { eventId: ticket.eventId, role: actor.role },
    });

    return { payload };
  }

  // ==================== INTERNALS ====================

  private qrSecret(): string {
    return process.env.TICKET_QR_SECRET || requireJwtSecret();
  }

  /** Non-privileged callers only ever see tickets of their own organization. */
  private tenantEventFilter(): Prisma.EventWhereInput | undefined {
    if (this.tenant.current().privileged) return undefined;
    return { organizationId: this.tenant.requireOrganization() };
  }

  private async findScannableTicket(
    ticketId: string | undefined,
    ticketCode: string | undefined,
  ): Promise<ScannableTicket | null> {
    const eventFilter = this.tenantEventFilter();
    const identity: Prisma.TicketWhereInput = ticketCode ? { code: ticketCode } : { id: ticketId };
    return this.prisma.ticket.findFirst({
      where: { ...identity, ...(eventFilter ? { event: eventFilter } : {}) },
      select: ticketSelection,
    });
  }

  private parseQrPayload(raw: string): QrEnvelope {
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw new BadRequestException('Malformed QR payload');
    }
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      throw new BadRequestException('Malformed QR payload');
    }
    const { t, e, s } = decoded as Record<string, unknown>;
    if (typeof t !== 'string' || typeof e !== 'string' || typeof s !== 'string') {
      throw new BadRequestException('Malformed QR payload');
    }
    return { ticketId: t, eventId: e, signature: s };
  }

  private async verifyQrEnvelope(
    envelope: QrEnvelope,
    ticket: ScannableTicket,
    command: ScanTicketCommand,
  ): Promise<void> {
    const signed = verifyTicketSignature(
      envelope.ticketId,
      envelope.eventId,
      envelope.signature,
      this.qrSecret(),
    );
    if (signed && envelope.eventId === ticket.eventId) return;

    this.logger.warn(`Rejected QR for ticket ${ticket.id} at ${command.station ?? 'unknown station'}`);
    await this.recordScan(ticket.id, command, undefined, false, 'Invalid rotating signature');
    await this.auditDenial(
      command,
      ticket.id,
      ticket.event.organizationId,
      'Invalid rotating signature',
    );
    throw new BadRequestException('Invalid or expired QR');
  }

  private async resolveZone(
    ticket: ScannableTicket,
    zoneId: string | undefined,
  ): Promise<string | undefined> {
    if (!zoneId) return undefined;
    const zone = await this.prisma.accessZone.findFirst({
      where: { id: zoneId, venueId: ticket.event.venueId },
      select: { id: true },
    });
    if (!zone) throw new BadRequestException('Access zone does not belong to this event venue');
    return zone.id;
  }

  /**
   * A replayed request carries the key of an admission that already succeeded,
   * so it is answered with the original outcome instead of a duplicate entry.
   */
  private async hasAdmissionWithKey(ticketId: string, idempotencyKey: string): Promise<boolean> {
    const previous = await this.prisma.auditEvent.findFirst({
      where: {
        entityType: 'Ticket',
        entityId: ticketId,
        action: SCAN_ACTION,
        metadata: { path: ['idempotencyKey'], equals: idempotencyKey },
      },
      select: { id: true },
    });
    return previous !== null;
  }

  private async rejectScan(
    ticket: ScannableTicket,
    command: ScanTicketCommand,
    zoneId: string | undefined,
    reason: string,
    message: string,
  ): Promise<never> {
    await this.recordScan(ticket.id, command, zoneId, false, reason);
    await this.auditDenial(command, ticket.id, ticket.event.organizationId, reason);
    throw new BadRequestException(message);
  }

  private buildResult(ticket: ScannableTicket): ScanTicketResult {
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

  private async recordScan(
    ticketId: string,
    command: ScanTicketCommand,
    zoneId: string | undefined,
    success: boolean,
    reason?: string,
  ): Promise<void> {
    await this.prisma.ticketScan.create({
      data: {
        ticketId,
        zoneId,
        scannedBy: command.scannedByUserId,
        channel: command.channel,
        success,
        reason,
      },
    });
  }

  private async auditDenial(
    command: ScanTicketCommand,
    ticketId: string | undefined,
    organizationId: string | undefined,
    reason: string,
  ): Promise<void> {
    await this.audit.log({
      action: SCAN_DENIED_ACTION,
      entityType: 'Ticket',
      entityId: ticketId,
      organizationId,
      userId: command.scannedByUserId,
      ipAddress: command.ipAddress,
      userAgent: command.userAgent,
      metadata: {
        reason,
        channel: command.channel,
        station: command.station,
        zoneId: command.zoneId,
      },
    });
  }

  private async assertMayIssueQr(
    ticketId: string,
    organizationId: string,
    orderUserId: string | undefined,
    actor: QrActor,
  ): Promise<void> {
    const context = this.tenant.current();
    const isVenueStaff =
      VENUE_STAFF_ROLES.has(actor.role) &&
      (context.privileged || context.organizationId === organizationId);
    if (isVenueStaff) return;

    const holderId = await this.resolveHolder(ticketId, orderUserId);
    if (holderId && holderId === actor.userId) return;

    throw new ForbiddenException('You cannot access the QR of this ticket');
  }

  /** The holder is the buyer of the order unless an accepted transfer moved the ticket. */
  private async resolveHolder(
    ticketId: string,
    orderUserId: string | undefined,
  ): Promise<string | undefined> {
    const transfer = await this.prisma.ticketTransfer.findFirst({
      where: { ticketId, status: TransferStatus.ACCEPTED, toUserId: { not: null } },
      orderBy: { acceptedAt: 'desc' },
      select: { toUserId: true },
    });
    return transfer?.toUserId ?? orderUserId;
  }
}
