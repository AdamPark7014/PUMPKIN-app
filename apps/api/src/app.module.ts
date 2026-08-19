import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import {
  PrismaModule,
  CommonModule,
  TenantModule,
  AuthModule, 
  DiscoveryModule, 
  InventoryModule, 
  PricingModule, 
  OrdersModule, 
  PaymentModule, 
  ResaleModule, 
  FraudModule, 
  AnalyticsModule, 
  AdminModule,
  NotificationModule,
  AccessModule,
  SeatMapping3DModule,
  EventManagementModule,
  EventSchedulingModule,
  ChannelManagementModule,
  TaquillaPosModule,
  LayoutManagementModule,
  SearchModule,
  ReportingModule,
  CampaignExecutionModule,
  VenueLayoutModule,
  OrganizationModule,
  WaitlistModule,
  TicketTransferModule,
  PartnersModule,
  BillingModule,
  SeasonModule,
} from './modules';
import { MetricsModule } from './modules/metrics/metrics.module';
import { AiEngineModule } from './modules/ai-engine/ai-engine.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    // Config
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        '.env.local',
        '.env',
        '../../.env',
      ],
    }),
    ThrottlerModule.forRoot([
      {
        // Límite global por IP. En la sede TODOS los dispositivos (cajeros,
        // admins, escáneres) salen por una sola IP pública y el admin hace
        // ~15 peticiones por pantalla: 120/min se agotaba en minutos. Las
        // rutas sensibles a fuerza bruta (login, PIN) llevan su propio
        // @Throttle más estricto.
        ttl: 60_000,
        limit: Number(process.env.THROTTLE_LIMIT_PER_MIN) || 1200,
      },
    ]),

  CommonModule,
    TenantModule,
    PrismaModule,
    BullModule.forRoot({
      redis: process.env.REDIS_URL || 'redis://localhost:6379',
    }),
    
    // Core Modules
    AuthModule,
    DiscoveryModule,
    InventoryModule,
    PricingModule,
    OrdersModule,
    PaymentModule,
    ResaleModule,
    FraudModule,
    AnalyticsModule,
    AdminModule,
    NotificationModule,
    AccessModule,
    SeatMapping3DModule,
    EventManagementModule,
    EventSchedulingModule,
    ChannelManagementModule,
    TaquillaPosModule,
    LayoutManagementModule,
    SearchModule,
    ReportingModule,
    CampaignExecutionModule,
    VenueLayoutModule,
    OrganizationModule,
    WaitlistModule,
    TicketTransferModule,
    PartnersModule,
    BillingModule,
    SeasonModule,
    MetricsModule,
    AiEngineModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
  exports: [AppService],
})
export class AppModule {}


