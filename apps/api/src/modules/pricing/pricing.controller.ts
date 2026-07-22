import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PricingService } from './pricing.service';

@ApiTags('Pricing')
@Controller('pricing')
export class PricingController {
  constructor(private pricingService: PricingService) {}

  // ==================== CALCULATE PRICE ====================

  @Post('calculate')
  @ApiOperation({ summary: 'Calculate ticket price with all factors' })
  async calculatePrice(
    @Body()
    dto: {
      eventId: string;
      offerId: string;
      quantity: number;
      customerSegment?: 'EARLY_BUYER' | 'REGULAR' | 'VVIP';
      promotionCode?: string;
    },
  ) {
    return await this.pricingService.calculatePrice({
      ...dto,
      timestamp: new Date(),
    });
  }

  // ==================== UPDATE DYNAMIC PRICES ====================

  @Post('events/:eventId/update-dynamic')
  @ApiOperation({ summary: 'Update dynamic prices for event' })
  async updateDynamicPrices(@Param('eventId') eventId: string) {
    await this.pricingService.updateDynamicPrices(eventId);
    return { message: 'Dynamic prices updated' };
  }

  // ==================== PRICE HISTORY ====================

  @Get('offers/:offerId/history')
  @ApiOperation({ summary: 'Get price history for offer' })
  async getPriceHistory(
    @Param('offerId') offerId: string,
    @Query('limit') limit?: number,
  ) {
    return await this.pricingService.getPriceHistory(offerId, limit);
  }

  // ==================== REVENUE ESTIMATION ====================

  @Get('events/:eventId/revenue-estimate')
  @ApiOperation({ summary: 'Estimate event revenue' })
  async estimateRevenue(@Param('eventId') eventId: string) {
    return await this.pricingService.estimateEventRevenue(eventId);
  }
}


