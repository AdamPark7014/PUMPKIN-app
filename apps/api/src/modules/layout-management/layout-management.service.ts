import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma, SalesChannel } from '@prisma/client';
import type { SeatMapData } from '@boletera/shared';
import {
  calculateSightlines,
  normalizeSeatMap,
  resolveGeometry,
} from '@boletera/venue-engine';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { LayoutAccessService } from '../venue-layout/layout-access.service';
import { VenueLayoutService } from '../venue-layout/venue-layout.service';
import type { CreateVenueLayoutDto } from './layout-management.dto';

@Injectable()
export class LayoutManagementService {
  private readonly logger = new Logger(LayoutManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly venueLayout: VenueLayoutService,
    private readonly inventory: InventoryService,
    private readonly access: LayoutAccessService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async createVenueLayout(
    venueId: string,
    data: CreateVenueLayoutDto,
    organizationId?: string,
  ) {
    await this.access.requireVenue(venueId, organizationId);

    const mapData: SeatMapData = {
      version: 3,
      viewport: { width: 800, height: 500 },
      sections: data.sections.map((sec, si) => {
        const seatsPerRow = sec.seatsPerRow ?? 10;
        const rows = sec.rows ?? Math.ceil(sec.capacity / seatsPerRow);
        const seats: SeatMapData['sections'][0]['seats'] = [];
        let count = 0;
        for (let r = 0; r < rows && count < sec.capacity; r++) {
          for (let s = 1; s <= seatsPerRow && count < sec.capacity; s++) {
            const label = `${String.fromCharCode(65 + (r % 26))}-${s}`;
            seats.push({
              id: `seat-${sec.sectionId}-${r}-${s}`,
              label,
              row: String.fromCharCode(65 + (r % 26)),
              x: 40 + s * 34,
              y: 80 + r * 32 + si * 120,
              tier: sec.type === 'vip' || sec.type === 'premium' ? 'premium' : 'standard',
            });
            count++;
          }
        }
        return {
          id: sec.sectionId,
          name: sec.name,
          slug: sec.sectionId,
          color: '#737373',
          seats,
        };
      }),
    };

    const result = await this.venueLayout.saveMap(
      venueId,
      organizationId ?? '',
      mapData,
    );

    const ctx = this.tenant.current();
    await this.audit.log({
      action: 'layout.create',
      entityType: 'VenueLayout',
      entityId: result.layout.id,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      metadata: {
        venueId,
        name: data.name,
        totalCapacity: data.totalCapacity,
        sections: data.sections.length,
      },
    });

    return result;
  }

  async calculateSightlineScores(layoutId: string, organizationId?: string) {
    const layout = await this.access.requireLayoutForOrg(layoutId, organizationId);
    const map = normalizeSeatMap(layout.mapData);
    const scene = resolveGeometry(map);
    const result = calculateSightlines(scene);
    const byId = new Map(result.scores.map((s) => [s.seatId, s]));

    let updated = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const sec of layout.sections) {
        for (const seat of sec.seats) {
          const hit = byId.get(seat.id);
          if (!hit) continue;
          const prev =
            seat.coord3d && typeof seat.coord3d === 'object' && !Array.isArray(seat.coord3d)
              ? (seat.coord3d as Record<string, unknown>)
              : {};
          await tx.seat.update({
            where: { id: seat.id },
            data: {
              viewQuality: hit.score,
              coord3d: {
                ...prev,
                x: typeof prev.x === 'number' ? prev.x : seat.x,
                y: typeof prev.y === 'number' ? prev.y : 0,
                z: typeof prev.z === 'number' ? prev.z : seat.y,
                visibility: hit.visibility,
                sightline: {
                  score: hit.score,
                  grade: hit.grade,
                  occluded: hit.occluded,
                },
              } as unknown as Prisma.InputJsonValue,
            },
          });
          updated += 1;
        }
      }

      const nextSections = map.sections.map((sec) => ({
        ...sec,
        seats: sec.seats.map((seat) => {
          const hit = byId.get(seat.id);
          if (!hit || seat.visibility?.blocked) return seat;
          return {
            ...seat,
            visibility: hit.visibility,
            metadata: {
              ...(seat.metadata ?? {}),
              sightline: { score: hit.score, grade: hit.grade, occluded: hit.occluded },
            },
          };
        }),
      }));

      await tx.venueLayout.update({
        where: { id: layoutId },
        data: {
          mapData: {
            ...map,
            version: 3,
            sections: nextSections,
          } as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
    });

    const ctx = this.tenant.current();
    await this.audit.log({
      action: 'layout.sightlines',
      entityType: 'VenueLayout',
      entityId: layoutId,
      organizationId: layout.venue.organizationId,
      userId: ctx.userId,
      metadata: { seatsScored: updated },
    });

    this.logger.log(`Sightlines scored for layout ${layoutId}: ${updated} seats`);
    return {
      layoutId,
      seatsScored: updated,
      summary: result.summary,
      stageTarget: result.stageTarget,
      source: 'VenueGeometryEngine',
      note: 'Sightlines from distance, facing, elevation, and obstacle occlusion',
    };
  }

  async holdSeats(
    layoutId: string,
    eventId: string,
    seatIds: string[],
    _durationMinutes = 15,
    sessionId?: string,
    organizationId?: string,
  ) {
    if (!seatIds.length) throw new BadRequestException('seatIds required');

    const layout = await this.access.requireLayoutForOrg(layoutId, organizationId);
    const event = await this.access.requireEvent(eventId, organizationId);

    if (event.venueId !== layout.venueId) {
      throw new BadRequestException('Event venue does not match layout venue');
    }

    const layoutSeatIds = new Set(layout.sections.flatMap((s) => s.seats.map((seat) => seat.id)));
    const foreign = seatIds.filter((id) => !layoutSeatIds.has(id));
    if (foreign.length) {
      throw new BadRequestException(`Seats not in layout: ${foreign.slice(0, 5).join(', ')}`);
    }

    const hold = await this.inventory.createHold({
      eventId,
      seatIds,
      sessionId: sessionId ?? `layout-${Date.now()}`,
      channel: SalesChannel.WEB,
    });

    const ctx = this.tenant.current();
    await this.audit.log({
      action: 'layout.seats_hold',
      entityType: 'VenueLayout',
      entityId: layoutId,
      organizationId: event.organizationId,
      userId: ctx.userId,
      metadata: { eventId, seatCount: seatIds.length },
    });

    return hold;
  }

  async releaseSeats(
    layoutId: string,
    seatIds: string[],
    organizationId?: string,
  ) {
    if (!seatIds.length) throw new BadRequestException('seatIds required');

    const layout = await this.access.requireLayoutForOrg(layoutId, organizationId);
    const layoutSeatIds = new Set(layout.sections.flatMap((s) => s.seats.map((seat) => seat.id)));
    const foreign = seatIds.filter((id) => !layoutSeatIds.has(id));
    if (foreign.length) {
      throw new BadRequestException(`Seats not in layout: ${foreign.slice(0, 5).join(', ')}`);
    }

    let released = 0;
    for (const seatId of seatIds) {
      const hold = await this.prisma.seatHold.findFirst({
        where: {
          seatId,
          status: 'ACTIVE',
          event: { organizationId: layout.venue.organizationId },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!hold) continue;
      await this.inventory.releaseHold(hold.id);
      released += 1;
    }

    const ctx = this.tenant.current();
    await this.audit.log({
      action: 'layout.seats_release',
      entityType: 'VenueLayout',
      entityId: layoutId,
      organizationId: layout.venue.organizationId,
      userId: ctx.userId,
      metadata: { requested: seatIds.length, released },
    });

    return { seatsReleased: released };
  }
}
