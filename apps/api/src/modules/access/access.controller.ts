import { Body, Controller, Get, Headers, Ip, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SalesChannel } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AccessService } from './access.service';
import { ScanTicketDto, TicketIdParamDto } from './access.dto';

@ApiTags('Access')
@Controller('access')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Post('scan')
  @UseGuards(JwtAuthGuard, RolesGuard)
  // Roles only: TAQUILLA is not granted ticket:scan in the shared permission map yet.
  @Roles('SCANNER', 'TAQUILLA', 'VENUE_MANAGER', 'ADMIN', 'SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Admit a ticket at the gate. Send Idempotency-Key to make retries safe.',
  })
  scan(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ScanTicketDto,
    @Ip() ipAddress: string,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.access.scanTicket({
      ticketCode: body.ticketCode,
      qrPayload: body.qrPayload,
      zoneId: body.zoneId,
      station: body.scannedBy,
      channel: body.channel ?? SalesChannel.TAQUILLA,
      scannedByUserId: user.sub,
      idempotencyKey: idempotencyKey?.slice(0, 128),
      ipAddress,
      userAgent,
    });
  }

  @Get('tickets/:id/qr')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Entry QR of a ticket, for its holder or the venue staff of its org' })
  qr(@CurrentUser() user: AuthenticatedUser, @Param() params: TicketIdParamDto) {
    return this.access.getQrForTicket(params.id, { userId: user.sub, role: user.role });
  }
}
