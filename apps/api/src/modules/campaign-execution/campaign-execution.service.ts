import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma, PromotionType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import type { ValidatedCreateCampaign } from './campaign.dto';

type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED';

type EventCampaign = {
  id: string;
  eventId: string;
  name: string;
  type: string;
  status: CampaignStatus;
  startsAt: string;
  endsAt: string;
  allocation: number;
  quantityPerUser: number;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  codes?: string[];
  redeemed?: number;
  idempotencyKey?: string;
};

type EventMetadata = {
  campaigns?: EventCampaign[];
  loyaltyLedger?: Record<
    string,
    { points: number; history: Array<{ eventId: string; points: number; at: string }> }
  >;
  [key: string]: unknown;
};

type CampaignLookup = {
  eventId: string;
  organizationId: string;
  campaign: EventCampaign;
  campaigns: EventCampaign[];
  metadata: EventMetadata;
};

@Injectable()
export class CampaignExecutionService {
  private readonly logger = new Logger(CampaignExecutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private asMetadata(metadata: unknown): EventMetadata {
    return typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
      ? ({ ...(metadata as EventMetadata) } as EventMetadata)
      : {};
  }

  private readCampaigns(metadata: unknown): EventCampaign[] {
    const campaigns = this.asMetadata(metadata).campaigns;
    return Array.isArray(campaigns) ? [...campaigns] : [];
  }

  private tenantEventWhere(organizationId?: string): Prisma.EventWhereInput {
    if (organizationId) {
      this.tenant.assertOrganization(organizationId);
      return { organizationId };
    }
    const context = this.tenant.current();
    if (context.privileged) return {};
    return { organizationId: this.tenant.requireOrganization() };
  }

  private async requireOwnedEvent(eventId: string, organizationId?: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, ...this.tenantEventWhere(organizationId) },
      select: { id: true, organizationId: true, metadata: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');
    this.tenant.assertOrganization(event.organizationId);
    return event;
  }

  private async findCampaignForTenant(campaignId: string): Promise<CampaignLookup> {
    const events = await this.prisma.event.findMany({
      where: this.tenantEventWhere(),
      select: { id: true, organizationId: true, metadata: true },
    });

    for (const event of events) {
      const metadata = this.asMetadata(event.metadata);
      const campaigns = this.readCampaigns(metadata);
      const campaign = campaigns.find((item) => item.id === campaignId);
      if (!campaign) continue;
      this.tenant.assertOrganization(event.organizationId);
      return {
        eventId: event.id,
        organizationId: event.organizationId,
        campaign,
        campaigns,
        metadata,
      };
    }

    throw new NotFoundException('Campaña no encontrada');
  }

  private async persistCampaigns(
    eventId: string,
    metadata: EventMetadata,
    campaigns: EventCampaign[],
  ) {
    await this.prisma.event.update({
      where: { id: eventId },
      data: {
        metadata: {
          ...metadata,
          campaigns,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private generatePresaleCodes(allocation: number): string[] {
    const count = Math.min(Math.max(allocation, 0), 500);
    const codes = new Set<string>();
    while (codes.size < count) {
      codes.add(`PS${randomBytes(4).toString('hex').toUpperCase().slice(0, 6)}`);
    }
    return [...codes];
  }

  async createCampaign(
    organizationId: string,
    eventId: string,
    data: ValidatedCreateCampaign,
    idempotencyKey?: string,
  ) {
    this.tenant.assertOrganization(organizationId);
    const event = await this.requireOwnedEvent(eventId, organizationId);
    const metadata = this.asMetadata(event.metadata);
    const campaigns = this.readCampaigns(metadata);
    const normalizedKey = idempotencyKey?.trim();

    if (normalizedKey) {
      const existing = campaigns.find((campaign) => campaign.idempotencyKey === normalizedKey);
      if (existing) return existing;
    }

    const campaign: EventCampaign = {
      id: `camp_${Date.now()}_${randomBytes(3).toString('hex')}`,
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
      codes: data.type === 'presale' ? this.generatePresaleCodes(data.allocation) : undefined,
      idempotencyKey: normalizedKey || undefined,
    };

    await this.prisma.$transaction(async (tx) => {
      if (data.type === 'early_bird' || data.type === 'presale') {
        const code = `CAMP-${campaign.id.slice(-6).toUpperCase()}`;
        await tx.promotion.upsert({
          where: { code },
          create: {
            code,
            organizationId,
            name: data.name,
            type:
              data.discountType === 'percentage'
                ? PromotionType.PERCENTAGE
                : PromotionType.FIXED_AMOUNT,
            value: new Decimal(data.discountValue),
            startDate: data.startsAt,
            endDate: data.endsAt,
            usageLimit: data.allocation,
            usagePerCustomer: data.quantityPerUser,
          },
          update: {
            name: data.name,
            startDate: data.startsAt,
            endDate: data.endsAt,
            value: new Decimal(data.discountValue),
            usageLimit: data.allocation,
            usagePerCustomer: data.quantityPerUser,
          },
        });
      }

      campaigns.push(campaign);
      await tx.event.update({
        where: { id: eventId },
        data: {
          metadata: {
            ...metadata,
            campaigns,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });

    await this.audit.log({
      action: 'CAMPAIGN_CREATED',
      entityType: 'Campaign',
      entityId: campaign.id,
      organizationId,
      userId: this.tenant.current().userId,
      metadata: { eventId, type: campaign.type, name: campaign.name },
    });

    this.logger.log(`Campaign created: ${campaign.id}`);
    return campaign;
  }

  async listCampaigns(eventId: string, page?: number, limit?: number) {
    const event = await this.requireOwnedEvent(eventId);
    const campaigns = this.readCampaigns(event.metadata);
    if (page == null && limit == null) return campaigns;

    const safePage = Math.max(1, page ?? 1);
    const safeLimit = Math.min(100, Math.max(1, limit ?? 50));
    const start = (safePage - 1) * safeLimit;
    return campaigns.slice(start, start + safeLimit);
  }

  async publishCampaign(campaignId: string) {
    return this.setStatus(campaignId, 'ACTIVE', 'CAMPAIGN_PUBLISHED');
  }

  async pauseCampaign(campaignId: string) {
    return this.setStatus(campaignId, 'PAUSED', 'CAMPAIGN_PAUSED');
  }

  async resumeCampaign(campaignId: string) {
    return this.setStatus(campaignId, 'ACTIVE', 'CAMPAIGN_RESUMED');
  }

  async endCampaign(campaignId: string) {
    return this.setStatus(campaignId, 'ENDED', 'CAMPAIGN_ENDED');
  }

  private async setStatus(
    campaignId: string,
    status: CampaignStatus,
    auditAction: string,
  ) {
    const found = await this.findCampaignForTenant(campaignId);
    const campaigns = found.campaigns.map((campaign) =>
      campaign.id === campaignId ? { ...campaign, status } : campaign,
    );
    const updated = campaigns.find((campaign) => campaign.id === campaignId);
    if (!updated) throw new NotFoundException('Campaña no encontrada');

    await this.persistCampaigns(found.eventId, found.metadata, campaigns);
    await this.audit.log({
      action: auditAction,
      entityType: 'Campaign',
      entityId: campaignId,
      organizationId: found.organizationId,
      userId: this.tenant.current().userId,
      metadata: { eventId: found.eventId, status },
    });
    return updated;
  }

  async getActiveCampaigns(eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId },
      select: { id: true, metadata: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');

    const now = new Date();
    return this.readCampaigns(event.metadata).filter(
      (campaign) =>
        campaign.status === 'ACTIVE' &&
        new Date(campaign.startsAt) <= now &&
        new Date(campaign.endsAt) >= now,
    );
  }

  async validatePresaleCode(code: string, eventId: string, _userId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId },
      select: { id: true, organizationId: true, metadata: true },
    });
    if (!event) {
      return { valid: false, reason: 'Evento no encontrado' };
    }

    const promo = await this.prisma.promotion.findFirst({
      where: { code, organizationId: event.organizationId },
    });
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

    for (const campaign of this.readCampaigns(event.metadata)) {
      if (campaign.codes?.includes(code) && campaign.status === 'ACTIVE') {
        return {
          valid: true,
          discount: campaign.discountValue,
          discountType: campaign.discountType,
          campaignId: campaign.id,
          campaignName: campaign.name,
        };
      }
    }
    return { valid: false, reason: 'Código inválido' };
  }

  async applyDiscount(campaignId: string, basePrice: number, quantity: number) {
    // Public checkout preview: resolve by campaign id without staff JWT.
    const events = await this.prisma.event.findMany({
      select: { id: true, metadata: true },
    });

    for (const event of events) {
      const campaign = this.readCampaigns(event.metadata).find((item) => item.id === campaignId);
      if (campaign?.status === 'ACTIVE') {
        const unit =
          campaign.discountType === 'percentage'
            ? basePrice * (campaign.discountValue / 100)
            : campaign.discountValue;
        return {
          basePrice,
          discountAmount: unit,
          finalPrice: Math.max(0, basePrice - unit) * quantity,
        };
      }
    }
    throw new BadRequestException('Campaña no encontrada o inactiva');
  }

  async getCampaignAnalytics(campaignId: string) {
    const found = await this.findCampaignForTenant(campaignId);
    const redeemed = found.campaign.redeemed ?? 0;
    return {
      campaignId: found.campaign.id,
      name: found.campaign.name,
      type: found.campaign.type,
      status: found.campaign.status,
      stats: {
        allocation: found.campaign.allocation,
        redeemed,
        remaining: found.campaign.allocation - redeemed,
        redemptionRate: found.campaign.allocation
          ? (redeemed / found.campaign.allocation) * 100
          : 0,
      },
      period: { startDate: found.campaign.startsAt, endDate: found.campaign.endsAt },
    };
  }

  async awardLoyaltyPoints(userId: string, eventId: string, points: number) {
    const event = await this.requireOwnedEvent(eventId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const metadata = this.asMetadata(event.metadata);
    const ledger = { ...(metadata.loyaltyLedger ?? {}) };
    const entry = ledger[userId] ?? { points: 0, history: [] };
    entry.points += points;
    entry.history = [
      ...entry.history,
      { eventId, points, at: new Date().toISOString() },
    ].slice(-200);
    ledger[userId] = entry;

    await this.prisma.event.update({
      where: { id: event.id },
      data: {
        metadata: {
          ...metadata,
          loyaltyLedger: ledger,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await this.audit.log({
      action: 'LOYALTY_POINTS_AWARDED',
      entityType: 'Loyalty',
      entityId: userId,
      organizationId: event.organizationId,
      userId: this.tenant.current().userId,
      metadata: { eventId, points, balance: entry.points },
    });

    return { userId, points: entry.points };
  }

  async recordPromotionUse(eventId: string, code: string) {
    await this.prisma.$transaction(async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: eventId },
        select: { id: true, organizationId: true, metadata: true },
      });
      if (!event) return;

      const promo = await tx.promotion.findFirst({
        where: { code, organizationId: event.organizationId },
      });
      if (promo) {
        if (promo.usageLimit != null && promo.usageCount >= promo.usageLimit) {
          throw new BadRequestException('Código agotado');
        }
        await tx.promotion.update({
          where: { id: promo.id },
          data: { usageCount: { increment: 1 } },
        });
      }

      const metadata = this.asMetadata(event.metadata);
      const campaigns = this.readCampaigns(metadata);
      let changed = false;
      for (const campaign of campaigns) {
        if (campaign.codes?.includes(code)) {
          campaign.redeemed = (campaign.redeemed ?? 0) + 1;
          changed = true;
          break;
        }
      }
      if (changed) {
        await tx.event.update({
          where: { id: eventId },
          data: {
            metadata: {
              ...metadata,
              campaigns,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }
    });
  }

  async exportPresaleCodesCsv(campaignId: string) {
    const found = await this.findCampaignForTenant(campaignId);
    if (!found.campaign.codes?.length) {
      throw new BadRequestException('Campaña no encontrada o sin códigos de preventa');
    }
    const header = 'code,campaign,eventId,status';
    const rows = found.campaign.codes.map(
      (code) => `${code},${found.campaign.name},${found.eventId},${found.campaign.status}`,
    );
    return {
      filename: `presale-${campaignId}.csv`,
      csv: [header, ...rows].join('\n'),
      count: found.campaign.codes.length,
    };
  }

  async getLoyaltyBalance(userId: string, actor?: AuthenticatedUser) {
    if (
      actor &&
      actor.role !== 'SUPER_ADMIN' &&
      actor.role !== 'ADMIN' &&
      actor.role !== 'PROMOTER' &&
      actor.sub !== userId
    ) {
      throw new ForbiddenException('No puedes consultar el saldo de lealtad de otro usuario');
    }

    let organizationId = actor?.organizationId;
    if (!organizationId && actor?.role !== 'SUPER_ADMIN') {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { organizationId: true },
      });
      organizationId = user?.organizationId ?? undefined;
    }

    const events = await this.prisma.event.findMany({
      where: this.tenantEventWhere(organizationId),
      select: { metadata: true },
    });

    let points = 0;
    for (const event of events) {
      const ledger = this.asMetadata(event.metadata).loyaltyLedger?.[userId];
      if (ledger?.points) points += ledger.points;
    }

    return { userId, points };
  }
}
