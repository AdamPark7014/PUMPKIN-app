import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChannelManagementModule } from '../channel-management/channel-management.module';
import { VenueLayoutService } from './venue-layout.service';
import { VenueLayoutController, EventPublishController } from './venue-layout.controller';

@Module({
  imports: [PrismaModule, ChannelManagementModule],
  controllers: [VenueLayoutController, EventPublishController],
  providers: [VenueLayoutService],
  exports: [VenueLayoutService],
})
export class VenueLayoutModule {}


