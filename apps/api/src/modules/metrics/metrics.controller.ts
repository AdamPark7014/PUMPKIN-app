import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgAccessGuard } from '../auth/org-access.guard';
import { MetricsService } from './metrics.service';
import {
  MetricsPagedQueryDto,
  MetricsRangeQueryDto,
  MetricsTimeSeriesQueryDto,
} from './dto/metrics-query.dto';

type AuthedRequest = {
  user: {
    organizationId?: string | null;
    role?: string;
    sub?: string;
  };
};

@ApiTags('Metrics')
@ApiBearerAuth()
@Controller('metrics')
@UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
@Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  private org(req: AuthedRequest, queryOrgId?: string): string {
    return this.metrics.resolveOrganizationId(req.user, queryOrgId);
  }

  @Get('executive')
  @ApiOperation({
    summary: 'Resumen ejecutivo: ingresos, boletos, conversión, canales y proyección',
  })
  getExecutive(@Request() req: AuthedRequest, @Query() query: MetricsRangeQueryDto) {
    return this.metrics.getExecutiveSummary(
      this.org(req, query.organizationId),
      query.from,
      query.to,
    );
  }

  @Get('events/sales-pace')
  @ApiOperation({
    summary: 'Ritmo de venta por evento vs curva esperada, ocupacion y eventos en riesgo',
  })
  getSalesPace(@Request() req: AuthedRequest, @Query() query: MetricsRangeQueryDto) {
    return this.metrics.getEventSalesPace(
      this.org(req, query.organizationId),
      query.from,
      query.to,
    );
  }

  @Get('inventory')
  @ApiOperation({
    summary: 'Disponibilidad por zona/tier, holds, bloqueados y velocidad de agotamiento',
  })
  getInventory(@Request() req: AuthedRequest, @Query() query: MetricsRangeQueryDto) {
    return this.metrics.getInventoryMetrics(
      this.org(req, query.organizationId),
      query.from,
      query.to,
      query.eventId,
    );
  }

  @Get('orders')
  @ApiOperation({
    summary: 'Ordenes y pagos: estados, aprobacion, reembolsos, contracargos y metodos',
  })
  getOrders(@Request() req: AuthedRequest, @Query() query: MetricsRangeQueryDto) {
    return this.metrics.getOrdersPaymentsMetrics(
      this.org(req, query.organizationId),
      query.from,
      query.to,
    );
  }

  @Get('access')
  @ApiOperation({
    summary: 'Asistencia: curva de check-in, no-show y trafico por punto de acceso',
  })
  getAccess(@Request() req: AuthedRequest, @Query() query: MetricsRangeQueryDto) {
    return this.metrics.getAccessMetrics(
      this.org(req, query.organizationId),
      query.from,
      query.to,
      query.eventId,
    );
  }

  @Get('resale')
  @ApiOperation({ summary: 'Metricas de reventa / marketplace secundario' })
  getResale(@Request() req: AuthedRequest, @Query() query: MetricsRangeQueryDto) {
    return this.metrics.getResaleMetrics(
      this.org(req, query.organizationId),
      query.from,
      query.to,
    );
  }

  @Get('waitlist')
  @ApiOperation({ summary: 'Lista de espera: embudo y conversion' })
  getWaitlist(@Request() req: AuthedRequest, @Query() query: MetricsRangeQueryDto) {
    return this.metrics.getWaitlistMetrics(
      this.org(req, query.organizationId),
      query.from,
      query.to,
    );
  }

  @Get('campaigns')
  @ApiOperation({ summary: 'Campanas / promociones con embudo de conversion' })
  getCampaigns(@Request() req: AuthedRequest, @Query() query: MetricsRangeQueryDto) {
    return this.metrics.getCampaignMetrics(
      this.org(req, query.organizationId),
      query.from,
      query.to,
    );
  }

  @Get('fraud')
  @ApiOperation({ summary: 'Antifraude: senales de riesgo agregadas' })
  getFraud(@Request() req: AuthedRequest, @Query() query: MetricsRangeQueryDto) {
    return this.metrics.getFraudMetrics(
      this.org(req, query.organizationId),
      query.from,
      query.to,
    );
  }

  @Get('settlements')
  @ApiOperation({ summary: 'Liquidaciones a organizadores / payouts' })
  getSettlements(@Request() req: AuthedRequest, @Query() query: MetricsRangeQueryDto) {
    return this.metrics.getSettlementsMetrics(
      this.org(req, query.organizationId),
      query.from,
      query.to,
    );
  }

  @Get('timeseries')
  @ApiOperation({
    summary: 'Series temporales parametrizables (hora/dia/semana/mes)',
  })
  getTimeSeries(@Request() req: AuthedRequest, @Query() query: MetricsTimeSeriesQueryDto) {
    return this.metrics.getTimeSeries(
      this.org(req, query.organizationId),
      query.metric ?? 'revenue',
      query.granularity ?? 'day',
      query.from,
      query.to,
      query.eventId,
    );
  }

  @Get('alerts')
  @ApiOperation({
    summary: 'Alertas y recomendaciones accionables derivadas de agregados',
  })
  getAlerts(@Request() req: AuthedRequest, @Query() query: MetricsPagedQueryDto) {
    return this.metrics.getAlerts(
      this.org(req, query.organizationId),
      query.from,
      query.to,
    );
  }
}
