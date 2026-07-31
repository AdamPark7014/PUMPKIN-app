import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { InteractiveQueryDto, RecommendSeatsDto } from './seat-mapping-3d.dto';
import { SeatMapping3DService } from './seat-mapping-3d.service';

@ApiTags('3D Seat Mapping')
@Controller('3d')
export class SeatMapping3DController {
  constructor(private seatMappingService: SeatMapping3DService) {}

  @Get('venue/:venueId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @Permissions('venue:manage')
  @ApiOperation({
    summary: 'Generate 3D venue map (compat)',
    deprecated: true,
    description:
      'Prefer published SeatMapData + client @boletera/venue-3d. Still powered by VenueGeometryEngine.',
  })
  generateVenue3D(
    @Param('venueId') venueId: string,
    @CurrentUser('organizationId') orgId: string | undefined,
  ) {
    return this.seatMappingService.generateVenue3D(venueId, orgId);
  }

  @Get('events/:eventId/interactive')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Live seat status for 3D clients',
    description:
      'Returns statusBySeat (+ compatible venue envelope). Geometry is projected client-side from the published map.',
  })
  getInteractiveSeatView(
    @Param('eventId') eventId: string,
    @Query() query: InteractiveQueryDto,
  ) {
    return this.seatMappingService.getInteractiveSeatView(eventId, query.selectedSeat);
  }

  @Post('events/:eventId/recommendations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER', 'TAQUILLA')
  @Permissions('event:read')
  @ApiOperation({ summary: 'Heuristic seat recommendations (sightline / preference scores)' })
  recommendSeats(@Param('eventId') eventId: string, @Body() preferences: RecommendSeatsDto) {
    return this.seatMappingService.recommendSeats(eventId, preferences);
  }

  @Get('events/:eventId/heatmap')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get real-time occupancy heatmap' })
  getOccupancyHeatmap(@Param('eventId') eventId: string) {
    return this.seatMappingService.getOccupancyHeatmap(eventId);
  }
}
