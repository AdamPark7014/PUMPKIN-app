import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgAccessGuard } from '../auth/org-access.guard';
import { Permissions } from '../auth/permissions.decorator';
import {
  CreateSeasonPassDto,
  ListSeasonPassesQueryDto,
  PurchaseSeasonPassDto,
} from './season.dto';
import { SeasonService } from './season.service';

@ApiTags('Season / Abonos')
@Controller('season')
export class SeasonController {
  constructor(private season: SeasonService) {}

  @Post('purchase/:seasonPassId')
  @ApiOperation({ summary: 'Purchase season pass (demo completes immediately)' })
  purchase(
    @Param('seasonPassId') seasonPassId: string,
    @Body() body: PurchaseSeasonPassDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.season.purchase(seasonPassId, body, idempotencyKey);
  }

  @Post('org/:orgId')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('event:write')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create season pass / abono' })
  create(
    @Param('orgId') orgId: string,
    @Body() body: CreateSeasonPassDto,
  ) {
    return this.season.create(orgId, body);
  }

  @Get('org/:orgId')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @Permissions('event:read')
  @ApiBearerAuth()
  list(
    @Param('orgId') orgId: string,
    @Query() query: ListSeasonPassesQueryDto,
  ) {
    return this.season.list(orgId, query);
  }
}
