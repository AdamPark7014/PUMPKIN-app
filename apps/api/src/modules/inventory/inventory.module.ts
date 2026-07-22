import { Module } from '@nestjs/common';
import { ChannelManagementModule } from '../channel-management/channel-management.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  imports: [ChannelManagementModule, WaitlistModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}


