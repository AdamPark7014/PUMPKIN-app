import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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

  @Get(':venueId/layout')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Get active venue layout + seat map' })
  getLayout(@Param('venueId') venueId: string, @CurrentUser('organizationId') orgId: string) {
    return this.layoutService.getActiveLayout(venueId, orgId);
  }

  @Put(':venueId/layout')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Save seat map (syncs sections/seats to DB)' })
  saveLayout(
    @Param('venueId') venueId: string,
    @CurrentUser('organizationId') orgId: string,
    @Body() body: { mapData: SeatMapData },
  ) {
    return this.layoutService.saveMap(venueId, orgId, body.mapData);
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


