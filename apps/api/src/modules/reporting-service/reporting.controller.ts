import { Controller, Get, Header, Param, Query, Sse, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgAccessGuard } from '../auth/org-access.guard';
import { ReportingService } from './reporting.service';

@ApiTags('Reporting & Analytics')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
@Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
export class ReportingController {
  constructor(private reportingService: ReportingService) {}

  @Get('dashboard/realtime/:organizationId')
  @ApiOperation({ summary: 'Get real-time dashboard' })
  async getRealtimeDashboard(
    @Param('organizationId') orgId: string,
    @Query('eventId') eventId?: string,
  ) {
    return await this.reportingService.getRealtimeDashboard(orgId, eventId);
  }

  @Sse('dashboard/realtime/:organizationId/stream')
  @ApiOperation({ summary: 'SSE stream for realtime dashboard (10s)' })
  streamRealtime(
    @Param('organizationId') orgId: string,
    @Query('eventId') eventId?: string,
  ) {
    return this.reportingService.streamRealtimeDashboard(orgId, eventId);
  }

  @Get('settlement/:organizationId/:period')
  @ApiOperation({ summary: 'Generate settlement report' })
  async getSettlement(
    @Param('organizationId') orgId: string,
    @Param('period') period: 'DAILY' | 'WEEKLY' | 'MONTHLY',
  ) {
    return await this.reportingService.generateSettlementReport(orgId, period);
  }

  @Get('heatmap/:eventId')
  @ApiOperation({ summary: 'Get occupancy heatmap' })
  async getHeatmap(@Param('eventId') eventId: string) {
    return await this.reportingService.getOccupancyHeatmap(eventId);
  }

  @Get('predict/:eventId')
  @ApiOperation({ summary: 'Get occupancy prediction' })
  async predictOccupancy(@Param('eventId') eventId: string) {
    return await this.reportingService.predictOccupancy(eventId);
  }

  @Get('channels/:organizationId')
  @ApiOperation({ summary: 'Get channel performance' })
  async getChannelPerformance(@Param('organizationId') orgId: string) {
    return await this.reportingService.getChannelPerformance(orgId);
  }

  @Get('customers/:organizationId')
  @ApiOperation({ summary: 'Get customer analytics' })
  async getCustomerAnalytics(@Param('organizationId') orgId: string) {
    return await this.reportingService.getCustomerAnalytics(orgId);
  }

  @Get('export/sales/:organizationId')
  @Header('Content-Type', 'text/csv')
  @ApiOperation({ summary: 'Export completed sales as CSV' })
  async exportSales(
    @Param('organizationId') orgId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const result = await this.reportingService.exportSalesCsv(
      orgId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
    return result.csv;
  }

  @Get('forecast/:organizationId/:days')
  @ApiOperation({ summary: 'Get revenue forecast' })
  async getRevenueForecast(
    @Param('organizationId') orgId: string,
    @Param('days') days: string,
  ) {
    return await this.reportingService.generateRevenueForecast(orgId, parseInt(days, 10));
  }
}
