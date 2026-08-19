import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgAccessGuard } from '../auth/org-access.guard';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminService } from './admin.service';
import {
  AdminPagedQueryDto,
  AdminSalesReportQueryDto,
  AdminScopeQueryDto,
  CancelOrderDto,
  CompletePayoutDto,
  CreateVenueDto,
  OrderIdParamDto,
  PayoutIdParamDto,
  ProcessPayoutDto,
  RefundOrderDto,
  SuggestLayoutDto,
  UpdateBrandingDto,
} from './dto/admin.dto';

type AuthedRequest = { user: AuthenticatedUser };

@ApiTags('Admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('dashboard')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @Permissions('analytics:read')
  @ApiOperation({ summary: 'Tenant operations dashboard KPIs' })
  dashboard(@Query() query: AdminScopeQueryDto) {
    return this.admin.dashboard(query.organizationId);
  }

  @Get('platform/overview')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @Permissions('analytics:read')
  @ApiOperation({ summary: 'Platform overview for the tenant admin home' })
  platformOverview(@Query() query: AdminScopeQueryDto) {
    return this.admin.platformOverview(query.organizationId);
  }

  @Get('orders')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @Permissions('order:read')
  @ApiOperation({ summary: 'Paginated tenant order list' })
  orders(@Query() query: AdminPagedQueryDto) {
    return this.admin.listOrders(query.organizationId, query);
  }

  @Get('orders/:id')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @Permissions('order:read')
  @ApiOperation({ summary: 'Order detail scoped to the tenant' })
  orderDetail(
    @Query() query: AdminScopeQueryDto,
    @Param() params: OrderIdParamDto,
  ) {
    return this.admin.getOrder(query.organizationId, params.id);
  }

  @Post('orders/:id/refund')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  // PROMOTER lacks `payment:refund` in the auth permission map; role gate kept for contract.
  @ApiOperation({ summary: 'Request a refund for a tenant order' })
  refundOrder(
    @Request() req: AuthedRequest,
    @Query() query: AdminScopeQueryDto,
    @Param() params: OrderIdParamDto,
    @Body() body: RefundOrderDto,
  ) {
    return this.admin.requestRefund(
      query.organizationId,
      params.id,
      body,
      req.user.email || req.user.sub || 'staff',
    );
  }

  @Post('orders/:id/resend-email')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  // PROMOTER / VENUE_MANAGER lack `order:write` in the auth permission map.
  @ApiOperation({ summary: 'Re-queue order confirmation and ticket PDF emails' })
  resendEmail(
    @Query() query: AdminScopeQueryDto,
    @Param() params: OrderIdParamDto,
  ) {
    return this.admin.resendOrderEmail(query.organizationId, params.id);
  }

  @Post('orders/:id/cancel')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  // PROMOTER lacks `order:write` in the auth permission map.
  @ApiOperation({ summary: 'Cancel a non-completed tenant order' })
  cancelOrder(
    @Query() query: AdminScopeQueryDto,
    @Param() params: OrderIdParamDto,
    @Body() body: CancelOrderDto,
  ) {
    return this.admin.cancelOrderForOrg(query.organizationId, params.id, body);
  }

  @Get('payouts')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @Permissions('payment:read')
  @ApiOperation({ summary: 'Channel totals and promoter payouts for the tenant' })
  payouts(@Query() query: AdminPagedQueryDto) {
    return this.admin.listPayouts(query.organizationId, query);
  }

  @Post('payouts/:payoutId/process')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Permissions('payment:refund')
  @ApiOperation({ summary: 'Mark a promoter payout as PROCESSING' })
  processPayout(
    @Query() query: AdminScopeQueryDto,
    @Param() params: PayoutIdParamDto,
    @Body() body: ProcessPayoutDto,
  ) {
    return this.admin.markPayoutProcessing(
      query.organizationId,
      params.payoutId,
      body,
    );
  }

  @Post('payouts/:payoutId/complete')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Permissions('payment:refund')
  @ApiOperation({ summary: 'Mark a promoter payout COMPLETED after SPEI' })
  completePayout(
    @Query() query: AdminScopeQueryDto,
    @Param() params: PayoutIdParamDto,
    @Body() body: CompletePayoutDto,
  ) {
    return this.admin.markPayoutCompleted(
      query.organizationId,
      params.payoutId,
      body,
    );
  }

  @Get('events')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @Permissions('event:read')
  @ApiOperation({ summary: 'Paginated tenant event catalog' })
  events(@Query() query: AdminPagedQueryDto) {
    return this.admin.listEvents(query.organizationId, query);
  }

  @Get('venues')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @Permissions('venue:manage')
  @ApiOperation({ summary: 'Paginated tenant venues' })
  venues(@Query() query: AdminPagedQueryDto) {
    return this.admin.listVenues(query.organizationId, query);
  }

  @Post('venues')
  @Roles('ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER', 'PROMOTER')
  @Permissions('venue:manage')
  @ApiOperation({ summary: 'Create a venue with an empty active layout' })
  createVenue(
    @Query() query: AdminScopeQueryDto,
    @Body() body: CreateVenueDto,
  ) {
    return this.admin.createVenue(query.organizationId, body);
  }

  @Get('branding')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Permissions('tenant:manage')
  @ApiOperation({ summary: 'Tenant theme / branding' })
  getBranding(@Query() query: AdminScopeQueryDto) {
    return this.admin.getTheme(query.organizationId);
  }

  @Post('branding')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Permissions('tenant:manage')
  @ApiOperation({ summary: 'Upsert tenant theme / branding' })
  brandingPost(
    @Query() query: AdminScopeQueryDto,
    @Body() body: UpdateBrandingDto,
  ) {
    return this.admin.updateTheme(query.organizationId, body);
  }

  @Put('branding')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Permissions('tenant:manage')
  @ApiOperation({ summary: 'Upsert tenant theme / branding' })
  brandingPut(
    @Query() query: AdminScopeQueryDto,
    @Body() body: UpdateBrandingDto,
  ) {
    return this.admin.updateTheme(query.organizationId, body);
  }

  @Get('reports/sales')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @Permissions('analytics:read')
  @ApiOperation({ summary: 'Sales totals grouped by channel' })
  sales(@Query() query: AdminSalesReportQueryDto, @Request() req: AuthedRequest) {
    return this.admin.salesReport(query.organizationId, query, { role: req.user?.role });
  }

  @Post('venues/suggest-layout')
  @Roles('ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @Permissions('venue:manage')
  @ApiOperation({ summary: 'Heuristic layout suggestion for a tenant venue' })
  suggestLayout(
    @Query() query: AdminScopeQueryDto,
    @Body() body: SuggestLayoutDto,
  ) {
    return this.admin.suggestLayoutFromPlan(query.organizationId, body);
  }
}
