import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsIn, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgAccessGuard } from '../auth/org-access.guard';

class SettlementBodyDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;
}

class PeriodQueryDto {
  @IsOptional()
  @IsIn(['DAY', 'WEEK', 'MONTH'])
  period?: 'DAY' | 'WEEK' | 'MONTH';
}

type AuthedRequest = {
  user: {
    organizationId?: string | null;
    role?: string;
  };
};

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
@Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('events/:eventId/dashboard')
  @ApiOperation({ summary: 'Dashboard analitico de un evento (scoped por org del JWT)' })
  async getEventDashboard(
    @Request() req: AuthedRequest,
    @Param('eventId') eventId: string,
    @Query('organizationId') organizationId?: string,
  ) {
    const orgId =
      req.user.role === 'SUPER_ADMIN' || req.user.role === 'ADMIN'
        ? organizationId ?? req.user.organizationId
        : req.user.organizationId;
    if (!orgId) {
      throw new BadRequestException('organizationId requerido');
    }
    this.analyticsService.assertOrgAccess(
      req.user.organizationId,
      orgId,
      req.user.role,
    );
    return this.analyticsService.getEventDashboard(eventId, orgId);
  }

  @Get('promoters/:organizationId/dashboard')
  @ApiOperation({ summary: 'Dashboard del promotor / organizacion' })
  async getPromoterDashboard(
    @Request() req: AuthedRequest,
    @Param('organizationId') organizationId: string,
    @Query() query: PeriodQueryDto,
  ) {
    this.analyticsService.assertOrgAccess(
      req.user.organizationId,
      organizationId,
      req.user.role,
    );
    return this.analyticsService.getPromoterDashboard(organizationId, query.period);
  }

  @Post('promoters/:organizationId/settlement')
  @ApiOperation({ summary: 'Generar reporte de liquidacion mensual' })
  async generateSettlement(
    @Request() req: AuthedRequest,
    @Param('organizationId') organizationId: string,
    @Body() body: SettlementBodyDto,
  ) {
    this.analyticsService.assertOrgAccess(
      req.user.organizationId,
      organizationId,
      req.user.role,
    );
    return this.analyticsService.generateSettlementReport(
      organizationId,
      body.month,
      body.year,
    );
  }

  @Get('promoters/:organizationId/customers')
  @ApiOperation({ summary: 'Analitica de clientes' })
  async getCustomerAnalytics(
    @Request() req: AuthedRequest,
    @Param('organizationId') organizationId: string,
  ) {
    this.analyticsService.assertOrgAccess(
      req.user.organizationId,
      organizationId,
      req.user.role,
    );
    return this.analyticsService.getCustomerAnalytics(organizationId);
  }

  @Get('promoters/:organizationId/fraud')
  @ApiOperation({ summary: 'Analitica de fraude' })
  async getFraudAnalytics(
    @Request() req: AuthedRequest,
    @Param('organizationId') organizationId: string,
  ) {
    this.analyticsService.assertOrgAccess(
      req.user.organizationId,
      organizationId,
      req.user.role,
    );
    return this.analyticsService.getFraudAnalytics(organizationId);
  }
}
