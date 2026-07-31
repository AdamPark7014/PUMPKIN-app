import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { SeatMapData } from '@boletera/shared';
import {
  buildEgressReport,
  egressReportFilename,
  exportEgressOverviewCsv,
  exportEgressReportToCsv,
  summarizeEgressReport,
  type EgressReport,
  type EgressReportSummaryRow,
} from '@boletera/venue-engine';
import { TenantContextService } from '../../common/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildEgressPdfBuffer, egressPdfFilename } from './egress-pdf';
import { LayoutAccessService } from './layout-access.service';
import { LayoutSyncService } from './layout-sync.service';
import { asSeatMapData, layoutToMapData } from './map-data.mapper';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export type EgressFormat = 'json' | 'csv' | 'pdf';

export type EgressOverviewResult = {
  generatedAt: string;
  venues: Array<EgressReportSummaryRow & { venueId: string; layoutId: string | null }>;
  counts: { ok: number; warn: number; critical: number; noNetwork: number; empty: number };
  page: number;
  pageSize: number;
  total: number;
};

@Injectable()
export class EgressReportService {
  private readonly logger = new Logger(EgressReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: LayoutAccessService,
    private readonly sync: LayoutSyncService,
    private readonly tenant: TenantContextService,
  ) {}

  async getEgressReport(
    venueId: string,
    organizationId: string | undefined,
    opts?: { mapData?: SeatMapData; format?: EgressFormat },
  ): Promise<
    | { format: 'json'; report: EgressReport; filename: string }
    | { format: 'csv'; csv: string; filename: string; report: EgressReport }
    | { format: 'pdf'; pdf: Buffer; filename: string; report: EgressReport }
  > {
    const current = await this.sync.getActiveLayout(venueId, organizationId);
    const mapData = opts?.mapData ?? asSeatMapData(current.layout.mapData);
    if (!mapData?.sections?.length) {
      throw new BadRequestException('El venue no tiene mapa con secciones.');
    }
    const venueName = current.venue?.name ?? 'venue';
    const report = buildEgressReport(mapData, { venueName });
    if (opts?.format === 'csv') {
      return {
        format: 'csv',
        csv: exportEgressReportToCsv(report),
        filename: egressReportFilename(venueName),
        report,
      };
    }
    if (opts?.format === 'pdf') {
      const pdf = await buildEgressPdfBuffer(report);
      return {
        format: 'pdf',
        pdf,
        filename: egressPdfFilename(venueName),
        report,
      };
    }
    return { format: 'json', report, filename: egressReportFilename(venueName) };
  }

  async getEgressOverview(
    organizationId: string | undefined,
    opts?: { page?: number; pageSize?: number },
  ): Promise<EgressOverviewResult> {
    const orgId = this.access.resolveOrganizationId(organizationId);
    if (!orgId && !this.tenant.current().privileged) {
      throw new BadRequestException('organizationId is required');
    }

    const page = Math.max(1, opts?.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, opts?.pageSize ?? DEFAULT_PAGE_SIZE),
    );

    // Lean query: use persisted mapData JSON instead of hydrating every seat row.
    const where = orgId ? { organizationId: orgId } : {};
    const [total, venues] = await this.prisma.$transaction([
      this.prisma.venue.count({ where }),
      this.prisma.venue.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          layouts: {
            where: { isActive: true },
            orderBy: { updatedAt: 'desc' },
            take: 1,
            select: { id: true, mapData: true, metadata: true },
          },
        },
      }),
    ]);

    const rows: Array<EgressReportSummaryRow & { venueId: string; layoutId: string | null }> =
      [];

    for (const venue of venues) {
      const layout = venue.layouts[0];
      if (!layout) {
        rows.push(this.emptyRow(venue.id, venue.name, null, 'Sin layout activo'));
        continue;
      }

      let mapData: SeatMapData | null;
      try {
        mapData = layoutToMapData({
          mapData: layout.mapData,
          metadata: layout.metadata,
          sections: [],
        });
        const stored = asSeatMapData(layout.mapData);
        if (stored?.sections?.length) mapData = stored;
      } catch (err) {
        this.logger.warn(
          `Egress overview map parse failed for venue ${venue.id}: ${String(err)}`,
        );
        rows.push(this.emptyRow(venue.id, venue.name, layout.id, 'Error al leer mapa'));
        continue;
      }

      if (!mapData?.sections?.length) {
        rows.push(this.emptyRow(venue.id, venue.name, layout.id, 'Mapa vacío'));
        continue;
      }

      try {
        const report = buildEgressReport(mapData, { venueName: venue.name });
        const summary = summarizeEgressReport(report);
        rows.push({ ...summary, venueId: venue.id, layoutId: layout.id });
      } catch (err) {
        this.logger.warn(`Egress overview failed for venue ${venue.id}: ${String(err)}`);
        rows.push({
          ...this.emptyRow(venue.id, venue.name, layout.id, 'Error al analizar'),
          sections: mapData.sections.length,
        });
      }
    }

    // Page-local counts (efficient); total reflects org size.
    const counts = {
      ok: rows.filter((r) => r.status === 'ok').length,
      warn: rows.filter((r) => r.status === 'warn').length,
      critical: rows.filter((r) => r.status === 'critical').length,
      noNetwork: rows.filter((r) => r.status === 'no-network').length,
      empty: rows.filter((r) => r.status === 'empty').length,
    };

    return {
      generatedAt: new Date().toISOString(),
      venues: rows,
      counts,
      page,
      pageSize,
      total,
    };
  }

  async exportEgressOverviewCsv(
    organizationId: string | undefined,
    opts?: { page?: number; pageSize?: number },
  ): Promise<{ csv: string; filename: string }> {
    const overview = await this.getEgressOverview(organizationId, opts);
    const day = new Date().toISOString().slice(0, 10);
    return {
      csv: exportEgressOverviewCsv(overview.venues),
      filename: `egress-overview-${day}.csv`,
    };
  }

  private emptyRow(
    venueId: string,
    venueName: string,
    layoutId: string | null,
    statusReason: string,
  ): EgressReportSummaryRow & { venueId: string; layoutId: string | null } {
    return {
      venueId,
      layoutId,
      venueName,
      hasNetwork: false,
      sections: 0,
      unreachable: 0,
      seatsWithPath: 0,
      seatsWithoutPath: 0,
      clearanceMinutes: null,
      maxPathLength: null,
      avgPathLength: null,
      topBottleneckUtilization: null,
      topBottleneckKind: null,
      status: 'empty',
      statusReason,
    };
  }
}
