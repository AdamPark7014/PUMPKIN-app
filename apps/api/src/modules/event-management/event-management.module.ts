import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EventManagementService } from './event-management.service';
import { EventManagementController } from './event-management.controller';

@Module({
  imports: [PrismaModule],
  controllers: [EventManagementController],
  providers: [EventManagementService],
  exports: [EventManagementService]
})
export class EventManagementModule {}


