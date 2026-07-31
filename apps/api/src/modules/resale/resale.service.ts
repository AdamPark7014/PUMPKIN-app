import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Currency,
  Prisma,
  ResaleOfferStatus,
  ResaleStatus,
  TicketStatus,
  UserRole,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AuditService } from '../../common/audit.service';
import { RedisService } from '../../common/redis.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';

const IDEMPOTENCY_TTL_SECONDS = 86_400;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const OFFER_TTL_MS = 24 * 60 * 60 * 1000;

type TicketForListing = {
  id: string;
  status: TicketStatus;
  orderItemId: string | null;
  buyerEmail: string | null;
  createdAt: Date;
  eventId: string;
  offer: { basePrice: Decimal };
  event: {
    allowResale: boolean;
    nonTransferable: boolean;
    organizationId: string;
  };
  orderItem: { order: { userId: string; buyerEmail: string } } | null;
};

@Injectable()
export class ResaleService {
  private readonly RESALE_FEE_PERCENT = 0.08;
  private readonly MIN_RESALE_PRICE_PERCENT = 0.5;
  private readonly MAX_RESALE_PRICE_PERCENT = 2.0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  async createListing(data: {
    ticketId?: string;
    ticketCode?: string;
    askingPrice: number;
    currency?: string;
    sellerId: string;
    sellerEmail: string;
    sellerName?: string;
    idempotencyKey?: string;
  }) {
    if (!data.ticketId && !data.ticketCode) {
      throw new BadRequestException('Debes indicar ticketId o ticketCode');
    }

    if (data.idempotencyKey) {
      const cached = await this.readIdempotentResult(data.idempotencyKey);
      if (cached) return cached;
    }

    const ticket = await this.loadTicketForListing(data.ticketId, data.ticketCode);
    this.assertTenantIfPresent(ticket.event.organizationId);
    this.assertTicketOwnership(ticket, data.sellerId, data.sellerEmail);

    const listing = await this.createListingForTicket(ticket, {
      askingPrice: data.askingPrice,
      currency: this.parseCurrency(data.currency),
      sellerId: data.sellerId,
      sellerName: data.sellerName ?? data.sellerEmail ?? 'Vendedor',
    });

    await this.audit.log({
      action: 'RESALE_LISTING_CREATE',
      entityType: 'ResaleListing',
      entityId: listing.id,
      organizationId: ticket.event.organizationId,
      userId: data.sellerId,
      metadata: {
        ticketId: ticket.id,
        askingPrice: data.askingPrice,
        idempotencyKey: data.idempotencyKey,
      },
    });

    if (data.idempotencyKey) {
      await this.storeIdempotentResult(data.idempotencyKey, listing);
    }
    return listing;
  }

  private async createListingForTicket(
    ticket: TicketForListing,
    data: {
      askingPrice: number;
      currency: Currency;
      sellerId: string;
      sellerName: string;
    },
  ) {
    if (ticket.status !== TicketStatus.SOLD) {
      throw new BadRequestException('El boleto debe estar en estado VENDIDO');
    }
    if (!ticket.orderItemId) {
      throw new BadRequestException('El boleto debe tener historial de compra');
    }
    if (!ticket.event.allowResale) {
      throw new BadRequestException('La reventa no está permitida para este evento');
    }
    if (ticket.event.nonTransferable) {
      throw new BadRequestException('Este boleto no es transferible');
    }

    const antiScalping = await this.antiScalpingForTicket(ticket);
    if (!antiScalping.allowed) {
      throw new BadRequestException(antiScalping.reason ?? 'Reventa no permitida');
    }

    const originalPrice = Number(ticket.offer.basePrice);
    const minPrice = originalPrice * this.MIN_RESALE_PRICE_PERCENT;
    const maxPrice = originalPrice * this.MAX_RESALE_PRICE_PERCENT;
    if (data.askingPrice < minPrice || data.askingPrice > maxPrice) {
      throw new BadRequestException(
        `El precio debe estar entre ${minPrice.toFixed(2)} y ${maxPrice.toFixed(2)}`,
      );
    }

    const fee = new Decimal(data.askingPrice * this.RESALE_FEE_PERCENT);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const claimed = await tx.ticket.updateMany({
            where: { id: ticket.id, status: TicketStatus.SOLD },
            data: {
              status: TicketStatus.RESOLD,
              resalePrice: new Decimal(data.askingPrice),
            },
          });
          if (claimed.count === 0) {
            throw new ConflictException(
              'El boleto ya no está disponible para reventa (conflicto de concurrencia)',
            );
          }

          return tx.resaleListing.create({
            data: {
              ticketId: ticket.id,
              sellerId: data.sellerId,
              sellerName: data.sellerName,
              askingPrice: new Decimal(data.askingPrice),
              currency: data.currency,
              fee,
              status: ResaleStatus.ACTIVE,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof ConflictException || error instanceof BadRequestException) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ya existe un anuncio de reventa para este boleto');
      }
      throw error;
    }
  }

