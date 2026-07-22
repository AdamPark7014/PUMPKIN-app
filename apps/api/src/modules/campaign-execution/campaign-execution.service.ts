import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import { PromotionType } from '@prisma/client';

type EventCampaign = {
  id: string;
  eventId: string;
  name: string;
  type: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED';
  startsAt: string;
  endsAt: string;
  allocation: number;
  quantityPerUser: number;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  codes?: string[];
  redeemed?: number;
};

@Injectable()
export class CampaignExecutionService {
  private logger = new Logger(CampaignExecutionService.name);

  constructor(private prisma: PrismaService) {}

  private async getEventCampaigns(eventId: string): Promise<EventCampaign[]> {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new BadRequestException('Event not found');
    return ((event.metadata as { campaigns?: EventCampaign[] })?.campaigns ?? []);
  }

  private async saveCampaigns(eventId: string, campaigns: EventCampaign[]) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new BadRequestException('Event not found');
    const meta = (event.metadata as Record<string, unknown>) ?? {};
    await this.prisma.event.update({
      where: { id: eventId },
      data: { metadata: { ...meta, campaigns } },
    });
  }

  async createCampaign(
    organizationId: string,
    eventId: string,
    data: {
      name: string;
      type: string;
      startsAt: Date;
      endsAt: Date;
      allocation: number;
      quantityPerUser: number;
      discountType: 'percentage' | 'fixed';
      discountValue: number;
    },
  ) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId },
    });
    if (!event) throw new BadRequestException('Event not found');

    const campaigns = await this.getEventCampaigns(eventId);
    const campaign: EventCampaign = {
      id: `camp_${Date.now()}`,
      eventId,
      name: data.name,
      type: data.type,
      status: 'DRAFT',
      startsAt: data.startsAt.toISOString(),
      endsAt: data.endsAt.toISOString(),
      allocation: data.allocation,
      quantityPerUser: data.quantityPerUser,
      discountType: data.discountType,
      discountValue: data.discountValue,
      redeemed: 0,
      codes:
        data.type === 'presale'
          ? Array.from({ length: Math.min(data.allocation, 500) }, () =>
              `PS${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
            )
          : undefined,
    };

    if (data.type === 'early_bird' || data.type === 'presale') {
      const code = `CAMP-${campaign.id.slice(-6).toUpperCase()}`;
      await this.prisma.promotion.upsert({
        where: { code },
        create: {
          code,
          organizationId,
          name: data.name,
          type: data.discountType === 'percentage' ? PromotionType.PERCENTAGE : PromotionType.FIXED_AMOUNT,
          value: new Decimal(data.discountValue),
          startDate: data.startsAt,
          endDate: data.endsAt,
          usageLimit: data.allocation,
          usagePerCustomer: data.quantityPerUser,
        },
        update: {
          startDate: data.startsAt,
          endDate: data.endsAt,
          value: new Decimal(data.discountValue),
        },
      });
    }

    campaigns.push(campaign);
    await this.saveCampaigns(eventId, campaigns);
    this.logger.log(`Campaign created: ${campaign.id}`);
    return campaign;
  }

  async listCampaigns(eventId: string) {
    return this.getEventCampaigns(eventId);
  }

  async publishCampaign(campaignId: string) {
    const events = await this.prisma.event.findMany({
      where: { metadata: { not: undefined } },
      select: { id: true, metadata: true },
    });
    for (const event of events) {
      const campaigns = ((event.metadata as { campaigns?: EventCampaign[] })?.campaigns ?? []);
      const idx = campaigns.findIndex((c) => c.id === campaignId);
      if (idx >= 0) {
        campaigns[idx].status = 'ACTIVE';
        await this.saveCampaigns(event.id, campaigns);
        return campaigns[idx];
      }
    }
    throw new BadRequestException('Campaign not found');
  }

  async pauseCampaign(campaignId: string) {
    return this.setStatus(campaignId, 'PAUSED');
  }

  async resumeCampaign(campaignId: string) {
    return this.setStatus(campaignId, 'ACTIVE');
  }

  async endCampaign(campaignId: string) {
    return this.setStatus(campaignId, 'ENDED');
  }

  private async setStatus(campaignId: string, status: EventCampaign['status']) {
    const events = await this.prisma.event.findMany({ select: { id: true, metadata: true } });
    for (const event of events) {
      const campaigns = ((event.metadata as { campaigns?: EventCampaign[] })?.campaigns ?? []);
      const idx = campaigns.findIndex((c) => c.id === campaignId);
      if (idx >= 0) {
        campaigns[idx].status = status;
        await this.saveCampaigns(event.id, campaigns);
        return campaigns[idx];
      }
    }
    throw new BadRequestException('Campaign not found');
  }

  async getActiveCampaigns(eventId: string) {
    const now = new Date();
    return (await this.getEventCampaigns(eventId)).filter(
      (c) =>
        c.status === 'ACTIVE' &&
        new Date(c.startsAt) <= now &&
        new Date(c.endsAt) >= now,
    );
  }

  async validatePresaleCode(code: string, eventId: string, _userId: string) {
    const promo = await this.prisma.promotion.findUnique({ where: { code } });
    if (promo && promo.startDate <= new Date() && promo.endDate >= new Date()) {
      if (promo.usageLimit && promo.usageCount >= promo.usageLimit) {
        return { valid: false, reason: 'Código agotado' };
      }
      return {
        valid: true,
        discount: Number(promo.value),
        discountType: promo.type === PromotionType.PERCENTAGE ? 'percentage' : 'fixed',
        promotionId: promo.id,
        campaignName: promo.name,
      };
    }

    const campaigns = await this.getEventCampaigns(eventId);
    for (const c of campaigns) {
      if (c.codes?.includes(code) && c.status === 'ACTIVE') {
        return {
          valid: true,
          discount: c.discountValue,
          discountType: c.discountType,
          campaignId: c.id,
          campaignName: c.name,
        };
      }
    }
    return { valid: false, reason: 'Código inválido' };
  }

  async applyDiscount(campaignId: string, basePrice: number, quantity: number) {
    const events = await this.prisma.event.findMany({ select: { id: true, metadata: true } });
    for (const event of events) {
      const campaigns = ((event.metadata as { campaigns?: EventCampaign[] })?.campaigns ?? []);
      const c = campaigns.find((x) => x.id === campaignId);
      if (c && c.status === 'ACTIVE') {
        const unit =
          c.discountType === 'percentage'
            ? basePrice * (c.discountValue / 100)
            : c.discountValue;
        return {
          basePrice,
          discountAmount: unit,
          finalPrice: Math.max(0, basePrice - unit) * quantity,
        };
      }
    }
    throw new BadRequestException('Campaign not found or not active');
  }

  async getCampaignAnalytics(campaignId: string) {
    const events = await this.prisma.event.findMany({ select: { id: true, metadata: true } });
    for (const event of events) {
      const campaigns = ((event.metadata as { campaigns?: EventCampaign[] })?.campaigns ?? []);
      const c = campaigns.find((x) => x.id === campaignId);
      if (c) {
        const redeemed = c.redeemed ?? 0;
        return {
          campaignId: c.id,
          name: c.name,
          type: c.type,
          status: c.status,
          stats: {
            allocation: c.allocation,
            redeemed,
            remaining: c.allocation - redeemed,
            redemptionRate: c.allocation ? (redeemed / c.allocation) * 100 : 0,
          },
          period: { startDate: c.startsAt, endDate: c.endsAt },
        };
      }
    }
    throw new BadRequestException('Campaign not found');
  }

  async awardLoyaltyPoints(userId: string, eventId: string, points: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    const meta = (user as { metadata?: Record<string, unknown> }).metadata ?? {};
    const loyalty = (meta.loyalty as { points?: number; history?: unknown[] }) ?? { points: 0, history: [] };
    loyalty.points = (loyalty.points ?? 0) + points;
    loyalty.history = [...(loyalty.history ?? []), { eventId, points, at: new Date().toISOString() }];
    return { userId, points: loyalty.points };
  }

  async recordPromotionUse(eventId: string, code: string) {
    const promo = await this.prisma.promotion.findUnique({ where: { code } });
    if (promo) {
      await this.prisma.promotion.update({
        where: { id: promo.id },
        data: { usageCount: { increment: 1 } },
      });
    }

    const campaigns = await this.getEventCampaigns(eventId);
    let changed = false;
    for (const c of campaigns) {
      if (c.codes?.includes(code)) {
        c.redeemed = (c.redeemed ?? 0) + 1;
        changed = true;
        break;
      }
    }
    if (changed) await this.saveCampaigns(eventId, campaigns);
  }

  async exportPresaleCodesCsv(campaignId: string) {
    const events = await this.prisma.event.findMany({ select: { id: true, metadata: true } });
    for (const event of events) {
      const campaigns = ((event.metadata as { campaigns?: EventCampaign[] })?.campaigns ?? []);
      const c = campaigns.find((x) => x.id === campaignId);
      if (!c?.codes?.length) continue;
      const header = 'code,campaign,eventId,status';
      const rows = c.codes.map(
        (code) => `${code},${c.name},${event.id},${c.status}`,
      );
      return {
        filename: `presale-${campaignId}.csv`,
        csv: [header, ...rows].join('\n'),
        count: c.codes.length,
      };
    }
    throw new BadRequestException('Campaign not found or no presale codes');
  }

  async getLoyaltyBalance(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const loyalty = ((user as { metadata?: { loyalty?: { points?: number } } })?.metadata?.loyalty) ?? {};
    return { userId, points: loyalty.points ?? 0 };
  }
}


