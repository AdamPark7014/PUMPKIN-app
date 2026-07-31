import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Permissions } from '../auth/permissions.decorator';
import {
  ApplyRecommendationsDto,
  ApproveRecommendationDto,
  CalculateCartDto,
  CalculatePriceDto,
  EventIdParamDto,
  OfferIdParamDto,
  PriceHistoryQueryDto,
  RecommendationIdParamDto,
  RejectRecommendationDto,
} from './pricing.dto';
import { PricingService } from './pricing.service';

@ApiTags('Pricing')
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  // ==================== CALCULATE PRICE ====================

  @Post('calculate')
  @ApiOperation({ summary: 'Calculate ticket price with all factors' })
  async calculatePrice(@Body() dto: CalculatePriceDto) {
    return this.pricingService.calculatePrice({
      ...dto,
      timestamp: new Date(),
    });
  }

  @Post('calculate-cart')
  @ApiOperation({ summary: 'Calculate cart total across multiple offers' })
  async calculateCart(@Body() dto: CalculateCartDto) {
    if (!dto.items?.length) {
      return {
        subtotal: '0',
        fees: '0',
        taxes: '0',
        total: '0',
        discount: '0',
        lines: [],
      };
    }

    const lines: Array<
      Awaited<ReturnType<PricingService['calculatePrice']>> & {
        offerId: string;
        quantity: number;
      }
    > = [];
    let subtotal = 0;
    let fees = 0;
    let taxes = 0;
    let total = 0;
    let discount = 0;

    for (const item of dto.items) {
      if (!item.offerId || !item.quantity) continue;
      const line = await this.pricingService.calculatePrice({
        eventId: dto.eventId,
        offerId: item.offerId,
        quantity: item.quantity,
        promotionCode: dto.promotionCode,
        customerSegment: dto.customerSegment,
        timestamp: new Date(),
      });
      lines.push({ offerId: item.offerId, quantity: item.quantity, ...line });
      subtotal += Number(line.subtotal);
      fees += Number(line.fees);
      taxes += Number(line.taxes);
      total += Number(line.total);
      discount += Number(line.discount);
    }

    return {
      subtotal: subtotal.toFixed(2),
      fees: fees.toFixed(2),
      taxes: taxes.toFixed(2),
      total: total.toFixed(2),
      discount: discount.toFixed(2),
      lines,
    };
  }

  // ==================== UPDATE DYNAMIC PRICES (compatible) ====================

  @Post('events/:eventId/update-dynamic')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('price:write')
  @ApiOperation({
    summary:
      'Generate explainable dynamic-price recommendations (auto-applies safe deltas; queues the rest for approval)',
  })
  async updateDynamicPrices(@Param() params: EventIdParamDto) {
    const result = await this.pricingService.updateDynamicPrices(params.eventId);
    return {
      message: result.message,
      applied: result.applied,
      pendingApproval: result.pendingApproval,
      held: result.held,
      summary: result.bundle.summary,
      signals: result.bundle.signals,
    };
  }

  // ==================== RECOMMENDATIONS ====================

  @Get('events/:eventId/recommendations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({
    summary: 'Explainable price recommendations (pace/occupancy/time/inventory/bands)',
  })
  async getRecommendations(@Param() params: EventIdParamDto) {
    return this.pricingService.getRecommendations(params.eventId);
  }

  @Post('events/:eventId/recommendations/preview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Preview recommendations without writing DynamicPrice rows' })
  async previewRecommendations(@Param() params: EventIdParamDto) {
    return this.pricingService.previewRecommendations(params.eventId);
  }

  @Post('events/:eventId/recommendations/apply')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('price:write')
  @ApiOperation({
    summary:
      'Apply recommendations; set confirmApproval=true to force human-approved deltas',
  })
  async applyRecommendations(
    @Param() params: EventIdParamDto,
    @Body() dto: ApplyRecommendationsDto,
  ) {
    return this.pricingService.applyRecommendations(params.eventId, dto);
  }

  @Get('events/:eventId/recommendations/pending')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'List pending price recommendations awaiting approval' })
  async listPending(@Param() params: EventIdParamDto) {
    return this.pricingService.listPendingRecommendations(params.eventId);
  }

  @Post('recommendations/:recommendationId/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('price:write')
  @ApiOperation({ summary: 'Approve a pending price recommendation (human-in-the-loop)' })
  async approve(
    @Param() params: RecommendationIdParamDto,
    @Body() dto: ApproveRecommendationDto,
  ) {
    return this.pricingService.approveRecommendation(
      params.recommendationId,
      dto.note,
    );
  }

  @Post('recommendations/:recommendationId/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('price:write')
  @ApiOperation({ summary: 'Reject a pending price recommendation' })
  async reject(
    @Param() params: RecommendationIdParamDto,
    @Body() dto: RejectRecommendationDto,
  ) {
    return this.pricingService.rejectRecommendation(
      params.recommendationId,
      dto.reason,
    );
  }

  // ==================== PRICE HISTORY ====================

  @Get('offers/:offerId/history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Get price history for offer' })
  async getPriceHistory(
    @Param() params: OfferIdParamDto,
    @Query() query: PriceHistoryQueryDto,
  ) {
    return this.pricingService.getPriceHistory(params.offerId, query.limit);
  }

  // ==================== REVENUE ESTIMATION ====================

  @Get('events/:eventId/revenue-estimate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Estimate event revenue' })
  async estimateRevenue(@Param() params: EventIdParamDto) {
    return this.pricingService.estimateEventRevenue(params.eventId);
  }
}
