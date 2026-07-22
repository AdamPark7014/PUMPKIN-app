import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SeatMapping3DModule } from '../seat-mapping-3d/seat-mapping-3d.module';
import { VenueLayoutModule } from '../venue-layout/venue-layout.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LayoutManagementService } from './layout-management.service';
import { LayoutManagementController } from './layout-management.controller';

@Module({
  imports: [PrismaModule, SeatMapping3DModule, VenueLayoutModule, InventoryModule],
  controllers: [LayoutManagementController],
  providers: [LayoutManagementService],
  exports: [LayoutManagementService],
})
export class LayoutManagementModule {}


