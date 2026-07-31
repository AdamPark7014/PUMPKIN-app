import { BadRequestException, Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PosSessionStatus, Prisma, SalesChannel } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { ManagerPinService } from './manager-pin.service';
import { PosAccessService } from './pos-access.service';
import {
  VARIANCE_PIN_THRESHOLD,
  asPosOps,
  asSessionMetadata,
  clampPageSize,
  type CashDropEntry,
  type SessionMetadata,
  type SessionStartResult,
  type ZReportRow,
} from './types';

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PosAccessService,
    private readonly managerPin: ManagerPinService,
    private readonly audit: AuditService,
    private readonly tenant: TenantContextService,
  ) {}

  async startCashierSession(
    terminalId: string,
    cashierId: string,
    openingCash = 0,
  ): Promise<SessionStartResult> {
    const terminal = await this.access.requireTerminal(terminalId);
    const actorId = this.access.actorUserId();
    const resolvedCashierId = cashierId || actorId;

    if (!Number.isFinite(openingCash) || openingCash < 0) {
      throw new BadRequestException('Invalid opening cash');
    }

    const active = await this.prisma.posCashierSession.findFirst({
      where: {
        terminalId: terminal.id,
        cashierId: resolvedCashierId,
        status: PosSessionStatus.ACTIVE,
      },
      orderBy: { startedAt: 'desc' },
    });
    if (active) {
      const meta = asSessionMetadata(active.metadata);
      return {
        sessionId: active.id,
        status: 'ACTIVE',
        startedAt: active.startedAt,
        openingCash: Number(meta.openingCash ?? openingCash),
        resumed: true,
      };
    }

    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.posCashierSession.create({
        data: {
          terminalId: terminal.id,
          cashierId: resolvedCashierId,
          status: PosSessionStatus.ACTIVE,
          metadata: {
            openingCash,
            transactionCount: 0,
            cashDrops: [],
          } satisfies Prisma.InputJsonObject,
        },
      });

      await tx.cashierShift.create({
        data: {
          userId: resolvedCashierId,
          organizationId: terminal.organizationId,
          openingCash: new Decimal(openingCash),
          metadata: {
            posSessionId: created.id,
            terminalId: terminal.id,
          } satisfies Prisma.InputJsonObject,
        },
      });

      return created;
    });

    await this.audit.log({
      action: 'pos.session.start',
      entityType: 'PosCashierSession',
      entityId: session.id,
      organizationId: terminal.organizationId,
      userId: actorId,
      metadata: { terminalId: terminal.id, openingCash, cashierId: resolvedCashierId },
    });

    return {
      sessionId: session.id,
      status: 'ACTIVE',
      startedAt: session.startedAt,
      openingCash,
      resumed: false,
    };
  }

  async getSessionSummary(sessionId: string) {
    const session = await this.access.requireSession(sessionId);
    const meta = asSessionMetadata(session.metadata);
    const openingCash = Number(meta.openingCash ?? 0);
    const cashDrops = Array.isArray(meta.cashDrops) ? meta.cashDrops : [];
    const dropsTotal = cashDrops.reduce((sum, drop) => sum + Number(drop.amount || 0), 0);

    const orders = await this.prisma.order.findMany({
      where: {
        organizationId: session.terminal.organizationId,
        channel: SalesChannel.TAQUILLA,
        status: 'COMPLETED',
        createdAt: { gte: session.startedAt },
        cashierId: session.cashierId,
      },
      select: {
        id: true,
        publicId: true,
        totalAmount: true,
        paymentMethod: true,
        createdAt: true,
        posOps: true,
        event: { select: { title: true } },
        items: { select: { quantity: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    let cashSales = 0;
    let cardSales = 0;
    let compCount = 0;
    const byMethod: Record<string, number> = {};

    for (const order of orders) {
      const ops = asPosOps(order.posOps);
      if (ops.isComp || Number(order.totalAmount) === 0) {
        compCount += 1;
        continue;
      }
      const method = order.paymentMethod;
      const amount = Number(order.totalAmount);
      byMethod[method] = (byMethod[method] ?? 0) + amount;
      if (method === 'CASH') cashSales += amount;
      if (method === 'CARD') cardSales += amount;
    }

    const totalRevenue = orders.reduce((sum, order) => sum + Number(order.totalAmount), 0);
    const expectedCash = openingCash + cashSales - dropsTotal;

    return {
      totalTransactions: orders.length,
      totalRevenue,
      byMethod,
      cashSales,
      cardSales,
      compCount,
      openingCash,
      cashDrops,
      dropsTotal,
      expectedCash,
      startTime: session.startedAt,
      endTime: new Date(),
      recentSales: orders.slice(0, 12).map((order) => ({
        orderId: order.id,
        publicId: order.publicId,
        eventTitle: order.event.title,
        total: Number(order.totalAmount),
        paymentMethod: order.paymentMethod,
        quantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
        createdAt: order.createdAt.toISOString(),
        isComp: Boolean(asPosOps(order.posOps).isComp),
      })),
    };
  }

  async endCashierSession(
    sessionId: string,
    cashierId: string,
    closingCashCounted?: number,
    managerPin?: string,
  ) {
    const session = await this.access.requireSession(sessionId);
    const actorId = this.access.actorUserId();
    const resolvedCashierId = cashierId || actorId;

    const summary = await this.getSessionSummary(sessionId);
    const counted =
      closingCashCounted !== undefined && Number.isFinite(closingCashCounted)
        ? closingCashCounted
        : summary.expectedCash;
    const variance = counted - summary.expectedCash;

    const org = await this.access.loadOrgSettings(session.terminal.organizationId);
    const threshold = org.settings.varianceThreshold ?? VARIANCE_PIN_THRESHOLD;
    if (Math.abs(variance) > threshold) {
      await this.managerPin.assertManagerPin(session.terminal.organizationId, managerPin);
    }

    const report: SessionMetadata = {
      sessionId,
      cashierId: resolvedCashierId,
      startTime: session.startedAt,
      endTime: new Date().toISOString(),
      totalTransactions: summary.totalTransactions,
      totalRevenue: summary.totalRevenue,
      byMethod: summary.byMethod,
      cashSales: summary.cashSales,
      cardSales: summary.cardSales,
      compCount: summary.compCount,
      openingCash: summary.openingCash,
      dropsTotal: summary.dropsTotal,
      expectedCash: summary.expectedCash,
      closingCashCounted: counted,
      variance,
      zReport: true,
      status: 'CLOSED',
      terminalId: session.terminalId,
    };

    await this.prisma.$transaction(async (tx) => {
      const closed = await tx.posCashierSession.updateMany({
        where: { id: sessionId, status: PosSessionStatus.ACTIVE },
        data: {
          status: PosSessionStatus.CLOSED,
          endedAt: new Date(),
          metadata: report as Prisma.InputJsonValue,
        },
      });
      if (closed.count === 0) {
        throw new BadRequestException('Session already closed');
      }

      const shift = await tx.cashierShift.findFirst({
        where: {
          userId: resolvedCashierId,
          organizationId: session.terminal.organizationId,
          closedAt: null,
        },
        orderBy: { openedAt: 'desc' },
      });
      if (shift) {
        const prevMeta = asSessionMetadata(shift.metadata);
        await tx.cashierShift.update({
          where: { id: shift.id },
          data: {
            closedAt: new Date(),
            closingCash: new Decimal(counted),
            totalSales: new Decimal(summary.totalRevenue),
            metadata: { ...prevMeta, ...report } as Prisma.InputJsonValue,
          },
        });
      }
    });

    await this.audit.log({
      action: 'pos.session.end',
      entityType: 'PosCashierSession',
      entityId: sessionId,
      organizationId: session.terminal.organizationId,
      userId: actorId,
      metadata: { variance, closingCashCounted: counted, totalRevenue: summary.totalRevenue },
    });

    return report;
  }

  async addCashDrop(sessionId: string, amount: number, cashierId: string, note?: string) {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Invalid drop amount');
    }
    const session = await this.access.requireActiveSession(sessionId);
    const actorId = this.access.actorUserId();
    const meta = asSessionMetadata(session.metadata);
    const cashDrops: CashDropEntry[] = Array.isArray(meta.cashDrops)
      ? [...meta.cashDrops]
      : [];
    cashDrops.push({
      amount,
      note: note || '',
      cashierId: cashierId || actorId,
      at: new Date().toISOString(),
    });

    await this.prisma.posCashierSession.update({
      where: { id: session.id },
      data: {
        metadata: { ...meta, cashDrops } as Prisma.InputJsonValue,
      },
    });

    await this.audit.log({
      action: 'pos.session.cash_drop',
      entityType: 'PosCashierSession',
      entityId: session.id,
      organizationId: session.terminal.organizationId,
      userId: actorId,
      metadata: { amount, note },
    });

    return this.getSessionSummary(sessionId);
  }

  async handoff(data: {
    sessionId: string;
    fromCashierId: string;
    toCashierId: string;
    openingCash?: number;
    closingCashCounted?: number;
    managerPin?: string;
  }) {
    const session = await this.access.requireSession(data.sessionId);
    await this.managerPin.assertManagerPin(session.terminal.organizationId, data.managerPin);

    if (!data.toCashierId) {
      throw new BadRequestException('toCashierId is required');
    }

    const closed = await this.endCashierSession(
      data.sessionId,
      data.fromCashierId || session.cashierId,
      data.closingCashCounted,
      data.managerPin,
    );

    const next = await this.startCashierSession(
      session.terminalId,
      data.toCashierId,
      data.openingCash ?? Number(closed.expectedCash ?? 0),
    );

    await this.audit.log({
      action: 'pos.session.handoff',
      entityType: 'PosCashierSession',
      entityId: data.sessionId,
      organizationId: session.terminal.organizationId,
      userId: this.tenant.current().userId,
      metadata: {
        fromCashierId: data.fromCashierId,
        toCashierId: data.toCashierId,
        nextSessionId: next.sessionId,
      },
    });

    return { closed, next };
  }

  async listZReports(
    organizationId: string,
    take?: number,
    skip?: number,
  ): Promise<ZReportRow[]> {
    const orgId = this.access.resolveOrganizationId(organizationId);
    const pageSize = clampPageSize(take);
    const offset = Math.max(0, skip ?? 0);

    const terminals = await this.prisma.posTerminal.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true },
    });
    const terminalIds = terminals.map((terminal) => terminal.id);
    if (!terminalIds.length) return [];

    const nameById = new Map(terminals.map((terminal) => [terminal.id, terminal.name]));
    const sessions = await this.prisma.posCashierSession.findMany({
      where: { terminalId: { in: terminalIds }, status: PosSessionStatus.CLOSED },
      orderBy: { endedAt: 'desc' },
      take: pageSize,
      skip: offset,
      select: {
        id: true,
        terminalId: true,
        cashierId: true,
        endedAt: true,
        metadata: true,
      },
    });

    return sessions.map((session) => ({
      sessionId: session.id,
      terminalId: session.terminalId,
      terminalName: nameById.get(session.terminalId),
      cashierId: session.cashierId,
      endedAt: session.endedAt,
      report: session.metadata,
    }));
  }
}
