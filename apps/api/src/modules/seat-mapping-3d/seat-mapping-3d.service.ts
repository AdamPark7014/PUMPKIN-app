import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus, TicketStatus } from '@prisma/client';
import type { SeatMapData } from '@boletera/shared';
import {
  calculateSightlines,
  normalizeSeatMap,
  projectTo3D,
  resolveGeometry,
} from '@boletera/venue-engine';
import { TenantContextService } from '../../common/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';

export interface SeatPosition {
  id: string;
  label: string;
  section: string;
  row: string;
  seatNumber: number;
  x: number;
  y: number;
  z: number;
  tier: 'premium' | 'standard' | 'economy';
  visible: boolean;
  accessible: boolean;
  price: number;
  status: 'available' | 'held' | 'sold' | 'blocked';
  viewQuality?: number;
  sightlineGrade?: string;
}

export interface Section3D {
  id: string;
  name: string;
  color: string;
  seats: SeatPosition[];
  capacity: number;
  soldCount: number;
  price: number;
  geometry: {
    shape: 'rectangular' | 'curved' | 'circular';
    width: number;
    depth: number;
    rotation: number;
  };
}

const PUBLIC_EVENT_STATUSES: ReadonlySet<EventStatus> = new Set([
  EventStatus.SCHEDULED,
  EventStatus.LIVE,
]);

function asSeatTier(value: string | undefined): SeatPosition['tier'] {
  if (value === 'premium' || value === 'economy' || value === 'standard') return value;
  return 'standard';
}

function asSeatStatus(value: string): SeatPosition['status'] {
  if (value === 'held' || value === 'sold' || value === 'blocked' || value === 'available') {
    return value;
  }
  return 'available';
}

