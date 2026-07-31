import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AMLStatus,
  FraudSeverity,
  FraudStatus,
  FraudType,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { createHash } from 'crypto';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { FlagResolutionStatus } from './fraud.dto';

export interface FraudCheckContext {
  orderId?: string;
  userId?: string;
  eventId?: string;
  ipAddress?: string;
  deviceFingerprint?: string;
  buyerEmail?: string;
  amount?: number;
  currency?: string;
  channel?: string;
  paymentMethod?: string;
}

export interface FraudScoreFlag {
  type: FraudType;
  weight: number;
  reason: string;
}

export interface FraudScore {
  score: number;
  severity: FraudSeverity;
  flags: FraudScoreFlag[];
  recommendedAction: 'ALLOW' | 'REVIEW' | 'BLOCK';
}

export interface CreateFlagInput {
  type: FraudType;
  severity: FraudSeverity;
  score: number;
  reason: string;
  orderId?: string;
  userId?: string;
  eventId?: string;
  ticketId?: string;
  ipAddress?: string;
  deviceFingerprint?: string;
  metadata?: Record<string, unknown>;
}

export interface ListFlagsParams {
  severity?: FraudSeverity;
  status?: FraudStatus;
  type?: FraudType;
  eventId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
  offset?: number;
}

export interface ListFlagsResult {
  data: Array<{
    id: string;
    type: FraudType;
    severity: FraudSeverity;
    score: number;
    reason: string;
    status: FraudStatus;
    orderId: string | null;
    userId: string | null;
    eventId: string | null;
    ticketId: string | null;
    ipAddress: string | null;
    deviceFingerprint: string | null;
    resolution: string | null;
    resolvedBy: string | null;
    resolvedAt: Date | null;
    createdAt: Date;
    order: { publicId: string } | null;
    user: { email: string } | null;
  }>;
  nextCursor: string | null;
  total: number;
  limit: number;
  offset: number;
}

export interface KycInput {
  fullName: string;
  dateOfBirth: string;
  address: string;
  city: string;
  country: string;
  documentNumber: string;
  documentType: string;
}

export interface AmlInput {
  name: string;
  country: string;
}

