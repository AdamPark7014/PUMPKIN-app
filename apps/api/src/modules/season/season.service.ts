import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma, SeasonPassPurchaseStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AuditService } from '../../common/audit.service';
import { RedisService } from '../../common/redis.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateSeasonPassDto,
  ListSeasonPassesQueryDto,
  PurchaseSeasonPassDto,
} from './season.dto';

const ACTIVE_PURCHASE_STATUSES: SeasonPassPurchaseStatus[] = [
  SeasonPassPurchaseStatus.PENDING,
  SeasonPassPurchaseStatus.COMPLETED,
];

const IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 24;
const DEFAULT_LIST_LIMIT = 200;

type LockedSeasonPass = {
  id: string;
  organizationId: string;
  venueId: string | null;
  price: Decimal;
  maxQuantity: number;
  soldQuantity: number;
  active: boolean;
  startsAt: Date;
  endsAt: Date;
};

type SeasonPassPurchaseRecord = {
  id: string;
  seasonPassId: string;
  userId: string | null;
  buyerEmail: string;
  buyerName: string;
  quantity: number;
  totalAmount: Decimal;
  status: SeasonPassPurchaseStatus;
  seatSection: string | null;
  createdAt: Date;
};

@Injectable()
export class SeasonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenant: TenantContextService,
    private readonly redis: RedisService,
  ) {}

  async create(orgId: string, data: CreateSeasonPassDto) {
    this.tenant.assertOrganization(orgId);

    const startsAt = new Date(data.startsAt);
    const endsAt = new Date(data.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException('Invalid season dates');
    }
    if (endsAt <= startsAt) {
      throw new BadRequestException('endsAt must be after startsAt');
    }

    if (data.venueId) {
      await this.assertVenueInOrganization(orgId, data.venueId);
    }
    if (data.eventIds?.length) {
      await this.assertEventsInOrganization(orgId, data.eventIds, data.venueId);
    }

    const actor = this.tenant.current();
    try {
      const pass = await this.prisma.$transaction(async (tx) => {
        return tx.seasonPass.create({
          data: {
            organizationId: orgId,
            venueId: data.venueId,
            name: data.name.trim(),
            slug: data.slug.trim(),
            description: data.description?.trim(),
            seasonLabel: data.seasonLabel.trim(),
            startsAt,
            endsAt,
            price: data.price,
            maxQuantity: data.maxQuantity ?? 100,
            events: data.eventIds?.length
              ? { create: data.eventIds.map((eventId) => ({ eventId })) }
              : undefined,
          },
          include: {
            events: {
              include: {
                event: { select: { id: true, title: true, startsAt: true } },
              },
            },
          },
        });
      });

      await this.audit.log({
        action: 'SEASON_PASS_CREATED',
        entityType: 'SeasonPass',
        entityId: pass.id,
        organizationId: orgId,
        userId: actor.userId,
        metadata: {
          slug: pass.slug,
          seasonLabel: pass.seasonLabel,
          venueId: pass.venueId,
          eventIds: data.eventIds ?? [],
          maxQuantity: pass.maxQuantity,
          price: Number(pass.price),
        },
      });

      return pass;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Season pass slug already exists for organization');
      }
      throw error;
    }
  }

  async list(orgId: string, query: ListSeasonPassesQueryDto = {}) {
    this.tenant.assertOrganization(orgId);

    const paginate = query.page !== undefined || query.limit !== undefined;
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_LIST_LIMIT;

    return this.prisma.seasonPass.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        organizationId: true,
        venueId: true,
        name: true,
        slug: true,
        description: true,
        seasonLabel: true,
        startsAt: true,
        endsAt: true,
        price: true,
        currency: true,
        maxQuantity: true,
        soldQuantity: true,
        benefits: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        events: {
          select: {
            id: true,
            eventId: true,
            event: { select: { id: true, title: true, startsAt: true } },
          },
        },
        _count: { select: { purchases: true } },
      },
      orderBy: { startsAt: 'desc' },
      ...(paginate ? { skip: (page - 1) * limit, take: limit } : {}),
    });
  }

  async purchase(
    seasonPassId: string,
    data: PurchaseSeasonPassDto,
    idempotencyKey?: string,
  ) {
    const quantity = data.quantity ?? 1;
    const buyerEmail = data.buyerEmail.trim().toLowerCase();
    const buyerName = data.buyerName.trim();
    const seatSection = data.seatSection?.trim() || undefined;
    const normalizedKey = this.normalizeIdempotencyKey(idempotencyKey);
    const requestFingerprint = this.fingerprintPurchaseRequest({
      seasonPassId,
      buyerEmail,
      buyerName,
      quantity,
      seatSection,
    });

    if (normalizedKey) {
      const replay = await this.resolveIdempotentPurchase(
        normalizedKey,
        requestFingerprint,
      );
      if (replay) return replay;
    }

    const actor = this.tenant.current();

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        if (normalizedKey) {
          await this.acquireIdempotencyLock(tx, normalizedKey);
          const lockedReplay = await this.resolveIdempotentPurchase(
            normalizedKey,
            requestFingerprint,
            tx,
          );
          if (lockedReplay) {
            return { purchase: lockedReplay, replayed: true as const };
          }
        }

        const lockedRows = await tx.$queryRaw<LockedSeasonPass[]>(Prisma.sql`
          SELECT
            id,
            "organizationId",
            "venueId",
            price,
            "maxQuantity",
            "soldQuantity",
            active,
            "startsAt",
            "endsAt"
          FROM "SeasonPass"
          WHERE id = ${seasonPassId}
          FOR UPDATE
        `);
        const pass = lockedRows[0];
        if (!pass?.active) {
          throw new NotFoundException('Season pass not found');
        }

        // Public purchases are not tenant-bound; authenticated tenant actors
        // may only buy passes for their own organization (SUPER_ADMIN exempt).
        if (actor.organizationId || actor.privileged) {
          this.tenant.assertOrganization(pass.organizationId);
        }

        const now = new Date();
        if (now > pass.endsAt) {
          throw new BadRequestException('Season pass sales window has ended');
        }

        await this.assertRenewalAndSeatInvariants(tx, {
          seasonPassId: pass.id,
          organizationId: pass.organizationId,
          venueId: pass.venueId,
          buyerEmail,
          quantity,
          seatSection,
        });

        if (pass.soldQuantity + quantity > pass.maxQuantity) {
          throw new BadRequestException('Season pass sold out');
        }

        const updated = await tx.seasonPass.updateMany({
          where: {
            id: pass.id,
            active: true,
            soldQuantity: { lte: pass.maxQuantity - quantity },
          },
          data: { soldQuantity: { increment: quantity } },
        });
        if (updated.count !== 1) {
          throw new BadRequestException('Season pass sold out');
        }

        const purchase = await tx.seasonPassPurchase.create({
          data: {
            seasonPassId: pass.id,
            userId: actor.userId,
            buyerEmail,
            buyerName,
            quantity,
            totalAmount: new Decimal(pass.price).mul(quantity),
            status: SeasonPassPurchaseStatus.COMPLETED,
            seatSection,
          },
        });

        // Persist audit inside the transaction so idempotent retries that take
        // the advisory lock can observe the prior purchase deterministically.
        await tx.auditEvent.create({
          data: {
            action: 'SEASON_PASS_PURCHASED',
            entityType: 'SeasonPassPurchase',
            entityId: purchase.id,
            organizationId: pass.organizationId,
            userId: actor.userId,
            metadata: {
              seasonPassId: purchase.seasonPassId,
              buyerEmail: purchase.buyerEmail,
              quantity: purchase.quantity,
              seatSection: purchase.seatSection,
              totalAmount: Number(purchase.totalAmount),
              idempotencyKey: normalizedKey ?? null,
              requestFingerprint,
            },
          },
        });

        return { purchase, replayed: false as const };
      });

      if (!result.replayed && normalizedKey) {
        await this.cacheIdempotentPurchase(
          normalizedKey,
          requestFingerprint,
          result.purchase,
        );
      }

      return result.purchase;
    } catch (error) {
      if (normalizedKey) {
        const replay = await this.resolveIdempotentPurchase(
          normalizedKey,
          requestFingerprint,
        );
        if (replay) return replay;
      }
      throw error;
    }
  }

  private async assertVenueInOrganization(organizationId: string, venueId: string) {
    const venue = await this.prisma.venue.findFirst({
      where: { id: venueId, organizationId },
      select: { id: true },
    });
    if (!venue) {
      throw new BadRequestException('Venue not found for this organization');
    }
  }

  private async assertEventsInOrganization(
    organizationId: string,
    eventIds: string[],
    venueId?: string,
  ) {
    const events = await this.prisma.event.findMany({
      where: {
        id: { in: eventIds },
        organizationId,
        ...(venueId ? { venueId } : {}),
      },
      select: { id: true },
    });
    if (events.length !== eventIds.length) {
      throw new BadRequestException(
        venueId
          ? 'One or more events are missing or not linked to the selected venue'
          : 'One or more events are missing or outside this organization',
      );
    }
  }

  private async assertRenewalAndSeatInvariants(
    tx: Prisma.TransactionClient,
    params: {
      seasonPassId: string;
      organizationId: string;
      venueId: string | null;
      buyerEmail: string;
      quantity: number;
      seatSection?: string;
    },
  ) {
    const existingActive = await tx.seasonPassPurchase.findFirst({
      where: {
        seasonPassId: params.seasonPassId,
        buyerEmail: params.buyerEmail,
        status: { in: ACTIVE_PURCHASE_STATUSES },
      },
      select: { id: true, status: true, seatSection: true, quantity: true },
      orderBy: { createdAt: 'desc' },
    });

    if (existingActive) {
      // Schema has no Renewal entity. Same-pass repurchase would double-count
      // capacity; cross-season renewal must target a different SeasonPass.
      throw new ConflictException(
        'Buyer already holds an active season pass purchase; renew by purchasing the next season pass',
      );
    }

    if (!params.seatSection || !params.venueId) {
      return;
    }

    const section = await tx.section.findFirst({
      where: {
        layout: {
          venueId: params.venueId,
          isActive: true,
          venue: { organizationId: params.organizationId },
        },
        OR: [
          { name: { equals: params.seatSection, mode: 'insensitive' } },
          { slug: { equals: params.seatSection, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        name: true,
        _count: { select: { seats: true } },
      },
    });

    const layoutExists = await tx.venueLayout.findFirst({
      where: {
        venueId: params.venueId,
        isActive: true,
        venue: { organizationId: params.organizationId },
      },
      select: { id: true },
    });

    if (layoutExists && !section) {
      throw new BadRequestException('Seat section not found for season pass venue');
    }

    if (section && section._count.seats > 0) {
      const reserved = await tx.seasonPassPurchase.aggregate({
        where: {
          seasonPassId: params.seasonPassId,
          seatSection: { equals: params.seatSection, mode: 'insensitive' },
          status: { in: ACTIVE_PURCHASE_STATUSES },
        },
        _sum: { quantity: true },
      });
      const used = reserved._sum.quantity ?? 0;
      if (used + params.quantity > section._count.seats) {
        throw new BadRequestException('Seat section capacity exceeded for season pass');
      }
    }
  }

  private normalizeIdempotencyKey(key?: string): string | undefined {
    const trimmed = key?.trim();
    if (!trimmed) return undefined;
    if (trimmed.length > 128) {
      throw new BadRequestException('Idempotency-Key must be at most 128 characters');
    }
    return trimmed;
  }

  private fingerprintPurchaseRequest(input: {
    seasonPassId: string;
    buyerEmail: string;
    buyerName: string;
    quantity: number;
    seatSection?: string;
  }): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          seasonPassId: input.seasonPassId,
          buyerEmail: input.buyerEmail,
          buyerName: input.buyerName,
          quantity: input.quantity,
          seatSection: input.seatSection ?? null,
        }),
      )
      .digest('hex');
  }

  private idempotencyCacheKey(key: string): string {
    return `season:purchase:idempotency:${key}`;
  }

  private async acquireIdempotencyLock(
    tx: Prisma.TransactionClient,
    idempotencyKey: string,
  ): Promise<void> {
    const lockKey = createHash('sha256').update(idempotencyKey).digest();
    const lockId = lockKey.readInt32BE(0);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockId})`;
  }

  private async cacheIdempotentPurchase(
    idempotencyKey: string,
    requestFingerprint: string,
    purchase: SeasonPassPurchaseRecord,
  ): Promise<void> {
    if (!this.redis.isReady) return;
    await this.redis.setHold(
      this.idempotencyCacheKey(idempotencyKey),
      JSON.stringify({
        requestFingerprint,
        purchase: {
          id: purchase.id,
          seasonPassId: purchase.seasonPassId,
          userId: purchase.userId,
          buyerEmail: purchase.buyerEmail,
          buyerName: purchase.buyerName,
          quantity: purchase.quantity,
          totalAmount: purchase.totalAmount.toString(),
          status: purchase.status,
          seatSection: purchase.seatSection,
          createdAt: purchase.createdAt.toISOString(),
        },
      }),
      IDEMPOTENCY_TTL_SECONDS,
    );
  }

  private async resolveIdempotentPurchase(
    idempotencyKey: string,
    requestFingerprint: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<SeasonPassPurchaseRecord | null> {
    if (this.redis.isReady) {
      const cached = await this.redis.get(this.idempotencyCacheKey(idempotencyKey));
      if (cached) {
        const parsed = JSON.parse(cached) as {
          requestFingerprint: string;
          purchase: SeasonPassPurchaseRecord;
        };
        if (parsed.requestFingerprint !== requestFingerprint) {
          throw new ConflictException(
            'Idempotency-Key already used with a different purchase payload',
          );
        }
        return {
          ...parsed.purchase,
          totalAmount: new Decimal(parsed.purchase.totalAmount),
          createdAt: new Date(parsed.purchase.createdAt),
        };
      }
    }

    const audit = await db.auditEvent.findFirst({
      where: {
        action: 'SEASON_PASS_PURCHASED',
        entityType: 'SeasonPassPurchase',
        metadata: {
          path: ['idempotencyKey'],
          equals: idempotencyKey,
        },
      },
      select: { entityId: true, metadata: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!audit?.entityId) return null;

    const metadata =
      audit.metadata && typeof audit.metadata === 'object' && !Array.isArray(audit.metadata)
        ? (audit.metadata as Record<string, unknown>)
        : {};
    if (
      typeof metadata.requestFingerprint === 'string' &&
      metadata.requestFingerprint !== requestFingerprint
    ) {
      throw new ConflictException(
        'Idempotency-Key already used with a different purchase payload',
      );
    }

    return db.seasonPassPurchase.findUnique({
      where: { id: audit.entityId },
    });
  }
}
