import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  JoinWaitlistDto,
  WaitlistEventParamDto,
  WaitlistListQueryDto,
  WaitlistNotifyQueryDto,
  WaitlistOrgParamDto,
} from './waitlist.dto';
import { WaitlistService } from './waitlist.service';

@ApiTags('Waitlist')
@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Post('join')
  @ApiOperation({ summary: 'Unirse a la lista de espera de un evento' })
  join(
    @Body() body: JoinWaitlistDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.waitlist.join({ ...body, idempotencyKey });
  }

  @Get('event/:eventId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @Permissions('event:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar entradas de lista de espera por evento' })
  listEvent(
    @Param() params: WaitlistEventParamDto,
    @Query() query: WaitlistListQueryDto,
  ) {
    return this.waitlist.listByEvent(
      params.eventId,
      query.status,
      query.limit,
      query.offset,
    );
  }

  @Get('organization/:orgId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @Permissions('event:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar lista de espera por organización' })
  listOrg(
    @Param() params: WaitlistOrgParamDto,
    @Query() query: WaitlistListQueryDto,
  ) {
    return this.waitlist.listByOrganization(params.orgId, query.limit, query.offset);
  }

  @Get('event/:eventId/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @Permissions('event:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Estadísticas de lista de espera por evento' })
  stats(@Param() params: WaitlistEventParamDto) {
    return this.waitlist.stats(params.eventId);
  }

  @Post('event/:eventId/notify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @Permissions('event:write')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Notificar lote de lista de espera' })
  notify(
    @Param() params: WaitlistEventParamDto,
    @Query() query: WaitlistNotifyQueryDto,
    @Req() req: { user: AuthenticatedUser },
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.waitlist.notifyBatch(
      params.eventId,
      query.limit ?? 50,
      req.user.sub,
      idempotencyKey,
    );
  }
}
