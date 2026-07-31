import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  BlackoutParamsDto,
  CalendarQueryDto,
  CancelEventDto,
  CreateBlackoutDto,
  CreateScheduledEventDto,
  CreateSeriesDto,
  EventIdParamDto,
  ExtendSeriesDto,
  ListSeriesQueryDto,
  PhaseIdParamDto,
  PreviewScheduleDto,
  RescheduleEventDto,
  SeriesIdParamDto,
  SetSaleWindowsDto,
  TransitionsQueryDto,
  UpdateSeriesDto,
  UpsertPhaseDto,
  VenueIdParamDto,
} from './event-scheduling.dto';
import { EventSchedulingService } from './event-scheduling.service';
import { SaleWindowService } from './sale-window.service';

@ApiTags('Event Scheduling')
@Controller('events/schedule')
export class EventSchedulingController {
  constructor(
    private readonly scheduling: EventSchedulingService,
    private readonly saleWindows: SaleWindowService,
  ) {}

  @Post('preview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('PROMOTER', 'VENUE_MANAGER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:read')
  @ApiOperation({ summary: 'Expand a recurrence and report venue conflicts (no writes)' })
  preview(
    @CurrentUser('organizationId') orgId: string | undefined,
    @Body() body: PreviewScheduleDto,
  ) {
    return this.scheduling.previewSchedule(orgId, body);
  }

  @Post('events')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiOperation({ summary: 'Create one scheduled event with its sale windows' })
  createScheduledEvent(
    @CurrentUser('organizationId') orgId: string | undefined,
    @CurrentUser('sub') userId: string | undefined,
    @Body() body: CreateScheduledEventDto,
  ) {
    return this.scheduling.createScheduledEvent(orgId, userId, body);
  }

  @Post('series')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiOperation({ summary: 'Create a scheduled series (tour, residency, season)' })
  createSeries(
    @CurrentUser('organizationId') orgId: string | undefined,
    @CurrentUser('sub') userId: string | undefined,
    @Body() body: CreateSeriesDto,
  ) {
    return this.scheduling.createSeries(orgId, userId, body);
  }

  @Get('series')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('PROMOTER', 'VENUE_MANAGER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:read')
  @ApiOperation({ summary: 'List series with their next dates' })
  listSeries(
    @CurrentUser('organizationId') orgId: string | undefined,
    @Query() query: ListSeriesQueryDto,
  ) {
    return this.scheduling.listSeries(orgId, query);
  }

  @Get('series/:seriesId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('PROMOTER', 'VENUE_MANAGER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:read')
  @ApiOperation({ summary: 'Series detail with every occurrence and its sale state' })
  getSeries(
    @CurrentUser('organizationId') orgId: string | undefined,
    @Param() params: SeriesIdParamDto,
  ) {
    return this.scheduling.getSeries(orgId, params.seriesId);
  }

  @Patch('series/:seriesId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiOperation({ summary: 'Rename or change the status of a series' })
  updateSeries(
    @CurrentUser('organizationId') orgId: string | undefined,
    @Param() params: SeriesIdParamDto,
    @Body() body: UpdateSeriesDto,
  ) {
    return this.scheduling.updateSeries(orgId, params.seriesId, body);
  }

  @Post('series/:seriesId/extend')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiOperation({ summary: 'Continue a series with more dates from its stored recurrence' })
  extendSeries(
    @CurrentUser('organizationId') orgId: string | undefined,
    @CurrentUser('sub') userId: string | undefined,
    @Param() params: SeriesIdParamDto,
    @Body() body: ExtendSeriesDto,
  ) {
    return this.scheduling.extendSeries(
      orgId,
      userId,
      params.seriesId,
      body,
    );
  }

  @Get('events/:eventId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('PROMOTER', 'VENUE_MANAGER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:read')
  @ApiOperation({ summary: 'Schedule, sale windows, phases and conflicts of an event' })
  getEventSchedule(
    @CurrentUser('organizationId') orgId: string | undefined,
    @Param() params: EventIdParamDto,
  ) {
    return this.scheduling.getEventSchedule(orgId, params.eventId);
  }

  @Put('events/:eventId/windows')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiOperation({ summary: 'Set announce / auto-publish / on-sale windows' })
  setWindows(
    @CurrentUser('organizationId') orgId: string | undefined,
    @CurrentUser('sub') userId: string | undefined,
    @Param() params: EventIdParamDto,
    @Body() body: SetSaleWindowsDto,
  ) {
    return this.scheduling.setSaleWindows(
      orgId,
      userId,
      params.eventId,
      body,
    );
  }

  @Patch('events/:eventId/reschedule')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiOperation({ summary: 'Move an event to a new date (conflict-checked, audited)' })
  reschedule(
    @CurrentUser('organizationId') orgId: string | undefined,
    @CurrentUser('sub') userId: string | undefined,
    @Param() params: EventIdParamDto,
    @Body() body: RescheduleEventDto,
  ) {
    return this.scheduling.rescheduleEvent(
      orgId,
      userId,
      params.eventId,
      body,
    );
  }

  @Patch('events/:eventId/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiOperation({ summary: 'Cancel an event and close its sales' })
  cancel(
    @CurrentUser('organizationId') orgId: string | undefined,
    @CurrentUser('sub') userId: string | undefined,
    @Param() params: EventIdParamDto,
    @Body() body: CancelEventDto,
  ) {
    return this.scheduling.cancelEvent(
      orgId,
      userId,
      params.eventId,
      body,
    );
  }

  @Put('events/:eventId/phases')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiOperation({ summary: 'Create or update a sale phase (presale, members, public…)' })
  upsertPhase(
    @CurrentUser('organizationId') orgId: string | undefined,
    @CurrentUser('sub') userId: string | undefined,
    @Param() params: EventIdParamDto,
    @Body() body: UpsertPhaseDto,
  ) {
    return this.scheduling.upsertPhase(
      orgId,
      userId,
      params.eventId,
      body,
    );
  }

  @Delete('events/:eventId/phases/:phaseId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiOperation({ summary: 'Delete a sale phase' })
  deletePhase(
    @CurrentUser('organizationId') orgId: string | undefined,
    @Param() params: PhaseIdParamDto,
  ) {
    return this.scheduling.deletePhase(
      orgId,
      params.eventId,
      params.phaseId,
    );
  }

  @Get('venues/:venueId/blackouts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('PROMOTER', 'VENUE_MANAGER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:read')
  @ApiOperation({ summary: 'List venue blackout windows' })
  listBlackouts(
    @CurrentUser('organizationId') orgId: string | undefined,
    @Param() params: VenueIdParamDto,
  ) {
    return this.scheduling.listBlackouts(orgId, params.venueId);
  }

  @Post('venues/:venueId/blackouts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('VENUE_MANAGER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('venue:manage')
  @ApiOperation({ summary: 'Block a venue window (maintenance, private hire)' })
  createBlackout(
    @CurrentUser('organizationId') orgId: string | undefined,
    @CurrentUser('sub') userId: string | undefined,
    @Param() params: VenueIdParamDto,
    @Body() body: CreateBlackoutDto,
  ) {
    return this.scheduling.createBlackout(
      orgId,
      userId,
      params.venueId,
      body,
    );
  }

  @Delete('venues/:venueId/blackouts/:blackoutId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('VENUE_MANAGER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('venue:manage')
  @ApiOperation({ summary: 'Remove a venue blackout' })
  deleteBlackout(
    @CurrentUser('organizationId') orgId: string | undefined,
    @Param() params: BlackoutParamsDto,
  ) {
    return this.scheduling.deleteBlackout(
      orgId,
      params.venueId,
      params.blackoutId,
    );
  }

  @Get('calendar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('PROMOTER', 'VENUE_MANAGER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:read')
  @ApiOperation({ summary: 'Range calendar with sale states, series and conflicts' })
  calendar(
    @CurrentUser('organizationId') orgId: string | undefined,
    @Query() query: CalendarQueryDto,
  ) {
    return this.scheduling.getCalendar(orgId, query);
  }

  @Get('transitions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('PROMOTER', 'VENUE_MANAGER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:read')
  @ApiOperation({ summary: 'What publishes / goes on sale / closes in the next hours' })
  transitions(
    @CurrentUser('organizationId') orgId: string | undefined,
    @Query() query: TransitionsQueryDto,
  ) {
    return this.scheduling.getUpcomingTransitions(orgId, query.hours ?? 72);
  }

  @Get('public/events/:eventId/sale-state')
  @ApiOperation({ summary: 'Storefront sale state for an event (no auth)' })
  publicSaleState(@Param() params: EventIdParamDto) {
    return this.saleWindows.getStatus(params.eventId);
  }

  @Post('tick')
  @ApiOperation({ summary: 'Run time-based transitions (requires X-Internal-Secret)' })
  tick(@Headers('x-internal-secret') internalSecret?: string) {
    const expected = process.env.INTERNAL_API_SECRET || process.env.JWT_SECRET;
    if (!expected || internalSecret !== expected) {
      throw new UnauthorizedException(
        'Se requiere X-Internal-Secret para el tick del programador',
      );
    }
    return this.scheduling.runTick();
  }
}
