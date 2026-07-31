import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { CampaignExecutionModule } from '../campaign-execution/campaign-execution.module';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BanorteReconciliationService } from './banorte-reconciliation.service';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuthModule,
    NotificationModule,
    CampaignExecutionModule,
  ],
  controllers: [PaymentController],
  providers: [PaymentService, BanorteReconciliationService],
  exports: [PaymentService, BanorteReconciliationService],
})
export class PaymentModule {}
