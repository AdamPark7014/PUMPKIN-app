import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EventManagementController } from './event-management.controller';
import { EventManagementService } from './event-management.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [EventManagementController],
  providers: [EventManagementService],
  exports: [EventManagementService],
})
export class EventManagementModule {}
