import {
  Body,
  Controller,
  Get,
  Headers,
  Header,
  Param,
  Post,
  Query,
  Request,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SalesChannel } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Permissions } from '../auth/permissions.decorator';
import {
  CreateOrderDto,
  ListMineQueryDto,
  PublicIdParamDto,
  RequestCfdiDto,
} from './orders.dto';
import { OrdersService } from './orders.service';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Create order from active holds (idempotent)' })
  create(
    @Body() body: CreateOrderDto,
    @Request() req: { user?: { sub: string } },
    @Headers('x-channel') channelHeader?: string,
    @Headers('x-cashier-id') cashierId?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-forwarded-for') forwardedFor?: string,
  ) {
    const channel =
      channelHeader?.toUpperCase() === 'TAQUILLA' ? SalesChannel.TAQUILLA : SalesChannel.WEB;
    return this.orders.createOrder({
      ...body,
      userId: body.userId ?? req.user?.sub,
      channel,
      cashierId,
      idempotencyKey,
      ipAddress: forwardedFor?.split(',')[0]?.trim(),
    });
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CUSTOMER', 'TAQUILLA', 'PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('order:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List orders for the authenticated buyer' })
  myOrders(
    @Request() req: { user: { sub: string } },
    @Query() query: ListMineQueryDto,
  ) {
    return this.orders.listForUser(req.user.sub, query.limit, query.offset);
  }

  @Get(':publicId/status')
  @ApiOperation({ summary: 'Public order status (no PII)' })
  status(@Param() params: PublicIdParamDto) {
    return this.orders.getStatus(params.publicId);
  }

  @Get(':publicId/qrcodes')
  @ApiOperation({ summary: 'QR payloads for completed order tickets' })
  qrcodes(@Param() params: PublicIdParamDto) {
    return this.orders.getQrCodesForOrder(params.publicId);
  }

  @Get(':publicId/tickets.pdf')
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({ summary: 'Download ticket PDF' })
  async ticketsPdf(
    @Param() params: PublicIdParamDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const buf = await this.orders.buildTicketsPdf(params.publicId);
    res.set({
      'Content-Disposition': `attachment; filename="boletera-${params.publicId}.pdf"`,
    });
    return new StreamableFile(buf);
  }

  @Post(':publicId/cfdi')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CUSTOMER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('order:write')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request CFDI for own completed order' })
  requestCfdi(
    @Param() params: PublicIdParamDto,
    @Request() req: { user: { sub: string } },
    @Body() body: RequestCfdiDto,
  ) {
    return this.orders.requestCfdiForBuyer(params.publicId, req.user.sub, body);
  }

  @Get(':publicId')
  @ApiOperation({ summary: 'Order detail by public id' })
  get(@Param() params: PublicIdParamDto) {
    return this.orders.getByPublicId(params.publicId);
  }
}
