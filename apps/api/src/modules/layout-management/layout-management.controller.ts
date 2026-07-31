import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  CreateVenueLayoutDto,
  HoldSeatsDto,
  ReleaseSeatsDto,
} from './layout-management.dto';
import { LayoutManagementService } from './layout-management.service';

@ApiTags('Layout Management')
@Controller('layouts')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class LayoutManagementController {
  constructor(private layoutService: LayoutManagementService) {}

  @Post('venue/:venueId')
  @Roles('ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER', 'PROMOTER')
  @Permissions('venue:manage')
  @ApiOperation({ summary: 'Create venue layout with sections' })
  createLayout(
    @Param('venueId') venueId: string,
    @CurrentUser('organizationId') orgId: string | undefined,
    @Body() data: CreateVenueLayoutDto,
  ) {
    return this.layoutService.createVenueLayout(venueId, data, orgId);
  }

  @Post(':layoutId/sightlines')
  @Roles('ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER', 'PROMOTER')
  @Permissions('venue:manage')
  @ApiOperation({ summary: 'Calculate sightline scores' })
  calculateSightlines(
    @Param('layoutId') layoutId: string,
    @CurrentUser('organizationId') orgId: string | undefined,
  ) {
    return this.layoutService.calculateSightlineScores(layoutId, orgId);
  }

  @Post(':layoutId/seats/hold')
  @Roles('ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER', 'PROMOTER', 'TAQUILLA')
  @ApiOperation({ summary: 'Hold seats' })
  holdSeats(
    @Param('layoutId') layoutId: string,
    @CurrentUser('organizationId') orgId: string | undefined,
    @Body() data: HoldSeatsDto,
  ) {
    return this.layoutService.holdSeats(
      layoutId,
      data.eventId,
      data.seatIds,
      data.durationMinutes,
      data.sessionId,
      orgId,
    );
  }

  @Post(':layoutId/seats/release')
  @Roles('ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER', 'PROMOTER', 'TAQUILLA')
  @ApiOperation({ summary: 'Release seats' })
  releaseSeats(
    @Param('layoutId') layoutId: string,
    @CurrentUser('organizationId') orgId: string | undefined,
    @Body() data: ReleaseSeatsDto,
  ) {
    return this.layoutService.releaseSeats(layoutId, data.seatIds, orgId);
  }
}
