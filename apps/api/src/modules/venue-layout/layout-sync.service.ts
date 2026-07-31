import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SeatMapData } from '@boletera/shared';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { LayoutAccessService } from './layout-access.service';
import {
  layoutToMapData,
  seatCoord3d,
  viewQualityFromVisibility,
} from './map-data.mapper';

@Injectable()
export class LayoutSyncService {
  private readonly logger = new Logger(LayoutSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: LayoutAccessService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async getActiveLayout(venueId: string, organizationId?: string) {
    const { venue, layout: existing } = await this.access.findActiveLayout(
      venueId,
      organizationId,
    );

    let layout = existing;
    if (!layout) {
      layout = (await this.prisma.venueLayout.create({
        data: {
          venueId,
          name: 'Layout principal',
          mapData: { sections: [], viewport: { width: 800, height: 500 } },
        },
        include: {
          sections: {
            include: { seats: { include: { row: true } } },
            orderBy: { sortOrder: 'asc' as const },
          },
        },
      })) as NonNullable<typeof existing>;
    }

    const mapData = layoutToMapData(layout);
    return {
      venue: { id: venue.id, name: venue.name, slug: venue.slug },
      layout: { ...layout, mapData },
    };
  }

  async saveMap(
    venueId: string,
    organizationId: string | undefined,
    mapData: SeatMapData,
    opts?: { expectedVersion?: number },
  ) {
    if (!Array.isArray(mapData.sections)) {
      throw new BadRequestException('mapData.sections is required');
    }

    const { layout: active } = await this.getActiveLayout(venueId, organizationId);
    if (opts?.expectedVersion != null && active.version !== opts.expectedVersion) {
      throw new ConflictException(
        `Layout version conflict: expected ${opts.expectedVersion}, current ${active.version}`,
      );
    }

    const seatCount = mapData.sections.reduce((n, s) => n + (s.seats?.length ?? 0), 0);
    const ctx = this.tenant.current();
    const nextVersion = active.version + 1;

    await this.prisma.$transaction(async (tx) => {
      // Single active layout invariant per venue.
      await tx.venueLayout.updateMany({
        where: { venueId, id: { not: active.id }, isActive: true },
        data: { isActive: false },
      });

      // Optimistic lock: only bump if version still matches.
      const locked = await tx.venueLayout.updateMany({
        where: { id: active.id, version: active.version },
        data: { version: nextVersion },
      });
      if (locked.count !== 1) {
        throw new ConflictException('Layout version changed during save');
      }

      const existingSections = await tx.section.findMany({
        where: { layoutId: active.id },
        select: { id: true },
      });
      const keepSectionIds = new Set(mapData.sections.map((s) => s.id).filter(Boolean));
      const orphanSectionIds = existingSections
        .map((s) => s.id)
        .filter((id) => !keepSectionIds.has(id));
      if (orphanSectionIds.length) {
        await tx.seat.deleteMany({ where: { sectionId: { in: orphanSectionIds } } });
        await tx.seatRow.deleteMany({ where: { sectionId: { in: orphanSectionIds } } });
        await tx.section.deleteMany({ where: { id: { in: orphanSectionIds } } });
      }

      for (let i = 0; i < mapData.sections.length; i++) {
        await this.syncSection(tx, active.id, mapData.sections[i], i);
      }

      const refreshed = await tx.venueLayout.findUnique({
        where: { id: active.id },
        include: {
          sections: {
            include: { seats: { include: { row: true } } },
            orderBy: { sortOrder: 'asc' },
          },
        },
      });
      const nextMap = refreshed ? layoutToMapData(refreshed) : mapData;
      if (mapData.venue) nextMap.venue = mapData.venue;
      for (const sec of mapData.sections) {
        const target = nextMap.sections.find(
          (s) => s.id === sec.id || s.slug === sec.slug,
        );
        if (!target) continue;
        if (sec.blocks) target.blocks = sec.blocks;
        if (sec.rake != null) target.rake = sec.rake;
        if (sec.seatPitch != null) target.seatPitch = sec.seatPitch;
        if (sec.rowPitch != null) target.rowPitch = sec.rowPitch;
        if (sec.curvature != null) target.curvature = sec.curvature;
        if (sec.levelId) target.levelId = sec.levelId;
      }
      nextMap.version = 3;

      await tx.venueLayout.update({
        where: { id: active.id },
        data: {
          mapData: nextMap as unknown as Prisma.InputJsonValue,
          metadata: (mapData.venue as unknown as Prisma.InputJsonValue) ?? undefined,
        },
      });

      await tx.eventSeatMap.updateMany({
        where: { layoutId: active.id },
        data: {
          snapshotData: nextMap as unknown as Prisma.InputJsonValue,
          publishedAt: new Date(),
        },
      });

      await tx.venue.update({
        where: { id: venueId },
        data: { totalCapacity: seatCount },
      });
    });

    await this.audit.log({
      action: 'venue_layout.save',
      entityType: 'VenueLayout',
      entityId: active.id,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      metadata: {
        venueId,
        seatCount,
        sectionCount: mapData.sections.length,
        version: nextVersion,
      },
    });

    this.logger.log(`Map saved for venue ${venueId} (synced event snapshots)`);
    return this.getActiveLayout(venueId, organizationId);
  }

  private async syncSection(
    tx: Prisma.TransactionClient,
    layoutId: string,
    sec: SeatMapData['sections'][0],
    index: number,
  ) {
    let section = sec.id
      ? await tx.section.findFirst({ where: { id: sec.id, layoutId } })
      : null;
    if (!section && sec.slug) {
      section = await tx.section.findFirst({
        where: { layoutId, slug: sec.slug },
      });
    }

    const sectionMetadata: Record<string, unknown> = {
      ...(sec.shape ? { shape: sec.shape } : {}),
      ...(sec.blocks ? { blocks: sec.blocks } : {}),
      ...(sec.rake != null ? { rake: sec.rake } : {}),
      ...(sec.seatPitch != null ? { seatPitch: sec.seatPitch } : {}),
      ...(sec.rowPitch != null ? { rowPitch: sec.rowPitch } : {}),
      ...(sec.curvature != null ? { curvature: sec.curvature } : {}),
      ...(sec.levelId ? { levelId: sec.levelId } : {}),
    };
    const sectionMetadataPayload: Prisma.InputJsonValue | typeof Prisma.JsonNull =
      Object.keys(sectionMetadata).length > 0
        ? (sectionMetadata as Prisma.InputJsonValue)
        : Prisma.JsonNull;

    if (section) {
      section = await tx.section.update({
        where: { id: section.id },
        data: {
          name: sec.name,
          slug: sec.slug || `section-${index}`,
          color: sec.color || '#737373',
          sortOrder: index,
          metadata: sectionMetadataPayload,
        },
      });
    } else {
      const createData: {
        id?: string;
        layoutId: string;
        name: string;
        slug: string;
        color: string;
        sortOrder: number;
        metadata: Prisma.InputJsonValue | typeof Prisma.JsonNull;
      } = {
        layoutId,
        name: sec.name,
        slug: sec.slug || `section-${index}`,
        color: sec.color || '#737373',
        sortOrder: index,
        metadata: sectionMetadataPayload,
      };
      if (sec.id && !sec.id.startsWith('tmp-')) {
        const taken = await tx.section.findUnique({ where: { id: sec.id } });
        if (!taken) createData.id = sec.id;
      }
      section = await tx.section.create({ data: createData });
    }

    const rowLabels = Array.from(
      new Set(sec.seats.map((s) => s.row || s.label.split('-')[0] || 'A')),
    );
    const rowByLabel = new Map<string, string>();
    for (let ri = 0; ri < rowLabels.length; ri++) {
      const label = rowLabels[ri];
      const existingRow = await tx.seatRow.findFirst({
        where: { sectionId: section.id, label },
      });
      if (existingRow) {
        rowByLabel.set(label, existingRow.id);
      } else {
        const row = await tx.seatRow.create({
          data: { sectionId: section.id, label, sortOrder: ri },
        });
        rowByLabel.set(label, row.id);
      }
    }

    const keepSeatIds = Array.from(new Set(sec.seats.map((s) => s.id).filter(Boolean)));
    if (keepSeatIds.length) {
      await tx.seat.deleteMany({
        where: { sectionId: section.id, id: { notIn: keepSeatIds } },
      });
    } else {
      await tx.seat.deleteMany({ where: { sectionId: section.id } });
    }

    for (const seat of sec.seats) {
      const rowLabel = seat.row || seat.label.split('-')[0] || 'A';
      const rowId = rowByLabel.get(rowLabel);
      if (!rowId) {
        throw new BadRequestException(`Missing row mapping for seat ${seat.label}`);
      }

      const existing = seat.id
        ? await tx.seat.findFirst({
            where: {
              id: seat.id,
              section: { layoutId },
            },
          })
        : null;

      const seatPayload = {
        sectionId: section.id,
        label: seat.label,
        x: seat.x,
        y: seat.y,
        rotation: seat.rotation ?? seat.rotation3d?.y ?? 0,
        tier: seat.tier ?? 'standard',
        rowId,
        coord3d: seatCoord3d(seat),
        viewQuality: viewQualityFromVisibility(seat.visibility),
      };

      if (existing) {
        await tx.seat.update({
          where: { id: existing.id },
          data: seatPayload,
        });
      } else {
        const createSeat: {
          id?: string;
          sectionId: string;
          label: string;
          x: number;
          y: number;
          rotation: number;
          tier: string;
          rowId: string;
          coord3d?: Prisma.InputJsonValue;
          viewQuality?: number | null;
        } = { ...seatPayload };
        if (seat.id && !seat.id.startsWith('tmp-')) {
          const taken = await tx.seat.findUnique({ where: { id: seat.id } });
          if (taken) {
            throw new BadRequestException(
              `Seat id ${seat.id} belongs to another layout`,
            );
          }
          createSeat.id = seat.id;
        }
        await tx.seat.create({ data: createSeat });
      }
    }
  }
}
