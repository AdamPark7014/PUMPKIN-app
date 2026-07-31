import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SalesChannel } from '@prisma/client';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  CreateBestAvailableHoldDto,
  CreateHoldDto,
  EventIdParamDto,
  HoldIdParamDto,
  ReleaseHoldQueryDto,
} from './inventory.dto';
import { InventoryService } from './inventory.service';

@ApiTags('Inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get(':eventId/map')
  @ApiOperation({ summary: 'Published seat-map snapshot for an event' })
  getMap(@Param() params: EventIdParamDto) {
    return this.inventory.getMap(params.eventId);
  }

  @Get(':eventId/availability')
  @ApiOperation({ summary: 'Ticket availability (expires stale holds first)' })
  availability(@Param() params: EventIdParamDto) {
    return this.inventory.getAvailability(params.eventId);
  }

  @Sse(':eventId/stream')
  @ApiOperation({ summary: 'SSE availability stream' })
  stream(@Param() params: EventIdParamDto) {
    return this.inventory.streamAvailability(params.eventId);
  }

  @Post('holds/best-available')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Hold best-available seats or GA quantity' })
  createBestAvailable(
    @Body() body: CreateBestAvailableHoldDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Headers('x-channel') channelHeader?: string,
    @Headers('x-cashier-id') cashierId?: string,
  ) {
    const channel =
      channelHeader?.toUpperCase() === 'TAQUILLA' ? SalesChannel.TAQUILLA : SalesChannel.WEB;
    return this.inventory.createBestAvailableHold({
      ...body,
      userId: body.userId ?? user?.sub,
      channel,
      cashierId,
    });
  }

  @Post('holds')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Hold specific seats or GA quantity' })
  createHold(
    @Body() body: CreateHoldDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Headers('x-channel') channelHeader?: string,
    @Headers('x-cashier-id') cashierId?: string,
  ) {
    const channel =
      channelHeader?.toUpperCase() === 'TAQUILLA' ? SalesChannel.TAQUILLA : SalesChannel.WEB;
    return this.inventory.createHold({
      ...body,
      userId: body.userId ?? user?.sub,
      channel,
      cashierId,
    });
  }

  @Delete('holds/:id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Release an active hold' })
  release(@Param() params: HoldIdParamDto, @Query() query: ReleaseHoldQueryDto) {
    return this.inventory.releaseHold(params.id, query.sessionId);
  }
}
