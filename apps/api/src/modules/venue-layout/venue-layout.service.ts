import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventStatus, TicketStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { SeatMapData, SeatMapSection } from '@boletera/shared';
import { generateTicketCode } from '@boletera/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelManagementService } from '../channel-management/channel-management.service';

@Injectable()
export class VenueLayoutService {
  private logger = new Logger(VenueLayoutService.name);

  constructor(
    private prisma: PrismaService,
    private channels: ChannelManagementService,
  ) {}

  async getActiveLayout(venueId: string, organizationId: string) {
    const venue = await this.prisma.venue.findFirst({
      where: { id: venueId, organizationId },
      include: {
        layouts: {
          where: { isActive: true },
          orderBy: { updatedAt: 'desc' },
          take: 1,
          include: { sections: { include: { seats: true }, orderBy: { sortOrder: 'asc' } } },
        },
      },
    });
    if (!venue) throw new NotFoundException('Venue not found');

    let layout = venue.layouts[0];
    if (!layout) {
      layout = await this.prisma.venueLayout.create({
        data: {
          venueId,
          name: 'Layout principal',
          mapData: { sections: [], viewport: { width: 800, height: 500 } },
        },
        include: { sections: { include: { seats: true } } },
      });
    }

    const mapData = this.layoutToMapData(layout);
    return { venue: { id: venue.id, name: venue.name, slug: venue.slug }, layout: { ...layout, mapData } };
  }

  private layoutToMapData(layout: {
    sections: Array<{
      id: string;
      name: string;
      slug: string;
      color: string;
      seats: Array<{
        id: string;
        label: string;
        x: number;
        y: number;
        tier: string | null;
        coord3d: unknown;
        row?: { label: string } | null;
      }>;
    }>;
    mapData: unknown;
  }): SeatMapData {
    if (layout.sections.length > 0) {
      return {
        sections: layout.sections.map((sec) => ({
          id: sec.id,
          name: sec.name,
          slug: sec.slug,
          color: sec.color,
          seats: sec.seats.map((s) => ({
            id: s.id,
            label: s.label,
            x: s.x,
            y: s.y,
            tier: s.tier ?? 'standard',
            row: sec.seats[0]?.row?.label,
            coord3d: s.coord3d as SeatMapData['sections'][0]['seats'][0]['coord3d'],
          })),
        })),
        viewport: (layout.mapData as SeatMapData)?.viewport ?? { width: 800, height: 500 },
      };
    }
    return (layout.mapData as SeatMapData) ?? { sections: [], viewport: { width: 800, height: 500 } };
  }

  async saveMap(venueId: string, organizationId: string, mapData: SeatMapData) {
    const { layout } = await this.getActiveLayout(venueId, organizationId);

    await this.prisma.$transaction(async (tx) => {
      await tx.seat.deleteMany({ where: { section: { layoutId: layout.id } } });
      await tx.seatRow.deleteMany({ where: { section: { layoutId: layout.id } } });
      await tx.section.deleteMany({ where: { layoutId: layout.id } });

      for (let i = 0; i < mapData.sections.length; i++) {
        const sec = mapData.sections[i];
        const section = await tx.section.create({
          data: {
            layoutId: layout.id,
            name: sec.name,
            slug: sec.slug || `section-${i}`,
            color: sec.color || '#737373',
            sortOrder: i,
          },
        });

        const row = await tx.seatRow.create({
          data: { sectionId: section.id, label: sec.seats[0]?.row || 'A', sortOrder: 0 },
        });

        for (const seat of sec.seats) {
          await tx.seat.create({
            data: {
              sectionId: section.id,
              rowId: row.id,
              label: seat.label,
              x: seat.x,
              y: seat.y,
              tier: seat.tier ?? 'standard',
              coord3d: seat.coord3d ?? undefined,
            },
          });
        }
      }

      await tx.venueLayout.update({
        where: { id: layout.id },
        data: { mapData: mapData as object, version: { increment: 1 } },
      });
    });

    this.logger.log(`Map saved for venue ${venueId}`);
    return this.getActiveLayout(venueId, organizationId);
  }

