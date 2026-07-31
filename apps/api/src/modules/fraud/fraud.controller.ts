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
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { FraudService } from './fraud.service';
import {
  AmlCheckDto,
  AnalyzeFraudDto,
  CreateFlagDto,
  FlagIdParamDto,
  FlagResolutionStatus,
  KycCheckDto,
  ListFlagsQueryDto,
  OrganizationIdParamDto,
  ResolveFlagDto,
  UserIdParamDto,
} from './fraud.dto';

@ApiTags('Fraud')
@Controller('fraud')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class FraudController {
  constructor(private readonly fraudService: FraudService) {}

  @Post('analyze')
  @Roles('TAQUILLA', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('order:write')
  @ApiOperation({ summary: 'Analyze a transaction for fraud' })
  analyzeFraud(@Body() dto: AnalyzeFraudDto) {
    return this.fraudService.analyzeFraud(dto);
  }

  @Post('flags')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Permissions('audit:read')
  @ApiOperation({ summary: 'Create a fraud flag' })
  createFlag(@Body() dto: CreateFlagDto) {
    return this.fraudService.createFlag({
      type: dto.type,
      severity: dto.severity,
      score: dto.score ?? 0,
      reason: dto.reason,
      orderId: dto.orderId,
      userId: dto.userId,
      eventId: dto.eventId,
      ticketId: dto.ticketId,
      ipAddress: dto.ipAddress,
      deviceFingerprint: dto.deviceFingerprint,
      metadata: dto.metadata,
    });
  }

  @Get('flags')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Permissions('audit:read')
  @ApiOperation({ summary: 'List fraud flags for the authenticated tenant' })
  listFlags(@Query() query: ListFlagsQueryDto) {
    return this.fraudService.listFlags({
      severity: query.severity,
      status: query.status,
      type: query.type,
      eventId: query.eventId,
      from: query.from,
      to: query.to,
      cursor: query.cursor,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Post('flags/:flagId/resolve')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Permissions('audit:read')
  @ApiOperation({ summary: 'Resolve a fraud flag' })
  resolveFlag(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: FlagIdParamDto,
    @Body() body: ResolveFlagDto,
  ) {
    return this.fraudService.resolveFlag(
      params.flagId,
      body.resolution,
      user.sub,
      body.status ?? FlagResolutionStatus.RESOLVED,
    );
  }

  @Post('kyc/:userId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Permissions('tenant:manage')
  @ApiOperation({ summary: 'Run a KYC consistency check for a user' })
  performKYC(@Param() params: UserIdParamDto, @Body() dto: KycCheckDto) {
    return this.fraudService.performKYCCheck(params.userId, dto);
  }

  @Post('aml/:organizationId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Permissions('tenant:manage')
  @ApiOperation({ summary: 'Run an AML denylist check for an organization' })
  performAML(@Param() params: OrganizationIdParamDto, @Body() dto: AmlCheckDto) {
    return this.fraudService.performAMLCheck(params.organizationId, dto);
  }
}
