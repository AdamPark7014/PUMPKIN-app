import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HoldStatus, Prisma, SalesChannel, TicketStatus } from '@prisma/client';
import { Observable, from, interval, map, mergeMap } from 'rxjs';
import { AuditService } from '../../common/audit.service';
import { RedisService } from '../../common/redis.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { ChannelQuotaService } from '../channel-management/channel-quota.service';
import { SaleWindowService } from '../event-scheduling/sale-window.service';
import { PrismaService } from '../prisma/prisma.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import type {
  AvailabilityResult,
  BestAvailableHoldResult,
  CreateBestAvailableHoldInput,
  CreateHoldInput,
  HoldResult,
  SeatHoldRow,
} from './inventory.types';
import { liberateHeldInventory } from './liberate-held-inventory';

const HOLD_TTL_WEB_SECONDS = 900;
const HOLD_TTL_TAQUILLA_SECONDS = 300;
const EXPIRE_BATCH_SIZE = 200;
const MAX_SEATS_PER_HOLD = 20;

type TxClient = Prisma.TransactionClient;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly quotas: ChannelQuotaService,
    private readonly waitlist: WaitlistService,
    private readonly saleWindows: SaleWindowService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private holdTtl(channel: SalesChannel): number {
    return channel === SalesChannel.TAQUILLA ? HOLD_TTL_TAQUILLA_SECONDS : HOLD_TTL_WEB_SECONDS;
  }

  /**
   * Public paths allow anonymous callers; authenticated tenant-bound callers
   * may only touch their own organization. SUPER_ADMIN is privileged.
   */
  private assertTenantIfPresent(organizationId: string): void {
    const ctx = this.tenant.current();
    if (!ctx.organizationId && !ctx.privileged) return;
    this.tenant.assertOrganization(organizationId);
  }

  private async requireEvent(eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId },
      select: {
        id: true,
        organizationId: true,
        currency: true,
        holdExpiration: true,
        status: true,
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    this.assertTenantIfPresent(event.organizationId);
    return event;
  }

  /**
   * Release ACTIVE holds past expiresAt and restore HELD tickets to AVAILABLE.
   * Called opportunistically before availability/hold mutations so inventory
   * never stays locked after TTL.
   */
  async expireStaleHolds(eventId?: string): Promise<number> {
    const now = new Date();
    const expired = await this.prisma.seatHold.findMany({
      where: {
        status: HoldStatus.ACTIVE,
        expiresAt: { lte: now },
        ...(eventId ? { eventId } : {}),
      },
      select: {
        id: true,
        eventId: true,
        seatId: true,
        offerId: true,
        quantity: true,
        sessionId: true,
        status: true,
        expiresAt: true,
      },
      take: EXPIRE_BATCH_SIZE,
      orderBy: { expiresAt: 'asc' },
    });
    if (!expired.length) return 0;

    let released = 0;
    for (const hold of expired) {
      const ok = await this.releaseHoldInternal(hold, { reason: 'EXPIRED', force: true });
      if (ok) released += 1;
    }
    return released;
  }

  async getMap(eventId: string) {
    const event = await this.requireEvent(eventId);
    const seatMap = await this.prisma.eventSeatMap.findFirst({
      where: { eventId: event.id },
      select: { snapshotData: true },
    });
    if (!seatMap) throw new NotFoundException('Seat map not found');
    return seatMap.snapshotData;
  }

  async getAvailability(eventId: string): Promise<AvailabilityResult> {
    const event = await this.requireEvent(eventId);
    await this.expireStaleHolds(event.id);
    const now = new Date();

    const [tickets, activeHolds, statusGroups] = await Promise.all([
      this.prisma.ticket.findMany({
        where: { eventId: event.id },
        select: {
          id: true,
          seatId: true,
          status: true,
          section: true,
          row: true,
          seatNumber: true,
        },
      }),
      this.prisma.seatHold.count({
        where: {
          eventId: event.id,
          status: HoldStatus.ACTIVE,
          expiresAt: { gt: now },
        },
      }),
      this.prisma.ticket.groupBy({
        by: ['status'],
        where: { eventId: event.id },
        _count: { _all: true },
      }),
    ]);

    const statusCounts: Record<string, number> = {};
    for (const row of statusGroups) {
      statusCounts[row.status] = row._count._all;
    }

    return { tickets, activeHolds, statusCounts };
  }

  async createHold(dto: CreateHoldInput): Promise<HoldResult> {
    const channel = dto.channel ?? SalesChannel.WEB;
    const event = await this.requireEvent(dto.eventId);
    await this.expireStaleHolds(event.id);

    const seatCount = dto.seatIds?.length ?? 0;
    if (seatCount > MAX_SEATS_PER_HOLD) {
      throw new BadRequestException(`Maximum ${MAX_SEATS_PER_HOLD} seats per hold`);
    }
    const qty = seatCount || dto.quantity || 0;
    if (qty < 1) {
      throw new BadRequestException('seatIds or offerId+quantity required');
    }

    await this.saleWindows.assertPurchasable(event.id, { channel, code: dto.saleCode });
    await this.quotas.assertAvailable(event.id, channel, qty);

    const ttl = this.holdTtl(channel);
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const redisKeys: string[] = [];

    try {
      const holds = await this.prisma.$transaction(
        async (tx) => {
          if (dto.seatIds?.length) {
            return this.holdSeats(tx, {
              eventId: event.id,
              seatIds: dto.seatIds,
              offerId: dto.offerId,
              userId: dto.userId,
              sessionId: dto.sessionId,
              channel,
              cashierId: dto.cashierId,
              expiresAt,
              ttl,
              redisKeys,
            });
          }
          if (dto.offerId && dto.quantity) {
            return this.holdGaQuantity(tx, {
              eventId: event.id,
              offerId: dto.offerId,
              quantity: dto.quantity,
              userId: dto.userId,
              sessionId: dto.sessionId,
              channel,
              cashierId: dto.cashierId,
              expiresAt,
            });
          }
          throw new BadRequestException('seatIds or offerId+quantity required');
        },
        { timeout: 15_000 },
      );

      await this.audit.log({
        action: 'inventory.hold.created',
        entityType: 'SeatHold',
        entityId: holds[0]?.id,
        organizationId: event.organizationId,
        userId: dto.userId ?? this.tenant.current().userId,
        metadata: {
          eventId: event.id,
          channel,
          count: holds.length,
          seatIds: dto.seatIds ?? [],
          offerId: dto.offerId ?? null,
        },
      });

      return { holds, expiresAt };
    } catch (error) {
      await Promise.all(redisKeys.map((key) => this.redis.del(key)));
      throw error;
    }
  }

  private async holdSeats(
    tx: TxClient,
    opts: {
      eventId: string;
      seatIds: string[];
      offerId?: string;
      userId?: string;
      sessionId?: string;
      channel: SalesChannel;
      cashierId?: string;
      expiresAt: Date;
      ttl: number;
      redisKeys: string[];
    },
  ) {
    const uniqueSeatIds = [...new Set(opts.seatIds)];
    if (uniqueSeatIds.length !== opts.seatIds.length) {
      throw new BadRequestException('Duplicate seatIds are not allowed');
    }

    const holds = [];
    for (const seatId of uniqueSeatIds) {
      const redisKey = `hold:${opts.eventId}:${seatId}`;
      const locked = await this.redis.setHold(redisKey, opts.sessionId ?? 'anon', opts.ttl);
      if (!locked && this.redis.isReady) {
        throw new ConflictException(`Seat ${seatId} held by another user`);
      }
      if (locked) opts.redisKeys.push(redisKey);

      const claimed = await tx.ticket.updateMany({
        where: {
          eventId: opts.eventId,
          seatId,
          status: TicketStatus.AVAILABLE,
        },
        data: { status: TicketStatus.HELD },
      });
      if (claimed.count === 0) {
        throw new ConflictException(`Seat ${seatId} not available`);
      }

      const ticket = await tx.ticket.findFirst({
        where: { eventId: opts.eventId, seatId, status: TicketStatus.HELD },
        select: { offerId: true },
      });

      const hold = await tx.seatHold.create({
        data: {
          eventId: opts.eventId,
          seatId,
          offerId: opts.offerId ?? ticket?.offerId,
          userId: opts.userId,
          sessionId: opts.sessionId,
          channel: opts.channel,
          cashierId: opts.cashierId,
          quantity: 1,
          expiresAt: opts.expiresAt,
          status: HoldStatus.ACTIVE,
        },
      });
      holds.push(hold);
    }
    return holds;
  }

  private async holdGaQuantity(
    tx: TxClient,
    opts: {
      eventId: string;
      offerId: string;
      quantity: number;
      userId?: string;
      sessionId?: string;
      channel: SalesChannel;
      cashierId?: string;
      expiresAt: Date;
    },
  ) {
    const offer = await tx.offer.findFirst({
      where: {
        id: opts.offerId,
        eventId: opts.eventId,
        isAvailable: true,
      },
      select: { id: true },
    });
    if (!offer) throw new NotFoundException('Offer not found');

    const candidates = await tx.ticket.findMany({
      where: {
        eventId: opts.eventId,
        offerId: opts.offerId,
        status: TicketStatus.AVAILABLE,
        seatId: null,
      },
      select: { id: true },
      take: opts.quantity,
      orderBy: { createdAt: 'asc' },
    });
    if (candidates.length < opts.quantity) {
      throw new BadRequestException('Not enough tickets');
    }

    const holds = [];
    for (const ticket of candidates) {
      const claimed = await tx.ticket.updateMany({
        where: { id: ticket.id, status: TicketStatus.AVAILABLE },
        data: { status: TicketStatus.HELD },
      });
      if (claimed.count === 0) {
        throw new ConflictException('Ticket conflict — retry');
      }

      const hold = await tx.seatHold.create({
        data: {
          eventId: opts.eventId,
          offerId: opts.offerId,
          userId: opts.userId,
          sessionId: opts.sessionId,
          channel: opts.channel,
          cashierId: opts.cashierId,
          quantity: 1,
          expiresAt: opts.expiresAt,
          status: HoldStatus.ACTIVE,
        },
      });
      holds.push(hold);
    }
    return holds;
  }

  /**
   * Pick N best-available seats for an offer (contiguous same-row when possible),
   * or GA quantity holds when tickets have no seat.
   */
  async createBestAvailableHold(
    dto: CreateBestAvailableHoldInput,
  ): Promise<BestAvailableHoldResult> {
    const quantity = Math.min(Math.max(dto.quantity || 1, 1), 12);
    const event = await this.requireEvent(dto.eventId);
    await this.expireStaleHolds(event.id);

    const offer = await this.prisma.offer.findFirst({
      where: {
        id: dto.offerId,
        eventId: event.id,
        isAvailable: true,
      },
      select: { id: true },
    });
    if (!offer) throw new NotFoundException('Offer not found');

    const candidates = await this.prisma.ticket.findMany({
      where: {
        eventId: event.id,
        offerId: offer.id,
        status: TicketStatus.AVAILABLE,
      },
      select: {
        id: true,
        seatId: true,
        section: true,
        row: true,
        seatNumber: true,
      },
      orderBy: [{ section: 'asc' }, { row: 'asc' }, { seatNumber: 'asc' }],
      take: Math.max(quantity * 8, 40),
    });
    if (candidates.length < quantity) {
      throw new BadRequestException('Not enough tickets available');
    }

    const withSeats = candidates.filter((t) => t.seatId);
    if (withSeats.length >= quantity) {
      const picked =
        dto.contiguous === false
          ? withSeats.slice(0, quantity)
          : this.pickContiguousSeats(withSeats, quantity) ?? withSeats.slice(0, quantity);
      const seatIds = picked.map((t) => t.seatId!).filter(Boolean);
      const result = await this.createHold({
        eventId: event.id,
        seatIds,
        offerId: offer.id,
        sessionId: dto.sessionId,
        userId: dto.userId,
        channel: dto.channel,
        cashierId: dto.cashierId,
        saleCode: dto.saleCode,
      });
      return {
        ...result,
        seats: picked.map((t) => ({
          seatId: t.seatId,
          section: t.section,
          row: t.row,
          seatNumber: t.seatNumber,
          label: [t.section, t.row, t.seatNumber].filter(Boolean).join(' · '),
        })),
        mode: 'RESERVED' as const,
      };
    }

    const result = await this.createHold({
      eventId: event.id,
      offerId: offer.id,
      quantity,
      sessionId: dto.sessionId,
      userId: dto.userId,
      channel: dto.channel,
      cashierId: dto.cashierId,
      saleCode: dto.saleCode,
    });
    return {
      ...result,
      seats: [],
      mode: 'GA' as const,
    };
  }

  private pickContiguousSeats<
    T extends { section: string | null; row: string | null; seatNumber: string | null },
  >(tickets: T[], quantity: number): T[] | null {
    const groups = new Map<string, T[]>();
    for (const t of tickets) {
      const key = `${t.section ?? ''}::${t.row ?? ''}`;
      const list = groups.get(key) ?? [];
      list.push(t);
      groups.set(key, list);
    }
    for (const row of groups.values()) {
      const sorted = [...row].sort(
        (a, b) => this.seatNum(a.seatNumber) - this.seatNum(b.seatNumber),
      );
      for (let i = 0; i <= sorted.length - quantity; i++) {
        const slice = sorted.slice(i, i + quantity);
        let contiguous = true;
        for (let j = 1; j < slice.length; j++) {
          if (this.seatNum(slice[j].seatNumber) !== this.seatNum(slice[j - 1].seatNumber) + 1) {
            contiguous = false;
            break;
          }
        }
        if (contiguous) return slice;
      }
    }
    return null;
  }

  private seatNum(value: string | null | undefined): number {
    const n = parseInt(String(value ?? '').replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  }

  async releaseHold(holdId: string, sessionId?: string) {
    const hold = await this.prisma.seatHold.findFirst({
      where: { id: holdId },
      select: {
        id: true,
        eventId: true,
        seatId: true,
        offerId: true,
        quantity: true,
        sessionId: true,
        status: true,
        expiresAt: true,
        event: { select: { organizationId: true } },
      },
    });
    if (!hold) throw new NotFoundException('Hold not found');
    this.assertTenantIfPresent(hold.event.organizationId);

    if (
      sessionId &&
      hold.sessionId &&
      hold.sessionId !== sessionId &&
      !this.tenant.current().organizationId &&
      !this.tenant.current().privileged
    ) {
      throw new ForbiddenException('Hold session mismatch');
    }

    const released = await this.releaseHoldInternal(hold, { reason: 'RELEASED', force: false });
    if (!released) {
      return { released: false, status: hold.status };
    }

    await this.audit.log({
      action: 'inventory.hold.released',
      entityType: 'SeatHold',
      entityId: hold.id,
      organizationId: hold.event.organizationId,
      userId: this.tenant.current().userId,
      metadata: { eventId: hold.eventId, seatId: hold.seatId, reason: 'RELEASED' },
    });

    void this.waitlist.notifyBatch(hold.eventId, 5).catch(() => undefined);
    return { released: true };
  }

  private async releaseHoldInternal(
    hold: SeatHoldRow & { event?: { organizationId: string } },
    opts: { reason: 'RELEASED' | 'EXPIRED'; force: boolean },
  ): Promise<boolean> {
    const nextStatus =
      opts.reason === 'EXPIRED' ? HoldStatus.EXPIRED : HoldStatus.RELEASED;

    // Expire only past-due ACTIVE holds unless this is an explicit release.
    const expiryGuard =
      opts.force && opts.reason === 'EXPIRED'
        ? { expiresAt: { lte: new Date() } }
        : {};

    const marked = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.seatHold.updateMany({
        where: {
          id: hold.id,
          status: HoldStatus.ACTIVE,
          ...expiryGuard,
        },
        data: {
          status: nextStatus,
          releasedAt: new Date(),
        },
      });
      if (updated.count === 0) return false;

      await liberateHeldInventory(tx, {
        eventId: hold.eventId,
        seatId: hold.seatId,
        offerId: hold.offerId,
        quantity: hold.quantity ?? 1,
      });
      return true;
    });

    if (!marked) return false;

    if (hold.seatId) {
      await this.redis.del(`hold:${hold.eventId}:${hold.seatId}`);
    }
    return true;
  }

  streamAvailability(eventId: string): Observable<MessageEvent> {
    return interval(3000).pipe(
      mergeMap(() => from(this.getAvailability(eventId))),
      map((data) => ({ data: JSON.stringify(data) } as MessageEvent)),
    );
  }
}
