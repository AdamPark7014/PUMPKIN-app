import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Headers,
  Logger,
  Query,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { BanorteReconciliationService } from './banorte-reconciliation.service';
import { PaymentService } from './payment.service';

@ApiTags('Payments')
@Controller('payments')
export class PaymentController {
  private logger = new Logger(PaymentController.name);

  constructor(
    private paymentService: PaymentService,
    private reconciliation: BanorteReconciliationService,
  ) {}

  @Get('config')
  @ApiOperation({ summary: 'Public payment config (Banorte direct)' })
  getConfig() {
    return this.paymentService.getBanortePublicConfig();
  }

  @Get('config/validate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Validate Banorte production credentials' })
  validateConfig() {
    return this.paymentService.validateBanorteSetup();
  }

  @Post('intents')
  @ApiOperation({ summary: 'Create Banorte payment (Payworks / SPEI / OXXO)' })
  async createIntent(
    @Body()
    dto: {
      orderId: string;
      amount: number;
      currency: string;
      buyerEmail: string;
      buyerName: string;
      paymentMethod?: string;
      publicId?: string;
    },
  ) {
    return await this.paymentService.createPaymentIntent(dto);
  }

  @Post('confirm')
  @ApiOperation({ summary: 'Confirm Banorte payment (demo / return URL)' })
  async confirmPayment(
    @Body()
    dto: {
      orderId: string;
      intentId?: string;
      externalId?: string;
    },
  ) {
    return await this.paymentService.confirmBanortePayment(dto);
  }

  @Post(':orderId/refunds')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request refund via Banorte (audited)' })
  async createRefund(
    @Param('orderId') orderId: string,
    @Body() dto: { reason: string; amount?: number; notes?: string },
    @CurrentUser() user: { email?: string; sub?: string; id?: string },
  ) {
    return await this.paymentService.createRefund({
      orderId,
      ...dto,
      requestedBy: user?.email || user?.sub || 'staff',
    });
  }

  @Post('refunds/:refundId/complete')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Mark pending Banorte-portal refund as completed and release inventory',
  })
  async completeManualRefund(
    @Param('refundId') refundId: string,
    @Body() dto: { banorteReference?: string },
    @CurrentUser() user: { email?: string; sub?: string },
  ) {
    return await this.paymentService.completeManualRefund(
      refundId,
      user?.email || user?.sub || 'admin',
      dto.banorteReference,
    );
  }

  @Post('webhooks/banorte')
  @ApiOperation({ summary: 'Banorte IPN / Payworks webhook' })
  async handleBanorteWebhook(
    @Body() body: Record<string, unknown>,
    @Headers('x-banorte-signature') sig: string,
    @Headers('x-signature') sigAlt: string,
  ) {
    return await this.paymentService.handleBanorteWebhook(body, sig || sigAlt);
  }

  @Post('reconcile/spei')
  @ApiOperation({ summary: 'Reconcile pending SPEI/OXXO (requires X-Internal-Secret)' })
  async reconcileSpei(@Headers('x-internal-secret') internalSecret?: string) {
    const expected = process.env.INTERNAL_API_SECRET || process.env.JWT_SECRET;
    if (!expected || internalSecret !== expected) {
      throw new UnauthorizedException('X-Internal-Secret required for reconcile');
    }
    return this.reconciliation.reconcilePendingSpei();
  }

  @Get('webhooks/banorte/return')
  @ApiOperation({ summary: 'Return URL after Payworks (redirect handler)' })
  async payworksReturn(@Query('orderId') orderId: string, @Query('result') result: string) {
    if (result === 'ok' && orderId) {
      const cfg = await import('@boletera/payments').then((m) => m.getBanorteConfig());
      if (cfg.isDemo) {
        await this.paymentService.completeOrder(orderId, `banorte_return_${Date.now()}`);
      }
    }
    return { ok: result === 'ok', orderId };
  }
}
