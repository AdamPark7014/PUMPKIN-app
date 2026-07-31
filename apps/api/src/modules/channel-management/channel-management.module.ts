import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ChannelManagementController } from './channel-management.controller';
import { ChannelManagementService } from './channel-management.service';
import { ChannelQuotaService } from './channel-quota.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ChannelManagementController],
  providers: [ChannelManagementService, ChannelQuotaService],
  exports: [ChannelManagementService, ChannelQuotaService],
})
export class ChannelManagementModule {}
