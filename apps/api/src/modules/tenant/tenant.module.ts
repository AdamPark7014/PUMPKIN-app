import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantController } from './tenant.controller';
import { TenantScopeService } from './tenant-scope.service';
import { TenantService } from './tenant.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TenantController],
  providers: [TenantService, TenantScopeService],
  exports: [TenantService, TenantScopeService],
})
export class TenantModule {}
