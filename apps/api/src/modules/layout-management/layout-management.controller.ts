import { Controller, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { LayoutManagementService } from './layout-management.service';

export type CreateLayoutDto = {
  name: string;
  totalCapacity: number;
  sections: Array<{
    sectionId: string;
    name: string;
    capacity: number;
    type?: string;
    rows?: number;
    seatsPerRow?: number;
  }>;
};

export type HoldSeatsDto = {
  eventId: string;
  seatIds: string[];
  durationMinutes?: number;
  sessionId?: string;
};

@ApiTags('Layout Management')
@Controller('layouts')
export class LayoutManagementController {
  constructor(private layoutService: LayoutManagementService) {}

  @Post('venue/:venueId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER', 'PROMOTER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create venue layout with sections' })
  async createLayout(
    @Param('venueId') venueId: string,
    @CurrentUser('organizationId') orgId: string,
    @Body() data: CreateLayoutDto,
  ) {
    return await this.layoutService.createVenueLayout(venueId, data, orgId);
  }

  @Post(':layoutId/sightlines')
  @ApiOperation({ summary: 'Calculate sightline scores' })
  async calculateSightlines(@Param('layoutId') layoutId: string) {
    return await this.layoutService.calculateSightlineScores(layoutId);
  }

  @Post(':layoutId/seats/hold')
  @ApiOperation({ summary: 'Hold seats' })
  async holdSeats(@Param('layoutId') layoutId: string, @Body() data: HoldSeatsDto) {
    return await this.layoutService.holdSeats(
      layoutId,
      data.eventId,
      data.seatIds,
      data.durationMinutes,
      data.sessionId,
    );
  }

  @Post(':layoutId/seats/release')
  @ApiOperation({ summary: 'Release seats' })
  async releaseSeats(@Param('layoutId') _layoutId: string, @Body() data: { seatIds: string[] }) {
    return await this.layoutService.releaseSeats(data.seatIds);
  }
}