  async makeOffer(data: {
    listingId: string;
    offerPrice: number;
    buyerId: string;
    buyerEmail: string;
    idempotencyKey?: string;
  }) {
    if (data.idempotencyKey) {
      const cached = await this.readIdempotentResult(data.idempotencyKey);
      if (cached) return cached;
    }

    const listing = await this.prisma.resaleListing.findUnique({
      where: { id: data.listingId },
      include: {
        ticket: { select: { event: { select: { organizationId: true } } } },
      },
    });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');
    this.assertTenantIfPresent(listing.ticket.event.organizationId);

    if (listing.status !== ResaleStatus.ACTIVE || listing.delisted) {
      throw new ConflictException('El anuncio no está activo');
    }
    if (listing.sellerId === data.buyerId) {
      throw new BadRequestException('No puedes ofertar por tu propio anuncio');
    }
    if (data.offerPrice > Number(listing.askingPrice)) {
      throw new BadRequestException('La oferta no puede superar el precio solicitado');
    }

    const expiresAt = new Date(Date.now() + OFFER_TTL_MS);
    const offer = await this.prisma.resaleOffer.create({
      data: {
        listingId: data.listingId,
        buyerId: data.buyerId,
        buyerEmail: data.buyerEmail,
        offerPrice: new Decimal(data.offerPrice),
        status: ResaleOfferStatus.PENDING,
        expiresAt,
      },
    });

    await this.audit.log({
      action: 'RESALE_OFFER_CREATE',
      entityType: 'ResaleOffer',
      entityId: offer.id,
      organizationId: listing.ticket.event.organizationId,
      userId: data.buyerId,
      metadata: { listingId: data.listingId, offerPrice: data.offerPrice },
    });

    if (data.idempotencyKey) {
      await this.storeIdempotentResult(data.idempotencyKey, offer);
    }
    return offer;
  }

