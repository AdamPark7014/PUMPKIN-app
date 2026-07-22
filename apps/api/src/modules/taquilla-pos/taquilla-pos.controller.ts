import { Controller, Post, Get, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgAccessGuard } from '../auth/org-access.guard';
import { TaquillaPosService } from './taquilla-pos.service';
import type { InitTerminalDto, ProcessPaymentDto, SyncOfflineDto } from './taquilla-pos.dto';

@ApiTags('Taquilla / POS')
@ApiBearerAuth()
@Controller('taquilla')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('TAQUILLA', 'VENUE_MANAGER', 'PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'SCANNER')
export class TaquillaPosController {
  constructor(private posService: TaquillaPosService) {}

  @Post('terminal/init')
  @ApiOperation({ summary: 'Initialize POS terminal' })
  async initTerminal(@Body() data: InitTerminalDto) {
    return await this.posService.initializeTerminal(data);
  }

  @Post('session/start')
  @ApiOperation({ summary: 'Start cashier session' })
  async startSession(@Body() data: { terminalId: string; cashierId: string }) {
    return await this.posService.startCashierSession(data.terminalId, data.cashierId);
  }

  @Post('checkout')
  @ApiOperation({ summary: 'Quick checkout at box office' })
  async quickCheckout(
    @Body()
    data: {
      terminalId: string;
      sessionId: string;
      checkoutData: {
        eventId: string;
        offerId: string;
        quantity: number;
        paymentMethod: 'CASH' | 'CARD' | 'CHECK';
        discountCode?: string;
        cashierId?: string;
      };
    },
  ) {
    return await this.posService.quickCheckout(data.terminalId, data.sessionId, data.checkoutData);
  }

  @Post('terminal/init-org')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Initialize POS terminal for organization' })
  async initTerminalOrg(
    @Body()
    data: {
      organizationId: string;
      locationName: string;
      terminalName: string;
      hardwareConfig?: Record<string, string>;
    },
  ) {
    return await this.posService.initializeTerminal(data);
  }

  @Post('payment')
  @ApiOperation({ summary: 'Process payment' })
  async processPayment(@Body() data: ProcessPaymentDto) {
    return await this.posService.processPayment(data.orderId, data.paymentData);
  }

  @Get('receipt/:orderId')
  @ApiOperation({ summary: 'Generate receipt' })
  async generateReceipt(
    @Param('orderId') orderId: string,
    @Query('terminalId') terminalId: string,
  ) {
    return await this.posService.generateReceipt(orderId, terminalId ?? 'terminal');
  }

  @Post('scan')
  @ApiOperation({ summary: 'Scan ticket barcode' })
  async scanBarcode(@Body() data: { terminalId: string; barcode: string }) {
    return await this.posService.scanBarcode(data.terminalId, data.barcode);
  }

  @Post('sync-inventory')
  @ApiOperation({ summary: 'Sync inventory with terminal' })
  async syncInventory(@Body() data: { terminalId: string; eventId: string }) {
    return await this.posService.syncInventory(data.terminalId, data.eventId);
  }

  @Post('offline/enable/:terminalId')
  @ApiOperation({ summary: 'Enable offline mode' })
  async enableOffline(@Param('terminalId') terminalId: string) {
    return await this.posService.enableOfflineMode(terminalId);
  }

  @Post('offline/sync/:terminalId')
  @ApiOperation({ summary: 'Sync offline transactions' })
  async syncOffline(
    @Param('terminalId') terminalId: string,
    @Body() data: SyncOfflineDto,
  ) {
    return await this.posService.syncOfflineTransactions(terminalId, data.transactions);
  }

  @Post('session/end')
  @ApiOperation({ summary: 'End cashier session with report' })
  async endSession(@Body() data: { sessionId: string; cashierId: string }) {
    return await this.posService.endCashierSession(data.sessionId, data.cashierId);
  }

  @Get('session/summary')
  @ApiOperation({ summary: 'Live shift summary for open session' })
  async sessionSummary(@Query('sessionId') sessionId: string) {
    return await this.posService.getSessionSummary(sessionId);
  }

  @Get('analytics/:terminalId/:period')
  @ApiOperation({ summary: 'Terminal analytics' })
  async getAnalytics(
    @Param('terminalId') terminalId: string,
    @Param('period') period: 'TODAY' | 'WEEK' | 'MONTH',
  ) {
    return await this.posService.getTerminalAnalytics(terminalId, period);
  }
}
