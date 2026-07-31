import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, SalesChannel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type ChannelBucket = {
  tickets: number;
  available: number;
  allocated: number;
  sold: number;
};

type ChannelInventory = Record<string, ChannelBucket>;

type EventMetadata = {
  channelInventory?: ChannelInventory;
  [key: string]: unknown;
};

@Injectable()
export class ChannelQuotaService {
  constructor(private readonly prisma: PrismaService) {}

  private channelKey(channel: SalesChannel): string {
    switch (channel) {
      case SalesChannel.TAQUILLA:
        return 'taquilla';
      case SalesChannel.API:
        return 'api';
      case SalesChannel.ADMIN:
        return 'web';
      default:
        return 'web';
    }
  }

  private asMetadata(metadata: unknown): EventMetadata {
    return typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
      ? ({ ...(metadata as EventMetadata) } as EventMetadata)
      : {};
  }

  private readInventory(metadata: unknown): ChannelInventory | undefined {
    const inventory = this.asMetadata(metadata).channelInventory;
    if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) {
      return undefined;
    }
    return { ...inventory };
  }

  /** Throws if channel inventory is configured and quota is exhausted. */
  async assertAvailable(eventId: string, channel: SalesChannel, quantity: number) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { metadata: true },
    });
    const inventory = this.readInventory(event?.metadata);
    if (!inventory) return;

    const key = this.channelKey(channel);
    const bucket = inventory[key];
    if (!bucket) return;

    if ((bucket.available ?? 0) < quantity) {
      throw new BadRequestException(
        `Cupo del canal ${key} agotado (${bucket.available ?? 0} disponibles, se requieren ${quantity})`,
      );
    }
  }

  /** Atomically decrement available / increment sold after a successful order. */
  async consume(eventId: string, channel: SalesChannel, quantity: number) {
    await this.mutateQuota(eventId, channel, quantity, 'consume');
  }

  /** Atomically restore quota when hold released or refund. */
  async release(eventId: string, channel: SalesChannel, quantity: number) {
    await this.mutateQuota(eventId, channel, quantity, 'release');
  }

  private async mutateQuota(
    eventId: string,
    channel: SalesChannel,
    quantity: number,
    mode: 'consume' | 'release',
  ) {
    if (quantity <= 0) return;

    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; metadata: unknown }>>`
        SELECT id, metadata
        FROM "Event"
        WHERE id = ${eventId}
        FOR UPDATE
      `;
      const event = rows[0];
      if (!event) return;

      const metadata = this.asMetadata(event.metadata);
      const inventory = this.readInventory(metadata);
      if (!inventory || !Object.keys(inventory).length) return;

      const key = this.channelKey(channel);
      const bucket = inventory[key];
      if (!bucket) return;

      if (mode === 'consume') {
        if ((bucket.available ?? 0) < quantity) {
          throw new BadRequestException(
            `Cupo del canal ${key} agotado (${bucket.available ?? 0} disponibles, se requieren ${quantity})`,
          );
        }
        inventory[key] = {
          ...bucket,
          available: Math.max(0, (bucket.available ?? 0) - quantity),
          sold: (bucket.sold ?? 0) + quantity,
          allocated: (bucket.allocated ?? 0) + quantity,
        };
      } else {
        inventory[key] = {
          ...bucket,
          available: Math.min(
            bucket.tickets ?? (bucket.available ?? 0) + quantity,
            (bucket.available ?? 0) + quantity,
          ),
          sold: Math.max(0, (bucket.sold ?? 0) - quantity),
        };
      }

      await tx.event.update({
        where: { id: eventId },
        data: {
          metadata: {
            ...metadata,
            channelInventory: inventory,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });
  }
}