  async importAiSections(venueId: string, organizationId: string, sections: SeatMapSection[]) {
    const current = await this.getActiveLayout(venueId, organizationId);
    const mapData: SeatMapData = {
      ...(current.layout.mapData as SeatMapData),
      sections: sections.map((s, i) => ({
        ...s,
        id: s.id || `sec-${i}`,
        slug: s.slug || `section-${i}`,
        color: s.color || '#404040',
      })),
    };
    return this.saveMap(venueId, organizationId, mapData);
  }

  async publishToEvent(eventId: string, organizationId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId },
      include: {
        venue: {
          include: {
            layouts: {
              where: { isActive: true },
              include: { sections: { include: { seats: { include: { row: true } } } } },
            },
          },
        },
        seatMap: true,
        offers: true,
      },
    });
    if (!event) throw new NotFoundException('Event not found');

    const layout = event.venue.layouts[0];
    if (!layout?.sections.length) {
      throw new BadRequestException('El venue no tiene mapa con asientos. Guarda el layout primero.');
    }

    const snapshotData = this.layoutToMapData(layout);
    const totalSeats = snapshotData.sections.reduce((n, s) => n + s.seats.length, 0);
    if (totalSeats === 0) throw new BadRequestException('No hay asientos en el mapa');

    const tierPrices: Record<string, number> = {
      premium: Number(event.maxPrice) || Number(event.minPrice) * 1.5,
      standard: Number(event.minPrice) || 100,
      economy: Number(event.minPrice) * 0.7 || 50,
    };

    const result = await this.prisma.$transaction(async (tx) => {
      if (event.seatMap) {
        await tx.eventSeatMap.update({
          where: { id: event.seatMap.id },
          data: { snapshotData: snapshotData as object, layoutId: layout.id, publishedAt: new Date() },
        });
      } else {
        await tx.eventSeatMap.create({
          data: { eventId, layoutId: layout.id, snapshotData: snapshotData as object },
        });
      }

      await tx.ticket.deleteMany({
        where: { eventId, status: { in: [TicketStatus.AVAILABLE, TicketStatus.HELD] } },
      });

      const offersBySection: Record<string, string> = {};

      for (const section of layout.sections) {
        const slug = section.slug;
        const tier = section.seats[0]?.tier ?? 'standard';
        const price = tierPrices[tier] ?? tierPrices.standard;
        const qty = section.seats.length;

        const offer = await tx.offer.upsert({
          where: { eventId_zone: { eventId, zone: slug } },
          create: {
            eventId,
            name: section.name,
            zone: slug,
            basePrice: new Decimal(price),
            totalQuantity: qty,
            remainingQuantity: qty,
            soldQuantity: 0,
            holdQuantity: 0,
            startDate: new Date(),
            endDate: event.startsAt,
            isAvailable: true,
          },
          update: {
            totalQuantity: qty,
            remainingQuantity: qty,
            isAvailable: true,
          },
        });
        offersBySection[section.id] = offer.id;

        for (const seat of section.seats) {
          await tx.ticket.create({
            data: {
              code: generateTicketCode(),
              eventId,
              offerId: offer.id,
              status: TicketStatus.AVAILABLE,
              seatId: seat.id,
              seatNumber: seat.label.includes('-') ? seat.label.split('-').pop() : seat.label,
              row: seat.row?.label ?? (seat.label.includes('-') ? seat.label.split('-')[0] : 'GA'),
              section: section.name,
            },
          });
        }
      }

      const updatedEvent = await tx.event.update({
        where: { id: eventId },
        data: {
          status: EventStatus.SCHEDULED,
          publishedAt: new Date(),
          totalCapacity: totalSeats,
          metadata: {
            ...((event.metadata as object) ?? {}),
            publishedWithLayout: layout.id,
            publishedAt: new Date().toISOString(),
          },
        },
      });

      return { event: updatedEvent, totalSeats, sections: layout.sections.length };
    });

    const meta = (event.metadata as Record<string, unknown>) ?? {};
    const channelAlloc = meta.channelAllocation ?? meta.channels;
    if (channelAlloc) {
      try {
        await this.channels.allocateInventoryToChannels(eventId, result.totalSeats);
      } catch (e) {
        this.logger.warn(`Channel inventory allocation skipped: ${(e as Error).message}`);
      }
    }

    this.logger.log(`Published event ${eventId}: ${result.totalSeats} tickets`);
    return result;
  }
}


