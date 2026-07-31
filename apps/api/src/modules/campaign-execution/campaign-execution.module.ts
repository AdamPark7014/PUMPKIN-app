import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CampaignExecutionController } from './campaign-execution.controller';
import { CampaignExecutionService } from './campaign-execution.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CampaignExecutionController],
  providers: [CampaignExecutionService],
  exports: [CampaignExecutionService],
})
export class CampaignExecutionModule {}
