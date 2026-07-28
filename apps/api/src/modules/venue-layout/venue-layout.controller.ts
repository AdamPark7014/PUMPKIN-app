import { Body, Controller, Get, Header, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { SeatMapData, SeatMapSection } from '@boletera/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { VenueLayoutService } from './venue-layout.service';

@ApiTags('Venue Layout / Map Editor')
@Controller('venues')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class VenueLayoutController {
  constructor(private layoutService: VenueLayoutService) {}

  /** Static path — must be registered before `:venueId` routes. */
  @Get('egress-overview')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Org-wide egress health summary (all venues)' })
  getEgressOverview(@CurrentUser('organizationId') orgId: string) {
    return this.layoutService.getEgressOverview(orgId);
  }

  @Get('egress-overview.csv')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'Org-wide egress health summary (CSV download)' })
  async getEgressOverviewCsv(
    @CurrentUser('organizationId') orgId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.layoutService.exportEgressOverviewCsv(orgId);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return result.csv;
  }

  @Get(':venueId/layout')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Get active venue layout + seat map' })
  getLayout(@Param('venueId') venueId: string, @CurrentUser('organizationId') orgId: string) {
    return this.layoutService.getActiveLayout(venueId, orgId);
  }

  @Get(':venueId/layout/egress')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Egress / circulation report (JSON) for active layout' })
  async getEgressJson(
    @Param('venueId') venueId: string,
    @CurrentUser('organizationId') orgId: string,
  ) {
    return this.layoutService.getEgressReport(venueId, orgId, { format: 'json' });
  }

  @Get(':venueId/layout/egress.csv')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'Egress / circulation report (CSV download)' })
  async getEgressCsv(
    @Param('venueId') venueId: string,
    @CurrentUser('organizationId') orgId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.layoutService.getEgressReport(venueId, orgId, { format: 'csv' });
    if (result.format !== 'csv') {
      throw new Error('Expected CSV egress report');
    }
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return result.csv;
  }

  @Get(':venueId/layout/egress.pdf')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({ summary: 'Egress / circulation report (PDF download)' })
  async getEgressPdf(
    @Param('venueId') venueId: string,
    @CurrentUser('organizationId') orgId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.layoutService.getEgressReport(venueId, orgId, { format: 'pdf' });
    if (result.format !== 'pdf') {
      throw new Error('Expected PDF egress report');
    }
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return result.pdf;
  }

  @Post(':venueId/layout/egress')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @ApiOperation({
    summary: 'Analyze egress for saved layout or unsaved mapData draft (json|csv|pdf)',
  })
  async postEgress(
    @Param('venueId') venueId: string,
    @CurrentUser('organizationId') orgId: string,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { mapData?: SeatMapData; format?: 'json' | 'csv' | 'pdf' } = {},
    @Query('format') formatQuery?: 'json' | 'csv' | 'pdf',
  ) {
    const format = body.format ?? formatQuery ?? 'json';
    const result = await this.layoutService.getEgressReport(venueId, orgId, {
      mapData: body.mapData,
      format,
    });
    if (result.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return result.csv;
    }
    if (result.format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return result.pdf;
    }
    return result;
  }

  @Put(':venueId/layout')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Save seat map (syncs sections/seats to DB)' })
  saveLayout(
    @Param('venueId') venueId: string,
    @CurrentUser('organizationId') orgId: string,
    @Body() body: SeatMapData & { mapData?: SeatMapData },
  ) {
    const mapData = body.mapData ?? body;
    return this.layoutService.saveMap(venueId, orgId, mapData);
  }

  @Post(':venueId/layout/from-template')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Replace layout from template (arena/theater/stadium/festival)' })
  fromTemplate(
    @Param('venueId') venueId: string,
    @CurrentUser('organizationId') orgId: string,
    @Body()
    body: {
      template: 'arena' | 'theater' | 'stadium' | 'festival';
      capacity?: number;
      sectionCount?: number;
    },
  ) {
    return this.layoutService.applyTemplate(venueId, orgId, body.template, {
      capacity: body.capacity,
      sectionCount: body.sectionCount,
    });
  }

  @Post(':venueId/layout/ai-import')
  @Roles('ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Import AI-suggested sections into layout' })
  aiImport(
    @Param('venueId') venueId: string,
    @CurrentUser('organizationId') orgId: string,
    @Body() body: { sections: SeatMapSection[] },
  ) {
    return this.layoutService.importAiSections(venueId, orgId, body.sections);
  }

  @Post(':venueId/layout/suggest')
  @Roles('ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Generate layout from natural-language prompt via templates' })
  suggest(
    @Param('venueId') venueId: string,
    @CurrentUser('organizationId') orgId: string,
    @Body() body: { prompt: string },
  ) {
    return this.layoutService.suggestFromPrompt(venueId, orgId, body.prompt || '');
  }
}

@ApiTags('Event Publishing')
@Controller('events')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class EventPublishController {
  constructor(private layoutService: VenueLayoutService) {}

  @Post(':eventId/publish')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @ApiOperation({ summary: 'Publish event: map snapshot + offers + tickets + channels' })
  publish(@Param('eventId') eventId: string, @CurrentUser('organizationId') orgId: string) {
    return this.layoutService.publishToEvent(eventId, orgId);
  }
}


