import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ApiKeyGuard } from './api-key.guard';
import { PartnerApiController } from './partner-api.controller';
import { PartnersController } from './partners.controller';
import { PartnersService } from './partners.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PartnersController, PartnerApiController],
  providers: [PartnersService, ApiKeyGuard],
  exports: [PartnersService, ApiKeyGuard],
})
export class PartnersModule {}
