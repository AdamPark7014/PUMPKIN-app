import { Controller, Post, Get, Body, Param, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FraudService } from './fraud.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@ApiTags('Fraud')
@Controller('fraud')
export class FraudController {
  constructor(private fraudService: FraudService) {}

  // ==================== ANALYZE FRAUD ====================

  @Post('analyze')
  @ApiOperation({ summary: 'Analyze transaction for fraud' })
  async analyzeFraud(
    @Body()
    dto: {
      orderId?: string;
      userId?: string;
      eventId?: string;
      ipAddress?: string;
      deviceFingerprint?: string;
      buyerEmail?: string;
      amount?: number;
      currency?: string;
      channel?: string;
      paymentMethod?: string;
    },
  ) {
    return await this.fraudService.analyzeFraud(dto);
  }

  // ==================== CREATE FLAG ====================

  @Post('flags')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create fraud flag' })
  async createFlag(
    @Body()
    dto: {
      type: string;
      severity: string;
      reason: string;
      orderId?: string;
      userId?: string;
      eventId?: string;
      ipAddress?: string;
      deviceFingerprint?: string;
      metadata?: Record<string, any>;
    },
  ) {
    return await this.fraudService.createFlag({
      ...dto,
      type: dto.type as any,
      severity: dto.severity as any,
      score: 0,
    });
  }

  // ==================== LIST FLAGS ====================

  @Get('flags')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List fraud flags' })
  async listFlags(
    @Query('severity') severity?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return await this.fraudService.listFlags({
      severity: severity as any,
      status: status as any,
      limit,
      offset,
    });
  }

  // ==================== RESOLVE FLAG ====================

  @Post('flags/:flagId/resolve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resolve fraud flag' })
  async resolveFlag(
    @Param('flagId') flagId: string,
    @Body() body: { resolution: string },
  ) {
    return await this.fraudService.resolveFlag(flagId, body.resolution, 'admin-user');
  }

  // ==================== KYC CHECK ====================

  @Post('kyc/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Perform KYC check' })
  async performKYC(
    @Param('userId') userId: string,
    @Body()
    dto: {
      fullName: string;
      dateOfBirth: string;
      address: string;
      city: string;
      country: string;
      documentNumber: string;
      documentType: string;
    },
  ) {
    return await this.fraudService.performKYCCheck(userId, dto);
  }

  // ==================== AML CHECK ====================

  @Post('aml/:organizationId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Perform AML check' })
  async performAML(
    @Param('organizationId') organizationId: string,
    @Body() dto: { name: string; country: string },
  ) {
    return await this.fraudService.performAMLCheck(organizationId, dto);
  }
}


