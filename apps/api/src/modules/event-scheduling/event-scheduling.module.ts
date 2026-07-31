import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EventSchedulingController } from './event-scheduling.controller';
import { EventSchedulingService } from './event-scheduling.service';
import { SaleWindowService } from './sale-window.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [EventSchedulingController],
  providers: [EventSchedulingService, SaleWindowService],
  exports: [EventSchedulingService, SaleWindowService],
})
export class EventSchedulingModule {}
