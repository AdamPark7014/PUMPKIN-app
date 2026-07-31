import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus, Prisma, TicketStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { generateTicketCode } from '@boletera/crypto';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { ChannelManagementService } from '../channel-management/channel-management.service';
import { PrismaService } from '../prisma/prisma.service';
import { LayoutAccessService } from './layout-access.service';
import { layoutToMapData } from './map-data.mapper';

@Injectable()
export class EventPublishService {
  private readonly logger = new Logger(EventPublishService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: LayoutAccessService,
    private readonly channels: ChannelManagementService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async publishToEvent(eventId: string, organizationId?: string) {
    const orgId = this.access.resolveOrganizationId(organizationId);
    const event = orgId
      ? await this.prisma.event.findFirst({
          where: { id: eventId, organizationId: orgId },
          include: {
            venue: {
              include: {
                layouts: {
                  where: { isActive: true },
                  orderBy: { updatedAt: 'desc' },
                  take: 1,
                  include: {
                    sections: {
                      orderBy: { sortOrder: 'asc' },
                      include: { seats: { include: { row: true } } },
                    },
                  },
                },
              },
            },
            seatMap: true,
            offers: true,
          },
        })
      : await this.prisma.event.findUnique({
          where: { id: eventId },
          include: {
            venue: {
              include: {
                layouts: {
                  where: { isActive: true },
                  orderBy: { updatedAt: 'desc' },
                  take: 1,
                  include: {
                    sections: {
                      orderBy: { sortOrder: 'asc' },
                      include: { seats: { include: { row: true } } },
                    },
                  },
                },
              },
            },
            seatMap: true,
            offers: true,
          },
        });
    if (!event) throw new NotFoundException('Event not found');
    this.tenant.assertOrganization(event.organizationId);

    const layout = event.venue.layouts[0];
    if (!layout?.sections.length) {
      throw new BadRequestException(
        'El venue no tiene mapa con asientos. Guarda el layout primero.',
      );
    }

    const snapshotData = layoutToMapData(layout);
    const totalSeats = snapshotData.sections.reduce((n, s) => n + s.seats.length, 0);
    if (totalSeats === 0) throw new BadRequestException('No hay asientos en el mapa');

    const soldOrIssued = await this.prisma.ticket.count({
      where: {
        eventId,
        status: {
          in: [
            TicketStatus.SOLD,
            TicketStatus.USED,
            TicketStatus.TRANSFERRED,
            TicketStatus.RESOLD,
          ],
        },
      },
    });
    if (soldOrIssued > 0) {
      throw new BadRequestException(
        'Cannot republish layout while sold/used tickets exist for this event',
      );
    }

    const tierPrices: Record<string, number> = {
      premium: Number(event.maxPrice) || Number(event.minPrice) * 1.5,
      standard: Number(event.minPrice) || 100,
      economy: Number(event.minPrice) * 0.7 || 50,
    };

    const ctx = this.tenant.current();
    const result = await this.prisma.$transaction(async (tx) => {
      if (event.seatMap) {
        await tx.eventSeatMap.update({
          where: { id: event.seatMap.id },
          data: {
            snapshotData: snapshotData as unknown as Prisma.InputJsonValue,
            layoutId: layout.id,
            publishedAt: new Date(),
          },
        });
      } else {
        await tx.eventSeatMap.create({
          data: {
            eventId,
            layoutId: layout.id,
            snapshotData: snapshotData as unknown as Prisma.InputJsonValue,
          },
        });
      }

      await tx.ticket.deleteMany({
        where: {
          eventId,
          status: { in: [TicketStatus.AVAILABLE, TicketStatus.HELD] },
        },
      });

      const offersBySection: Record<string, string> = {};
      const keepZones: string[] = [];
      const ticketRows: Prisma.TicketCreateManyInput[] = [];

      for (const section of layout.sections) {
        const slug = section.slug;
        keepZones.push(slug);
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
            name: section.name,
            basePrice: new Decimal(price),
            totalQuantity: qty,
            remainingQuantity: qty,
            soldQuantity: 0,
            holdQuantity: 0,
            isAvailable: true,
          },
        });
        offersBySection[section.id] = offer.id;

        for (const seat of section.seats) {
          ticketRows.push({
            code: generateTicketCode(),
            eventId,
            offerId: offer.id,
            status: TicketStatus.AVAILABLE,
            seatId: seat.id,
            seatNumber: seat.label.includes('-')
              ? seat.label.split('-').pop()
              : seat.label,
            row: seat.row?.label ?? (seat.label.includes('-') ? seat.label.split('-')[0] : 'GA'),
            section: section.name,
          });
        }
      }

      // Batch ticket inserts for large maps.
      const CHUNK = 500;
      for (let i = 0; i < ticketRows.length; i += CHUNK) {
        await tx.ticket.createMany({ data: ticketRows.slice(i, i + CHUNK) });
      }

      await tx.offer.updateMany({
        where: {
          eventId,
          zone: { notIn: keepZones },
          isAvailable: true,
        },
        data: { isAvailable: false },
      });

      const prevMeta =
        event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
          ? (event.metadata as Record<string, unknown>)
          : {};

      const updatedEvent = await tx.event.update({
        where: { id: eventId },
        data: {
          status: EventStatus.SCHEDULED,
          publishedAt: new Date(),
          totalCapacity: totalSeats,
          metadata: {
            ...prevMeta,
            publishedWithLayout: layout.id,
            publishedAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      });

      return {
        event: updatedEvent,
        totalSeats,
        sections: layout.sections.length,
        offersBySection,
      };
    });

    const meta =
      event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
        ? (event.metadata as Record<string, unknown>)
        : {};
    const channelAlloc = meta.channelAllocation ?? meta.channels;
    if (channelAlloc) {
      try {
        await this.channels.allocateInventoryToChannels(eventId, result.totalSeats);
      } catch (e) {
        this.logger.warn(`Channel inventory allocation skipped: ${(e as Error).message}`);
      }
    }

    await this.audit.log({
      action: 'event.publish_layout',
      entityType: 'Event',
      entityId: eventId,
      organizationId: event.organizationId,
      userId: ctx.userId,
      metadata: {
        layoutId: layout.id,
        totalSeats: result.totalSeats,
        sections: result.sections,
      },
    });

    this.logger.log(`Published event ${eventId}: ${result.totalSeats} tickets`);
    return {
      event: result.event,
      totalSeats: result.totalSeats,
      sections: result.sections,
    };
  }
}
