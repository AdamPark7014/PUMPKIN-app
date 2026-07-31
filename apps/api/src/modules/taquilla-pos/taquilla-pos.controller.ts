import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgAccessGuard } from '../auth/org-access.guard';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  AnalyticsParamsDto,
  CashDropDto,
  CreateHoldDto,
  EndSessionDto,
  ExchangeDto,
  HandoffDto,
  InitTerminalDto,
  ManagerPinDto,
  OrderIdParamDto,
  ProcessPaymentDto,
  QuickCheckoutDto,
  ReceiptQueryDto,
  ReleaseHoldsDto,
  ScanBarcodeDto,
  SessionSummaryQueryDto,
  StartSessionDto,
  SyncInventoryDto,
  SyncOfflineDto,
  TerminalIdParamDto,
  VerifyPinDto,
  VoidOrderDto,
  WillcallFulfillDto,
  WillcallLookupDto,
  ZReportsQueryDto,
} from './taquilla-pos.dto';
import { TaquillaPosService } from './taquilla-pos.service';

const POS_STAFF = ['TAQUILLA', 'ADMIN', 'SUPER_ADMIN'] as const;
const POS_READERS = ['TAQUILLA', 'PROMOTER', 'ADMIN', 'SUPER_ADMIN'] as const;
const POS_MANAGERS = ['VENUE_MANAGER', 'PROMOTER', 'ADMIN', 'SUPER_ADMIN'] as const;

@ApiTags('Taquilla / POS')
@ApiBearerAuth()
@Controller('taquilla')
@UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
@Roles(...POS_STAFF)
export class TaquillaPosController {
  constructor(private readonly posService: TaquillaPosService) {}

  @Post('terminal/init')
  @Roles(...POS_STAFF, 'VENUE_MANAGER', 'PROMOTER')
  @ApiOperation({ summary: 'Initialize POS terminal' })
  initTerminal(@Body() data: InitTerminalDto) {
    return this.posService.initializeTerminal(data);
  }

  @Post('session/start')
  @Permissions('order:write')
  @ApiOperation({ summary: 'Start cashier session with opening cash float' })
  startSession(@Body() data: StartSessionDto) {
    return this.posService.startCashierSession(
      data.terminalId,
      data.cashierId,
      data.openingCash ?? 0,
    );
  }

  @Post('holds')
  @Permissions('order:write')
  @ApiOperation({ summary: 'Create taquilla holds (seats or GA) with short TTL' })
  createHold(@Body() data: CreateHoldDto) {
    return this.posService.createPosHold(data);
  }

  @Post('holds/release')
  @Permissions('order:write')
  @ApiOperation({ summary: 'Release active holds' })
  releaseHolds(@Body() data: ReleaseHoldsDto) {
    return this.posService.releaseHolds(data.holdIds);
  }

  @Post('checkout')
  @Permissions('order:write')
  @ApiOperation({ summary: 'Checkout at box office (GA or reserved seats)' })
  quickCheckout(@Body() data: QuickCheckoutDto) {
    return this.posService.quickCheckout(
      data.terminalId,
      data.sessionId,
      data.checkoutData,
    );
  }

  @Post('terminal/init-org')
  @Roles(...POS_STAFF, 'VENUE_MANAGER', 'PROMOTER')
  @ApiOperation({ summary: 'Initialize POS terminal for organization' })
  initTerminalOrg(@Body() data: InitTerminalDto) {
    return this.posService.initializeTerminal(data);
  }

  @Post('payment')
  @Permissions('order:write')
  @ApiOperation({
    summary: 'Legacy payment status — prefer checkout',
    deprecated: true,
  })
  processPayment(@Body() data: ProcessPaymentDto) {
    return this.posService.processPayment(data.orderId, data.paymentData);
  }

  @Get('receipt/:orderId')
  @Roles(...POS_READERS)
  @Permissions('order:read')
  @ApiOperation({ summary: 'Generate receipt' })
  generateReceipt(
    @Param() params: OrderIdParamDto,
    @Query() query: ReceiptQueryDto,
  ) {
    return this.posService.generateReceipt(
      params.orderId,
      query.terminalId ?? 'terminal',
    );
  }

  @Post('scan')
  @Roles('TAQUILLA', 'VENUE_MANAGER', 'ADMIN', 'SUPER_ADMIN', 'SCANNER')
  @ApiOperation({ summary: 'Scan ticket barcode or order publicId' })
  scanBarcode(@Body() data: ScanBarcodeDto) {
    return this.posService.scanBarcode(data.terminalId, data.barcode);
  }

