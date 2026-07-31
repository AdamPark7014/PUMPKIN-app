import {
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { OrgAccessGuard } from '../auth/org-access.guard';
import { ReportingService } from './reporting.service';
import {
  ExportSalesQueryDto,
  ReportingEventQueryDto,
} from './reporting.dto';

@ApiTags('Reporting & Analytics')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
@Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
@Permissions('analytics:read')
export class ReportingController {
  constructor(private readonly reportingService: ReportingService) {}

  @Get('dashboard/realtime/:organizationId')
  @ApiOperation({ summary: 'Get real-time dashboard' })
  getRealtimeDashboard(
    @Param('organizationId') orgId: string,
    @Query() query: ReportingEventQueryDto,
  ) {
    return this.reportingService.getRealtimeDashboard(orgId, query.eventId);
  }

  @Sse('dashboard/realtime/:organizationId/stream')
  @ApiOperation({ summary: 'SSE stream for realtime dashboard (10s)' })
  streamRealtime(
    @Param('organizationId') orgId: string,
    @Query() query: ReportingEventQueryDto,
  ) {
    return this.reportingService.streamRealtimeDashboard(orgId, query.eventId);
  }

  @Get('settlement/:organizationId/:period')
  @ApiOperation({ summary: 'Generate settlement report' })
  getSettlement(
    @Param('organizationId') orgId: string,
    @Param('period') period: 'DAILY' | 'WEEKLY' | 'MONTHLY',
  ) {
    return this.reportingService.generateSettlementReport(orgId, period);
  }

  @Get('heatmap/:eventId')
  @ApiOperation({ summary: 'Get occupancy heatmap' })
  getHeatmap(@Param('eventId') eventId: string) {
    return this.reportingService.getOccupancyHeatmap(eventId);
  }

  @Get('predict/:eventId')
  @ApiOperation({ summary: 'Get occupancy prediction' })
  predictOccupancy(@Param('eventId') eventId: string) {
    return this.reportingService.predictOccupancy(eventId);
  }

  @Get('channels/:organizationId')
  @ApiOperation({ summary: 'Get channel performance' })
  getChannelPerformance(
    @Param('organizationId') orgId: string,
    @Query() query: ReportingEventQueryDto,
  ) {
    return this.reportingService.getChannelPerformance(orgId, query.eventId);
  }

  @Get('customers/:organizationId')
  @ApiOperation({ summary: 'Get customer analytics' })
  getCustomerAnalytics(@Param('organizationId') orgId: string) {
    return this.reportingService.getCustomerAnalytics(orgId);
  }

  @Get('export/sales/:organizationId')
  @Permissions('data:export')
  @Header('Content-Type', 'text/csv')
  @ApiOperation({ summary: 'Export completed sales as CSV' })
  async exportSales(
    @Param('organizationId') orgId: string,
    @Query() query: ExportSalesQueryDto,
  ) {
    const result = await this.reportingService.exportSalesCsv(
      orgId,
      query.from ? new Date(query.from) : undefined,
      query.to ? new Date(query.to) : undefined,
      query.page ?? 1,
      query.pageSize ?? 5000,
    );
    return result.csv;
  }

  @Get('forecast/:organizationId/:days')
  @ApiOperation({ summary: 'Get revenue forecast' })
  getRevenueForecast(
    @Param('organizationId') orgId: string,
    @Param('days', ParseIntPipe) days: number,
  ) {
    return this.reportingService.generateRevenueForecast(orgId, days);
  }
}
