import { Injectable } from '@nestjs/common';
import { OrderStatus, SalesChannel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PosAccessService } from './pos-access.service';
import type { PosAnalyticsPeriod } from './types';

@Injectable()
export class PosAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PosAccessService,
  ) {}

  async getTerminalAnalytics(terminalId: string, period: PosAnalyticsPeriod) {
    const terminal = await this.access.requireTerminal(terminalId);

    const now = new Date();
    let since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === 'WEEK') since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (period === 'MONTH') since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const sessions = await this.prisma.posCashierSession.findMany({
      where: { terminalId: terminal.id },
      select: { cashierId: true },
      distinct: ['cashierId'],
    });
    const cashierIds = sessions.map((session) => session.cashierId);

    const aggregate = await this.prisma.order.aggregate({
      where: {
        organizationId: terminal.organizationId,
        channel: SalesChannel.TAQUILLA,
        createdAt: { gte: since },
        status: OrderStatus.COMPLETED,
        ...(cashierIds.length ? { cashierId: { in: cashierIds } } : { id: '__none__' }),
      },
      _count: { _all: true },
      _sum: { totalAmount: true },
    });

    const transactions = aggregate._count._all;
    const totalRevenue = Number(aggregate._sum.totalAmount ?? 0);

    return {
      terminalId: terminal.id,
      terminalName: terminal.name,
      period,
      transactions,
      totalRevenue,
      averageTransactionValue: transactions ? totalRevenue / transactions : 0,
    };
  }
}
