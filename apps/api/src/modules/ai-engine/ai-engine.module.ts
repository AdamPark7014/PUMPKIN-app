import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { TenantModule } from '../tenant/tenant.module';
import { MetricsModule } from '../metrics/metrics.module';
import { AiEngineController } from './ai-engine.controller';
import { AiCacheService } from './ai-cache.service';
import { SalesForecastService } from './prediction/sales-forecast.service';
import { AnomalyDetectionService } from './anomaly/anomaly-detection.service';
import { FraudRiskService } from './fraud/fraud-risk.service';
import { RecommendationsService } from './recommendations/recommendations.service';
import { ExecutiveNarrativeService } from './summaries/executive-narrative.service';
import { CustomerSegmentationService } from './segmentation/customer-segmentation.service';

@Module({
  imports: [PrismaModule, AuthModule, TenantModule, MetricsModule],
  controllers: [AiEngineController],
  providers: [
    AiCacheService,
    SalesForecastService,
    AnomalyDetectionService,
    FraudRiskService,
    RecommendationsService,
    ExecutiveNarrativeService,
    CustomerSegmentationService,
  ],
  exports: [
    SalesForecastService,
    AnomalyDetectionService,
    FraudRiskService,
    RecommendationsService,
    ExecutiveNarrativeService,
    CustomerSegmentationService,
  ],
})
export class AiEngineModule {}
