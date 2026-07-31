import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WaitlistStatus } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { RedisService } from '../../common/redis.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';

const IDEMPOTENCY_TTL_SECONDS = 86_400;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export type JoinWaitlistInput = {
  eventId: string;
  email: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  quantity?: number;
  offerId?: string;
  idempotencyKey?: string;
};

@Injectable()
export class WaitlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly tenant: TenantContextService,
    private readonly redis: RedisService,
  ) {}

  async join(data: JoinWaitlistInput) {
    const email = data.email.trim().toLowerCase();
    const quantity = data.quantity ?? 1;
    if (quantity < 1 || quantity > 20) {
      throw new BadRequestException('La cantidad debe estar entre 1 y 20');
    }

    if (data.idempotencyKey) {
      const cached = await this.readIdempotentResult(data.idempotencyKey);
      if (cached) return cached;
    }

    const event = await this.prisma.event.findUnique({
      where: { id: data.eventId },
      select: {
        id: true,
        title: true,
        organizationId: true,
        status: true,
        offers: data.offerId
          ? { where: { id: data.offerId }, select: { id: true }, take: 1 }
          : false,
      },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');
    this.assertTenantIfPresent(event.organizationId);

    if (data.offerId) {
      const offerOk =
        Array.isArray(event.offers) && event.offers.some((o) => o.id === data.offerId);
      if (!offerOk) {
        throw new BadRequestException('La oferta no pertenece a este evento');
      }
    }

    try {
      const entry = await this.prisma.waitlistEntry.create({
        data: {
          eventId: data.eventId,
          email,
          phone: data.phone,
          firstName: data.firstName,
          lastName: data.lastName,
          quantity,
          offerId: data.offerId,
          ...(data.idempotencyKey
            ? { metadata: { idempotencyKey: data.idempotencyKey } satisfies Prisma.InputJsonObject }
            : {}),
        },
      });

      await this.audit.log({
        action: 'WAITLIST_JOIN',
        entityType: 'WaitlistEntry',
        entityId: entry.id,
        organizationId: event.organizationId,
        userId: this.tenant.current().userId,
        metadata: { eventId: data.eventId, email },
      });

      const result = { ...entry, message: 'Te avisaremos cuando haya disponibilidad.' };
      if (data.idempotencyKey) {
        await this.storeIdempotentResult(data.idempotencyKey, result);
      }
      return result;
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existing = await this.prisma.waitlistEntry.findUnique({
          where: { eventId_email: { eventId: data.eventId, email } },
        });
        if (existing && data.idempotencyKey) {
          const meta = asRecord(existing.metadata);
          if (meta?.idempotencyKey === data.idempotencyKey) {
            const result = {
              ...existing,
              message: 'Te avisaremos cuando haya disponibilidad.',
            };
            await this.storeIdempotentResult(data.idempotencyKey, result);
            return result;
          }
        }
        throw new ConflictException('Ya estás en la lista de espera para este evento');
      }
      throw error;
    }
  }

  async listByEvent(
    eventId: string,
    status?: WaitlistStatus | string,
    limit = DEFAULT_PAGE_SIZE,
    offset = 0,
  ) {
    const event = await this.requireEventInTenant(eventId);
    const parsedStatus = this.parseStatus(status);
    const take = clampPageSize(limit);
    const skip = Math.max(0, offset);

    return this.prisma.waitlistEntry.findMany({
      where: {
        eventId: event.id,
        ...(parsedStatus ? { status: parsedStatus } : {}),
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take,
      skip,
    });
  }

  async listByOrganization(orgId: string, limit = 200, offset = 0) {
    this.tenant.assertOrganization(orgId);
    const take = clampPageSize(limit, 200);
    const skip = Math.max(0, offset);

    return this.prisma.waitlistEntry.findMany({
      where: { event: { organizationId: orgId } },
      include: {
        event: { select: { id: true, title: true, slug: true, startsAt: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  /**
   * Notifies pending waitlist entries. Concurrent callers claim rows via
   * conditional updates so the same entry is never notified twice.
   * Signature kept compatible with InventoryService.notifyBatch(eventId, limit).
   */
  async notifyBatch(eventId: string, limit = 50, actorId?: string, idempotencyKey?: string) {
    if (idempotencyKey) {
      const cached = await this.readIdempotentResult<{ notified: number; total: number }>(
        idempotencyKey,
      );
      if (cached) return cached;
    }

    const take = clampPageSize(limit);
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, slug: true, organizationId: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');
    this.assertTenantIfPresent(event.organizationId);

    const candidates = await this.prisma.waitlistEntry.findMany({
      where: { eventId: event.id, status: WaitlistStatus.PENDING },
      take,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      select: { id: true, email: true, quantity: true },
    });

    const webUrl = process.env.WEB_URL || 'http://localhost:3000';
    const notifiedAt = new Date();
    let notified = 0;

    for (const entry of candidates) {
      const claimed = await this.prisma.waitlistEntry.updateMany({
        where: { id: entry.id, status: WaitlistStatus.PENDING },
        data: { status: WaitlistStatus.NOTIFIED, notifiedAt },
      });
      if (claimed.count === 0) continue;

      await this.notifications.enqueueEmail({
        to: entry.email,
        subject: `¡Boletos disponibles! — ${event.title}`,
        template: 'waitlist-available',
        data: {
          eventTitle: event.title,
          eventUrl: `${webUrl}/events/${event.slug}`,
          quantity: entry.quantity,
        },
      });
      notified++;
    }

    await this.audit.log({
      action: 'WAITLIST_NOTIFY_BATCH',
      entityType: 'Event',
      entityId: eventId,
      organizationId: event.organizationId,
      userId: actorId ?? this.tenant.current().userId,
      metadata: { notified, candidates: candidates.length, idempotencyKey },
    });

    const result = { notified, total: candidates.length };
    if (idempotencyKey) {
      await this.storeIdempotentResult(idempotencyKey, result);
    }
    return result;
  }

  async stats(eventId: string) {
    const event = await this.requireEventInTenant(eventId);
    const grouped = await this.prisma.waitlistEntry.groupBy({
      by: ['status'],
      where: { eventId: event.id },
      _count: true,
    });
    const total = grouped.reduce((sum, row) => sum + row._count, 0);
    return { total, byStatus: grouped };
  }

  private async requireEventInTenant(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, organizationId: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');
    this.tenant.assertOrganization(event.organizationId);
    return event;
  }

  /** Staff paths assert; public join / inventory auto-notify skip when no tenant. */
  private assertTenantIfPresent(organizationId: string): void {
    const ctx = this.tenant.current();
    if (!ctx.organizationId && !ctx.privileged) return;
    this.tenant.assertOrganization(organizationId);
  }

  private parseStatus(status?: WaitlistStatus | string): WaitlistStatus | undefined {
    if (!status) return undefined;
    if (Object.values(WaitlistStatus).includes(status as WaitlistStatus)) {
      return status as WaitlistStatus;
    }
    throw new BadRequestException('Estado de lista de espera no válido');
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private async readIdempotentResult<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(`idem:waitlist:${key}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private async storeIdempotentResult(key: string, value: unknown): Promise<void> {
    await this.redis.setHold(`idem:waitlist:${key}`, JSON.stringify(value), IDEMPOTENCY_TTL_SECONDS);
  }
}

function clampPageSize(limit: number, max = MAX_PAGE_SIZE): number {
  if (!Number.isFinite(limit) || limit < 1) return Math.min(DEFAULT_PAGE_SIZE, max);
  return Math.min(Math.floor(limit), max);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
