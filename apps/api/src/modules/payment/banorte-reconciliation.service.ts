import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus, PaymentStatus, SalesChannel } from '@prisma/client';
import { getBanorteConfig, getProvider, BanorteProvider } from '@boletera/payments';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentService } from './payment.service';

@Injectable()
export class BanorteReconciliationService {
  private readonly logger = new Logger(BanorteReconciliationService.name);
  private readonly banorte = getProvider('banorte') as BanorteProvider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentService,
  ) {}

  /** Revisa órdenes WEB pendientes con intent SPEI/OXXO y completa si Banorte confirma pago */
  async reconcilePendingSpei(limit = 50) {
    const cfg = getBanorteConfig();
    if (cfg.isDemo) {
      return { checked: 0, completed: 0, demo: true };
    }

    const take = Math.min(Math.max(limit, 1), 200);
    const pending = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.PENDING,
        channel: SalesChannel.WEB,
        paymentMethod: { in: ['SPEI', 'OXXO'] },
      },
      take,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        publicId: true,
        organizationId: true,
      },
    });

    let completed = 0;
    const orderIds = pending.map((o) => o.id);
    const intents = orderIds.length
      ? await this.prisma.paymentIntent.findMany({
          where: {
            orderId: { in: orderIds },
            status: PaymentStatus.PENDING,
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            orderId: true,
            externalId: true,
          },
        })
      : [];

    const intentByOrder = new Map<string, (typeof intents)[number]>();
    for (const intent of intents) {
      if (intent.orderId && !intentByOrder.has(intent.orderId)) {
        intentByOrder.set(intent.orderId, intent);
      }
    }

    for (const order of pending) {
      const intent = intentByOrder.get(order.id);
      const externalId = intent?.externalId ?? intent?.id;
      if (!externalId) continue;

      try {
        const status = await this.banorte.getPaymentStatus?.(externalId);
        if (status?.status === 'completed') {
          await this.payments.completeOrder(order.id, externalId);
          completed += 1;
        }
      } catch (e) {
        this.logger.warn(
          `Reconcile skip ${order.publicId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    return { checked: pending.length, completed };
  }
}
