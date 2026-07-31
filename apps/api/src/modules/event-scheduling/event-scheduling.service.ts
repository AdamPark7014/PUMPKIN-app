import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EventSeriesKind,
  EventSeriesStatus,
  EventStatus,
  EventCategory,
  Prisma,
  SalePhaseKind,
  SalePhaseStatus,
  SalesChannel,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  DEFAULT_EVENT_DURATION_MINUTES,
  DEFAULT_TURNAROUND_MINUTES,
  MAX_OCCURRENCES,
  type RecurrenceRule,
  type ScheduleConflict,
  type ScheduleOccurrence,
  describeRecurrence,
  detectScheduleConflicts,
  expandRecurrence,
  formatLocalDate,
  isValidTimezone,
  resolveSaleStatus,
} from '@boletera/shared';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';

/** Defaults copied onto every occurrence of a series. */
export interface SeriesTemplate {
  capacity: number;
  basePrice: number;
  zoneName?: string;
  currency?: 'MXN' | 'USD';
  description?: string;
  imageUrl?: string;
  durationMinutes?: number;
  /** Minutes before show time when doors open. */
  doorsOffsetMinutes?: number;
  /** Days before show time when the event becomes visible. */
  announceOffsetDays?: number | null;
  /** Days before show time when a DRAFT auto-publishes. */
  publishOffsetDays?: number | null;
  /** Days before show time when general sales open. */
  salesStartOffsetDays?: number | null;
  /** Hours before show time when sales close (0 = at show time). */
  salesEndOffsetHours?: number | null;
}

export interface PhaseTemplate {
  name: string;
  kind: SalePhaseKind;
  code?: string | null;
  /** Days before show time when the phase opens. */
  startOffsetDays: number;
  /** Days before show time when the phase closes (must be < startOffsetDays). */
  endOffsetDays: number;
  channels?: SalesChannel[];
  allocationPercent?: number | null;
  maxPerOrder?: number | null;
  discountPercent?: number | null;
  priority?: number;
}

export interface OccurrencePreview extends ScheduleOccurrence {
  conflicts: ScheduleConflict[];
  blocking: boolean;
  doorsAt: string;
  endsAt: string;
  announceAt: string | null;
  publishAt: string | null;
  salesStartAt: string | null;
  salesEndAt: string | null;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

@Injectable()
export class EventSchedulingService {
  private logger = new Logger(EventSchedulingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenant: TenantContextService,
  ) {}

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private scopedOrganizationId(fallbackOrgId?: string): string {
    const ctx = this.tenant.current();
    if (ctx.privileged) {
      const organizationId = fallbackOrgId ?? ctx.organizationId;
      if (!organizationId) {
        throw new BadRequestException(
          'Se requiere una organización en el contexto del inquilino',
        );
      }
      return organizationId;
    }
    return this.tenant.requireOrganization();
  }

  private actorUserId(explicit?: string): string | undefined {
    return explicit ?? this.tenant.current().userId;
  }

  private slugify(text: string, suffix?: string) {
    const base = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60);
    const tail = suffix ? `-${suffix}` : '';
    return `${base || 'evento'}${tail}-${Math.random().toString(36).slice(2, 7)}`;
  }

  private async assertVenue(orgId: string, venueId: string) {
    const organizationId = this.scopedOrganizationId(orgId);
    const venue = await this.prisma.venue.findFirst({
      where: { id: venueId, organizationId },
      select: { id: true, name: true, timezone: true, totalCapacity: true },
    });
    if (!venue) {
      throw new NotFoundException('Recinto no encontrado para esta organización');
    }
    this.tenant.assertOrganization(organizationId);
    return venue;
  }

