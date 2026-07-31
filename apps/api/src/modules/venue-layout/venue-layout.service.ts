import { Injectable } from '@nestjs/common';
import type { SeatMapData, SeatMapSection } from '@boletera/shared';
import {
  generateLayoutTemplate,
  suggestTemplateFromPrompt,
  type LayoutTemplateId,
} from '@boletera/venue-engine';
import { EgressReportService } from './egress-report.service';
import { EventPublishService } from './event-publish.service';
import { LayoutSyncService } from './layout-sync.service';

/**
 * Public facade — preserves the historical VenueLayoutService contract used by
 * controllers and LayoutManagementService.
 */
@Injectable()
export class VenueLayoutService {
  constructor(
    private readonly sync: LayoutSyncService,
    private readonly egress: EgressReportService,
    private readonly publish: EventPublishService,
  ) {}

  getActiveLayout(venueId: string, organizationId: string) {
    return this.sync.getActiveLayout(venueId, organizationId);
  }

  saveMap(
    venueId: string,
    organizationId: string,
    mapData: SeatMapData,
    opts?: { expectedVersion?: number },
  ) {
    return this.sync.saveMap(venueId, organizationId, mapData, opts);
  }

  async applyTemplate(
    venueId: string,
    organizationId: string,
    template: LayoutTemplateId,
    opts?: { capacity?: number; sectionCount?: number },
  ) {
    const mapData = generateLayoutTemplate(template, {
      capacity: opts?.capacity,
      sectionCount: opts?.sectionCount,
      idPrefix: `${venueId.slice(-6)}-${template}`,
    });
    return this.saveMap(venueId, organizationId, mapData);
  }

  async suggestFromPrompt(venueId: string, organizationId: string, prompt: string) {
    const { template, capacity } = suggestTemplateFromPrompt(prompt);
    return this.applyTemplate(venueId, organizationId, template, { capacity });
  }

  async importAiSections(
    venueId: string,
    organizationId: string,
    sections: SeatMapSection[],
  ) {
    const current = await this.getActiveLayout(venueId, organizationId);
    const mapData: SeatMapData = {
      ...current.layout.mapData,
      sections: sections.map((s, i) => ({
        ...s,
        id: s.id || `sec-${i}`,
        slug: s.slug || `section-${i}`,
        color: s.color || '#404040',
      })),
    };
    return this.saveMap(venueId, organizationId, mapData);
  }

  getEgressReport(
    venueId: string,
    organizationId: string,
    opts?: { mapData?: SeatMapData; format?: 'json' | 'csv' | 'pdf' },
  ) {
    return this.egress.getEgressReport(venueId, organizationId, opts);
  }

  getEgressOverview(
    organizationId: string,
    opts?: { page?: number; pageSize?: number },
  ) {
    return this.egress.getEgressOverview(organizationId, opts);
  }

  exportEgressOverviewCsv(
    organizationId: string,
    opts?: { page?: number; pageSize?: number },
  ) {
    return this.egress.exportEgressOverviewCsv(organizationId, opts);
  }

  publishToEvent(eventId: string, organizationId: string) {
    return this.publish.publishToEvent(eventId, organizationId);
  }
}
