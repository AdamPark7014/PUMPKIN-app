import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, SalesChannel } from '@prisma/client';
import type { SeatMapData } from '@boletera/shared';
import {
  calculateSightlines,
  normalizeSeatMap,
  resolveGeometry,
} from '@boletera/venue-engine';
import { PrismaService } from '../prisma/prisma.service';
import { VenueLayoutService } from '../venue-layout/venue-layout.service';
import { InventoryService } from '../inventory/inventory.service';

@Injectable()
export class LayoutManagementService {
  private logger = new Logger(LayoutManagementService.name);

  constructor(
    private prisma: PrismaService,
    private venueLayout: VenueLayoutService,
    private inventory: InventoryService,
  ) {}

  async createVenueLayout(
    venueId: string,
    data: {
      name: string;
      totalCapacity: number;
      sections: Array<{
        sectionId: string;
        name: string;
        capacity: number;
        type?: string;
        rows?: number;
        seatsPerRow?: number;
      }>;
    },
    organizationId: string,
  ) {
    const mapData: SeatMapData = {
      viewport: { width: 800, height: 500 },
      sections: data.sections.map((sec, si) => {
        const seatsPerRow = sec.seatsPerRow ?? 10;
        const rows = sec.rows ?? Math.ceil(sec.capacity / seatsPerRow);
        const seats = [];
        let count = 0;
        for (let r = 0; r < rows && count < sec.capacity; r++) {
          for (let s = 1; s <= seatsPerRow && count < sec.capacity; s++) {
            const label = `${String.fromCharCode(65 + r)}-${s}`;
            seats.push({
              id: `seat-${sec.sectionId}-${r}-${s}`,
              label,
              row: String.fromCharCode(65 + r),
              x: 40 + s * 34,
              y: 80 + r * 32 + si * 120,
              tier: sec.type === 'vip' ? 'premium' : sec.type === 'accessible' ? 'standard' : 'standard',
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

    return this.venueLayout.saveMap(venueId, organizationId, mapData);
  }

  async calculateSightlineScores(layoutId: string) {
    const layout = await this.prisma.venueLayout.findUnique({
      where: { id: layoutId },
      include: { sections: { include: { seats: true } } },
    });
    if (!layout) throw new BadRequestException('Layout not found');

    const map = normalizeSeatMap(layout.mapData);
    const scene = resolveGeometry(map);
    const result = calculateSightlines(scene);
    const byId = new Map(result.scores.map((s) => [s.seatId, s]));

    let updated = 0;
    for (const sec of layout.sections) {
      for (const seat of sec.seats) {
        const hit = byId.get(seat.id);
        if (!hit) continue;
        const prev = (seat.coord3d as Record<string, unknown> | null) ?? {};
        await this.prisma.seat.update({
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

    // Keep mapData.venue + seat visibility in sync for editor/publish
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
    await this.prisma.venueLayout.update({
      where: { id: layoutId },
      data: {
        mapData: { ...map, version: 3, sections: nextSections } as object,
      },
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
    _layoutId: string,
    eventId: string,
    seatIds: string[],
    _durationMinutes = 15,
    sessionId?: string,
  ) {
    return this.inventory.createHold({
      eventId,
      seatIds,
      sessionId: sessionId ?? `layout-${Date.now()}`,
      channel: SalesChannel.WEB,
    });
  }

  async releaseSeats(seatIds: string[]) {
    for (const seatId of seatIds) {
      const hold = await this.prisma.seatHold.findFirst({
        where: { seatId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      });
      if (hold) await this.inventory.releaseHold(hold.id);
    }
    return { seatsReleased: seatIds.length };
  }
}


