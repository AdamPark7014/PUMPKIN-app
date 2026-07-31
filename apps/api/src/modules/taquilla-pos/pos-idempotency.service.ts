import { ConflictException, Injectable } from '@nestjs/common';
import {
  Currency,
  PaymentGateway,
  PaymentStatus,
  Prisma,
  SalesChannel,
} from '@prisma/client';
import { RedisService } from '../../common/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CLIENT_SALE_LOOKBACK_MS,
  IDEMPOTENCY_CLAIM_TTL_MS,
  asPosOps,
  idempotencyKeyForSale,
} from './types';

type CompletedOrderSnapshot = {
  id: string;
  publicId: string;
  totalAmount: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  fees: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  status: string;
  paymentMethod: string;
  posOps: unknown;
};

@Injectable()
export class PosIdempotencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async findSaleByClientId(
    organizationId: string,
    clientSaleId: string,
  ): Promise<CompletedOrderSnapshot | null> {
    const since = new Date(Date.now() - CLIENT_SALE_LOOKBACK_MS);
    const order = await this.prisma.order.findFirst({
      where: {
        organizationId,
        channel: SalesChannel.TAQUILLA,
        createdAt: { gte: since },
        posOps: {
          path: ['clientSaleId'],
          equals: clientSaleId,
        },
      },
      select: {
        id: true,
        publicId: true,
        totalAmount: true,
        subtotal: true,
        fees: true,
        taxAmount: true,
        status: true,
        paymentMethod: true,
        posOps: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return order;
  }

  async findSaleByIdempotencyKey(key: string): Promise<CompletedOrderSnapshot | null> {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { idempotencyKey: key },
      select: { orderId: true, status: true, metadata: true },
    });
    if (!intent?.orderId) return null;
    return this.prisma.order.findUnique({
      where: { id: intent.orderId },
      select: {
        id: true,
        publicId: true,
        totalAmount: true,
        subtotal: true,
        fees: true,
        taxAmount: true,
        status: true,
        paymentMethod: true,
        posOps: true,
      },
    });
  }

  /**
   * Atomically claim a sale idempotency key so concurrent checkouts cannot
   * create two orders for the same clientSaleId.
   */
  async claimSale(
    organizationId: string,
    clientSaleId: string,
    currency: Currency,
  ): Promise<{ key: string; alreadyExists: CompletedOrderSnapshot | null }> {
    const key = idempotencyKeyForSale(organizationId, clientSaleId);

    const existingByOps = await this.findSaleByClientId(organizationId, clientSaleId);
    if (existingByOps) return { key, alreadyExists: existingByOps };

    const existingByKey = await this.findSaleByIdempotencyKey(key);
    if (existingByKey) return { key, alreadyExists: existingByKey };

    const lockKey = `pos:lock:${key}`;
    const locked = await this.redis.setHold(lockKey, clientSaleId, Math.ceil(IDEMPOTENCY_CLAIM_TTL_MS / 1000));
    if (!locked && this.redis.isReady) {
      const raced = await this.findSaleByClientId(organizationId, clientSaleId);
      if (raced) return { key, alreadyExists: raced };
      throw new ConflictException('Sale already in progress for this clientSaleId');
    }

    try {
      await this.prisma.paymentIntent.create({
        data: {
          provider: PaymentGateway.CASH,
          amount: 0,
          currency,
          status: PaymentStatus.PENDING,
          channel: SalesChannel.TAQUILLA,
          idempotencyKey: key,
          expiresAt: new Date(Date.now() + IDEMPOTENCY_CLAIM_TTL_MS),
          metadata: {
            phase: 'claimed',
            organizationId,
            clientSaleId,
          } satisfies Prisma.InputJsonObject,
        },
      });
      return { key, alreadyExists: null };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced =
          (await this.findSaleByIdempotencyKey(key)) ??
          (await this.findSaleByClientId(organizationId, clientSaleId));
        if (raced) return { key, alreadyExists: raced };
        throw new ConflictException('Duplicate sale claim');
      }
      throw error;
    }
  }

  async bindSaleOrder(key: string, orderId: string, amount: number): Promise<void> {
    await this.prisma.paymentIntent.updateMany({
      where: { idempotencyKey: key },
      data: {
        orderId,
        amount,
        status: PaymentStatus.COMPLETED,
        metadata: {
          phase: 'completed',
          orderId,
        },
      },
    });
    await this.redis.del(`pos:lock:${key}`);
  }

  async releaseClaim(key: string): Promise<void> {
    await this.prisma.paymentIntent.deleteMany({
      where: {
        idempotencyKey: key,
        orderId: null,
        status: PaymentStatus.PENDING,
      },
    });
    await this.redis.del(`pos:lock:${key}`);
  }

  clientSaleIdOf(order: { posOps: unknown }): string | undefined {
    return asPosOps(order.posOps).clientSaleId;
  }
}
