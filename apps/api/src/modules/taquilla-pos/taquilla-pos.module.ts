import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersModule } from '../orders/orders.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PosAnalyticsService } from './analytics.service';
import { CheckoutService } from './checkout.service';
import { ManagerPinService } from './manager-pin.service';
import { PosAccessService } from './pos-access.service';
import { PosIdempotencyService } from './pos-idempotency.service';
import { SessionService } from './session.service';
import { TaquillaPosController } from './taquilla-pos.controller';
import { TaquillaPosService } from './taquilla-pos.service';
import { TerminalService } from './terminal.service';
import { VoidRefundService } from './void-refund.service';
import { WillcallService } from './willcall.service';

@Module({
  imports: [PrismaModule, InventoryModule, OrdersModule, AuthModule],
  controllers: [TaquillaPosController],
  providers: [
    PosAccessService,
    PosIdempotencyService,
    ManagerPinService,
    TerminalService,
    SessionService,
    CheckoutService,
    VoidRefundService,
    WillcallService,
    PosAnalyticsService,
    TaquillaPosService,
  ],
  exports: [TaquillaPosService],
})
export class TaquillaPosModule {}
