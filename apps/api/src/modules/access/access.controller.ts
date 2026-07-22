import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AccessService } from './access.service';

@ApiTags('Access')
@Controller('access')
export class AccessController {
  constructor(private access: AccessService) {}

  @Post('scan')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SCANNER', 'ADMIN', 'SUPER_ADMIN', 'TAQUILLA')
  @ApiBearerAuth()
  scan(
    @Body()
    body: {
      ticketCode?: string;
      qrPayload?: string;
      zoneId?: string;
      scannedBy: string;
      channel?: string;
    },
  ) {
    return this.access.scanTicket({
      ...body,
      channel: body.channel ?? 'TAQUILLA',
    });
  }

  @Get('tickets/:id/qr')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  qr(@Param('id') id: string) {
    return this.access.getQrForTicket(id);
  }
}


