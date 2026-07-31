import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  AllocateInventoryDto,
  ApiPartnerDto,
  ChannelConfigDto,
  TaquillaLocationDto,
} from './channel.dto';
import { ChannelManagementService } from './channel-management.service';
import { assertChannelConfig } from './channel-validate';

@ApiTags('Channel Management')
@Controller('channels')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ChannelManagementController {
  constructor(private readonly channelService: ChannelManagementService) {}

  @Post(':eventId/configure')
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiOperation({ summary: 'Configure sales channels' })
  async configureChannels(@Param('eventId') eventId: string, @Body() config: ChannelConfigDto) {
    return this.channelService.configureChannels(eventId, assertChannelConfig(config));
  }

  @Post(':eventId/allocate-inventory')
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiOperation({ summary: 'Allocate inventory to channels' })
  async allocateInventory(
    @Param('eventId') eventId: string,
    @Body() data: AllocateInventoryDto,
  ) {
    return this.channelService.allocateInventoryToChannels(eventId, data.totalTickets);
  }

  @Get(':eventId/health')
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:read')
  @ApiOperation({ summary: 'Get channel health status' })
  async getChannelHealth(@Param('eventId') eventId: string) {
    return this.channelService.getChannelHealth(eventId);
  }

  @Post(':eventId/reallocate')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiOperation({ summary: 'Dynamic channel reallocation based on demand' })
  async dynamicReallocate(@Param('eventId') eventId: string) {
    return this.channelService.dynamicReallocate(eventId);
  }

  @Get(':eventId/analytics')
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('analytics:read')
  @ApiOperation({ summary: 'Channel performance analytics' })
  async getAnalytics(@Param('eventId') eventId: string) {
    return this.channelService.getChannelAnalytics(eventId);
  }

  @Post(':eventId/partners')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Permissions('tenant:manage')
  @ApiOperation({ summary: 'Add API partner' })
  async addPartner(@Param('eventId') eventId: string, @Body() partner: ApiPartnerDto) {
    return this.channelService.addApiPartner(eventId, partner);
  }

  @Post(':eventId/taquilla-location')
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('venue:manage')
  @ApiOperation({ summary: 'Add taquilla location' })
  async addTaquillaLocation(
    @Param('eventId') eventId: string,
    @Body() location: TaquillaLocationDto,
  ) {
    return this.channelService.addTaquillaLocation(eventId, location);
  }
}
