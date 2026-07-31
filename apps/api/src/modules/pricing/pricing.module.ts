import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PricingCacheService } from './pricing-cache.service';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PricingController],
  providers: [PricingService, PricingCacheService],
  exports: [PricingService],
})
export class PricingModule {}