@Injectable()
export class SeatMapping3DService {
  private readonly logger = new Logger(SeatMapping3DService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private async loadVenueMap(
    venueId: string,
    organizationId: string,
  ): Promise<SeatMapData | null> {
    const layout = await this.prisma.venueLayout.findFirst({
      where: { venueId, isActive: true, venue: { organizationId } },
      orderBy: { updatedAt: 'desc' },
      select: { mapData: true },
    });
    if (!layout?.mapData) return null;
    return normalizeSeatMap(layout.mapData);
  }

  private async requireEventForMap(eventId: string, opts?: { requireStaff?: boolean }) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        organizationId: true,
        venueId: true,
        status: true,
        publishedAt: true,
        venue: { select: { name: true } },
        seatMap: { select: { snapshotData: true } },
      },
    });
    if (!event) throw new NotFoundException('Event not found');

    const ctx = this.tenant.current();
    const isStaff =
      Boolean(ctx.organizationId || ctx.privileged) &&
      (ctx.privileged || ctx.organizationId === event.organizationId);

    if (opts?.requireStaff) {
      if (!isStaff) throw new ForbiddenException('Organization access denied');
      this.tenant.assertOrganization(event.organizationId);
    } else if (!isStaff) {
      if (!event.publishedAt || !PUBLIC_EVENT_STATUSES.has(event.status)) {
        throw new NotFoundException('Event not found');
      }
    } else {
      this.tenant.assertOrganization(event.organizationId);
    }

    return event;
  }

  private async loadEventMap(eventId: string, opts?: { requireStaff?: boolean }) {
    const event = await this.requireEventForMap(eventId, opts);

    const raw =
      event.seatMap?.snapshotData ??
      (
        await this.prisma.venueLayout.findFirst({
          where: {
            venueId: event.venueId,
            isActive: true,
            venue: { organizationId: event.organizationId },
          },
          orderBy: { updatedAt: 'desc' },
          select: { mapData: true },
        })
      )?.mapData;

    if (!raw) throw new BadRequestException('No seat map published for this event/venue');

    return {
      map: normalizeSeatMap(raw),
      venueId: event.venueId,
      venueName: event.venue.name,
      organizationId: event.organizationId,
    };
  }

  private async ticketStatusMap(eventId: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: { eventId, seatId: { not: null } },
      select: { status: true, seatId: true },
    });
    const map = new Map<string, string>();
    for (const t of tickets) {
      if (!t.seatId) continue;
      map.set(t.seatId, String(t.status).toLowerCase());
    }
    return map;
  }

  private mapToSections3D(
    map: SeatMapData,
    ticketMap?: Map<string, string>,
    sightlineBySeat?: Map<string, { score: number; grade: string }>,
  ): Section3D[] {
    const scene = resolveGeometry(map);
    const projected = projectTo3D(scene);
    const poseById = new Map(projected.seats.map((s) => [s.id, s]));

    return map.sections.map((sec, i) => {
      const seats: SeatPosition[] = sec.seats.map((s, idx) => {
        const numMatch = s.label.match(/(\d+)\s*$/);
        const pose = poseById.get(s.id);
        const sight = sightlineBySeat?.get(s.id);
        const statusRaw = ticketMap?.get(s.id) ?? 'available';
        const status = s.visibility?.blocked ? 'blocked' : asSeatStatus(statusRaw);
        return {
          id: s.id,
          label: s.label,
          section: sec.name,
          row: s.row ?? 'A',
          seatNumber: numMatch ? parseInt(numMatch[1], 10) : idx + 1,
          x: pose?.px ?? s.x,
          y: pose?.py ?? s.elevation ?? 0,
          z: pose?.pz ?? s.y,
          tier: asSeatTier(s.tier),
          visible: !s.visibility?.blocked,
          accessible: false,
          price: 0,
          status,
          viewQuality: sight?.score,
          sightlineGrade: sight?.grade,
        };
      });
      return {
        id: sec.id,
        name: sec.name,
        color: sec.color || '#4ecdc4',
        seats,
        capacity: seats.length,
        soldCount: seats.filter((s) => s.status === 'sold').length,
        price: this.calculateSectionPrice(i),
        geometry: {
          shape: 'rectangular' as const,
          width: 50,
          depth: 30,
          rotation: 0,
        },
      };
    });
  }

  async generateVenue3D(venueId: string, organizationId?: string) {
    const ctx = this.tenant.current();
    const orgId =
      organizationId && organizationId.length > 0
        ? organizationId
        : ctx.privileged
          ? undefined
          : this.tenant.requireOrganization();

    if (orgId) this.tenant.assertOrganization(orgId);

    const venue = orgId
      ? await this.prisma.venue.findFirst({
          where: { id: venueId, organizationId: orgId },
          select: { id: true, name: true, organizationId: true },
        })
      : await this.prisma.venue.findUnique({
          where: { id: venueId },
          select: { id: true, name: true, organizationId: true },
        });
    if (!venue) throw new NotFoundException('Venue not found');
    this.tenant.assertOrganization(venue.organizationId);

    const map = await this.loadVenueMap(venueId, venue.organizationId);
    if (!map || !map.sections.some((s) => s.seats.length)) {
      throw new BadRequestException(
        'Venue has no authored seat map. Open the map editor and apply a template first.',
      );
    }

    const scene = resolveGeometry(map);
    const sight = calculateSightlines(scene);
    const sightlineBySeat = new Map(sight.scores.map((s) => [s.seatId, s]));
    const sections = this.mapToSections3D(map, undefined, sightlineBySeat);

    return {
      venueId,
      venueName: venue.name,
      capacity: sections.reduce((n, s) => n + s.capacity, 0),
      type: 'layout',
      source: 'VenueGeometryEngine',
      sections,
      sightlines: sight.summary,
      metadata: {
        center: { x: 0, y: 0, z: 0 },
        scale: 1.0,
        lighting: 'professional',
        perspective: '3d',
        engine: 'v3',
      },
    };
  }

  private calculateSectionPrice(sectionIndex: number): number {
    if (sectionIndex === 0 || sectionIndex === 4) return 150;
    if (sectionIndex % 2 === 1) return 120;
    return 80;
  }

  async getInteractiveSeatView(eventId: string, selectedSeatId?: string) {
    const { map, venueName } = await this.loadEventMap(eventId);
    const ticketMap = await this.ticketStatusMap(eventId);

    const statusBySeat: Record<string, string> = {};
    const venue = map.sections.map((sec, i) => {
      const seats: SeatPosition[] = sec.seats.map((s, idx) => {
        const numMatch = s.label.match(/(\d+)\s*$/);
        const statusRaw = ticketMap.get(s.id) ?? 'available';
        const status: SeatPosition['status'] = s.visibility?.blocked
          ? 'blocked'
          : asSeatStatus(statusRaw);
        statusBySeat[s.id] = status;
        return {
          id: s.id,
          label: s.label,
          section: sec.name,
          row: s.row ?? 'A',
          seatNumber: numMatch ? parseInt(numMatch[1], 10) : idx + 1,
          x: s.x,
          y: s.elevation ?? 0,
          z: s.y,
          tier: asSeatTier(s.tier),
          visible: !s.visibility?.blocked,
          accessible: false,
          price: 0,
          status,
        };
      });
      return {
        id: sec.id,
        name: sec.name,
        color: sec.color || '#4ecdc4',
        seats,
        capacity: seats.length,
        soldCount: seats.filter((s) => s.status === 'sold').length,
        price: this.calculateSectionPrice(i),
        geometry: {
          shape: 'rectangular' as const,
          width: 50,
          depth: 30,
          rotation: 0,
        },
      };
    });

    const selectedSeat = selectedSeatId
      ? (venue.flatMap((s) => s.seats).find((s) => s.id === selectedSeatId) ?? null)
      : null;

    this.logger.log(
      `Interactive status for ${venueName}: ${Object.keys(statusBySeat).length} seats (inventory)`,
    );

    return {
      venue,
      statusBySeat,
      selectedSeat,
      camera: {
        position: { x: 0, y: -50, z: 200 },
        target: { x: 0, y: 0, z: 0 },
        fov: 60,
      },
      controls: {
        zoom: true,
        rotate: true,
        pan: true,
        keyboard: true,
      },
      source: 'inventory',
      geometrySource: 'client-VenueGeometryEngine',
    };
  }

  async recommendSeats(
    eventId: string,
    preferences: {
      tier?: 'premium' | 'standard' | 'economy';
      count: number;
      accessible?: boolean;
      viewQuality?: 'best' | 'good' | 'any';
    },
  ) {
    const { map } = await this.loadEventMap(eventId, { requireStaff: true });
    const ticketMap = await this.ticketStatusMap(eventId);
    const scene = resolveGeometry(map);
    const sight = calculateSightlines(scene);
    const scoreById = new Map(sight.scores.map((s) => [s.seatId, s]));

    const available = scene.seats.filter((s) => {
      const st = ticketMap.get(s.id) ?? 'available';
      if (st !== 'available') return false;
      if (s.visibility?.blocked) return false;
      if (preferences.tier && s.tier && s.tier !== preferences.tier) return false;
      if (preferences.accessible && s.metadata?.accessible !== true) return false;
      const grade = scoreById.get(s.id)?.grade;
      if (preferences.viewQuality === 'best' && grade !== 'premium' && grade !== 'good') {
        return false;
      }
      if (
        preferences.viewQuality === 'good' &&
        (grade === 'restricted' || grade === 'blocked')
      ) {
        return false;
      }
      return true;
    });

    const scored = available
      .map((seat) => ({
        seat,
        score: scoreById.get(seat.id)?.score ?? 0,
        grade: scoreById.get(seat.id)?.grade ?? 'fair',
      }))
      .sort((a, b) => b.score - a.score);

    const recommended = scored.slice(0, preferences.count).map(({ seat, score, grade }) => ({
      id: seat.id,
      label: seat.label,
      section: seat.sectionName,
      row: seat.row,
      x: seat.x,
      y: seat.elevation,
      z: seat.y,
      tier: seat.tier,
      viewQuality: grade,
      sightlineScore: score,
      status: 'available' as const,
    }));

    this.logger.log(`Recommended ${recommended.length} seats for event ${eventId} via sightlines`);

    return {
      recommended,
      totalAvailable: available.length,
      viewQuality: preferences.viewQuality ?? 'any',
      confidence: Math.min(recommended.length / Math.max(preferences.count, 1), 1.0),
      sightlines: sight.summary,
      source: 'VenueGeometryEngine',
    };
  }

  async getOccupancyHeatmap(eventId: string) {
    await this.requireEventForMap(eventId);

    const grouped = await this.prisma.ticket.groupBy({
      by: ['status'],
      where: { eventId },
      _count: { _all: true },
    });

    const countOf = (status: TicketStatus) =>
      grouped.find((g) => g.status === status)?._count._all ?? 0;

    const occupancy = {
      total: grouped.reduce((n, g) => n + g._count._all, 0),
      sold: countOf(TicketStatus.SOLD),
      held: countOf(TicketStatus.HELD),
      available: countOf(TicketStatus.AVAILABLE),
      refunded: countOf(TicketStatus.REFUNDED),
    };

    const occupancyPercent =
      occupancy.total > 0 ? Math.round((occupancy.sold / occupancy.total) * 100) : 0;

    return {
      eventId,
      occupancy,
      occupancyPercent,
      recommendation: this.getOccupancyRecommendation(occupancyPercent),
      source: 'inventory',
    };
  }

  private getOccupancyRecommendation(percent: number): string {
    if (percent < 20) return 'Lots of inventory available';
    if (percent < 50) return 'Good availability';
    if (percent < 80) return 'Limited seats remaining';
    return 'Almost sold out';
  }
}
