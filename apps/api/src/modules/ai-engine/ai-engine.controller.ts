import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { OrgAccessGuard } from '../auth/org-access.guard';
import { TenantScopeService } from '../tenant/tenant-scope.service';
import { SalesForecastService } from './prediction/sales-forecast.service';
import { AnomalyDetectionService } from './anomaly/anomaly-detection.service';
import { FraudRiskService } from './fraud/fraud-risk.service';
import { RecommendationsService } from './recommendations/recommendations.service';
import { ExecutiveNarrativeService } from './summaries/executive-narrative.service';
import { CustomerSegmentationService } from './segmentation/customer-segmentation.service';
import {
  AiAnomaliesQueryDto,
  AiForecastQueryDto,
  AiFraudQueryDto,
  AiRangeQueryDto,
  AiRecommendationsQueryDto,
  AiSegmentationQueryDto,
} from './dto/ai-query.dto';
import type { AiAnomalyMetric } from '@boletera/shared';

@ApiTags('AI Engine')
@ApiBearerAuth()
@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
@Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
@Permissions('analytics:read')
export class AiEngineController {
  constructor(
    private readonly tenantScope: TenantScopeService,
    private readonly forecast: SalesForecastService,
    private readonly anomalies: AnomalyDetectionService,
    private readonly fraud: FraudRiskService,
    private readonly recommendations: RecommendationsService,
    private readonly narratives: ExecutiveNarrativeService,
    private readonly segmentation: CustomerSegmentationService,
  ) {}

  @Get('forecast/events/:eventId')
  @ApiOperation({
    summary:
      'Predicción de ventas y ocupación final por evento (intervalos de confianza)',
  })
  getEventForecast(
    @Param('eventId') eventId: string,
    @Query() query: AiForecastQueryDto,
  ) {
    const organizationId = this.tenantScope.resolve(query.organizationId);
    return this.forecast.forecast(
      organizationId,
      eventId,
      query.from,
      query.to,
    );
  }

  @Get('anomalies')
  @ApiOperation({
    summary:
      'Detección de anomalías (z-score) en ventas, reembolsos, aprobación y accesos',
  })
  getAnomalies(@Query() query: AiAnomaliesQueryDto) {
    const organizationId = this.tenantScope.resolve(query.organizationId);
    return this.anomalies.detect(organizationId, {
      from: query.from,
      to: query.to,
      eventId: query.eventId,
      metric: query.metric as AiAnomalyMetric | undefined,
      zThreshold: query.zThreshold,
    });
  }

  @Get('fraud/risk')
  @ApiOperation({
    summary: 'Puntuación de riesgo de fraude explicable (lote del periodo)',
  })
  getFraudRisk(@Query() query: AiFraudQueryDto) {
    const organizationId = this.tenantScope.resolve(query.organizationId);
    return this.fraud.scoreOrganization(organizationId, {
      from: query.from,
      to: query.to,
      eventId: query.eventId,
      limit: query.limit,
    });
  }

  @Get('fraud/risk/orders/:orderId')
  @ApiOperation({ summary: 'Puntuación de riesgo de fraude para una orden' })
  getFraudRiskOrder(
    @Param('orderId') orderId: string,
    @Query() query: { organizationId?: string },
  ) {
    const organizationId = this.tenantScope.resolve(query.organizationId);
    return this.fraud.scoreOrder(organizationId, orderId);
  }

  @Get('recommendations')
  @ApiOperation({
    summary: 'Recomendaciones accionables para el organizador',
  })
  getRecommendations(@Query() query: AiRecommendationsQueryDto) {
    const organizationId = this.tenantScope.resolve(query.organizationId);
    return this.recommendations.recommend(organizationId, {
      from: query.from,
      to: query.to,
      eventId: query.eventId,
      limit: query.limit,
    });
  }

  @Get('summaries/executive')
  @ApiOperation({
    summary: 'Resumen ejecutivo determinista en español (es-MX)',
  })
  getExecutiveSummary(@Query() query: AiRangeQueryDto) {
    const organizationId = this.tenantScope.resolve(query.organizationId);
    return this.narratives.narrate(organizationId, {
      from: query.from,
      to: query.to,
    });
  }

  @Get('segmentation/customers')
  @ApiOperation({
    summary: 'Segmentación RFM de clientes y probabilidad de abandono',
  })
  getCustomerSegmentation(@Query() query: AiSegmentationQueryDto) {
    const organizationId = this.tenantScope.resolve(query.organizationId);
    return this.segmentation.segment(organizationId, {
      from: query.from,
      to: query.to,
      limit: query.limit,
    });
  }
}
