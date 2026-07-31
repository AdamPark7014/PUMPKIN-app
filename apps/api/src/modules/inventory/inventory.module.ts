import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChannelManagementModule } from '../channel-management/channel-management.module';
import { EventSchedulingModule } from '../event-scheduling/event-scheduling.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  imports: [AuthModule, ChannelManagementModule, WaitlistModule, EventSchedulingModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