/** Exact-match denylist used until an external AML provider is wired. */
const AML_DENYLIST = new Set(
  [
    'north korea',
    'dprk',
    'al-qaeda',
    'isis',
    'islamic state',
    'hezbollah',
    'taliban',
  ].map((entry) => entry.toLowerCase()),
);

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);

  private readonly thresholds = {
    LOW: 30,
    MEDIUM: 50,
    HIGH: 75,
    CRITICAL: 90,
  } as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenant: TenantContextService,
  ) {}

  // ==================== FRAUD SCORING ====================

  async analyzeFraud(ctx: FraudCheckContext): Promise<FraudScore> {
    if (ctx.eventId) {
      await this.assertEventInTenant(ctx.eventId);
    }

    const [velocity, duplicates, locationScore, deviceScore, emailFlag, declinedCount] =
      await Promise.all([
        this.countRecentCompletedOrders(ctx.userId, 5 * 60_000),
        this.countDuplicatePurchases(ctx),
        this.checkLocationAnomaly(ctx.userId, ctx.ipAddress),
        this.analyzeDeviceFingerprint(ctx.userId, ctx.deviceFingerprint),
        this.unverifiedEmailWeight(ctx.buyerEmail),
        this.countDeclinedPayments(ctx.userId, 7 * 24 * 60 * 60_000),
      ]);

    const flags: FraudScoreFlag[] = [];
    let totalScore = 0;

    if (velocity > 3) {
      flags.push({
        type: FraudType.HIGH_VELOCITY,
        weight: 15,
        reason: `${velocity} orders in last 5 minutes`,
      });
      totalScore += 15;
    }

    if (duplicates > 0) {
      flags.push({
        type: FraudType.DUPLICATE_PURCHASE,
        weight: 25,
        reason: 'Duplicate purchase for same event',
      });
      totalScore += 25;
    }

    if (locationScore > 0) {
      flags.push({
        type: FraudType.UNLIKELY_LOCATION,
        weight: locationScore,
        reason: 'Unusual geographic location',
      });
      totalScore += locationScore;
    }

    if (ctx.amount !== undefined && ctx.amount > 5000) {
      flags.push({
        type: FraudType.SUSPICIOUS_ACTIVITY,
        weight: 10,
        reason: `Large order amount: ${ctx.amount}`,
      });
      totalScore += 10;
    }

    if (deviceScore > 0) {
      flags.push({
        type: FraudType.SUSPICIOUS_ACTIVITY,
        weight: deviceScore,
        reason: 'Suspicious device fingerprint',
      });
      totalScore += deviceScore;
    }

    if (emailFlag > 0) {
      flags.push({
        type: FraudType.SUSPICIOUS_ACTIVITY,
        weight: emailFlag,
        reason: 'Unverified email address',
      });
      totalScore += emailFlag;
    }

    if (declinedCount >= 3) {
      flags.push({
        type: FraudType.MULTIPLE_DECLINED,
        weight: 20,
        reason: `${declinedCount} declined payment attempts in 7 days`,
      });
      totalScore += 20;
    }

    totalScore = Math.min(totalScore, 100);
    const severity = this.severityFor(totalScore);
    let recommendedAction: FraudScore['recommendedAction'] = 'ALLOW';
    if (totalScore >= 90) recommendedAction = 'BLOCK';
    else if (totalScore >= 60) recommendedAction = 'REVIEW';

    this.logger.log(
      `Fraud score for ${ctx.userId ?? 'anonymous'}: ${totalScore} (${severity})`,
    );

    return { score: totalScore, severity, flags, recommendedAction };
  }

  // ==================== FLAG CREATION ====================

  async createFlag(data: CreateFlagInput) {
    const organizationId = await this.resolveFlagOrganization(data);
    if (organizationId) this.tenant.assertOrganization(organizationId);

    const metadata = data.metadata
      ? (data.metadata as Prisma.InputJsonValue)
      : undefined;

    const flag = await this.prisma.fraudFlag.create({
      data: {
        type: data.type,
        severity: data.severity,
        score: data.score,
        reason: data.reason,
        orderId: data.orderId,
        userId: data.userId,
        eventId: data.eventId,
        ticketId: data.ticketId,
        ipAddress: data.ipAddress,
        deviceFingerprint: data.deviceFingerprint,
        metadata,
        status: FraudStatus.FLAGGED,
      },
    });

    this.logger.warn(`Fraud flag created: ${flag.id} (${data.severity})`);

    await this.audit.log({
      action: 'fraud.flag.created',
      entityType: 'FraudFlag',
      entityId: flag.id,
      organizationId: organizationId ?? undefined,
      userId: this.tenant.current().userId,
      metadata: {
        type: data.type,
        severity: data.severity,
        score: data.score,
        eventId: data.eventId,
        orderId: data.orderId,
      },
    });

    if (data.severity === FraudSeverity.CRITICAL) {
      this.sendCriticalAlert(flag.id, data);
    }

    return flag;
  }

  // ==================== LIST FLAGS ====================

  async listFlags(params: ListFlagsParams): Promise<ListFlagsResult> {
    const take = Math.min(Math.max(params.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const skip = params.cursor ? 0 : Math.max(params.offset ?? 0, 0);
    const where = await this.buildFlagWhere(params);

    const [rows, total] = await Promise.all([
      this.prisma.fraudFlag.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: take + 1,
        skip,
        ...(params.cursor
          ? {
              cursor: { id: params.cursor },
              skip: 1,
            }
          : {}),
        select: {
          id: true,
          type: true,
          severity: true,
          score: true,
          reason: true,
          status: true,
          orderId: true,
          userId: true,
          eventId: true,
          ticketId: true,
          ipAddress: true,
          deviceFingerprint: true,
          resolution: true,
          resolvedBy: true,
          resolvedAt: true,
          createdAt: true,
          order: { select: { publicId: true } },
          user: { select: { email: true } },
        },
      }),
      this.prisma.fraudFlag.count({ where }),
    ]);

    const hasMore = rows.length > take;
    const data = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore ? data[data.length - 1]?.id ?? null : null;

    return {
      data,
      nextCursor,
      total,
      limit: take,
      offset: skip,
    };
  }

  // ==================== RESOLVE FLAG ====================

  async resolveFlag(
    flagId: string,
    resolution: string,
    resolvedBy: string,
    status: FlagResolutionStatus = FlagResolutionStatus.RESOLVED,
  ) {
    const existing = await this.prisma.fraudFlag.findUnique({
      where: { id: flagId },
      select: {
        id: true,
        status: true,
        event: { select: { organizationId: true } },
        order: { select: { organizationId: true } },
      },
    });
    if (!existing) throw new NotFoundException('Fraud flag not found');

    const organizationId =
      existing.event?.organizationId ?? existing.order?.organizationId;
    if (organizationId) this.tenant.assertOrganization(organizationId);
    else if (!this.tenant.current().privileged) {
      throw new ForbiddenException('Organization access denied');
    }

    if (
      existing.status === FraudStatus.RESOLVED ||
      existing.status === FraudStatus.FALSE_POSITIVE
    ) {
      return this.prisma.fraudFlag.findUniqueOrThrow({ where: { id: flagId } });
    }

    const nextStatus =
      status === FlagResolutionStatus.FALSE_POSITIVE
        ? FraudStatus.FALSE_POSITIVE
        : FraudStatus.RESOLVED;

    const flag = await this.prisma.fraudFlag.update({
      where: { id: flagId },
      data: {
        status: nextStatus,
        resolved: true,
        resolution,
        resolvedBy,
        resolvedAt: new Date(),
      },
    });

    await this.audit.log({
      action: 'fraud.flag.resolved',
      entityType: 'FraudFlag',
      entityId: flagId,
      organizationId: organizationId ?? undefined,
      userId: resolvedBy,
      metadata: { status: nextStatus, resolution },
    });

    this.logger.log(`Fraud flag resolved: ${flagId}`);
    return flag;
  }

  // ==================== KYC / AML ====================

  async performKYCCheck(userId: string, data: KycInput) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        organizationId: true,
        email: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.organizationId) this.tenant.assertOrganization(user.organizationId);
    else if (!this.tenant.current().privileged && this.tenant.current().organizationId) {
      throw new ForbiddenException('Organization access denied');
    }

    const expected = this.normalizeName(`${user.firstName} ${user.lastName}`);
    const provided = this.normalizeName(data.fullName);
    const documentHash = createHash('sha256')
      .update(`${data.documentType}:${data.documentNumber}:${data.country}`)
      .digest('hex');

    const nameMatches = expected.length > 0 && expected === provided;
    const birthDate = new Date(data.dateOfBirth);
    const ageYears = Number.isNaN(birthDate.getTime())
      ? 0
      : (Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    const adult = ageYears >= 18;

    let status: 'verified' | 'review' | 'rejected' = 'verified';
    if (!adult) status = 'rejected';
    else if (!nameMatches) status = 'review';

    if (status === 'review') {
      await this.createFlag({
        type: FraudType.KYC_MISMATCH,
        severity: FraudSeverity.MEDIUM,
        score: 40,
        reason: 'Submitted KYC name does not match account profile',
        userId,
        metadata: {
          documentHash,
          documentType: data.documentType,
          country: data.country,
        },
      });
    }

    await this.audit.log({
      action: 'fraud.kyc.checked',
      entityType: 'User',
      entityId: userId,
      organizationId: user.organizationId ?? this.tenant.current().organizationId,
      userId: this.tenant.current().userId,
      metadata: {
        status,
        documentHash,
        documentType: data.documentType,
        country: data.country,
        city: data.city,
        nameMatches,
        adult,
      },
    });

    // Preserve the historical field while exposing the real disposition.
    return { status, userId, verified: status === 'verified' };
  }

  async performAMLCheck(organizationId: string, data: AmlInput) {
    this.tenant.assertOrganization(organizationId);

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, amlStatus: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');

    const haystack = `${data.name} ${organization.name}`.toLowerCase();
    const hit = [...AML_DENYLIST].find((entry) => haystack.includes(entry));
    const isWatchlisted = hit !== undefined;
    const nextStatus = isWatchlisted ? AMLStatus.REJECTED : AMLStatus.VERIFIED;

    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        amlStatus: nextStatus,
        ...(isWatchlisted ? {} : { verified: true, verifiedAt: new Date() }),
      },
    });

    await this.audit.log({
      action: 'fraud.aml.checked',
      entityType: 'Organization',
      entityId: organizationId,
      organizationId,
      userId: this.tenant.current().userId,
      metadata: {
        status: isWatchlisted ? 'blocked' : 'cleared',
        isWatchlisted,
        country: data.country,
        match: hit ?? null,
        previousStatus: organization.amlStatus,
        severity: isWatchlisted ? FraudSeverity.CRITICAL : FraudSeverity.LOW,
      },
    });

    return {
      status: isWatchlisted ? 'blocked' : 'cleared',
      isWatchlisted,
    };
  }

  // ==================== INTERNALS ====================

  private severityFor(score: number): FraudSeverity {
    if (score >= this.thresholds.CRITICAL) return FraudSeverity.CRITICAL;
    if (score >= this.thresholds.HIGH) return FraudSeverity.HIGH;
    if (score >= this.thresholds.MEDIUM) return FraudSeverity.MEDIUM;
    return FraudSeverity.LOW;
  }

  private async countRecentCompletedOrders(
    userId: string | undefined,
    windowMs: number,
  ): Promise<number> {
    if (!userId) return 0;
    return this.prisma.order.count({
      where: {
        userId,
        createdAt: { gte: new Date(Date.now() - windowMs) },
        status: OrderStatus.COMPLETED,
        ...this.tenantOrderFilter(),
      },
    });
  }

  private async countDuplicatePurchases(ctx: FraudCheckContext): Promise<number> {
    if (!ctx.eventId || !ctx.userId) return 0;
    return this.prisma.order.count({
      where: {
        userId: ctx.userId,
        eventId: ctx.eventId,
        status: OrderStatus.COMPLETED,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        ...(ctx.orderId ? { id: { not: ctx.orderId } } : {}),
        ...this.tenantOrderFilter(),
      },
    });
  }

  private async countDeclinedPayments(
    userId: string | undefined,
    windowMs: number,
  ): Promise<number> {
    if (!userId) return 0;
    return this.prisma.order.count({
      where: {
        userId,
        status: OrderStatus.FAILED,
        createdAt: { gte: new Date(Date.now() - windowMs) },
        ...this.tenantOrderFilter(),
      },
    });
  }

  private async unverifiedEmailWeight(buyerEmail: string | undefined): Promise<number> {
    if (!buyerEmail) return 0;
    const user = await this.prisma.user.findUnique({
      where: { email: buyerEmail.trim().toLowerCase() },
      select: { emailVerified: true },
    });
    return user && !user.emailVerified ? 5 : 0;
  }

  private async checkLocationAnomaly(
    userId: string | undefined,
    ipAddress: string | undefined,
  ): Promise<number> {
    if (!userId || !ipAddress || ipAddress.includes(':')) return 0;

    const recent = await this.prisma.auditEvent.findMany({
      where: {
        userId,
        ipAddress: { not: null },
        createdAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
      },
      select: { ipAddress: true },
      take: 20,
      orderBy: { createdAt: 'desc' },
    });
    if (!recent.length) return 0;

    const subnet = (ip: string) => ip.split('.').slice(0, 3).join('.');
    const current = subnet(ipAddress);
    const known = new Set(
      recent
        .map((row) => row.ipAddress)
        .filter((ip): ip is string => typeof ip === 'string' && ip.length > 0)
        .map(subnet),
    );
    return known.size > 0 && !known.has(current) ? 12 : 0;
  }

  private async analyzeDeviceFingerprint(
    userId: string | undefined,
    fingerprint: string | undefined,
  ): Promise<number> {
    if (!userId || !fingerprint) return 0;
    const existingDevices = await this.prisma.fraudFlag.count({
      where: {
        userId,
        deviceFingerprint: fingerprint,
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    });
    return existingDevices === 0 ? 3 : 0;
  }

  private tenantOrderFilter(): Prisma.OrderWhereInput {
    const context = this.tenant.current();
    if (context.privileged || !context.organizationId) return {};
    return { organizationId: context.organizationId };
  }

  private async assertEventInTenant(eventId: string): Promise<void> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { organizationId: true },
    });
    if (!event) return;
    const context = this.tenant.current();
    if (!context.organizationId && !context.privileged) return;
    this.tenant.assertOrganization(event.organizationId);
  }

  private async resolveFlagOrganization(
    data: CreateFlagInput,
  ): Promise<string | undefined> {
    if (data.eventId) {
      const event = await this.prisma.event.findUnique({
        where: { id: data.eventId },
        select: { organizationId: true },
      });
      return event?.organizationId;
    }
    if (data.orderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: data.orderId },
        select: { organizationId: true },
      });
      return order?.organizationId;
    }
    if (data.ticketId) {
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: data.ticketId },
        select: { event: { select: { organizationId: true } } },
      });
      return ticket?.event.organizationId;
    }
    return undefined;
  }

  private async buildFlagWhere(params: ListFlagsParams): Promise<Prisma.FraudFlagWhereInput> {
    const context = this.tenant.current();
    const filters: Prisma.FraudFlagWhereInput = {
      ...(params.severity ? { severity: params.severity } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.type ? { type: params.type } : {}),
      ...(params.eventId ? { eventId: params.eventId } : {}),
    };

    if (params.from || params.to) {
      filters.createdAt = {
        ...(params.from ? { gte: new Date(params.from) } : {}),
        ...(params.to ? { lt: new Date(params.to) } : {}),
      };
    }

    if (!context.privileged) {
      const organizationId = this.tenant.requireOrganization();
      // FraudFlag has no organizationId column; scope through related entities.
      filters.AND = [
        {
          OR: [
            { event: { organizationId } },
            { order: { organizationId } },
            { ticket: { event: { organizationId } } },
          ],
        },
      ];
    }

    if (params.eventId) {
      await this.assertEventInTenant(params.eventId);
    }

    return filters;
  }

  private sendCriticalAlert(flagId: string, data: CreateFlagInput): void {
    this.logger.error(
      JSON.stringify({
        alert: 'CRITICAL_FRAUD',
        flagId,
        type: data.type,
        score: data.score,
        reason: data.reason,
        eventId: data.eventId,
        orderId: data.orderId,
        userId: data.userId,
      }),
    );
  }

  private normalizeName(value: string): string {
    return value
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
