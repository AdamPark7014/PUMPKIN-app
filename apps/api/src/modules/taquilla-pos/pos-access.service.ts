import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  HoldStatus,
  OrderStatus,
  PosSessionStatus,
  PosTerminalStatus,
  SalesChannel,
} from '@prisma/client';
import { TenantContextService } from '../../common/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { asOrgSettings, asPosOps, asSessionMetadata } from './types';

@Injectable()
export class PosAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * Tenant org for the request. SUPER_ADMIN must supply an organizationId
   * (body/query) because privileged context has no bound tenant — unless the
   * caller already resolved a tenant-owned resource by id.
   */
  resolveOrganizationId(explicitOrganizationId?: string): string {
    const ctx = this.tenant.current();
    if (ctx.privileged) {
      if (!explicitOrganizationId) {
        throw new BadRequestException('organizationId is required for cross-tenant operators');
      }
      return explicitOrganizationId;
    }
    const organizationId = this.tenant.requireOrganization();
    if (explicitOrganizationId) {
      this.tenant.assertOrganization(explicitOrganizationId);
    }
    return organizationId;
  }

  actorUserId(): string {
    const userId = this.tenant.current().userId;
    if (!userId) throw new ForbiddenException('Authenticated user required');
    return userId;
  }

  async requireTerminal(terminalId: string, organizationId?: string) {
    const ctx = this.tenant.current();
    if (ctx.privileged && !organizationId) {
      const terminal = await this.prisma.posTerminal.findUnique({ where: { id: terminalId } });
      if (!terminal) throw new NotFoundException('Terminal not found');
      if (terminal.status === PosTerminalStatus.DISABLED) {
        throw new BadRequestException('Terminal is disabled');
      }
      return terminal;
    }

    const orgId = this.resolveOrganizationId(organizationId);
    const terminal = await this.prisma.posTerminal.findFirst({
      where: { id: terminalId, organizationId: orgId },
    });
    if (!terminal) throw new NotFoundException('Terminal not found');
    this.tenant.assertOrganization(terminal.organizationId);
    if (terminal.status === PosTerminalStatus.DISABLED) {
      throw new BadRequestException('Terminal is disabled');
    }
    return terminal;
  }

  async requireActiveSession(sessionId: string, organizationId?: string) {
    const session = await this.requireSession(sessionId, organizationId);
    if (session.status !== PosSessionStatus.ACTIVE) {
      throw new BadRequestException('Active session required');
    }
    return session;
  }

  async requireSession(sessionId: string, organizationId?: string) {
    const ctx = this.tenant.current();
    if (ctx.privileged && !organizationId) {
      const session = await this.prisma.posCashierSession.findUnique({
        where: { id: sessionId },
        include: { terminal: true },
      });
      if (!session) throw new NotFoundException('Session not found');
      return session;
    }

    const orgId = this.resolveOrganizationId(organizationId);
    const session = await this.prisma.posCashierSession.findFirst({
      where: {
        id: sessionId,
        terminal: { organizationId: orgId },
      },
      include: { terminal: true },
    });
    if (!session) throw new NotFoundException('Session not found');
    this.tenant.assertOrganization(session.terminal.organizationId);
    return session;
  }

  async requireEvent(eventId: string, organizationId?: string) {
    const ctx = this.tenant.current();
    if (ctx.privileged && !organizationId) {
      const event = await this.prisma.event.findUnique({
        where: { id: eventId },
        select: {
          id: true,
          title: true,
          organizationId: true,
          currency: true,
          startsAt: true,
        },
      });
      if (!event) throw new NotFoundException('Event not found');
      return event;
    }

    const orgId = this.resolveOrganizationId(organizationId);
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId: orgId },
      select: {
        id: true,
        title: true,
        organizationId: true,
        currency: true,
        startsAt: true,
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    this.tenant.assertOrganization(event.organizationId);
    return event;
  }

  async requireOrder(orderId: string, organizationId?: string) {
    const ctx = this.tenant.current();
    const include = {
      event: { select: { id: true, title: true, startsAt: true, organizationId: true } },
      items: { include: { tickets: true } },
      refunds: { select: { id: true, status: true, amount: true } },
    } as const;

    if (ctx.privileged && !organizationId) {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include,
      });
      if (!order) throw new NotFoundException('Order not found');
      return order;
    }

    const orgId = this.resolveOrganizationId(organizationId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, organizationId: orgId },
      include,
    });
    if (!order) throw new NotFoundException('Order not found');
    this.tenant.assertOrganization(order.organizationId);
    return order;
  }

  async requireTaquillaOrder(orderId: string, organizationId?: string) {
    const order = await this.requireOrder(orderId, organizationId);
    if (order.channel !== SalesChannel.TAQUILLA) {
      throw new ForbiddenException('Only taquilla orders can be managed here');
    }
    return order;
  }

  async requireActiveHolds(holdIds: string[], eventId: string, organizationId?: string) {
    const event = await this.requireEvent(eventId, organizationId);
    const holds = await this.prisma.seatHold.findMany({
      where: {
        id: { in: holdIds },
        eventId: event.id,
        status: HoldStatus.ACTIVE,
        expiresAt: { gt: new Date() },
      },
    });
    if (holds.length !== holdIds.length) {
      throw new BadRequestException('Some holds expired or missing');
    }
    return { event, holds };
  }

  async loadOrgSettings(organizationId: string) {
    this.tenant.assertOrganization(organizationId);
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { id: true, settings: true, currency: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return { ...org, settings: asOrgSettings(org.settings) };
  }

  sessionMeta(session: { metadata: unknown }) {
    return asSessionMetadata(session.metadata);
  }

  orderPosOps(order: { posOps: unknown }) {
    return asPosOps(order.posOps);
  }

  assertCashierOwnsOrder(
    order: { cashierId: string | null },
    cashierId: string | undefined,
  ): void {
    if (cashierId && order.cashierId && order.cashierId !== cashierId) {
      throw new ForbiddenException('Order belongs to another cashier');
    }
  }

  assertVoidableStatus(status: OrderStatus): void {
    if (status !== OrderStatus.COMPLETED && status !== OrderStatus.PENDING) {
      throw new BadRequestException(`Cannot void order in status ${status}`);
    }
  }
}
