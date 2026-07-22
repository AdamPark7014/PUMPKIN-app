import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { getBanorteConfig, getProvider, BanorteProvider } from '@boletera/payments';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentService } from './payment.service';

@Injectable()
export class BanorteReconciliationService {
  private readonly logger = new Logger(BanorteReconciliationService.name);
  private banorte = getProvider('banorte') as BanorteProvider;

  constructor(
    private prisma: PrismaService,
    private payments: PaymentService,
  ) {}

  /** Revisa órdenes WEB pendientes con intent SPEI/OXXO y completa si Banorte confirma pago */
  async reconcilePendingSpei(limit = 50) {
    const cfg = getBanorteConfig();
    if (cfg.isDemo) {
      return { checked: 0, completed: 0, demo: true };
    }

    const pending = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.PENDING,
        channel: 'WEB',
        paymentMethod: { in: ['SPEI', 'OXXO'] },
      },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });

    let completed = 0;
    for (const order of pending) {
      const intent = await this.prisma.paymentIntent.findFirst({
        where: { orderId: order.id, status: PaymentStatus.PENDING },
        orderBy: { createdAt: 'desc' },
      });
      const externalId = intent?.externalId ?? intent?.id;
      if (!externalId) continue;

      try {
        const status = await this.banorte.getPaymentStatus?.(externalId);
        if (status?.status === 'completed') {
          await this.payments.completeOrder(order.id, externalId);
          completed++;
        }
      } catch (e) {
        this.logger.warn(`Reconcile skip ${order.publicId}: ${e}`);
      }
    }

    return { checked: pending.length, completed };
  }
}


