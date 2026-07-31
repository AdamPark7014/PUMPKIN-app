import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { TicketTransferService } from './ticket-transfer.service';
import {
  AcceptTransferDto,
  InitiateTransferDto,
  ListTransfersQueryDto,
  TransferIdParamDto,
} from './ticket-transfer.dto';

@ApiTags('Ticket Transfer')
@Controller('tickets/transfer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
@ApiBearerAuth()
export class TicketTransferController {
  constructor(private readonly transferService: TicketTransferService) {}

  @Post()
  @ApiOperation({ summary: 'Offer a ticket to another account by email' })
  initiate(@CurrentUser() user: AuthenticatedUser, @Body() body: InitiateTransferDto) {
    return this.transferService.initiate(
      { userId: user.sub, email: user.email },
      { ticketId: body.ticketId, toEmail: body.toEmail, message: body.message },
    );
  }

  @Post('accept')
  @ApiOperation({ summary: 'Claim a transfer with its code' })
  accept(@CurrentUser() user: AuthenticatedUser, @Body() body: AcceptTransferDto) {
    return this.transferService.accept(body.transferCode, {
      userId: user.sub,
      email: user.email,
    });
  }

  @Get('mine')
  @ApiOperation({ summary: 'Transfers sent by and offered to the current account' })
  mine(@CurrentUser() user: AuthenticatedUser, @Query() query: ListTransfersQueryDto) {
    return this.transferService.listByUser(
      { userId: user.sub, email: user.email },
      { limit: query.limit, offset: query.offset },
    );
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Withdraw a transfer that has not been claimed yet' })
  cancel(@CurrentUser() user: AuthenticatedUser, @Param() params: TransferIdParamDto) {
    return this.transferService.cancel(params.id, { userId: user.sub, email: user.email });
  }
}
