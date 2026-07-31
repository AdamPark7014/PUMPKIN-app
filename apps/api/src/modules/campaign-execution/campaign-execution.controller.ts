import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { OrgAccessGuard } from '../auth/org-access.guard';
import type { AuthRequest } from '../auth/auth.types';
import { CampaignExecutionService } from './campaign-execution.service';
import {
  ApplyDiscountDto,
  AwardLoyaltyPointsDto,
  CampaignListQueryDto,
  CreateCampaignDto,
  ValidatePresaleCodeDto,
} from './campaign.dto';
import { assertApplyDiscount, assertCreateCampaign } from './campaign-validate';

@ApiTags('Campaign Management')
@Controller('campaigns')
export class CampaignExecutionController {
  constructor(private campaignService: CampaignExecutionService) {}

  @Post('create/:organizationId/:eventId')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create campaign' })
  async createCampaign(
    @Param('organizationId') orgId: string,
    @Param('eventId') eventId: string,
    @Body() data: CreateCampaignDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.campaignService.createCampaign(
      orgId,
      eventId,
      assertCreateCampaign(data),
      idempotencyKey,
    );
  }

  @Get('list/:eventId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @Permissions('event:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List campaigns for event' })
  async listCampaigns(
    @Param('eventId') eventId: string,
    @Query() query: CampaignListQueryDto,
  ) {
    return this.campaignService.listCampaigns(eventId, query.page, query.limit);
  }

  @Post(':campaignId/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Publish campaign' })
  async publishCampaign(@Param('campaignId') campaignId: string) {
    return this.campaignService.publishCampaign(campaignId);
  }

  /** Public — checkout validates promo codes without staff JWT */
  @Post('validate-code')
  @ApiOperation({ summary: 'Validate presale code' })
  async validateCode(@Body() data: ValidatePresaleCodeDto) {
    return this.campaignService.validatePresaleCode(data.code, data.eventId, data.userId);
  }

  /** Public — pricing preview at checkout */
  @Post('apply-discount/:campaignId')
  @ApiOperation({ summary: 'Apply discount' })
  async applyDiscount(@Param('campaignId') campaignId: string, @Body() data: ApplyDiscountDto) {
    const body = assertApplyDiscount(data);
    return this.campaignService.applyDiscount(campaignId, body.basePrice, body.quantity);
  }

  @Get(':campaignId/codes/export')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('data:export')
  @ApiBearerAuth()
  @Header('Content-Type', 'text/csv')
  @ApiOperation({ summary: 'Export presale codes CSV' })
  async exportCodes(@Param('campaignId') campaignId: string) {
    const result = await this.campaignService.exportPresaleCodesCsv(campaignId);
    return result.csv;
  }

  @Get(':campaignId/analytics')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('analytics:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get campaign analytics' })
  async getAnalytics(@Param('campaignId') campaignId: string) {
    return await this.campaignService.getCampaignAnalytics(campaignId);
  }

  @Post(':campaignId/pause')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Pause campaign' })
  async pauseCampaign(@Param('campaignId') campaignId: string) {
    return await this.campaignService.pauseCampaign(campaignId);
  }

  @Post(':campaignId/resume')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resume campaign' })
  async resumeCampaign(@Param('campaignId') campaignId: string) {
    return await this.campaignService.resumeCampaign(campaignId);
  }

  @Post(':campaignId/end')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'End campaign' })
  async endCampaign(@Param('campaignId') campaignId: string) {
    return await this.campaignService.endCampaign(campaignId);
  }

  /** Public — storefront may list active promos */
  @Get('active/:eventId')
  @ApiOperation({ summary: 'Get active campaigns' })
  async getActiveCampaigns(@Param('eventId') eventId: string) {
    return await this.campaignService.getActiveCampaigns(eventId);
  }

  @Post(':userId/loyalty/award')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Award loyalty points' })
  async awardPoints(
    @Param('userId') userId: string,
    @Body() data: AwardLoyaltyPointsDto,
  ) {
    return this.campaignService.awardLoyaltyPoints(userId, data.eventId, data.points);
  }

  @Get(':userId/loyalty/balance')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'CUSTOMER', 'PROMOTER')
  @Permissions('event:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get loyalty balance' })
  async getLoyaltyBalance(
    @Param('userId') userId: string,
    @Req() request: AuthRequest,
  ) {
    return this.campaignService.getLoyaltyBalance(userId, request.user);
  }
}
