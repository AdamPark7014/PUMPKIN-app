import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { TicketTransferController } from './ticket-transfer.controller';
import { TicketTransferService } from './ticket-transfer.service';

@Module({
  imports: [PrismaModule, NotificationModule, AuthModule],
  controllers: [TicketTransferController],
  providers: [TicketTransferService],
  exports: [TicketTransferService],
})
export class TicketTransferModule {}
