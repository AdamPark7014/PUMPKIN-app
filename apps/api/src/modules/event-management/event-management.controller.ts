import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  AllocateChannelsDto,
  BulkPricingDto,
  CalendarParamsDto,
  CreateCampaignDto,
  CreateEventDto,
  CreateEventSeriesDto,
  CreateResidencyDto,
  EventIdParamDto,
  OfferParamsDto,
  SearchEventsQueryDto,
  SetPricingRulesDto,
  UpdateOfferDto,
} from './event-management.dto';
import { EventManagementService } from './event-management.service';

@ApiTags('Event Management')
@Controller('events/manage')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class EventManagementController {
  constructor(private readonly eventService: EventManagementService) {}

  @Post()
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiOperation({ summary: 'Create new event' })
  createEvent(
    @CurrentUser('organizationId') orgId: string | undefined,
    @Body() data: CreateEventDto,
  ) {
    return this.eventService.createEvent(orgId, data);
  }

  @Post('series')
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiOperation({ summary: 'Create event series' })
  createEventSeries(
    @CurrentUser('organizationId') orgId: string | undefined,
    @Body() data: CreateEventSeriesDto,
  ) {
    return this.eventService.createEventSeries(orgId, data);
  }

  @Post('residency')
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiOperation({ summary: 'Create residency (recurring events)' })
  createResidency(
    @CurrentUser('organizationId') orgId: string | undefined,
    @Body() data: CreateResidencyDto,
  ) {
    return this.eventService.createResidency(orgId, data);
  }

  @Put(':eventId/offers/:offerId')
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write', 'price:write')
  @ApiOperation({ summary: 'Update offer price or name' })
  updateOffer(
    @Param() params: OfferParamsDto,
    @Body() data: UpdateOfferDto,
  ) {
    return this.eventService.updateOffer(params.eventId, params.offerId, data);
  }

  @Put(':eventId/pricing')
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write', 'price:write')
  @ApiOperation({ summary: 'Configure pricing rules' })
  setPricingRules(
    @Param() params: EventIdParamDto,
    @Body() data: SetPricingRulesDto,
  ) {
    return this.eventService.setPricingRules(params.eventId, data);
  }

  @Put(':eventId/channels')
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiOperation({ summary: 'Allocate inventory across channels' })
  allocateChannels(
    @Param() params: EventIdParamDto,
    @Body() data: AllocateChannelsDto,
  ) {
    return this.eventService.allocateChannels(params.eventId, data);
  }

  @Post(':eventId/campaigns')
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiOperation({ summary: 'Create campaign (presale, early bird, VIP)' })
  createCampaign(
    @Param() params: EventIdParamDto,
    @Body() data: CreateCampaignDto,
  ) {
    return this.eventService.createCampaign(params.eventId, data);
  }

  @Get('calendar/:month/:year')
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @Permissions('event:read')
  @ApiOperation({ summary: 'Get event calendar for month' })
  getEventCalendar(
    @CurrentUser('organizationId') orgId: string | undefined,
    @Param() params: CalendarParamsDto,
  ) {
    return this.eventService.getEventCalendar(orgId, params.month, params.year);
  }

  @Put('bulk/pricing')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write', 'price:write')
  @ApiOperation({ summary: 'Bulk update pricing for multiple events' })
  bulkUpdatePricing(@Body() data: BulkPricingDto) {
    return this.eventService.bulkUpdatePricing(data);
  }

  @Get('search')
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @Permissions('event:read')
  @ApiOperation({ summary: 'Advanced event search with filters' })
  searchEvents(
    @CurrentUser('organizationId') orgId: string | undefined,
    @Query() filters: SearchEventsQueryDto,
  ) {
    return this.eventService.searchEvents(orgId, filters);
  }

  @Get(':eventId/hub')
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @Permissions('event:read')
  @ApiOperation({ summary: 'Event command hub (inventory, channels, config)' })
  getEventHub(
    @CurrentUser('organizationId') orgId: string | undefined,
    @Param() params: EventIdParamDto,
  ) {
    return this.eventService.getEventHub(params.eventId, orgId);
  }
}
