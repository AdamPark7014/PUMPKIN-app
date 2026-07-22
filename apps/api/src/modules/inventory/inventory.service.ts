import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HoldStatus, SalesChannel, TicketStatus } from '@prisma/client';
import { Observable, from, interval, map, mergeMap } from 'rxjs';
import { RedisService } from '../../common/redis.service';
import { ChannelQuotaService } from '../channel-management/channel-quota.service';
import { PrismaService } from '../prisma/prisma.service';
import { WaitlistService } from '../waitlist/waitlist.service';

const HOLD_TTL_WEB_SECONDS = 900;
const HOLD_TTL_TAQUILLA_SECONDS = 300;

@Injectable()
export class InventoryService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private quotas: ChannelQuotaService,
    private waitlist: WaitlistService,
  ) {}

  private holdTtl(channel: SalesChannel) {
    return channel === SalesChannel.TAQUILLA ? HOLD_TTL_TAQUILLA_SECONDS : HOLD_TTL_WEB_SECONDS;
  }

  async getMap(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        seatMap: { include: { layout: { include: { sections: { include: { seats: true } } } } } },
      },
    });
    if (!event?.seatMap) throw new NotFoundException('Seat map not found');
    return event.seatMap.snapshotData;
  }

  async getAvailability(eventId: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: { eventId },
      select: { id: true, seatId: true, status: true, section: true, row: true, seatNumber: true },
    });
    const holds = await this.prisma.seatHold.findMany({
      where: { eventId, status: HoldStatus.ACTIVE, expiresAt: { gt: new Date() } },
    });
    return { tickets, activeHolds: holds.length };
  }

  async createHold(dto: {
    eventId: string;
    seatIds?: string[];
    offerId?: string;
    quantity?: number;
    userId?: string;
    sessionId?: string;
    channel?: SalesChannel;
    cashierId?: string;
  }) {
    const channel = dto.channel ?? SalesChannel.WEB;
    const qty = dto.seatIds?.length ?? dto.quantity ?? 0;
    await this.quotas.assertAvailable(dto.eventId, channel, qty || 1);

    const ttl = this.holdTtl(channel);
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const holds = [];

    if (dto.seatIds?.length) {
      for (const seatId of dto.seatIds) {
        const ticket = await this.prisma.ticket.findFirst({
          where: { eventId: dto.eventId, seatId, status: TicketStatus.AVAILABLE },
        });
        if (!ticket) throw new ConflictException(`Seat ${seatId} not available`);

        const redisKey = `hold:${dto.eventId}:${seatId}`;
        const locked = await this.redis.setHold(redisKey, dto.sessionId ?? 'anon', ttl);
        if (!locked && this.redis.isReady) {
          throw new ConflictException(`Seat ${seatId} held by another user`);
        }

        const updated = await this.prisma.ticket.updateMany({
          where: { id: ticket.id, status: TicketStatus.AVAILABLE },
          data: { status: TicketStatus.HELD },
        });
        if (updated.count === 0) {
          await this.redis.del(redisKey);
          throw new ConflictException(`Seat ${seatId} conflict`);
        }

        const hold = await this.prisma.seatHold.create({
          data: {
            eventId: dto.eventId,
            seatId,
            offerId: dto.offerId,
            userId: dto.userId,
            sessionId: dto.sessionId,
            channel,
            cashierId: dto.cashierId,
            quantity: 1,
            expiresAt,
          },
        });
        holds.push(hold);
      }
    } else if (dto.offerId && dto.quantity) {
      const tickets = await this.prisma.ticket.findMany({
        where: { eventId: dto.eventId, offerId: dto.offerId, status: TicketStatus.AVAILABLE },
        take: dto.quantity,
      });
      if (tickets.length < dto.quantity) throw new BadRequestException('Not enough tickets');
      for (const ticket of tickets) {
        await this.prisma.ticket.update({
          where: { id: ticket.id },
          data: { status: TicketStatus.HELD },
        });
        const hold = await this.prisma.seatHold.create({
          data: {
            eventId: dto.eventId,
            offerId: dto.offerId,
            userId: dto.userId,
            sessionId: dto.sessionId,
            channel,
            cashierId: dto.cashierId,
            quantity: 1,
            expiresAt,
          },
        });
        holds.push(hold);
      }
    } else {
      throw new BadRequestException('seatIds or offerId+quantity required');
    }

    return { holds, expiresAt };
  }

  async releaseHold(holdId: string) {
    const hold = await this.prisma.seatHold.findUnique({ where: { id: holdId } });
    if (!hold) throw new NotFoundException('Hold not found');
    if (hold.seatId) {
      await this.redis.del(`hold:${hold.eventId}:${hold.seatId}`);
      await this.prisma.ticket.updateMany({
        where: { eventId: hold.eventId, seatId: hold.seatId, status: TicketStatus.HELD },
        data: { status: TicketStatus.AVAILABLE },
      });
    } else if (hold.offerId) {
      const held = await this.prisma.ticket.findFirst({
        where: { eventId: hold.eventId, offerId: hold.offerId, status: TicketStatus.HELD },
      });
      if (held) {
        await this.prisma.ticket.update({
          where: { id: held.id },
          data: { status: TicketStatus.AVAILABLE },
        });
      }
    }
    await this.prisma.seatHold.update({
      where: { id: holdId },
      data: { status: HoldStatus.RELEASED, releasedAt: new Date() },
    });

    void this.waitlist.notifyBatch(hold.eventId, 5).catch(() => undefined);

    return { released: true };
  }

  streamAvailability(eventId: string): Observable<MessageEvent> {
    return interval(3000).pipe(
      mergeMap(() => from(this.getAvailability(eventId))),
      map((data) => ({ data: JSON.stringify(data) } as MessageEvent)),
    );
  }
}
