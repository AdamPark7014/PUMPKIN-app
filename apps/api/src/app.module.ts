import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
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
  ],
  controllers: [AppController],
  providers: [AppService],
  exports: [AppService],
})
export class AppModule {}


