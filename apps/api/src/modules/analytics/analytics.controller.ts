import { Controller, Post, Get, Body, Param, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  // ==================== DASHBOARDS ====================

  @Get('events/:eventId/dashboard')
  @ApiOperation({ summary: 'Get event analytics dashboard' })
  async getEventDashboard(@Param('eventId') eventId: string) {
    return await this.analyticsService.getEventDashboard(eventId);
  }

  @Get('promoters/:organizationId/dashboard')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get promoter dashboard' })
  async getPromoterDashboard(
    @Param('organizationId') organizationId: string,
    @Query('period') period?: 'DAY' | 'WEEK' | 'MONTH',
  ) {
    return await this.analyticsService.getPromoterDashboard(organizationId, period);
  }

  // ==================== SETTLEMENT REPORTS ====================

  @Post('promoters/:organizationId/settlement')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate settlement report' })
  async generateSettlement(
    @Param('organizationId') organizationId: string,
    @Body() body: { month: number; year: number },
  ) {
    return await this.analyticsService.generateSettlementReport(organizationId, body.month, body.year);
  }

  // ==================== CUSTOMER ANALYTICS ====================

  @Get('promoters/:organizationId/customers')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get customer analytics' })
  async getCustomerAnalytics(@Param('organizationId') organizationId: string) {
    return await this.analyticsService.getCustomerAnalytics(organizationId);
  }

  // ==================== FRAUD ANALYTICS ====================

  @Get('promoters/:organizationId/fraud')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get fraud analytics' })
  async getFraudAnalytics(@Param('organizationId') organizationId: string) {
    return await this.analyticsService.getFraudAnalytics(organizationId);
  }
}