  async acceptOffer(
    offerId: string,
    actor: { userId: string; role: UserRole },
    idempotencyKey?: string,
  ) {
    if (idempotencyKey) {
      const cached = await this.readIdempotentResult(idempotencyKey);
      if (cached) return cached;
    }

    const offer = await this.prisma.resaleOffer.findUnique({
      where: { id: offerId },
      include: {
        listing: {
          include: {
            ticket: { include: { event: true } },
          },
        },
      },
    });
    if (!offer) throw new NotFoundException('Oferta no encontrada');

    const organizationId = offer.listing.ticket.event.organizationId;
    this.assertTenantIfPresent(organizationId);
    this.assertSellerOrStaff(offer.listing.sellerId, actor);

    if (offer.expiresAt.getTime() < Date.now()) {
      await this.prisma.resaleOffer.updateMany({
        where: { id: offerId, status: ResaleOfferStatus.PENDING },
        data: { status: ResaleOfferStatus.EXPIRED, respondedAt: new Date() },
      });
      throw new BadRequestException('La oferta ha expirado');
    }

    if (offer.status === ResaleOfferStatus.ACCEPTED) {
      const replay = await this.buildAcceptResult(offerId);
      if (idempotencyKey) await this.storeIdempotentResult(idempotencyKey, replay);
      return replay;
    }
    if (offer.status !== ResaleOfferStatus.PENDING) {
      throw new BadRequestException('La oferta no está pendiente');
    }

    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const offerClaimed = await tx.resaleOffer.updateMany({
            where: { id: offerId, status: ResaleOfferStatus.PENDING },
            data: { status: ResaleOfferStatus.ACCEPTED, respondedAt: new Date() },
          });
          if (offerClaimed.count === 0) {
            const current = await tx.resaleOffer.findUnique({ where: { id: offerId } });
            if (current?.status === ResaleOfferStatus.ACCEPTED) {
              return null;
            }
            throw new ConflictException('La oferta ya fue procesada por otra solicitud');
          }

          const listingClaimed = await tx.resaleListing.updateMany({
            where: { id: offer.listingId, status: ResaleStatus.ACTIVE },
            data: { status: ResaleStatus.SOLD, soldAt: new Date() },
          });
          if (listingClaimed.count === 0) {
            throw new ConflictException('El anuncio ya no está disponible');
          }

          await tx.resaleOffer.updateMany({
            where: {
              listingId: offer.listingId,
              status: ResaleOfferStatus.PENDING,
              id: { not: offerId },
            },
            data: { status: ResaleOfferStatus.EXPIRED, respondedAt: new Date() },
          });

          const transferTicket = await tx.ticket.update({
            where: { id: offer.listing.ticketId },
            data: {
              status: TicketStatus.SOLD,
              buyerEmail: offer.buyerEmail,
              isResale: true,
              resalePrice: offer.offerPrice,
            },
          });

          const resaleOrder = await tx.order.create({
            data: {
              publicId: `RESALE-${Date.now().toString(36).toUpperCase()}`,
              organizationId,
              eventId: offer.listing.ticket.eventId,
              userId: offer.buyerId,
              buyerEmail: offer.buyerEmail,
              buyerName: 'Comprador reventa',
              status: 'COMPLETED',
              subtotal: offer.offerPrice,
              fees: offer.listing.fee,
              discountAmount: new Decimal(0),
              taxAmount: new Decimal(0),
              totalAmount: offer.offerPrice.plus(offer.listing.fee),
              commissionAmount: offer.listing.fee,
              currency: offer.listing.currency,
              completedAt: new Date(),
              expiresAt: new Date(),
            },
          });

          return { resaleOrder, transferTicket };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      const finalResult = result ?? (await this.buildAcceptResult(offerId));

      await this.audit.log({
        action: 'RESALE_OFFER_ACCEPT',
        entityType: 'ResaleOffer',
        entityId: offerId,
        organizationId,
        userId: actor.userId,
        metadata: {
          listingId: offer.listingId,
          buyerId: offer.buyerId,
          idempotencyKey,
        },
      });

      if (idempotencyKey) {
        await this.storeIdempotentResult(idempotencyKey, finalResult);
      }
      return finalResult;
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' || error.code === 'P2002')
      ) {
        const replay = await this.prisma.resaleOffer.findUnique({ where: { id: offerId } });
        if (replay?.status === ResaleOfferStatus.ACCEPTED) {
          return this.buildAcceptResult(offerId);
        }
        throw new ConflictException('Conflicto de concurrencia al aceptar la oferta');
      }
      throw error;
    }
  }

  async rejectOffer(offerId: string, actor: { userId: string; role: UserRole }) {
    const offer = await this.prisma.resaleOffer.findUnique({
      where: { id: offerId },
      include: {
        listing: {
          include: { ticket: { select: { event: { select: { organizationId: true } } } } },
        },
      },
    });
    if (!offer) throw new NotFoundException('Oferta no encontrada');
    this.assertTenantIfPresent(offer.listing.ticket.event.organizationId);
    this.assertSellerOrStaff(offer.listing.sellerId, actor);

    const updated = await this.prisma.resaleOffer.updateMany({
      where: { id: offerId, status: ResaleOfferStatus.PENDING },
      data: { status: ResaleOfferStatus.REJECTED, respondedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new ConflictException('La oferta ya no está pendiente');
    }

    const rejected = await this.prisma.resaleOffer.findUniqueOrThrow({ where: { id: offerId } });

    await this.audit.log({
      action: 'RESALE_OFFER_REJECT',
      entityType: 'ResaleOffer',
      entityId: offerId,
      organizationId: offer.listing.ticket.event.organizationId,
      userId: actor.userId,
      metadata: { listingId: offer.listingId },
    });

    return rejected;
  }

  async cancelListing(listingId: string, actor: { userId: string; role: UserRole }) {
    const listing = await this.prisma.resaleListing.findUnique({
      where: { id: listingId },
      include: {
        ticket: { select: { event: { select: { organizationId: true } } } },
      },
    });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');
    this.assertTenantIfPresent(listing.ticket.event.organizationId);
    this.assertSellerOrStaff(listing.sellerId, actor);

    await this.prisma.$transaction(async (tx) => {
      const cancelled = await tx.resaleListing.updateMany({
        where: { id: listingId, status: ResaleStatus.ACTIVE },
        data: { status: ResaleStatus.CANCELLED },
      });
      if (cancelled.count === 0) {
        throw new ConflictException('El anuncio ya no está activo');
      }

      await tx.resaleOffer.updateMany({
        where: { listingId, status: ResaleOfferStatus.PENDING },
        data: { status: ResaleOfferStatus.EXPIRED, respondedAt: new Date() },
      });

      await tx.ticket.updateMany({
        where: { id: listing.ticketId, status: TicketStatus.RESOLD },
        data: { status: TicketStatus.SOLD, resalePrice: null },
      });
    });

    await this.audit.log({
      action: 'RESALE_LISTING_CANCEL',
      entityType: 'ResaleListing',
      entityId: listingId,
      organizationId: listing.ticket.event.organizationId,
      userId: actor.userId,
      metadata: { ticketId: listing.ticketId },
    });

    return { ...listing, status: ResaleStatus.CANCELLED };
  }

  async listActiveListings(params: {
    eventId?: string;
    offerId?: string;
    limit?: number;
    offset?: number;
  }) {
    const take = clampPageSize(params.limit ?? DEFAULT_PAGE_SIZE);
    const skip = Math.max(0, params.offset ?? 0);

    const ticketFilter: Prisma.TicketWhereInput = {};
    if (params.eventId) ticketFilter.eventId = params.eventId;
    if (params.offerId) ticketFilter.offerId = params.offerId;

    const ctx = this.tenant.current();
    if (ctx.organizationId && !ctx.privileged) {
      ticketFilter.event = { organizationId: ctx.organizationId };
    } else if (params.eventId) {
      const event = await this.prisma.event.findUnique({
        where: { id: params.eventId },
        select: { organizationId: true },
      });
      if (event) this.assertTenantIfPresent(event.organizationId);
    }

    const where: Prisma.ResaleListingWhereInput = {
      status: ResaleStatus.ACTIVE,
      delisted: false,
      ...(Object.keys(ticketFilter).length > 0 ? { ticket: ticketFilter } : {}),
    };

    const [listings, total] = await this.prisma.$transaction([
      this.prisma.resaleListing.findMany({
        where,
        include: {
          ticket: {
            include: { offer: true, event: true },
          },
          offers: {
            where: { status: ResaleOfferStatus.PENDING },
            select: { id: true },
          },
        },
        orderBy: { listedAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.resaleListing.count({ where }),
    ]);

    const mapped = listings.map((listing) => ({
      ...listing,
      priceComparison: {
        originalPrice: Number(listing.ticket.offer.basePrice),
        resalePrice: Number(listing.askingPrice),
        markup: (
          (Number(listing.askingPrice) / Number(listing.ticket.offer.basePrice)) * 100 -
          100
        ).toFixed(1),
      },
      pendingOffers: listing.offers.length,
    }));

    // Clients accept array OR `{ listings }` (admin/web).
    return {
      listings: mapped,
      total,
      limit: take,
      offset: skip,
    };
  }

  async getMarketplaceStats(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, organizationId: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');
    this.tenant.assertOrganization(event.organizationId);

    const ticketScope = { eventId: event.id };
    const [activeListings, soldListings, volumeAgg, avgAgg, priceRangeAgg, originalAvg] =
      await Promise.all([
        this.prisma.resaleListing.count({
          where: { status: ResaleStatus.ACTIVE, ticket: ticketScope },
        }),
        this.prisma.resaleListing.count({
          where: { status: ResaleStatus.SOLD, ticket: ticketScope },
        }),
        this.prisma.resaleListing.aggregate({
          _sum: { askingPrice: true },
          where: { status: ResaleStatus.SOLD, ticket: ticketScope },
        }),
        this.prisma.resaleListing.aggregate({
          _avg: { askingPrice: true },
          where: { ticket: ticketScope },
        }),
        this.prisma.resaleListing.aggregate({
          _min: { askingPrice: true },
          _max: { askingPrice: true },
          where: { ticket: ticketScope },
        }),
        this.prisma.ticket.aggregate({
          _avg: { originalPrice: true },
          where: { eventId: event.id },
        }),
      ]);

    const totalVolume = Number(volumeAgg._sum.askingPrice) || 0;
    const avgPrice = Number(avgAgg._avg.askingPrice) || 0;
    const priceRange = {
      min: Number(priceRangeAgg._min.askingPrice) || 0,
      max: Number(priceRangeAgg._max.askingPrice) || 0,
      original: Number(originalAvg._avg.originalPrice) || 0,
    };
    const original = priceRange.original || 1;

    return {
      eventId,
      activeListings,
      soldListings,
      totalVolume,
      avgResalePrice: avgPrice,
      priceRange,
      markup: {
        min: ((priceRange.min / original) * 100 - 100).toFixed(1),
        max: ((priceRange.max / original) * 100 - 100).toFixed(1),
        avg: ((avgPrice / original) * 100 - 100).toFixed(1),
      },
    };
  }

  async performAntiScalpingCheck(ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        offer: true,
        event: { select: { nonTransferable: true, organizationId: true, allowResale: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Boleto no encontrado');
    this.assertTenantIfPresent(ticket.event.organizationId);

    return this.antiScalpingForTicket({
      createdAt: ticket.createdAt,
      offer: ticket.offer,
      event: { nonTransferable: ticket.event.nonTransferable },
    });
  }

  private antiScalpingForTicket(ticket: {
    createdAt: Date;
    offer: { basePrice: Decimal };
    event: { nonTransferable: boolean };
  }): { allowed: boolean; reason?: string; maxPrice?: number } {
    const originalPrice = Number(ticket.offer.basePrice);
    const maxAllowedPrice = originalPrice * this.MAX_RESALE_PRICE_PERCENT;

    if (ticket.event.nonTransferable) {
      return { allowed: false, reason: 'Este boleto no es transferible' };
    }

    const hoursSincePurchase = (Date.now() - ticket.createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursSincePurchase < 24) {
      return {
        allowed: false,
        reason: `No se puede revender dentro de las 24 horas posteriores a la compra. Horas restantes: ${(24 - hoursSincePurchase).toFixed(1)}`,
        maxPrice: maxAllowedPrice,
      };
    }

    return { allowed: true, maxPrice: maxAllowedPrice };
  }

  private async loadTicketForListing(
    ticketId?: string,
    ticketCode?: string,
  ): Promise<TicketForListing> {
    const include = {
      offer: true,
      event: {
        select: {
          allowResale: true,
          nonTransferable: true,
          organizationId: true,
        },
      },
      orderItem: {
        select: {
          order: { select: { userId: true, buyerEmail: true } },
        },
      },
    } as const;

    const ticket = ticketId
      ? await this.prisma.ticket.findUnique({ where: { id: ticketId }, include })
      : await this.prisma.ticket.findFirst({
          where: { code: ticketCode },
          include,
        });

    if (!ticket) throw new NotFoundException('Boleto no encontrado');
    return ticket;
  }

  private assertTicketOwnership(
    ticket: TicketForListing,
    sellerId: string,
    sellerEmail: string,
  ): void {
    const orderUserId = ticket.orderItem?.order.userId;
    if (orderUserId && orderUserId === sellerId) return;

    const normalizedSeller = sellerEmail.trim().toLowerCase();
    const orderEmail = ticket.orderItem?.order.buyerEmail?.toLowerCase();
    const ticketEmail = ticket.buyerEmail?.toLowerCase();
    if (
      normalizedSeller &&
      (orderEmail === normalizedSeller || ticketEmail === normalizedSeller)
    ) {
      return;
    }

    throw new ForbiddenException('No eres el propietario de este boleto');
  }

  private assertSellerOrStaff(
    sellerId: string,
    actor: { userId: string; role: UserRole },
  ): void {
    if (actor.userId === sellerId) return;
    if (
      actor.role === UserRole.ADMIN ||
      actor.role === UserRole.SUPER_ADMIN ||
      actor.role === UserRole.PROMOTER
    ) {
      return;
    }
    throw new ForbiddenException('No tienes permiso para gestionar este anuncio');
  }

  private assertTenantIfPresent(organizationId: string): void {
    const ctx = this.tenant.current();
    if (!ctx.organizationId && !ctx.privileged) return;
    this.tenant.assertOrganization(organizationId);
  }

  private parseCurrency(value?: string): Currency {
    if (!value) return Currency.MXN;
    if (value === 'MXN' || value === 'USD' || value === 'EUR') return value;
    throw new BadRequestException('Moneda no válida');
  }

  private async buildAcceptResult(offerId: string) {
    const offer = await this.prisma.resaleOffer.findUniqueOrThrow({
      where: { id: offerId },
      include: {
        listing: {
          include: { ticket: true },
        },
      },
    });
    const resaleOrder = await this.prisma.order.findFirst({
      where: {
        userId: offer.buyerId,
        buyerEmail: offer.buyerEmail,
        eventId: offer.listing.ticket.eventId,
        publicId: { startsWith: 'RESALE-' },
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      resaleOrder,
      transferTicket: offer.listing.ticket,
    };
  }

  private async readIdempotentResult<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(`idem:resale:${key}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private async storeIdempotentResult(key: string, value: unknown): Promise<void> {
    await this.redis.setHold(
      `idem:resale:${key}`,
      JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
      IDEMPOTENCY_TTL_SECONDS,
    );
  }
}

function clampPageSize(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(limit), MAX_PAGE_SIZE);
}