  private async assertEvent(orgId: string, eventId: string) {
    const organizationId = this.scopedOrganizationId(orgId);
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId },
      include: {
        salePhases: { orderBy: { startsAt: 'asc' } },
        venue: { select: { id: true, name: true } },
      },
    });
    if (!event) {
      throw new NotFoundException('Evento no encontrado para esta organización');
    }
    this.tenant.assertOrganization(event.organizationId);
    return event;
  }

  /** Occurrence window derived from a template, in absolute instants. */
  private windowsFor(startsAt: Date, template: Partial<SeriesTemplate>) {
    const duration = template.durationMinutes ?? DEFAULT_EVENT_DURATION_MINUTES;
    const doorsOffset = template.doorsOffsetMinutes ?? 60;
    const offsetDate = (days?: number | null) =>
      days == null ? null : new Date(startsAt.getTime() - days * DAY_MS);

    const salesEndHours = template.salesEndOffsetHours;
    return {
      endsAt: new Date(startsAt.getTime() + duration * MINUTE_MS),
      doorsAt: new Date(startsAt.getTime() - doorsOffset * MINUTE_MS),
      announceAt: offsetDate(template.announceOffsetDays),
      publishAt: offsetDate(template.publishOffsetDays),
      salesStartAt: offsetDate(template.salesStartOffsetDays),
      salesEndAt:
        salesEndHours == null ? null : new Date(startsAt.getTime() - salesEndHours * HOUR_MS),
      durationMinutes: duration,
    };
  }

  private async bookedSlots(params: {
    venueId: string;
    organizationId: string;
    from: Date;
    to: Date;
    excludeEventIds?: string[];
    excludeSeriesId?: string;
  }) {
    const events = await this.prisma.event.findMany({
      where: {
        organizationId: params.organizationId,
        venueId: params.venueId,
        status: { notIn: [EventStatus.CANCELLED] },
        startsAt: { gte: new Date(params.from.getTime() - DAY_MS), lte: new Date(params.to.getTime() + DAY_MS) },
        ...(params.excludeEventIds?.length ? { id: { notIn: params.excludeEventIds } } : {}),
        ...(params.excludeSeriesId ? { NOT: { seriesId: params.excludeSeriesId } } : {}),
      },
      select: { id: true, title: true, startsAt: true, endsAt: true, durationMinutes: true },
    });

    const blackouts = await this.prisma.venueBlackout.findMany({
      where: {
        venueId: params.venueId,
        endsAt: { gte: new Date(params.from.getTime() - DAY_MS) },
        startsAt: { lte: new Date(params.to.getTime() + DAY_MS) },
      },
      select: { id: true, reason: true, startsAt: true, endsAt: true, blocking: true },
    });

    return {
      events: events.map((event) => ({
        id: event.id,
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        durationMinutes: event.durationMinutes,
      })),
      blackouts: blackouts.map((blackout) => ({
        id: blackout.id,
        title: blackout.reason,
        startsAt: blackout.startsAt,
        endsAt: blackout.endsAt,
        blocking: blackout.blocking,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Preview (no writes)
  // -------------------------------------------------------------------------

  async previewSchedule(
    orgId: string | undefined,
    dto: {
      rule: {
        frequency: RecurrenceRule['frequency'];
        startLocal: string;
        timezone?: string;
        interval?: number;
        count?: number;
        untilLocal?: string;
        byWeekday?: number[];
        monthlyMode?: RecurrenceRule['monthlyMode'];
        nth?: RecurrenceRule['nth'];
        nthWeekday?: number;
        exceptions?: string[];
        extraDates?: string[];
      };
      venueId: string;
      template?: Partial<SeriesTemplate>;
      turnaroundMinutes?: number;
      excludeSeriesId?: string;
      excludeEventIds?: string[];
    },
  ) {
    orgId = this.scopedOrganizationId(orgId);
    const venue = await this.assertVenue(orgId, dto.venueId);
    const rule: RecurrenceRule = {
      frequency: dto.rule.frequency,
      startLocal: dto.rule.startLocal,
      timezone: dto.rule.timezone || venue.timezone || 'America/Mexico_City',
      interval: dto.rule.interval,
      count: dto.rule.count,
      untilLocal: dto.rule.untilLocal,
      byWeekday: dto.rule.byWeekday as RecurrenceRule['byWeekday'],
      monthlyMode: dto.rule.monthlyMode,
      nth: dto.rule.nth,
      nthWeekday: dto.rule.nthWeekday as RecurrenceRule['nthWeekday'],
      exceptions: dto.rule.exceptions,
      extraDates: dto.rule.extraDates,
    };
    if (!isValidTimezone(rule.timezone)) {
      throw new BadRequestException(`Zona horaria inválida: ${rule.timezone}`);
    }

    let occurrences: ScheduleOccurrence[];
    try {
      occurrences = expandRecurrence(rule);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Recurrencia inválida');
    }
    if (!occurrences.length) {
      throw new BadRequestException('La recurrencia no produjo fechas');
    }

    const template = dto.template ?? {};
    const duration = template.durationMinutes ?? DEFAULT_EVENT_DURATION_MINUTES;
    const first = new Date(occurrences[0].startsAt);
    const last = new Date(occurrences[occurrences.length - 1].startsAt);

    const { events: booked, blackouts } = await this.bookedSlots({
      organizationId: orgId,
      venueId: dto.venueId,
      from: first,
      to: new Date(last.getTime() + duration * MINUTE_MS),
      excludeEventIds: dto.excludeEventIds,
      excludeSeriesId: dto.excludeSeriesId,
    });

    const candidates = occurrences.map((occurrence) => ({
      startsAt: occurrence.startsAt,
      durationMinutes: duration,
    }));
    const conflictMap = detectScheduleConflicts(candidates, booked, {
      turnaroundMinutes: dto.turnaroundMinutes ?? DEFAULT_TURNAROUND_MINUTES,
      defaultDurationMinutes: duration,
      blackouts: blackouts.filter((blackout) => blackout.blocking),
    });
    const softBlackouts = detectScheduleConflicts(candidates, [], {
      turnaroundMinutes: 0,
      defaultDurationMinutes: duration,
      blackouts: blackouts.filter((blackout) => !blackout.blocking),
    });

    const preview: OccurrencePreview[] = occurrences.map((occurrence, index) => {
      const startsAt = new Date(occurrence.startsAt);
      const windows = this.windowsFor(startsAt, template);
      const conflicts = [...(conflictMap.get(index) ?? []), ...(softBlackouts.get(index) ?? [])];
      return {
        ...occurrence,
        conflicts,
        // Overlaps and hard blackouts block; a short turnaround is only a warning.
        blocking: conflicts.some((conflict) => conflict.kind !== 'TURNAROUND'),
        doorsAt: windows.doorsAt.toISOString(),
        endsAt: windows.endsAt.toISOString(),
        announceAt: windows.announceAt?.toISOString() ?? null,
        publishAt: windows.publishAt?.toISOString() ?? null,
        salesStartAt: windows.salesStartAt?.toISOString() ?? null,
        salesEndAt: windows.salesEndAt?.toISOString() ?? null,
      };
    });

    return {
      venue: { id: venue.id, name: venue.name, timezone: venue.timezone },
      recurrence: { ...rule, summary: describeRecurrence(rule) },
      occurrences: preview,
      totals: {
        occurrences: preview.length,
        withConflicts: preview.filter((o) => o.conflicts.length).length,
        blocking: preview.filter((o) => o.blocking).length,
        capacity: (template.capacity ?? 0) * preview.length,
      },
      limits: { maxOccurrences: MAX_OCCURRENCES },
    };
  }

  // -------------------------------------------------------------------------
  // Series
  // -------------------------------------------------------------------------

  async createSeries(
    orgId: string | undefined,
    userId: string | undefined,
    dto: {
      name: string;
      description?: string;
      kind?: EventSeriesKind;
      category?: EventCategory;
      venueId: string;
      rule: {
        frequency: RecurrenceRule['frequency'];
        startLocal: string;
        timezone?: string;
        interval?: number;
        count?: number;
        untilLocal?: string;
        byWeekday?: number[];
        monthlyMode?: RecurrenceRule['monthlyMode'];
        nth?: RecurrenceRule['nth'];
        nthWeekday?: number;
        exceptions?: string[];
        extraDates?: string[];
      };
      template: SeriesTemplate;
      phases?: PhaseTemplate[];
      publish?: boolean;
      force?: boolean;
      turnaroundMinutes?: number;
    },
  ) {
    orgId = this.scopedOrganizationId(orgId);
    if (!dto.name?.trim()) throw new BadRequestException('El nombre es obligatorio');
    if (!dto.template?.capacity || dto.template.capacity < 1) {
      throw new BadRequestException('template.capacity debe ser al menos 1');
    }
    if (dto.template.basePrice == null || dto.template.basePrice < 0) {
      throw new BadRequestException('template.basePrice debe ser >= 0');
    }
    this.validatePhaseTemplates(dto.phases);

    const preview = await this.previewSchedule(orgId, {
      rule: dto.rule,
      venueId: dto.venueId,
      template: dto.template,
      turnaroundMinutes: dto.turnaroundMinutes,
    });

    const blocking = preview.occurrences.filter((occurrence) => occurrence.blocking);
    if (blocking.length && !dto.force) {
      throw new ConflictException({
        message: `${blocking.length} fecha(s) tienen conflicto en el recinto. Ajusta las fechas o usa force=true.`,
        conflicts: blocking.map((occurrence) => ({
          startsAt: occurrence.startsAt,
          localDate: occurrence.localDate,
          conflicts: occurrence.conflicts,
        })),
      });
    }

    const timezone = preview.recurrence.timezone;
    const status = dto.publish ? EventStatus.SCHEDULED : EventStatus.DRAFT;
    const currency = dto.template.currency ?? 'MXN';

    const series = await this.prisma.$transaction(async (tx) => {
      const created = await tx.eventSeries.create({
        data: {
          organizationId: orgId,
          venueId: dto.venueId,
          name: dto.name.trim(),
          slug: this.slugify(dto.name),
          description: dto.description,
          kind: dto.kind ?? EventSeriesKind.SERIES,
          status: dto.publish ? EventSeriesStatus.ACTIVE : EventSeriesStatus.DRAFT,
          category: dto.category ?? EventCategory.MUSIC,
          timezone,
          recurrence: (({ summary: _summary, ...rule }) =>
            rule)(preview.recurrence) as unknown as Prisma.InputJsonValue,
          template: dto.template as unknown as Prisma.InputJsonValue,
        },
      });

      for (const [index, occurrence] of preview.occurrences.entries()) {
        await this.createOccurrence(tx, {
          orgId,
          venueId: dto.venueId,
          seriesId: created.id,
          seriesOrder: index + 1,
          seriesName: dto.name.trim(),
          timezone,
          category: dto.category ?? EventCategory.MUSIC,
          status,
          currency,
          template: dto.template,
          phases: dto.phases,
          occurrence,
        });
      }

      return created;
    });

    await this.audit.log({
      action: 'EVENT_SERIES_CREATED',
      entityType: 'EventSeries',
      entityId: series.id,
      organizationId: orgId,
      userId: this.actorUserId(userId),
      metadata: {
        occurrences: preview.occurrences.length,
        recurrence: preview.recurrence.summary,
        forced: Boolean(dto.force && blocking.length),
      },
    });
    this.logger.log(`Series ${series.slug}: ${preview.occurrences.length} occurrences`);

    return this.getSeries(orgId, series.id);
  }

  /** One-off event created through the same conflict checks as a series. */
  async createScheduledEvent(
    orgId: string | undefined,
    userId: string | undefined,
    dto: {
      title: string;
      description?: string;
      category?: EventCategory;
      venueId: string;
      startLocal: string;
      timezone?: string;
      template: SeriesTemplate;
      phases?: PhaseTemplate[];
      publish?: boolean;
      force?: boolean;
      turnaroundMinutes?: number;
    },
  ) {
    orgId = this.scopedOrganizationId(orgId);
    if (!dto.title?.trim()) throw new BadRequestException('El título es obligatorio');
    if (!dto.template?.capacity || dto.template.capacity < 1) {
      throw new BadRequestException('template.capacity debe ser al menos 1');
    }
    this.validatePhaseTemplates(dto.phases);

    const venue = await this.assertVenue(orgId, dto.venueId);
    const rule: RecurrenceRule = {
      frequency: 'DAILY',
      startLocal: dto.startLocal,
      timezone: dto.timezone || venue.timezone || 'America/Mexico_City',
      count: 1,
    };
    const preview = await this.previewSchedule(orgId, {
      rule,
      venueId: dto.venueId,
      template: dto.template,
      turnaroundMinutes: dto.turnaroundMinutes,
    });
    const occurrence = preview.occurrences[0];
    if (occurrence.blocking && !dto.force) {
      throw new ConflictException({
        message: occurrence.conflicts[0]?.message ?? 'Conflicto de agenda en el recinto',
        conflicts: occurrence.conflicts,
      });
    }

    const event = await this.prisma.$transaction((tx) =>
      this.createOccurrence(tx, {
        orgId,
        venueId: dto.venueId,
        seriesName: dto.title.trim(),
        timezone: rule.timezone,
        category: dto.category ?? EventCategory.MUSIC,
        status: dto.publish ? EventStatus.SCHEDULED : EventStatus.DRAFT,
        currency: dto.template.currency ?? 'MXN',
        template: dto.template,
        phases: dto.phases,
        occurrence,
      }),
    );

    await this.audit.log({
      action: 'EVENT_SCHEDULED',
      entityType: 'Event',
      entityId: event.id,
      organizationId: orgId,
      userId: this.actorUserId(userId),
      metadata: {
        startsAt: event.startsAt.toISOString(),
        published: Boolean(dto.publish),
        forced: Boolean(dto.force && occurrence.blocking),
      },
    });

    return { event, conflicts: occurrence.conflicts };
  }

  private validatePhaseTemplates(phases?: PhaseTemplate[]) {
    for (const phase of phases ?? []) {
      if (!phase.name?.trim()) throw new BadRequestException('Cada fase necesita un nombre');
      if (phase.endOffsetDays >= phase.startOffsetDays) {
        throw new BadRequestException(
          `Phase "${phase.name}": endOffsetDays must be smaller than startOffsetDays (both count days before the show)`,
        );
      }
      if (phase.discountPercent != null && (phase.discountPercent < 0 || phase.discountPercent > 90)) {
        throw new BadRequestException(`Phase "${phase.name}": discountPercent must be between 0 and 90`);
      }
    }
  }

  /** Creates one event + its base offer + its sale phases inside a transaction. */
  private async createOccurrence(
    tx: Prisma.TransactionClient,
    params: {
      orgId: string;
      venueId: string;
      seriesId?: string;
      seriesOrder?: number;
      seriesName: string;
      timezone: string;
      category: EventCategory;
      status: EventStatus;
      currency: 'MXN' | 'USD';
      template: SeriesTemplate;
      phases?: PhaseTemplate[];
      occurrence: OccurrencePreview;
    },
  ) {
    const startsAt = new Date(params.occurrence.startsAt);
    const windows = this.windowsFor(startsAt, params.template);
    const title = params.seriesOrder
      ? `${params.seriesName} — ${params.occurrence.localDate}`
      : params.seriesName;

    const event = await tx.event.create({
      data: {
        title,
        description: params.template.description ?? null,
        slug: this.slugify(params.seriesName, params.occurrence.localDate),
        organizationId: params.orgId,
        venueId: params.venueId,
        seriesId: params.seriesId,
        seriesOrder: params.seriesOrder,
        category: params.category,
        startsAt,
        endsAt: windows.endsAt,
        doorsAt: windows.doorsAt,
        durationMinutes: windows.durationMinutes,
        timezone: params.timezone,
        status: params.status,
        publishedAt: params.status === EventStatus.SCHEDULED ? new Date() : null,
        announceAt: windows.announceAt,
        publishAt: windows.publishAt,
        salesStartAt: windows.salesStartAt,
        salesEndAt: windows.salesEndAt,
        image: params.template.imageUrl ?? null,
        totalCapacity: params.template.capacity,
        minPrice: new Decimal(params.template.basePrice),
        maxPrice: new Decimal(params.template.basePrice),
        currency: params.currency,
        metadata: {
          eventKind: params.seriesId ? 'series' : 'single',
          seriesName: params.seriesName,
          createdFrom: 'scheduling',
        } as Prisma.InputJsonValue,
      },
    });

    if (params.template.zoneName) {
      await tx.offer.create({
        data: {
          eventId: event.id,
          name: params.template.zoneName,
          zone: params.template.zoneName,
          basePrice: new Decimal(params.template.basePrice),
          currency: params.currency,
          totalQuantity: params.template.capacity,
          remainingQuantity: params.template.capacity,
          startDate: windows.salesStartAt ?? new Date(),
          endDate: windows.salesEndAt ?? startsAt,
          isAvailable: params.status === EventStatus.SCHEDULED,
        },
      });
    }

    for (const phase of params.phases ?? []) {
      await tx.salePhase.create({
        data: {
          eventId: event.id,
          name: phase.name.trim(),
          kind: phase.kind,
          code: phase.code?.trim() || null,
          startsAt: new Date(startsAt.getTime() - phase.startOffsetDays * DAY_MS),
          endsAt: new Date(startsAt.getTime() - phase.endOffsetDays * DAY_MS),
          channels: phase.channels ?? [],
          allocationPercent: phase.allocationPercent ?? null,
          maxPerOrder: phase.maxPerOrder ?? null,
          discountPercent: phase.discountPercent ?? null,
          priority: phase.priority ?? 100,
        },
      });
    }

    return event;
  }

  async listSeries(
    orgId: string | undefined,
    query: { limit?: number; cursor?: string } = {},
  ) {
    orgId = this.scopedOrganizationId(orgId);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    let cursorWhere: Prisma.EventSeriesWhereInput = {};
    if (query.cursor) {
      const cursor = await this.prisma.eventSeries.findFirst({
        where: { id: query.cursor, organizationId: orgId },
        select: { id: true, createdAt: true },
      });
      if (!cursor) throw new NotFoundException('Serie no encontrada');
      cursorWhere = {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      };
    }

    const series = await this.prisma.eventSeries.findMany({
      where: { organizationId: orgId, ...cursorWhere },
      include: {
        venue: { select: { id: true, name: true } },
        events: {
          orderBy: { startsAt: 'asc' },
          select: { id: true, startsAt: true, status: true, totalCapacity: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const now = new Date();
    const page = series.slice(0, limit).map((item) => {
      const upcoming = item.events.filter((event) => event.startsAt > now);
      const rule = item.recurrence as unknown as RecurrenceRule | null;
      return {
        id: item.id,
        name: item.name,
        slug: item.slug,
        kind: item.kind,
        status: item.status,
        timezone: item.timezone,
        venue: item.venue,
        summary: rule ? this.safeDescribe(rule) : null,
        totals: {
          events: item.events.length,
          upcoming: upcoming.length,
          cancelled: item.events.filter((event) => event.status === EventStatus.CANCELLED).length,
          capacity: item.events.reduce((sum, event) => sum + event.totalCapacity, 0),
        },
        firstDate: item.events[0]?.startsAt ?? null,
        lastDate: item.events[item.events.length - 1]?.startsAt ?? null,
        nextDate: upcoming[0]?.startsAt ?? null,
        createdAt: item.createdAt,
      };
    });

    return {
      items: page,
      series: page,
      nextCursor: series.length > limit ? page[page.length - 1]?.id ?? null : null,
      limit,
    };
  }

  private safeDescribe(rule: RecurrenceRule) {
    try {
      return describeRecurrence(rule);
    } catch {
      return null;
    }
  }

  async getSeries(orgId: string | undefined, seriesId: string) {
    orgId = this.scopedOrganizationId(orgId);
    const series = await this.prisma.eventSeries.findFirst({
      where: { id: seriesId, organizationId: orgId },
      include: {
        venue: { select: { id: true, name: true, timezone: true } },
        events: {
          orderBy: { startsAt: 'asc' },
          include: {
            salePhases: { orderBy: { startsAt: 'asc' } },
            _count: { select: { tickets: true, orders: true } },
          },
        },
      },
    });
    if (!series) throw new NotFoundException('Serie no encontrada');

    const rule = series.recurrence as unknown as RecurrenceRule | null;
    return {
      id: series.id,
      name: series.name,
      slug: series.slug,
      description: series.description,
      kind: series.kind,
      status: series.status,
      category: series.category,
      timezone: series.timezone,
      venue: series.venue,
      recurrence: rule ? { ...rule, summary: this.safeDescribe(rule) } : null,
      template: series.template as unknown as SeriesTemplate | null,
      events: series.events.map((event) => ({
        id: event.id,
        title: event.title,
        slug: event.slug,
        status: event.status,
        seriesOrder: event.seriesOrder,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        doorsAt: event.doorsAt,
        localDate: formatLocalDate(event.startsAt, event.timezone),
        totalCapacity: event.totalCapacity,
        sale: resolveSaleStatus({
          status: event.status,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          announceAt: event.announceAt,
          publishAt: event.publishAt,
          salesStartAt: event.salesStartAt,
          salesEndAt: event.salesEndAt,
          phases: event.salePhases.map((phase) => ({
            id: phase.id,
            name: phase.name,
            kind: phase.kind,
            startsAt: phase.startsAt,
            endsAt: phase.endsAt,
            code: phase.code,
            active: phase.status !== SalePhaseStatus.CANCELLED,
          })),
        }),
        counts: event._count,
      })),
      createdAt: series.createdAt,
      updatedAt: series.updatedAt,
    };
  }

  async updateSeries(
    orgId: string | undefined,
    seriesId: string,
    dto: { name?: string; description?: string; status?: EventSeriesStatus },
  ) {
    orgId = this.scopedOrganizationId(orgId);
    const series = await this.prisma.eventSeries.findFirst({
      where: { id: seriesId, organizationId: orgId },
      select: { id: true },
    });
    if (!series) throw new NotFoundException('Serie no encontrada');

    const updated = await this.prisma.eventSeries.updateMany({
      where: { id: seriesId, organizationId: orgId },
      data: {
        ...(dto.name != null ? { name: dto.name.trim() } : {}),
        ...(dto.description != null ? { description: dto.description } : {}),
        ...(dto.status != null ? { status: dto.status } : {}),
      },
    });
    if (!updated.count) throw new NotFoundException('Serie no encontrada');
    return this.getSeries(orgId, seriesId);
  }

  /** Add more dates to an existing series, continuing its stored recurrence. */
  async extendSeries(
    orgId: string | undefined,
    userId: string | undefined,
    seriesId: string,
    dto: { count?: number; untilLocal?: string; publish?: boolean; force?: boolean },
  ) {
    orgId = this.scopedOrganizationId(orgId);
    const series = await this.prisma.eventSeries.findFirst({
      where: { id: seriesId, organizationId: orgId },
      include: { events: { orderBy: { startsAt: 'asc' }, select: { id: true, startsAt: true } } },
    });
    if (!series) throw new NotFoundException('Serie no encontrada');
    if (!series.venueId) throw new BadRequestException('La serie no tiene recinto para programar');

    const rule = series.recurrence as unknown as RecurrenceRule | null;
    const template = series.template as unknown as SeriesTemplate | null;
    if (!rule || !template) {
      throw new BadRequestException('La serie no tiene recurrencia almacenada para extender');
    }

    const existing = new Set(series.events.map((event) => event.startsAt.toISOString()));
    const extendedRule: RecurrenceRule = dto.untilLocal
      ? { ...rule, count: undefined, untilLocal: dto.untilLocal }
      : { ...rule, untilLocal: undefined, count: series.events.length + Math.max(1, dto.count ?? 4) };

    const preview = await this.previewSchedule(orgId, {
      rule: extendedRule,
      venueId: series.venueId,
      template,
      excludeSeriesId: seriesId,
    });

    const fresh = preview.occurrences.filter((occurrence) => !existing.has(occurrence.startsAt));
    if (!fresh.length) {
      throw new BadRequestException('La recurrencia extendida no produjo fechas nuevas');
    }
    const blocking = fresh.filter((occurrence) => occurrence.blocking);
    if (blocking.length && !dto.force) {
      throw new ConflictException({
        message: `${blocking.length} fecha(s) nuevas tienen conflicto. Usa force=true para crearlas igual.`,
        conflicts: blocking.map((o) => ({ startsAt: o.startsAt, conflicts: o.conflicts })),
      });
    }

    const status = dto.publish ? EventStatus.SCHEDULED : EventStatus.DRAFT;
    const phases = await this.phaseTemplatesFromSeries(series.events[0]?.id, series.events[0]?.startsAt);

    await this.prisma.$transaction(async (tx) => {
      let order = series.events.length;
      for (const occurrence of fresh) {
        order += 1;
        await this.createOccurrence(tx, {
          orgId,
          venueId: series.venueId!,
          seriesId: series.id,
          seriesOrder: order,
          seriesName: series.name,
          timezone: series.timezone,
          category: series.category,
          status,
          currency: template.currency ?? 'MXN',
          template,
          phases,
          occurrence,
        });
      }
      const seriesUpdate = await tx.eventSeries.updateMany({
        where: { id: series.id, organizationId: orgId },
        data: { recurrence: extendedRule as unknown as Prisma.InputJsonValue },
      });
      if (!seriesUpdate.count) {
        throw new NotFoundException('Serie no encontrada');
      }
    });

    await this.audit.log({
      action: 'EVENT_SERIES_EXTENDED',
      entityType: 'EventSeries',
      entityId: series.id,
      organizationId: orgId,
      userId: this.actorUserId(userId),
      metadata: { added: fresh.length },
    });

    return { added: fresh.length, series: await this.getSeries(orgId, seriesId) };
  }

  /** Re-derive relative phase offsets from the first event so extensions match. */
  private async phaseTemplatesFromSeries(eventId?: string, startsAt?: Date): Promise<PhaseTemplate[]> {
    if (!eventId || !startsAt) return [];
    const phases = await this.prisma.salePhase.findMany({ where: { eventId } });
    return phases.map((phase) => ({
      name: phase.name,
      kind: phase.kind,
      code: phase.code,
      startOffsetDays: (startsAt.getTime() - phase.startsAt.getTime()) / DAY_MS,
      endOffsetDays: (startsAt.getTime() - phase.endsAt.getTime()) / DAY_MS,
      channels: phase.channels,
      allocationPercent: phase.allocationPercent,
      maxPerOrder: phase.maxPerOrder,
      discountPercent: phase.discountPercent,
      priority: phase.priority,
    }));
  }

  // -------------------------------------------------------------------------
  // Single event scheduling
  // -------------------------------------------------------------------------

  async rescheduleEvent(
    orgId: string | undefined,
    userId: string | undefined,
    eventId: string,
    dto: {
      startsAt: string;
      durationMinutes?: number;
      doorsAt?: string;
      reason: string;
      force?: boolean;
      keepStatus?: boolean;
    },
  ) {
    orgId = this.scopedOrganizationId(orgId);
    const event = await this.assertEvent(orgId, eventId);
    if (!dto.reason?.trim()) throw new BadRequestException('Se requiere un motivo para reprogramar');

    const startsAt = new Date(dto.startsAt);
    if (Number.isNaN(startsAt.getTime())) throw new BadRequestException('startsAt inválido');
    if (startsAt.getTime() === event.startsAt.getTime()) {
      throw new BadRequestException('La nueva fecha es igual a la actual');
    }

    const duration = dto.durationMinutes ?? event.durationMinutes ?? DEFAULT_EVENT_DURATION_MINUTES;
    const { events: booked, blackouts } = await this.bookedSlots({
      organizationId: orgId,
      venueId: event.venueId,
      from: startsAt,
      to: new Date(startsAt.getTime() + duration * MINUTE_MS),
      excludeEventIds: [event.id],
    });
    const conflicts =
      detectScheduleConflicts([{ startsAt: startsAt.toISOString(), durationMinutes: duration }], booked, {
        defaultDurationMinutes: duration,
        blackouts: blackouts.filter((blackout) => blackout.blocking),
      }).get(0) ?? [];
    const blocking = conflicts.filter((conflict) => conflict.kind !== 'TURNAROUND');
    if (blocking.length && !dto.force) {
      throw new ConflictException({ message: blocking[0].message, conflicts });
    }

    const endsAt = new Date(startsAt.getTime() + duration * MINUTE_MS);
    const doorsAt = dto.doorsAt
      ? new Date(dto.doorsAt)
      : event.doorsAt
        ? new Date(startsAt.getTime() - (event.startsAt.getTime() - event.doorsAt.getTime()))
        : null;
    // Sales can never outlive the show: clamp the closing time to the new date.
    const salesEndAt =
      event.salesEndAt && event.salesEndAt > endsAt ? endsAt : event.salesEndAt;

    const updatedCount = await this.prisma.event.updateMany({
      where: { id: event.id, organizationId: orgId },
      data: {
        startsAt,
        endsAt,
        doorsAt,
        durationMinutes: duration,
        salesEndAt,
        rescheduledFrom: event.rescheduledFrom ?? event.startsAt,
        scheduleNote: dto.reason.trim(),
        status:
          dto.keepStatus || event.status === EventStatus.DRAFT
            ? event.status
            : EventStatus.RESCHEDULED,
      },
    });
    if (!updatedCount.count) {
      throw new NotFoundException('Evento no encontrado para esta organización');
    }
    const updated = await this.prisma.event.findFirst({
      where: { id: event.id, organizationId: orgId },
      include: { salePhases: true },
    });
    if (!updated) {
      throw new NotFoundException('Evento no encontrado para esta organización');
    }

    await this.audit.log({
      action: 'EVENT_RESCHEDULED',
      entityType: 'Event',
      entityId: event.id,
      organizationId: orgId,
      userId: this.actorUserId(userId),
      metadata: {
        from: event.startsAt.toISOString(),
        to: startsAt.toISOString(),
        reason: dto.reason.trim(),
        forced: Boolean(dto.force && blocking.length),
      },
    });

    return { event: updated, conflicts };
  }

  async cancelEvent(
    orgId: string | undefined,
    userId: string | undefined,
    eventId: string,
    dto: { reason: string },
  ) {
    orgId = this.scopedOrganizationId(orgId);
    const event = await this.assertEvent(orgId, eventId);
    if (!dto.reason?.trim()) throw new BadRequestException('Se requiere un motivo para cancelar');
    if (event.status === EventStatus.CANCELLED) {
      throw new BadRequestException('El evento ya está cancelado');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.event.updateMany({
        where: { id: event.id, organizationId: orgId },
        data: {
          status: EventStatus.CANCELLED,
          cancelledAt: new Date(),
          scheduleNote: dto.reason.trim(),
        },
      });
      if (!result.count) {
        throw new NotFoundException('Evento no encontrado para esta organización');
      }
      await tx.offer.updateMany({
        where: { eventId: event.id, event: { organizationId: orgId } },
        data: { isAvailable: false },
      });
      await tx.salePhase.updateMany({
        where: {
          eventId: event.id,
          event: { organizationId: orgId },
          status: { in: [SalePhaseStatus.SCHEDULED, SalePhaseStatus.ACTIVE] },
        },
        data: { status: SalePhaseStatus.CANCELLED },
      });
      const cancelled = await tx.event.findFirst({
        where: { id: event.id, organizationId: orgId },
      });
      if (!cancelled) {
        throw new NotFoundException('Evento no encontrado para esta organización');
      }
      return cancelled;
    });

    await this.audit.log({
      action: 'EVENT_CANCELLED',
      entityType: 'Event',
      entityId: event.id,
      organizationId: orgId,
      userId: this.actorUserId(userId),
      metadata: { reason: dto.reason.trim() },
    });

    return updated;
  }

  async setSaleWindows(
    orgId: string | undefined,
    userId: string | undefined,
    eventId: string,
    dto: {
      announceAt?: string | null;
      publishAt?: string | null;
      salesStartAt?: string | null;
      salesEndAt?: string | null;
      doorsAt?: string | null;
      durationMinutes?: number | null;
    },
  ) {
    orgId = this.scopedOrganizationId(orgId);
    const event = await this.assertEvent(orgId, eventId);
    const parse = (value?: string | null) => {
      if (value === undefined) return undefined;
      if (value === null || value === '') return null;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) throw new BadRequestException(`Invalid date: ${value}`);
      return date;
    };

    const announceAt = parse(dto.announceAt);
    const publishAt = parse(dto.publishAt);
    const salesStartAt = parse(dto.salesStartAt);
    const salesEndAt = parse(dto.salesEndAt);
    const doorsAt = parse(dto.doorsAt);

    const finalAnnounce = announceAt !== undefined ? announceAt : event.announceAt;
    const finalPublish = publishAt !== undefined ? publishAt : event.publishAt;
    const finalStart = salesStartAt !== undefined ? salesStartAt : event.salesStartAt;
    const finalEnd = salesEndAt !== undefined ? salesEndAt : event.salesEndAt;
    if (finalStart && finalEnd && finalStart >= finalEnd) {
      throw new BadRequestException('salesStartAt debe ser anterior a salesEndAt');
    }
    if (finalAnnounce && finalPublish && finalAnnounce > finalPublish) {
      throw new BadRequestException('announceAt no puede ser posterior a publishAt');
    }
    if (finalPublish && finalStart && finalPublish > finalStart) {
      throw new BadRequestException('publishAt no puede ser posterior a salesStartAt');
    }
    const duration =
      dto.durationMinutes !== undefined
        ? dto.durationMinutes
        : event.durationMinutes ?? DEFAULT_EVENT_DURATION_MINUTES;
    const eventEnd =
      event.endsAt ??
      new Date(
        event.startsAt.getTime() +
          (duration ?? DEFAULT_EVENT_DURATION_MINUTES) * MINUTE_MS,
      );
    if (finalEnd && finalEnd > eventEnd) {
      throw new BadRequestException('salesEndAt no puede ser posterior al fin del evento');
    }
    if (doorsAt && doorsAt > event.startsAt) {
      throw new BadRequestException('doorsAt no puede ser posterior a la hora del show');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.event.updateMany({
        where: { id: event.id, organizationId: orgId },
        data: {
          ...(announceAt !== undefined ? { announceAt } : {}),
          ...(publishAt !== undefined ? { publishAt } : {}),
          ...(salesStartAt !== undefined ? { salesStartAt } : {}),
          ...(salesEndAt !== undefined ? { salesEndAt } : {}),
          ...(doorsAt !== undefined ? { doorsAt } : {}),
          ...(dto.durationMinutes !== undefined
            ? {
                durationMinutes: dto.durationMinutes,
                endsAt: dto.durationMinutes
                  ? new Date(event.startsAt.getTime() + dto.durationMinutes * MINUTE_MS)
                  : event.endsAt,
              }
            : {}),
        },
      });
      if (!result.count) {
        throw new NotFoundException('Evento no encontrado para esta organización');
      }
      const next = await tx.event.findFirst({
        where: { id: event.id, organizationId: orgId },
        include: { salePhases: { orderBy: { startsAt: 'asc' } } },
      });
      if (!next) {
        throw new NotFoundException('Evento no encontrado para esta organización');
      }
      if (salesStartAt !== undefined || salesEndAt !== undefined) {
        await tx.offer.updateMany({
          where: { eventId: event.id, event: { organizationId: orgId } },
          data: {
            ...(next.salesStartAt ? { startDate: next.salesStartAt } : {}),
            ...(next.salesEndAt ? { endDate: next.salesEndAt } : {}),
          },
        });
      }
      return next;
    });

    await this.audit.log({
      action: 'EVENT_SALE_WINDOWS_UPDATED',
      entityType: 'Event',
      entityId: event.id,
      organizationId: orgId,
      userId: this.actorUserId(userId),
      metadata: {
        announceAt: updated.announceAt,
        publishAt: updated.publishAt,
        salesStartAt: updated.salesStartAt,
        salesEndAt: updated.salesEndAt,
      },
    });

    return this.getEventSchedule(orgId, eventId);
  }

  async getEventSchedule(orgId: string | undefined, eventId: string) {
    orgId = this.scopedOrganizationId(orgId);
    const event = await this.assertEvent(orgId, eventId);
    const sale = resolveSaleStatus({
      status: event.status,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      announceAt: event.announceAt,
      publishAt: event.publishAt,
      salesStartAt: event.salesStartAt,
      salesEndAt: event.salesEndAt,
      phases: event.salePhases.map((phase) => ({
        id: phase.id,
        name: phase.name,
        kind: phase.kind,
        startsAt: phase.startsAt,
        endsAt: phase.endsAt,
        code: phase.code,
        active: phase.status !== SalePhaseStatus.CANCELLED,
      })),
    });

    const { events: booked, blackouts } = await this.bookedSlots({
      organizationId: orgId,
      venueId: event.venueId,
      from: event.startsAt,
      to: event.endsAt ?? event.startsAt,
      excludeEventIds: [event.id],
    });
    const conflicts =
      detectScheduleConflicts(
        [
          {
            id: event.id,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            durationMinutes: event.durationMinutes,
          },
        ],
        booked,
        { blackouts },
      ).get(0) ?? [];

    return {
      event: {
        id: event.id,
        title: event.title,
        status: event.status,
        timezone: event.timezone,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        doorsAt: event.doorsAt,
        durationMinutes: event.durationMinutes,
        announceAt: event.announceAt,
        publishAt: event.publishAt,
        salesStartAt: event.salesStartAt,
        salesEndAt: event.salesEndAt,
        publishedAt: event.publishedAt,
        rescheduledFrom: event.rescheduledFrom,
        scheduleNote: event.scheduleNote,
        seriesId: event.seriesId,
        seriesOrder: event.seriesOrder,
        venue: event.venue,
      },
      sale,
      phases: event.salePhases,
      conflicts,
    };
  }

  // -------------------------------------------------------------------------
  // Sale phases
  // -------------------------------------------------------------------------

  async upsertPhase(
    orgId: string | undefined,
    userId: string | undefined,
    eventId: string,
    dto: {
      id?: string;
      name: string;
      kind: SalePhaseKind;
      code?: string | null;
      startsAt: string;
      endsAt: string;
      channels?: SalesChannel[];
      allocationPercent?: number | null;
      maxPerOrder?: number | null;
      discountPercent?: number | null;
      priority?: number;
      notes?: string | null;
    },
  ) {
    orgId = this.scopedOrganizationId(orgId);
    const event = await this.assertEvent(orgId, eventId);
    if (!dto.name?.trim()) throw new BadRequestException('El nombre es obligatorio');

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException('Fechas de fase inválidas');
    }
    if (startsAt >= endsAt) throw new BadRequestException('La fase: startsAt debe ser anterior a endsAt');
    if (event.endsAt && startsAt > event.endsAt) {
      throw new BadRequestException('La fase no puede iniciar después de que termine el evento');
    }
    if (dto.allocationPercent != null && (dto.allocationPercent < 1 || dto.allocationPercent > 100)) {
      throw new BadRequestException('allocationPercent debe estar entre 1 y 100');
    }

    const data = {
      eventId: event.id,
      name: dto.name.trim(),
      kind: dto.kind,
      code: dto.code?.trim() || null,
      startsAt,
      endsAt,
      channels: dto.channels ?? [],
      allocationPercent: dto.allocationPercent ?? null,
      maxPerOrder: dto.maxPerOrder ?? null,
      discountPercent: dto.discountPercent ?? null,
      priority: dto.priority ?? 100,
      notes: dto.notes ?? null,
      status: this.phaseStatusFor(startsAt, endsAt),
    };

    let phase;
    if (dto.id) {
      const existing = await this.prisma.salePhase.findFirst({
        where: { id: dto.id, eventId: event.id, event: { organizationId: orgId } },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Fase no encontrada');
      phase = await this.prisma.salePhase.update({ where: { id: existing.id }, data });
    } else {
      phase = await this.prisma.salePhase.create({ data });
    }

    await this.audit.log({
      action: dto.id ? 'SALE_PHASE_UPDATED' : 'SALE_PHASE_CREATED',
      entityType: 'SalePhase',
      entityId: phase.id,
      organizationId: orgId,
      userId: this.actorUserId(userId),
      metadata: { eventId: event.id, kind: phase.kind, code: phase.code },
    });

    return phase;
  }

  private phaseStatusFor(startsAt: Date, endsAt: Date, now = new Date()) {
    if (endsAt <= now) return SalePhaseStatus.ENDED;
    if (startsAt <= now) return SalePhaseStatus.ACTIVE;
    return SalePhaseStatus.SCHEDULED;
  }

  async deletePhase(orgId: string | undefined, eventId: string, phaseId: string) {
    orgId = this.scopedOrganizationId(orgId);
    await this.assertEvent(orgId, eventId);
    const phase = await this.prisma.salePhase.findFirst({
      where: { id: phaseId, eventId, event: { organizationId: orgId } },
    });
    if (!phase) throw new NotFoundException('Fase no encontrada');
    await this.prisma.salePhase.delete({ where: { id: phase.id } });
    await this.audit.log({
      action: 'SALE_PHASE_DELETED',
      entityType: 'SalePhase',
      entityId: phase.id,
      organizationId: orgId,
      userId: this.actorUserId(),
      metadata: { eventId, name: phase.name, kind: phase.kind },
    });
    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Venue availability
  // -------------------------------------------------------------------------

  async listBlackouts(orgId: string | undefined, venueId: string) {
    orgId = this.scopedOrganizationId(orgId);
    await this.assertVenue(orgId, venueId);
    return this.prisma.venueBlackout.findMany({
      where: { venueId },
      orderBy: { startsAt: 'asc' },
    });
  }

  async createBlackout(
    orgId: string | undefined,
    userId: string | undefined,
    venueId: string,
    dto: { reason: string; startsAt: string; endsAt: string; blocking?: boolean },
  ) {
    orgId = this.scopedOrganizationId(orgId);
    await this.assertVenue(orgId, venueId);
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException('Fechas de bloqueo inválidas');
    }
    if (startsAt >= endsAt) throw new BadRequestException('startsAt debe ser anterior a endsAt');
    if (!dto.reason?.trim()) throw new BadRequestException('El motivo es obligatorio');

    const affected = await this.prisma.event.count({
      where: {
        organizationId: orgId,
        venueId,
        status: { notIn: [EventStatus.CANCELLED, EventStatus.COMPLETED] },
        startsAt: { gte: startsAt, lte: endsAt },
      },
    });

    const blackout = await this.prisma.venueBlackout.create({
      data: {
        venueId,
        reason: dto.reason.trim(),
        startsAt,
        endsAt,
        blocking: dto.blocking ?? true,
        createdBy: this.actorUserId(userId),
      },
    });

    await this.audit.log({
      action: 'VENUE_BLACKOUT_CREATED',
      entityType: 'VenueBlackout',
      entityId: blackout.id,
      organizationId: orgId,
      userId: this.actorUserId(userId),
      metadata: {
        venueId,
        reason: blackout.reason,
        blocking: blackout.blocking,
        affectedEvents: affected,
        startsAt: blackout.startsAt.toISOString(),
        endsAt: blackout.endsAt.toISOString(),
      },
    });

    return { blackout, affectedEvents: affected };
  }

  async deleteBlackout(orgId: string | undefined, venueId: string, blackoutId: string) {
    orgId = this.scopedOrganizationId(orgId);
    await this.assertVenue(orgId, venueId);
    const blackout = await this.prisma.venueBlackout.findFirst({
      where: { id: blackoutId, venueId, venue: { organizationId: orgId } },
    });
    if (!blackout) throw new NotFoundException('Bloqueo no encontrado');
    await this.prisma.venueBlackout.delete({ where: { id: blackout.id } });
    await this.audit.log({
      action: 'VENUE_BLACKOUT_DELETED',
      entityType: 'VenueBlackout',
      entityId: blackout.id,
      organizationId: orgId,
      userId: this.actorUserId(),
      metadata: { venueId, reason: blackout.reason },
    });
    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Calendar
  // -------------------------------------------------------------------------

  async getCalendar(
    orgId: string | undefined,
    query: { from: string; to: string; venueId?: string; status?: EventStatus; limit?: number },
  ) {
    orgId = this.scopedOrganizationId(orgId);
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('from y to deben ser fechas válidas');
    }
    if (to <= from) throw new BadRequestException('to debe ser posterior a from');
    if (to.getTime() - from.getTime() > 400 * DAY_MS) {
      throw new BadRequestException('El rango no puede exceder 400 días');
    }
    if (query.venueId) {
      await this.assertVenue(orgId, query.venueId);
    }
    const limit = Math.min(Math.max(query.limit ?? 500, 1), 1_000);

    const events = await this.prisma.event.findMany({
      where: {
        organizationId: orgId,
        startsAt: { gte: from, lte: to },
        ...(query.venueId ? { venueId: query.venueId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { startsAt: 'asc' },
      take: limit,
      include: {
        venue: { select: { id: true, name: true } },
        series: { select: { id: true, name: true, kind: true } },
        salePhases: { orderBy: { startsAt: 'asc' } },
        _count: { select: { orders: true } },
      },
    });

    const venueIds = [...new Set(events.map((event) => event.venueId))];
    const blackouts = await this.prisma.venueBlackout.findMany({
      where: {
        venue: { organizationId: orgId },
        venueId: query.venueId ? query.venueId : { in: venueIds.length ? venueIds : ['__none__'] },
        endsAt: { gte: from },
        startsAt: { lte: to },
      },
      include: { venue: { select: { id: true, name: true } } },
      orderBy: { startsAt: 'asc' },
      take: limit,
    });

    const now = new Date();
    const byVenue = new Map<string, typeof events>();
    for (const event of events) {
      const list = byVenue.get(event.venueId) ?? [];
      list.push(event);
      byVenue.set(event.venueId, list);
    }

    const conflictsByEvent = new Map<string, ScheduleConflict[]>();
    for (const [venueId, venueEvents] of byVenue) {
      const slots = venueEvents.map((event) => ({
        id: event.id,
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        durationMinutes: event.durationMinutes,
      }));
      const venueBlackouts = blackouts
        .filter((blackout) => blackout.venueId === venueId)
        .map((blackout) => ({
          id: blackout.id,
          title: blackout.reason,
          startsAt: blackout.startsAt,
          endsAt: blackout.endsAt,
        }));
      slots.forEach((slot, index) => {
        const others = slots.filter((_, i) => i !== index);
        const found = detectScheduleConflicts([slot], others, {
          turnaroundMinutes: 0,
          blackouts: venueBlackouts,
        }).get(0);
        if (found?.length) conflictsByEvent.set(slot.id, found);
      });
    }

    const days: Record<string, unknown[]> = {};
    const items = events.map((event) => {
      const sale = resolveSaleStatus(
        {
          status: event.status,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          announceAt: event.announceAt,
          publishAt: event.publishAt,
          salesStartAt: event.salesStartAt,
          salesEndAt: event.salesEndAt,
          phases: event.salePhases.map((phase) => ({
            id: phase.id,
            name: phase.name,
            kind: phase.kind,
            startsAt: phase.startsAt,
            endsAt: phase.endsAt,
            code: phase.code,
            active: phase.status !== SalePhaseStatus.CANCELLED,
          })),
        },
        now,
      );

      const localDate = formatLocalDate(event.startsAt, event.timezone);
      const item = {
        id: event.id,
        title: event.title,
        status: event.status,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        doorsAt: event.doorsAt,
        localDate,
        localTime: event.startsAt.toLocaleTimeString('es-MX', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: event.timezone,
        }),
        timezone: event.timezone,
        venue: event.venue,
        series: event.series,
        seriesOrder: event.seriesOrder,
        capacity: event.totalCapacity,
        orders: event._count.orders,
        saleState: sale.state,
        canPurchase: sale.canPurchase,
        nextChangeAt: sale.nextChangeAt ?? null,
        phases: event.salePhases.length,
        conflicts: conflictsByEvent.get(event.id) ?? [],
      };
      days[localDate] = [...(days[localDate] ?? []), item];
      return item;
    });

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      events: items,
      days,
      blackouts: blackouts.map((blackout) => ({
        id: blackout.id,
        reason: blackout.reason,
        startsAt: blackout.startsAt,
        endsAt: blackout.endsAt,
        blocking: blackout.blocking,
        venue: blackout.venue,
      })),
      totals: {
        events: items.length,
        onSale: items.filter((item) => item.saleState === 'ON_SALE').length,
        presale: items.filter((item) => item.saleState === 'PRESALE').length,
        draft: items.filter((item) => item.saleState === 'DRAFT').length,
        conflicts: items.filter((item) => item.conflicts.length).length,
      },
    };
  }

  /** Everything scheduled to change in the next `hours`, for the ops dashboard. */
  async getUpcomingTransitions(orgId: string | undefined, hours = 72) {
    orgId = this.scopedOrganizationId(orgId);
    const now = new Date();
    const horizon = new Date(now.getTime() + hours * HOUR_MS);

    const [publishing, onSale, closing, phases] = await Promise.all([
      this.prisma.event.findMany({
        where: { organizationId: orgId, status: EventStatus.DRAFT, publishAt: { gte: now, lte: horizon } },
        select: { id: true, title: true, publishAt: true },
        orderBy: { publishAt: 'asc' },
      }),
      this.prisma.event.findMany({
        where: { organizationId: orgId, salesStartAt: { gte: now, lte: horizon } },
        select: { id: true, title: true, salesStartAt: true },
        orderBy: { salesStartAt: 'asc' },
      }),
      this.prisma.event.findMany({
        where: { organizationId: orgId, salesEndAt: { gte: now, lte: horizon } },
        select: { id: true, title: true, salesEndAt: true },
        orderBy: { salesEndAt: 'asc' },
      }),
      this.prisma.salePhase.findMany({
        where: {
          event: { organizationId: orgId },
          status: { in: [SalePhaseStatus.SCHEDULED, SalePhaseStatus.ACTIVE] },
          OR: [
            { startsAt: { gte: now, lte: horizon } },
            { endsAt: { gte: now, lte: horizon } },
          ],
        },
        include: { event: { select: { id: true, title: true } } },
        orderBy: { startsAt: 'asc' },
      }),
    ]);

    return {
      horizonHours: hours,
      publishing: publishing.map((e) => ({ eventId: e.id, title: e.title, at: e.publishAt })),
      onSale: onSale.map((e) => ({ eventId: e.id, title: e.title, at: e.salesStartAt })),
      closing: closing.map((e) => ({ eventId: e.id, title: e.title, at: e.salesEndAt })),
      phases: phases.map((phase) => ({
        phaseId: phase.id,
        eventId: phase.event.id,
        title: phase.event.title,
        name: phase.name,
        kind: phase.kind,
        opensAt: phase.startsAt,
        closesAt: phase.endsAt,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Scheduler tick (called by the worker)
  // -------------------------------------------------------------------------

  /**
   * Advance every time-driven state machine: auto-publish, open/close general
   * sales, activate/expire sale phases, complete finished events and close
   * series whose last date already happened. Idempotent by design.
   */
  async runTick(now = new Date()) {
    const published = await this.prisma.event.updateMany({
      where: { status: EventStatus.DRAFT, publishAt: { not: null, lte: now } },
      data: { status: EventStatus.SCHEDULED, publishedAt: now },
    });

    const liveCandidates = await this.prisma.event.findMany({
      where: {
        status: { in: [EventStatus.SCHEDULED, EventStatus.RESCHEDULED] },
        salesStartAt: { not: null, lte: now },
        OR: [{ salesEndAt: null }, { salesEndAt: { gt: now } }],
      },
      select: { id: true },
    });
    if (liveCandidates.length) {
      await this.prisma.event.updateMany({
        where: { id: { in: liveCandidates.map((event) => event.id) } },
        data: { status: EventStatus.LIVE },
      });
      await this.prisma.offer.updateMany({
        where: { eventId: { in: liveCandidates.map((event) => event.id) } },
        data: { isAvailable: true },
      });
    }

    const closing = await this.prisma.event.findMany({
      where: {
        status: { in: [EventStatus.LIVE, EventStatus.SCHEDULED, EventStatus.RESCHEDULED] },
        salesEndAt: { not: null, lte: now },
      },
      select: { id: true },
    });
    if (closing.length) {
      await this.prisma.offer.updateMany({
        where: { eventId: { in: closing.map((event) => event.id) } },
        data: { isAvailable: false },
      });
    }

    const [phasesActivated, phasesEnded] = await Promise.all([
      this.prisma.salePhase.updateMany({
        where: { status: SalePhaseStatus.SCHEDULED, startsAt: { lte: now }, endsAt: { gt: now } },
        data: { status: SalePhaseStatus.ACTIVE },
      }),
      this.prisma.salePhase.updateMany({
        where: { status: { in: [SalePhaseStatus.SCHEDULED, SalePhaseStatus.ACTIVE] }, endsAt: { lte: now } },
        data: { status: SalePhaseStatus.ENDED },
      }),
    ]);

    const completed = await this.prisma.event.updateMany({
      where: {
        status: { in: [EventStatus.LIVE, EventStatus.SCHEDULED, EventStatus.RESCHEDULED] },
        OR: [
          { endsAt: { not: null, lt: now } },
          { endsAt: null, startsAt: { lt: new Date(now.getTime() - 12 * HOUR_MS) } },
        ],
      },
      data: { status: EventStatus.COMPLETED },
    });

    const activeSeries = await this.prisma.eventSeries.findMany({
      where: { status: { in: [EventSeriesStatus.DRAFT, EventSeriesStatus.ACTIVE] } },
      select: { id: true, status: true, events: { select: { status: true } } },
    });
    let seriesCompleted = 0;
    for (const series of activeSeries) {
      if (!series.events.length) continue;
      const finished = series.events.every(
        (event) =>
          event.status === EventStatus.COMPLETED || event.status === EventStatus.CANCELLED,
      );
      if (finished) {
        await this.prisma.eventSeries.update({
          where: { id: series.id },
          data: { status: EventSeriesStatus.COMPLETED },
        });
        seriesCompleted += 1;
      }
    }

    const result = {
      at: now.toISOString(),
      published: published.count,
      wentOnSale: liveCandidates.length,
      salesClosed: closing.length,
      phasesActivated: phasesActivated.count,
      phasesEnded: phasesEnded.count,
      completed: completed.count,
      seriesCompleted,
    };

    const changes =
      result.published +
      result.wentOnSale +
      result.salesClosed +
      result.phasesActivated +
      result.phasesEnded +
      result.completed +
      result.seriesCompleted;
    if (changes) this.logger.log(`Schedule tick: ${JSON.stringify(result)}`);

    return result;
  }
}
