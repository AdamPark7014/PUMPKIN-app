import {
  Body,
  Controller,
  Get,
  Headers,
  Header,
  Param,
  Post,
  Request,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SalesChannel } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { OrdersService } from './orders.service';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private orders: OrdersService) {}

  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  create(
    @Body()
    body: {
      eventId: string;
      offerId?: string;
      holdIds?: string[];
      items?: { offerId: string; holdIds: string[] }[];
      buyerName: string;
      buyerEmail: string;
      buyerPhone?: string;
      paymentMethod?: string;
      promotionCode?: string;
      userId?: string;
    },
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
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  myOrders(@Request() req: { user: { sub: string } }) {
    return this.orders.listForUser(req.user.sub);
  }

  @Get(':publicId/status')
  status(@Param('publicId') publicId: string) {
    return this.orders.getStatus(publicId);
  }

  @Get(':publicId/qrcodes')
  qrcodes(@Param('publicId') publicId: string) {
    return this.orders.getQrCodesForOrder(publicId);
  }

  @Get(':publicId/tickets.pdf')
  @Header('Content-Type', 'application/pdf')
  async ticketsPdf(@Param('publicId') publicId: string, @Res({ passthrough: true }) res: Response) {
    const buf = await this.orders.buildTicketsPdf(publicId);
    res.set({
      'Content-Disposition': `attachment; filename="boletera-${publicId}.pdf"`,
    });
    return new StreamableFile(buf);
  }

  @Post(':publicId/cfdi')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  requestCfdi(
    @Param('publicId') publicId: string,
    @Request() req: { user: { sub: string } },
    @Body()
    body: { receptorRfc: string; receptorNombre: string; receptorUsoCfdi?: string },
  ) {
    return this.orders.requestCfdiForBuyer(publicId, req.user.sub, body);
  }

  @Get(':publicId')
  get(@Param('publicId') publicId: string) {
    return this.orders.getByPublicId(publicId);
  }
}
