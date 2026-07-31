import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { MetricsCacheService } from './metrics-cache.service';

@Module({
  imports: [PrismaModule],
  controllers: [MetricsController],
  providers: [MetricsService, MetricsCacheService],
  exports: [MetricsService],
})
export class MetricsModule {}
