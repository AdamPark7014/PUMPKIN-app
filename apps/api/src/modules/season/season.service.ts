import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../../common/audit.service';

@Injectable()
export class SeasonService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async create(
    orgId: string,
    data: {
      name: string;
      slug: string;
      description?: string;
      seasonLabel: string;
      startsAt: string;
      endsAt: string;
      price: number;
      venueId?: string;
      maxQuantity?: number;
      eventIds?: string[];
    },
  ) {
    const pass = await this.prisma.seasonPass.create({
      data: {
        organizationId: orgId,
        venueId: data.venueId,
        name: data.name,
        slug: data.slug,
        description: data.description,
        seasonLabel: data.seasonLabel,
        startsAt: new Date(data.startsAt),
        endsAt: new Date(data.endsAt),
        price: data.price,
        maxQuantity: data.maxQuantity ?? 100,
        events: data.eventIds?.length
          ? { create: data.eventIds.map((eventId) => ({ eventId })) }
          : undefined,
      },
      include: { events: true },
    });

    await this.audit.log({
      action: 'SEASON_PASS_CREATED',
      entityType: 'SeasonPass',
      entityId: pass.id,
      organizationId: orgId,
    });

    return pass;
  }

  async list(orgId: string) {
    return this.prisma.seasonPass.findMany({
      where: { organizationId: orgId },
      include: {
        events: { include: { event: { select: { id: true, title: true, startsAt: true } } } },
        _count: { select: { purchases: true } },
      },
      orderBy: { startsAt: 'desc' },
    });
  }

  async purchase(
    seasonPassId: string,
    data: { buyerEmail: string; buyerName: string; quantity?: number; seatSection?: string },
  ) {
    const pass = await this.prisma.seasonPass.findUnique({ where: { id: seasonPassId } });
    if (!pass?.active) throw new NotFoundException('Season pass not found');
    const qty = data.quantity ?? 1;
    if (pass.soldQuantity + qty > pass.maxQuantity) {
      throw new BadRequestException('Season pass sold out');
    }

    const purchase = await this.prisma.$transaction(async (tx) => {
      await tx.seasonPass.update({
        where: { id: seasonPassId },
        data: { soldQuantity: { increment: qty } },
      });
      return tx.seasonPassPurchase.create({
        data: {
          seasonPassId,
          buyerEmail: data.buyerEmail.toLowerCase(),
          buyerName: data.buyerName,
          quantity: qty,
          totalAmount: Number(pass.price) * qty,
          status: 'COMPLETED',
          seatSection: data.seatSection,
        },
      });
    });

    return purchase;
  }
}
