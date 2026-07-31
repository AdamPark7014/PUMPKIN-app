import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ChannelManagementModule } from '../channel-management/channel-management.module';
import { EgressReportService } from './egress-report.service';
import { EventPublishService } from './event-publish.service';
import { LayoutAccessService } from './layout-access.service';
import { LayoutSyncService } from './layout-sync.service';
import { VenueLayoutService } from './venue-layout.service';
import { VenueLayoutController, EventPublishController } from './venue-layout.controller';

@Module({
  imports: [PrismaModule, ChannelManagementModule, AuthModule],
  controllers: [VenueLayoutController, EventPublishController],
  providers: [
    LayoutAccessService,
    LayoutSyncService,
    EgressReportService,
    EventPublishService,
    VenueLayoutService,
  ],
  exports: [VenueLayoutService, LayoutAccessService],
})
export class VenueLayoutModule {}
