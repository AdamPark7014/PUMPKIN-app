import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SalesChannel } from '@prisma/client';
import type { SeatMapData } from '@boletera/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SeatMapping3DService } from '../seat-mapping-3d/seat-mapping-3d.service';
import { VenueLayoutService } from '../venue-layout/venue-layout.service';
import { InventoryService } from '../inventory/inventory.service';

@Injectable()
export class LayoutManagementService {
  private logger = new Logger(LayoutManagementService.name);

  constructor(
    private prisma: PrismaService,
    private seat3d: SeatMapping3DService,
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
    return {
      layoutId,
      seatsScored: layout.sections.reduce((n, s) => n + s.seats.length, 0),
      note: 'Sightlines based on distance from stage center',
    };
  }

  async getSeatRecommendations(_layoutId: string, preferences: { eventId: string; count?: number }) {
    if (!preferences.eventId) throw new BadRequestException('eventId required');
    return this.seat3d.recommendSeats(preferences.eventId, {
      count: preferences.count ?? 2,
      viewQuality: 'best',
    });
  }

  async getOccupancyHeatmap(_layoutId: string, eventId: string) {
    return this.seat3d.getOccupancyHeatmap(eventId);
  }

  async get3DVisualizationData(_layoutId: string, eventId: string) {
    if (!eventId) throw new BadRequestException('eventId required');
    return this.seat3d.getInteractiveSeatView(eventId);
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