  @Post('void')
  @Permissions('order:write')
  @ApiOperation({ summary: 'Void a taquilla sale (requires manager PIN)' })
  voidOrder(@Body() data: VoidOrderDto) {
    return this.posService.voidOrder(data);
  }

  @Post('willcall/lookup')
  @Roles(...POS_READERS)
  @Permissions('order:read')
  @ApiOperation({ summary: 'Lookup orders for will-call pickup' })
  willcallLookup(@Body() data: WillcallLookupDto) {
    return this.posService.willcallLookup(data.q, data.organizationId);
  }

  @Post('willcall/fulfill')
  @Permissions('order:write')
  @ApiOperation({ summary: 'Mark will-call order as picked up' })
  willcallFulfill(@Body() data: WillcallFulfillDto) {
    return this.posService.willcallFulfill(
      data.orderId,
      data.cashierId,
      data.terminalId,
    );
  }

  @Post('exchange')
  @Permissions('order:write')
  @ApiOperation({ summary: 'Exchange / upgrade seats (void + new sale)' })
  exchange(@Body() data: ExchangeDto) {
    return this.posService.exchange(data);
  }

  @Post('session/cash-drop')
  @Permissions('order:write')
  @ApiOperation({ summary: 'Record mid-shift cash drawer drop' })
  cashDrop(@Body() data: CashDropDto) {
    return this.posService.addCashDrop(
      data.sessionId,
      data.amount,
      data.cashierId,
      data.note,
    );
  }

  @Post('session/handoff')
  @Permissions('order:write')
  @ApiOperation({ summary: 'Close current shift and open for another cashier' })
  handoff(@Body() data: HandoffDto) {
    return this.posService.handoff(data);
  }

  @Post('manager-pin')
  @Roles(...POS_MANAGERS)
  @ApiOperation({ summary: 'Set organization manager PIN' })
  setManagerPin(@Body() data: ManagerPinDto) {
    return this.posService.setManagerPin(
      data.organizationId,
      data.pin,
      data.currentPin,
    );
  }

  @Post('manager-pin/verify')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Roles(...POS_STAFF, 'VENUE_MANAGER', 'PROMOTER')
  @ApiOperation({ summary: 'Verify manager PIN' })
  verifyPin(@Body() data: VerifyPinDto) {
    return this.posService.verifyManagerPin(data.organizationId, data.pin);
  }

  @Get('z-reports')
  @Roles(...POS_READERS)
  @Permissions('order:read')
  @ApiOperation({ summary: 'List archived Z-reports for organization' })
  zReports(@Query() query: ZReportsQueryDto) {
    return this.posService.listZReports(
      query.organizationId,
      query.take,
      query.skip,
    );
  }

  @Post('sync-inventory')
  @Roles(...POS_READERS)
  @Permissions('order:read')
  @ApiOperation({ summary: 'Sync inventory with terminal' })
  syncInventory(@Body() data: SyncInventoryDto) {
    return this.posService.syncInventory(data.terminalId, data.eventId);
  }

  @Post('offline/enable/:terminalId')
  @Permissions('order:write')
  @ApiOperation({ summary: 'Enable offline mode' })
  enableOffline(@Param() params: TerminalIdParamDto) {
    return this.posService.enableOfflineMode(params.terminalId);
  }

  @Post('offline/sync/:terminalId')
  @Permissions('order:write')
  @ApiOperation({ summary: 'Sync offline transactions' })
  syncOffline(
    @Param() params: TerminalIdParamDto,
    @Body() data: SyncOfflineDto,
  ) {
    return this.posService.syncOfflineTransactions(
      params.terminalId,
      data.transactions,
    );
  }

  @Post('session/end')
  @Permissions('order:write')
  @ApiOperation({ summary: 'End cashier session with cash count (Z-report)' })
  endSession(@Body() data: EndSessionDto) {
    return this.posService.endCashierSession(
      data.sessionId,
      data.cashierId,
      data.closingCashCounted,
      data.managerPin,
    );
  }

  @Get('session/summary')
  @Roles(...POS_READERS)
  @Permissions('order:read')
  @ApiOperation({ summary: 'Live shift summary for open session' })
  sessionSummary(@Query() query: SessionSummaryQueryDto) {
    return this.posService.getSessionSummary(query.sessionId);
  }

  @Get('analytics/:terminalId/:period')
  @Roles(...POS_READERS)
  @Permissions('order:read')
  @ApiOperation({ summary: 'Terminal analytics' })
  getAnalytics(@Param() params: AnalyticsParamsDto) {
    return this.posService.getTerminalAnalytics(params.terminalId, params.period);
  }
}
