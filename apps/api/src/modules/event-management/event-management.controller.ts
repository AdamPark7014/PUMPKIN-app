import { Controller, Post, Get, Put, Param, Body, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { EventManagementService } from './event-management.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('Event Management')
@Controller('events/manage')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class EventManagementController {
  constructor(private eventService: EventManagementService) {}

  // ==================== EVENT CREATION ====================

  @Post()
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Create new event' })
  async createEvent(
    @CurrentUser('organizationId') orgId: string,
    @Body()
    data: {
      title: string;
      description: string;
      type: 'single' | 'series' | 'residency';
      startDate: Date;
      endDate?: Date;
      venueId: string;
      capacity: number;
      basePrice: number;
      imageUrl?: string;
    }
  ) {
    return await this.eventService.createEvent(orgId, data);
  }

  // ==================== SERIES MANAGEMENT ====================

  @Post('series')
  @Roles('PROMOTER', 'ADMIN')
  @ApiOperation({ summary: 'Create event series' })
  async createEventSeries(
    @CurrentUser('organizationId') orgId: string,
    @Body()
    data: {
      seriesName: string;
      description: string;
      venueId: string;
      occurrences: Array<{
        date: Date;
        title?: string;
        capacity?: number;
        basePrice?: number;
      }>;
    }
  ) {
    return await this.eventService.createEventSeries(orgId, data);
  }

  // ==================== RESIDENCY SETUP ====================

  @Post('residency')
  @Roles('PROMOTER', 'ADMIN')
  @ApiOperation({ summary: 'Create residency (recurring events)' })
  async createResidency(
    @CurrentUser('organizationId') orgId: string,
    @Body()
    data: {
      name: string;
      venueId: string;
      startDate: Date;
      frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
      occurrenceCount: number;
      capacity: number;
      basePrice: number;
      exceptions?: Date[];
    }
  ) {
    return await this.eventService.createResidency(orgId, data);
  }

  // ==================== PRICING CONFIGURATION ====================

  @Put(':eventId/offers/:offerId')
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Update offer price or name' })
  async updateOffer(
    @Param('eventId') eventId: string,
    @Param('offerId') offerId: string,
    @Body() data: { basePrice?: number; name?: string; isAvailable?: boolean },
  ) {
    return await this.eventService.updateOffer(eventId, offerId, data);
  }

  @Put(':eventId/pricing')
  @Roles('PROMOTER', 'ADMIN')
  @ApiOperation({ summary: 'Configure pricing rules' })
  async setPricingRules(
    @Param('eventId') eventId: string,
    @Body()
    data: {
      basePrice: number;
      dynamicPricingEnabled: boolean;
      surgeTiers?: Array<{ occupancy: number; multiplier: number }>;
      timeBasedRules?: Array<{ daysUntilEvent: number; multiplier: number }>;
      segmentPricing?: Record<string, number>;
      customZonePricing?: Record<string, number>;
    }
  ) {
    return await this.eventService.setPricingRules(eventId, data);
  }

  // ==================== CHANNEL ALLOCATION ====================

  @Put(':eventId/channels')
  @Roles('PROMOTER', 'ADMIN')
  @ApiOperation({ summary: 'Allocate inventory across channels' })
  async allocateChannels(
    @Param('eventId') eventId: string,
    @Body()
    data: {
      web: { enabled: boolean; allocation: number; discount?: number };
      taquilla: { enabled: boolean; allocation: number; locations?: string[] };
      api: { enabled: boolean; allocation: number; partners?: string[] };
      phone?: { enabled: boolean; allocation: number };
    }
  ) {
    return await this.eventService.allocateChannels(eventId, data);
  }

  // ==================== CAMPAIGN MANAGEMENT ====================

  @Post(':eventId/campaigns')
  @Roles('PROMOTER', 'ADMIN')
  @ApiOperation({ summary: 'Create campaign (presale, early bird, VIP)' })
  async createCampaign(
    @Param('eventId') eventId: string,
    @Body()
    data: {
      name: string;
      type: 'presale' | 'early_bird' | 'vip' | 'group' | 'loyalty';
      startDate: Date;
      endDate: Date;
      code?: string;
      allocation: number;
      discountType: 'percentage' | 'fixed';
      discountValue: number;
      quantityPerUser?: number;
      requiresApproval?: boolean;
    }
  ) {
    return await this.eventService.createCampaign(eventId, data);
  }

  // ==================== CALENDAR VIEW ====================

  @Get('calendar/:month/:year')
  @Roles('PROMOTER', 'ADMIN')
  @ApiOperation({ summary: 'Get event calendar for month' })
  async getEventCalendar(
    @CurrentUser('organizationId') orgId: string,
    @Param('month') month: number,
    @Param('year') year: number
  ) {
    return await this.eventService.getEventCalendar(orgId, month, year);
  }

  // ==================== BULK OPERATIONS ====================

  @Put('bulk/pricing')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Bulk update pricing for multiple events' })
  async bulkUpdatePricing(
    @Body() data: { eventIds: string[]; priceMultiplier: number }
  ) {
    return await this.eventService.bulkUpdatePricing(data.eventIds, data.priceMultiplier);
  }

  // ==================== ADVANCED SEARCH ====================

  @Get('search')
  @Roles('PROMOTER', 'ADMIN')
  @ApiOperation({ summary: 'Advanced event search with filters' })
  async searchEvents(
    @CurrentUser('organizationId') orgId: string,
    @Query() filters: any
  ) {
    return await this.eventService.searchEvents(orgId, filters);
  }

  @Get(':eventId/hub')
  @Roles('PROMOTER', 'ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Event command hub (inventory, channels, config)' })
  async getEventHub(
    @CurrentUser('organizationId') orgId: string,
    @Param('eventId') eventId: string,
  ) {
    return await this.eventService.getEventHub(eventId, orgId);
  }
}


