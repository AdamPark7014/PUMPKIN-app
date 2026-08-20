import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Headers,
  Query,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { BanorteReconciliationService } from './banorte-reconciliation.service';
import {
  CompleteManualRefundDto,
  ConfirmPaymentDto,
  CreatePaymentIntentDto,
  CreateRefundDto,
  OrderIdParamDto,
  RefundIdParamDto,
} from './payment.dto';
import { PaymentService } from './payment.service';

@ApiTags('Payments')
@Controller('payments')
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly reconciliation: BanorteReconciliationService,
  ) {}

  @Get('config')
  @ApiOperation({ summary: 'Public payment config (Banorte direct)' })
  getConfig() {
    return this.paymentService.getPublicPaymentConfig();
  }

  @Get('config/validate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @Permissions('payment:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Validate Banorte production credentials' })
  validateConfig() {
    return this.paymentService.validateBanorteSetup();
  }

  @Post('intents')
  @ApiOperation({ summary: 'Create Banorte payment (Payworks / SPEI / OXXO)' })
  async createIntent(
    @Body() dto: CreatePaymentIntentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.paymentService.createPaymentIntent({
      ...dto,
      idempotencyKey: dto.idempotencyKey ?? idempotencyKey,
    });
  }

  @Post('confirm')
  @ApiOperation({ summary: 'Confirm Banorte payment (demo / return URL)' })
  async confirmPayment(@Body() dto: ConfirmPaymentDto) {
    return this.paymentService.confirmBanortePayment(dto);
  }

  @Post(':orderId/refunds')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request refund via payment gateway of the order (audited, tenant-scoped)' })
  async createRefund(
    @Param() params: OrderIdParamDto,
    @Body() dto: CreateRefundDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.paymentService.createRefund({
      orderId: params.orderId,
      ...dto,
      requestedBy: user?.email || user?.sub || 'staff',
      idempotencyKey: dto.idempotencyKey ?? idempotencyKey,
    });
  }

  @Post('refunds/:refundId/complete')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Mark pending Banorte-portal refund as completed and release inventory',
  })
  async completeManualRefund(
    @Param() params: RefundIdParamDto,
    @Body() dto: CompleteManualRefundDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentService.completeManualRefund(
      params.refundId,
      user?.email || user?.sub || 'admin',
      dto.banorteReference,
    );
  }

  @Post('webhooks/mercadopago')
  @ApiOperation({ summary: 'Mercado Pago webhook (payment notifications)' })
  async handleMercadoPagoWebhook(
    @Body() body: Record<string, unknown>,
    @Query() query: Record<string, string | undefined>,
    @Headers('x-signature') xSignature?: string,
    @Headers('x-request-id') xRequestId?: string,
  ) {
    return this.paymentService.handleMercadoPagoWebhook({
      body,
      query,
      headers: { 'x-signature': xSignature, 'x-request-id': xRequestId },
    });
  }

  @Post('webhooks/banorte')
  @ApiOperation({ summary: 'Banorte IPN / Payworks webhook' })
  async handleBanorteWebhook(
    @Body() body: Record<string, unknown>,
    @Headers('x-banorte-signature') sig?: string,
    @Headers('x-signature') sigAlt?: string,
  ) {
    return this.paymentService.handleBanorteWebhook(body, sig || sigAlt);
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
  async payworksReturn(
    @Query('orderId') orderId?: string,
    @Query('result') result?: string,
  ) {
    if (result === 'ok' && orderId) {
      const cfg = await import('@boletera/payments').then((m) => m.getBanorteConfig());
      if (cfg.isDemo) {
        await this.paymentService.completeOrder(orderId, `banorte_return_${Date.now()}`);
      }
    }
    return { ok: result === 'ok', orderId: orderId ?? null };
  }
}
