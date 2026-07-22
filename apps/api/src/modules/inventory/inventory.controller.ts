import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Sse,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SalesChannel } from '@prisma/client';
import { InventoryService } from './inventory.service';

@ApiTags('Inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private inventory: InventoryService) {}

  @Get(':eventId/map')
  getMap(@Param('eventId') eventId: string) {
    return this.inventory.getMap(eventId);
  }

  @Get(':eventId/availability')
  availability(@Param('eventId') eventId: string) {
    return this.inventory.getAvailability(eventId);
  }

  @Sse(':eventId/stream')
  stream(@Param('eventId') eventId: string) {
    return this.inventory.streamAvailability(eventId);
  }

  @Post('holds')
  createHold(
    @Body()
    body: {
      eventId: string;
      seatIds?: string[];
      offerId?: string;
      quantity?: number;
      sessionId?: string;
      userId?: string;
    },
    @Headers('x-channel') channelHeader?: string,
    @Headers('x-cashier-id') cashierId?: string,
  ) {
    const channel =
      channelHeader?.toUpperCase() === 'TAQUILLA' ? SalesChannel.TAQUILLA : SalesChannel.WEB;
    return this.inventory.createHold({ ...body, channel, cashierId });
  }

  @Delete('holds/:id')
  release(@Param('id') id: string) {
    return this.inventory.releaseHold(id);
  }
}


