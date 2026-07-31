import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PromotionType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { PricingCacheService } from './pricing-cache.service';
import {
  encodeAppliedReason,
  encodePendingReason,
  encodeRejectedReason,
  isPendingReason,
  parsePendingReason,
} from './pending-reason';
import {
  SEGMENT_MULTIPLIERS,
  calculateSurgePricingLegacy,
  calculateTimeMultiplierLegacy,
  recommendForEvent,
} from './recommendation.engine';
import { applyGuardrails, roundMoneyPublic } from './guardrails';
import {
  PENDING_REASON_PREFIX,
  SERVICE_FEE_RATE,
  TAX_RATE,
  type EventRecommendationBundle,
  type EventSignals,
  type OfferRecommendation,
  type OfferSignals,
  type PricingContext,
  type PricingResult,
  type PricingRulesConfig,
  type SurgeTier,
  type TimeBasedRule,
} from './pricing.types';

interface PromotionRow {
  type: PromotionType;
  value: Decimal;
  maxDiscount: Decimal | null;
  startDate: Date;
  endDate: Date;
  usageLimit: number | null;
  usageCount: number;
  organizationId: string;
  code: string;
}

interface EventPricingRow {
  id: string;
  organizationId: string;
  title: string;
  startsAt: Date;
  salesStartAt: Date | null;
  createdAt: Date;
  enableDynamic: boolean;
  minPrice: Decimal;
  maxPrice: Decimal;
  surgeThreshold: number;
  surgePriceMultiplier: number;
  totalCapacity: number;
  currency: string;
  metadata: unknown;
  offers: Array<{
    id: string;
    name: string;
    zone: string;
    basePrice: Decimal;
    totalQuantity: number;
    remainingQuantity: number;
    soldQuantity: number;
    holdQuantity: number;
  }>;
}

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: PricingCacheService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly tenant?: TenantContextService,
  ) {}

  // ==================== CALCULATE PRICING (checkout-compatible) ====================

  async calculatePrice(ctx: PricingContext): Promise<PricingResult> {
    const [event, offer] = await Promise.all([
      this.prisma.event.findUnique({
        where: { id: ctx.eventId },
        select: {
          id: true,
          organizationId: true,
          startsAt: true,
          enableDynamic: true,
          minPrice: true,
          maxPrice: true,
          surgeThreshold: true,
          surgePriceMultiplier: true,
          metadata: true,
        },
      }),
      this.prisma.offer.findUnique({
        where: { id: ctx.offerId },
        select: {
          id: true,
          eventId: true,
          zone: true,
          basePrice: true,
          totalQuantity: true,
          soldQuantity: true,
          remainingQuantity: true,
        },
      }),
    ]);

    if (!event || !offer || offer.eventId !== ctx.eventId) {
      throw new BadRequestException('Event or offer not found');
    }

    const appliedRules: string[] = [];
    let dynamicMultiplier = 1;
    const basePrice = Number(offer.basePrice);
    const occupancyRate =
      offer.soldQuantity / Math.max(offer.totalQuantity, 1);
    appliedRules.push(`Occupancy: ${(occupancyRate * 100).toFixed(1)}%`);

    if (event.enableDynamic) {
      const surge = calculateSurgePricingLegacy(occupancyRate);
      if (surge.multiplier !== 1) {
        dynamicMultiplier *= surge.multiplier;
        appliedRules.push(`Surge pricing: ${surge.reason}`);
      }
    }

    const daysUntilEvent =
      (event.startsAt.getTime() - (ctx.timestamp?.getTime() ?? Date.now())) /
      (1000 * 60 * 60 * 24);
    const timeMultiplier = calculateTimeMultiplierLegacy(daysUntilEvent);
    if (timeMultiplier !== 1) {
      dynamicMultiplier *= timeMultiplier;
      appliedRules.push(
        `Time-based pricing: ${daysUntilEvent.toFixed(0)} days until event`,
      );
    }

    const segmentKey =
      ctx.customerSegment === 'EARLY_BUYER'
        ? 'EARLY_BIRD'
        : ctx.customerSegment || 'REGULAR';
    const segmentMultiplier = SEGMENT_MULTIPLIERS[segmentKey] ?? 1;
    if (segmentMultiplier !== 1) {
      dynamicMultiplier *= segmentMultiplier;
      appliedRules.push(`Customer segment: ${ctx.customerSegment || 'REGULAR'}`);
    }

    let discountAmount = 0;
    if (ctx.promotionCode) {
      const promotion = await this.prisma.promotion.findUnique({
        where: { code: ctx.promotionCode },
      });
      if (
        promotion &&
        this.isPromotionValid(promotion) &&
        promotion.organizationId === event.organizationId
      ) {
        discountAmount = this.calculateDiscount(
          promotion,
          basePrice * dynamicMultiplier * ctx.quantity,
        );
        appliedRules.push(
          `Promotion ${ctx.promotionCode}: -${discountAmount.toFixed(2)}`,
        );
      }
    }

    const rules = this.parsePricingRules(event.metadata);
    const candidate = roundMoneyPublic(basePrice * dynamicMultiplier);
    const guard = applyGuardrails(
      {
        minPrice: Number(event.minPrice),
        maxPrice: Number(event.maxPrice),
        pricingRules: rules,
      },
      { basePrice, zone: offer.zone },
      candidate,
    );
    const unit = guard.clamped ? roundMoneyPublic(
      Math.min(guard.ceiling, Math.max(guard.floor, candidate)),
    ) : candidate;
    if (guard.clamped) {
      dynamicMultiplier = unit / Math.max(basePrice, 0.01);
      appliedRules.push(`Guardrail band: ${guard.bandLabel}`);
    }

    const adjustedPrice = new Decimal(unit);
    const subtotal = new Decimal(unit * ctx.quantity - discountAmount);
    const fees = subtotal.mul(SERVICE_FEE_RATE);
    const taxes = subtotal.mul(TAX_RATE);
    const total = subtotal.plus(fees).plus(taxes);

    this.logger.log(
      `Price calculated for event ${ctx.eventId}: ${total.toFixed(2)} (multiplier: ${dynamicMultiplier.toFixed(2)})`,
    );

    return {
      basePrice: new Decimal(basePrice),
      dynamicMultiplier,
      adjustedPrice,
      discount: new Decimal(discountAmount),
      subtotal,
      fees,
      taxes,
      total,
      breakdown: {
        reason: 'Dynamic pricing applied',
        appliedRules,
      },
    };
  }

  // ==================== RECOMMENDATIONS ====================

  async getRecommendations(
    eventId: string,
    options?: { preview?: boolean },
  ): Promise<EventRecommendationBundle> {
    const event = await this.loadEventForPricing(eventId);
    this.assertTenant(event.organizationId);

    const cacheKey = this.cache.wrapKey([
      'rec',
      event.organizationId,
      eventId,
      options?.preview ? 'preview' : 'live',
    ]);
    const cached = this.cache.get<EventRecommendationBundle>(cacheKey);
    if (cached) return cached;

    const bundle = await this.buildRecommendations(event);
    this.cache.set(cacheKey, bundle, 30);
    return bundle;
  }

  /**
   * Preview recommendations without persisting pending rows.
   */
  async previewRecommendations(eventId: string): Promise<EventRecommendationBundle> {
    return this.getRecommendations(eventId, { preview: true });
  }

  /**
   * Persist pending recommendations and auto-apply only safe deltas.
   * Replaces blind surge writes with an explainable, guarded flow.
   * Endpoint `POST events/:eventId/update-dynamic` remains compatible.
   */
  async updateDynamicPrices(eventId: string): Promise<{
    message: string;
    applied: number;
    pendingApproval: number;
    held: number;
    bundle: EventRecommendationBundle;
  }> {
    const event = await this.loadEventForPricing(eventId);
    this.assertTenant(event.organizationId);

    const bundle = await this.buildRecommendations(event);
    const now = new Date();
    let applied = 0;
    let pendingApproval = 0;
    let held = 0;

    const actionable = bundle.recommendations.filter((r) => r.direction !== 'hold');
    held = bundle.recommendations.length - actionable.length;

    await this.prisma.$transaction(async (tx) => {
      for (const rec of actionable) {
        if (rec.autoApplicable) {
          await tx.dynamicPrice.updateMany({
            where: {
              eventId,
              offerId: rec.offerId,
              activeFrom: { lte: now },
              activeTo: { gt: now },
            },
            data: { activeTo: now },
          });
          await tx.dynamicPrice.create({
            data: {
              eventId,
              offerId: rec.offerId,
              adjustedPrice: new Decimal(rec.recommendedPrice),
              priceMultiplier: rec.recommendedMultiplier,
              reason: encodeAppliedReason(rec.explanation),
              activeFrom: now,
              activeTo: new Date(now.getTime() + 60 * 60 * 1000),
            },
          });
          applied += 1;
        } else {
          await tx.dynamicPrice.create({
            data: {
              eventId,
              offerId: rec.offerId,
              adjustedPrice: new Decimal(rec.recommendedPrice),
              priceMultiplier: rec.recommendedMultiplier,
              reason: encodePendingReason({
                v: 1,
                status: 'pending',
                explanation: rec.explanation,
                factors: rec.factors,
                direction: rec.direction,
                deltaPercent: rec.deltaPercent,
                requiresApproval: true,
                guardrail: rec.guardrail,
                basePrice: rec.basePrice,
                currentPrice: rec.currentPrice,
              }),
              // Inactive until approved
              activeFrom: new Date('2099-01-01T00:00:00.000Z'),
              activeTo: new Date('2099-01-01T01:00:00.000Z'),
            },
          });
          pendingApproval += 1;
        }
      }
    });

    this.cache.invalidatePrefix(`rec|${event.organizationId}|${eventId}`);

    await this.audit?.log({
      action: 'pricing.recommendations.generated',
      entityType: 'Event',
      entityId: eventId,
      organizationId: event.organizationId,
      userId: this.tenant?.current().userId,
      metadata: {
        applied,
        pendingApproval,
        held,
        summary: bundle.summary,
        signals: bundle.signals,
      },
    });

    this.logger.log(
      `Dynamic pricing for ${eventId}: applied=${applied} pending=${pendingApproval} held=${held}`,
    );

    return {
      message: 'Dynamic prices updated',
      applied,
      pendingApproval,
      held,
      bundle,
    };
  }

  /**
   * Apply a subset of live recommendations (with optional forced approval).
   */
  async applyRecommendations(
    eventId: string,
    dto: { confirmApproval?: boolean; offerIds?: string[] },
  ): Promise<{ applied: string[]; skipped: string[]; pendingCreated: string[] }> {
    const event = await this.loadEventForPricing(eventId);
    this.assertTenant(event.organizationId);

    const bundle = await this.buildRecommendations(event);
    const filter = dto.offerIds?.length ? new Set(dto.offerIds) : null;
    const now = new Date();
    const applied: string[] = [];
    const skipped: string[] = [];
    const pendingCreated: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const rec of bundle.recommendations) {
        if (filter && !filter.has(rec.offerId)) continue;
        if (rec.direction === 'hold') {
          skipped.push(rec.offerId);
          continue;
        }
        if (rec.requiresApproval && !dto.confirmApproval) {
          await tx.dynamicPrice.create({
            data: {
              eventId,
              offerId: rec.offerId,
              adjustedPrice: new Decimal(rec.recommendedPrice),
              priceMultiplier: rec.recommendedMultiplier,
              reason: encodePendingReason({
                v: 1,
                status: 'pending',
                explanation: rec.explanation,
                factors: rec.factors,
                direction: rec.direction,
                deltaPercent: rec.deltaPercent,
                requiresApproval: true,
                guardrail: rec.guardrail,
                basePrice: rec.basePrice,
                currentPrice: rec.currentPrice,
              }),
              activeFrom: new Date('2099-01-01T00:00:00.000Z'),
              activeTo: new Date('2099-01-01T01:00:00.000Z'),
            },
          });
          pendingCreated.push(rec.offerId);
          continue;
        }

        await tx.dynamicPrice.updateMany({
          where: {
            eventId,
            offerId: rec.offerId,
            activeFrom: { lte: now },
            activeTo: { gt: now },
          },
          data: { activeTo: now },
        });
        await tx.dynamicPrice.create({
          data: {
            eventId,
            offerId: rec.offerId,
            adjustedPrice: new Decimal(rec.recommendedPrice),
            priceMultiplier: rec.recommendedMultiplier,
            reason: encodeAppliedReason(rec.explanation),
            activeFrom: now,
            activeTo: new Date(now.getTime() + 60 * 60 * 1000),
          },
        });
        applied.push(rec.offerId);
      }
    });

    this.cache.invalidatePrefix(`rec|${event.organizationId}|${eventId}`);

    await this.audit?.log({
      action: 'pricing.recommendations.applied',
      entityType: 'Event',
      entityId: eventId,
      organizationId: event.organizationId,
      userId: this.tenant?.current().userId,
      metadata: {
        applied,
        skipped,
        pendingCreated,
        confirmApproval: Boolean(dto.confirmApproval),
      },
    });

    return { applied, skipped, pendingCreated };
  }

  async listPendingRecommendations(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, organizationId: true },
    });
    if (!event) throw new NotFoundException('Event not found');
    this.assertTenant(event.organizationId);

    const rows = await this.prisma.dynamicPrice.findMany({
      where: {
        eventId,
        reason: { startsWith: PENDING_REASON_PREFIX },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return rows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      offerId: row.offerId,
      adjustedPrice: Number(row.adjustedPrice),
      priceMultiplier: row.priceMultiplier,
      createdAt: row.createdAt,
      status: 'pending' as const,
      payload: parsePendingReason(row.reason),
      reason: row.reason,
    }));
  }

  async approveRecommendation(
    recommendationId: string,
    note?: string,
  ): Promise<{ id: string; status: 'approved' }> {
    const row = await this.prisma.dynamicPrice.findUnique({
      where: { id: recommendationId },
      include: {
        event: { select: { organizationId: true } },
        offer: { select: { basePrice: true } },
      },
    });
    if (!row || !isPendingReason(row.reason)) {
      throw new NotFoundException('Pending recommendation not found');
    }
    this.assertTenant(row.event.organizationId);

    const payload = parsePendingReason(row.reason);
    if (!payload) throw new BadRequestException('Invalid pending payload');

    const now = new Date();
    if (now.getTime() - row.createdAt.getTime() > 24 * 60 * 60 * 1000) {
      throw new ConflictException(
        'Recommendation expired; generate a new preview',
      );
    }

    const active = await this.prisma.dynamicPrice.findFirst({
      where: {
        eventId: row.eventId,
        offerId: row.offerId,
        activeFrom: { lte: now },
        activeTo: { gt: now },
        NOT: { reason: { startsWith: PENDING_REASON_PREFIX } },
      },
      orderBy: { createdAt: 'desc' },
      select: { adjustedPrice: true },
    });
    const currentPrice = active
      ? Number(active.adjustedPrice)
      : Number(row.offer.basePrice);
    if (Math.abs(currentPrice - payload.currentPrice) > 0.01) {
      throw new ConflictException(
        'Current price changed; generate a new recommendation before approval',
      );
    }

    const approvedPrice = Number(row.adjustedPrice);
    if (
      !Number.isFinite(approvedPrice) ||
      approvedPrice < payload.guardrail.floor ||
      approvedPrice > payload.guardrail.ceiling
    ) {
      throw new ConflictException(
        'Recommendation is outside its approved price band',
      );
    }

    const explanation = [
      payload.explanation,
      note ? `Note: ${note}` : null,
    ]
      .filter(Boolean)
      .join(' | ');

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.dynamicPrice.updateMany({
        where: {
          eventId: row.eventId,
          offerId: row.offerId,
          id: { not: recommendationId },
          activeFrom: { lte: now },
          activeTo: { gt: now },
        },
        data: { activeTo: now },
      });
      return tx.dynamicPrice.updateMany({
        where: { id: recommendationId, reason: row.reason },
        data: {
          reason: encodeAppliedReason(explanation),
          activeFrom: now,
          activeTo: new Date(now.getTime() + 60 * 60 * 1000),
        },
      });
    });
    if (updated.count !== 1) {
      throw new ConflictException('Recommendation was already reviewed');
    }

    this.cache.invalidatePrefix(
      `rec|${row.event.organizationId}|${row.eventId}`,
    );

    await this.audit?.log({
      action: 'pricing.recommendation.approved',
      entityType: 'DynamicPrice',
      entityId: recommendationId,
      organizationId: row.event.organizationId,
      userId: this.tenant?.current().userId,
      metadata: {
        eventId: row.eventId,
        offerId: row.offerId,
        adjustedPrice: approvedPrice,
        previousPrice: currentPrice,
        note: note?.slice(0, 500),
      },
    });

    return { id: recommendationId, status: 'approved' };
  }

  async rejectRecommendation(
    recommendationId: string,
    reason?: string,
  ): Promise<{ id: string; status: 'rejected' }> {
    const row = await this.prisma.dynamicPrice.findUnique({
      where: { id: recommendationId },
      include: {
        event: { select: { organizationId: true } },
      },
    });
    if (!row || !isPendingReason(row.reason)) {
      throw new NotFoundException('Pending recommendation not found');
    }
    this.assertTenant(row.event.organizationId);

    const payload = parsePendingReason(row.reason);
    if (!payload) throw new BadRequestException('Invalid pending payload');

    const updated = await this.prisma.dynamicPrice.updateMany({
      where: { id: recommendationId, reason: row.reason },
      data: {
        reason: encodeRejectedReason(payload, reason),
        activeFrom: new Date('2099-01-01T00:00:00.000Z'),
        activeTo: new Date('2099-01-01T00:00:00.000Z'),
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException('Recommendation was already reviewed');
    }

    this.cache.invalidatePrefix(
      `rec|${row.event.organizationId}|${row.eventId}`,
    );

    await this.audit?.log({
      action: 'pricing.recommendation.rejected',
      entityType: 'DynamicPrice',
      entityId: recommendationId,
      organizationId: row.event.organizationId,
      userId: this.tenant?.current().userId,
      metadata: {
        eventId: row.eventId,
        offerId: row.offerId,
        reason: reason?.slice(0, 500),
      },
    });

    return { id: recommendationId, status: 'rejected' };
  }

  // ==================== GET PRICE HISTORY ====================

  async getPriceHistory(offerId: string, limit = 20) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      select: {
        id: true,
        event: { select: { organizationId: true } },
      },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    this.assertTenant(offer.event.organizationId);

    const take = Math.min(Math.max(limit || 20, 1), 200);
    return this.prisma.dynamicPrice.findMany({
      where: { offerId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  // ==================== ESTIMATE REVENUE (no N+1) ====================

  async estimateEventRevenue(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        organizationId: true,
        totalCapacity: true,
        currency: true,
        offers: {
          select: {
            id: true,
            basePrice: true,
            soldQuantity: true,
          },
        },
      },
    });

    if (!event) throw new BadRequestException('Event not found');
    this.assertTenant(event.organizationId);

    // Prefer denormalized soldQuantity; single groupBy fallback for consistency check.
    const soldGroups = await this.prisma.ticket.groupBy({
      by: ['offerId'],
      where: {
        eventId,
        status: { in: ['SOLD', 'USED'] },
      },
      _count: true,
    });
    const soldByOffer = new Map(soldGroups.map((g) => [g.offerId, g._count]));

    let totalRevenue = 0;
    let soldTickets = 0;

    for (const offer of event.offers) {
      const sold = soldByOffer.get(offer.id) ?? offer.soldQuantity;
      totalRevenue += sold * Number(offer.basePrice);
      soldTickets += sold;
    }

    const commission = await this.calculateCommission(
      event.organizationId,
      totalRevenue,
    );

    return {
      eventId,
      title: event.title,
      totalCapacity: event.totalCapacity,
      soldTickets,
      occupancyPercent: ((soldTickets / Math.max(event.totalCapacity, 1)) * 100).toFixed(2),
      grossRevenue: totalRevenue,
      commission,
      netRevenue: totalRevenue - commission,
      currency: event.currency,
    };
  }

  // ==================== INTERNALS ====================

  private assertTenant(organizationId: string): void {
    if (!this.tenant) {
      throw new ForbiddenException('Tenant context unavailable');
    }
    const ctx = this.tenant.current();
    if (!ctx.organizationId && !ctx.privileged) {
      throw new ForbiddenException('Organization access denied');
    }
    try {
      this.tenant.assertOrganization(organizationId);
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      throw new ForbiddenException('Organization access denied');
    }
  }

  private parsePricingRules(metadata: unknown): PricingRulesConfig | undefined {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return undefined;
    }
    const root = metadata as { pricingRules?: unknown };
    const rules = root.pricingRules;
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
      return undefined;
    }
    const raw = rules as {
      dynamicPricingEnabled?: unknown;
      autoApplyMaxDelta?: unknown;
      floorMultiplier?: unknown;
      ceilingMultiplier?: unknown;
      surgeTiers?: unknown;
      timeBasedRules?: unknown;
      customZonePricing?: unknown;
    };

    const finite = (value: unknown): value is number =>
      typeof value === 'number' && Number.isFinite(value);
    const positive = (value: unknown): value is number =>
      finite(value) && value > 0;
    const isObject = (value: unknown): value is Record<string, unknown> =>
      value != null && typeof value === 'object' && !Array.isArray(value);

    const parsed: PricingRulesConfig = {};
    if (typeof raw.dynamicPricingEnabled === 'boolean') {
      parsed.dynamicPricingEnabled = raw.dynamicPricingEnabled;
    }
    if (finite(raw.autoApplyMaxDelta) && raw.autoApplyMaxDelta >= 0) {
      parsed.autoApplyMaxDelta = Math.min(raw.autoApplyMaxDelta, 0.25);
    }
    if (positive(raw.floorMultiplier)) {
      parsed.floorMultiplier = raw.floorMultiplier;
    }
    if (positive(raw.ceilingMultiplier)) {
      parsed.ceilingMultiplier = raw.ceilingMultiplier;
    }
    if (Array.isArray(raw.surgeTiers)) {
      const tiers: SurgeTier[] = [];
      for (const tier of raw.surgeTiers.slice(0, 20)) {
        if (!isObject(tier)) continue;
        const occupancy = tier.occupancy;
        const multiplier = tier.multiplier;
        if (
          finite(occupancy) &&
          occupancy >= 0 &&
          occupancy <= 1 &&
          positive(multiplier)
        ) {
          tiers.push({ occupancy, multiplier });
        }
      }
      if (tiers.length) parsed.surgeTiers = tiers;
    }
    if (Array.isArray(raw.timeBasedRules)) {
      const timeRules: TimeBasedRule[] = [];
      for (const rule of raw.timeBasedRules.slice(0, 20)) {
        if (!isObject(rule)) continue;
        const daysUntilEvent = rule.daysUntilEvent;
        const multiplier = rule.multiplier;
        if (finite(daysUntilEvent) && daysUntilEvent >= 0 && positive(multiplier)) {
          timeRules.push({ daysUntilEvent, multiplier });
        }
      }
      if (timeRules.length) parsed.timeBasedRules = timeRules;
    }
    if (isObject(raw.customZonePricing)) {
      const zones: Record<string, number> = {};
      let count = 0;
      for (const [zone, price] of Object.entries(raw.customZonePricing)) {
        if (count >= 100) break;
        if (zone.length <= 128 && positive(price)) {
          zones[zone] = price;
          count += 1;
        }
      }
      if (count > 0) parsed.customZonePricing = zones;
    }
    return parsed;
  }

  private async loadEventForPricing(eventId: string): Promise<EventPricingRow> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        organizationId: true,
        title: true,
        startsAt: true,
        salesStartAt: true,
        createdAt: true,
        enableDynamic: true,
        minPrice: true,
        maxPrice: true,
        surgeThreshold: true,
        surgePriceMultiplier: true,
        totalCapacity: true,
        currency: true,
        metadata: true,
        offers: {
          select: {
            id: true,
            name: true,
            zone: true,
            basePrice: true,
            totalQuantity: true,
            remainingQuantity: true,
            soldQuantity: true,
            holdQuantity: true,
          },
        },
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  private async buildRecommendations(
    event: EventPricingRow,
  ): Promise<EventRecommendationBundle> {
    const offerIds = event.offers.map((o) => o.id);
    const now = new Date();

    // Active dynamic prices in one query (no N+1).
    const activeDynamics =
      offerIds.length === 0
        ? []
        : await this.prisma.dynamicPrice.findMany({
            where: {
              eventId: event.id,
              offerId: { in: offerIds },
              activeFrom: { lte: now },
              activeTo: { gt: now },
              NOT: { reason: { startsWith: PENDING_REASON_PREFIX } },
            },
            orderBy: { createdAt: 'desc' },
            select: {
              offerId: true,
              adjustedPrice: true,
            },
          });

    const latestByOffer = new Map<string, number>();
    for (const row of activeDynamics) {
      if (!latestByOffer.has(row.offerId)) {
        latestByOffer.set(row.offerId, Number(row.adjustedPrice));
      }
    }

    // Optional ticket recount in one groupBy for accuracy.
    const soldGroups =
      offerIds.length === 0
        ? []
        : await this.prisma.ticket.groupBy({
            by: ['offerId'],
            where: {
              eventId: event.id,
              offerId: { in: offerIds },
              status: { in: ['SOLD', 'USED'] },
            },
            _count: true,
          });
    const soldByOffer = new Map(soldGroups.map((g) => [g.offerId, g._count]));

    const signals: EventSignals = {
      eventId: event.id,
      organizationId: event.organizationId,
      title: event.title,
      startsAt: event.startsAt,
      salesStartAt: event.salesStartAt,
      createdAt: event.createdAt,
      enableDynamic: event.enableDynamic,
      minPrice: Number(event.minPrice),
      maxPrice: Number(event.maxPrice),
      surgeThreshold: event.surgeThreshold,
      surgePriceMultiplier: event.surgePriceMultiplier,
      totalCapacity: event.totalCapacity,
      currency: event.currency,
      pricingRules: this.parsePricingRules(event.metadata),
      now,
    };

    const offers: OfferSignals[] = event.offers.map((o) => {
      const sold = soldByOffer.get(o.id) ?? o.soldQuantity;
      const base = Number(o.basePrice);
      return {
        offerId: o.id,
        name: o.name,
        zone: o.zone,
        basePrice: base,
        totalQuantity: o.totalQuantity,
        soldQuantity: sold,
        remainingQuantity: Math.max(0, o.totalQuantity - sold - o.holdQuantity),
        holdQuantity: o.holdQuantity,
        currentPrice: latestByOffer.get(o.id) ?? base,
      };
    });

    return recommendForEvent(signals, offers);
  }

  private calculateDiscount(promotion: PromotionRow, subtotal: number): number {
    if (promotion.type === 'PERCENTAGE') {
      const discount = subtotal * (Number(promotion.value) / 100);
      const maxDiscount = promotion.maxDiscount
        ? Number(promotion.maxDiscount)
        : Infinity;
      return Math.min(discount, maxDiscount);
    }

    if (promotion.type === 'FIXED_AMOUNT') {
      return Math.min(Number(promotion.value), subtotal);
    }

    if (promotion.type === 'BOGO') {
      return subtotal * 0.5;
    }

    return 0;
  }

  private isPromotionValid(promotion: PromotionRow): boolean {
    const now = new Date();
    if (promotion.startDate > now || promotion.endDate < now) return false;
    if (
      promotion.usageLimit != null &&
      promotion.usageCount >= promotion.usageLimit
    ) {
      return false;
    }
    return true;
  }

  private async calculateCommission(
    organizationId: string,
    revenue: number,
  ): Promise<number> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { commissionRate: true },
    });
    if (!org) return 0;
    return revenue * org.commissionRate;
  }
}

export type { OfferRecommendation, EventRecommendationBundle, PricingResult };
