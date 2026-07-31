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
  CreateResaleListingDto,
  ListResaleQueryDto,
  MakeResaleOfferDto,
  ResaleEventParamDto,
  ResaleListingParamDto,
  ResaleOfferParamDto,
  ResaleTicketParamDto,
} from './resale.dto';
import { ResaleService } from './resale.service';

@ApiTags('Resale')
@Controller('resale')
export class ResaleController {
  constructor(private readonly resaleService: ResaleService) {}

  @Post('listings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Permissions('order:write')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear anuncio de reventa' })
  createListing(
    @Body() dto: CreateResaleListingDto,
    @Req() req: { user: AuthenticatedUser },
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.resaleService.createListing({
      ...dto,
      sellerId: req.user.sub,
      sellerEmail: req.user.email,
      sellerName: dto.sellerName ?? req.user.email,
      idempotencyKey,
    });
  }

  @Post('listings/:listingId/offers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Permissions('order:write')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Hacer oferta sobre un anuncio de reventa' })
  makeOffer(
    @Param() params: ResaleListingParamDto,
    @Body() dto: MakeResaleOfferDto,
    @Req() req: { user: AuthenticatedUser },
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.resaleService.makeOffer({
      listingId: params.listingId,
      offerPrice: dto.offerPrice,
      buyerId: req.user.sub,
      buyerEmail: req.user.email,
      idempotencyKey,
    });
  }

  @Post('offers/:offerId/accept')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Permissions('order:write')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Aceptar oferta de reventa' })
  acceptOffer(
    @Param() params: ResaleOfferParamDto,
    @Req() req: { user: AuthenticatedUser },
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.resaleService.acceptOffer(
      params.offerId,
      { userId: req.user.sub, role: req.user.role },
      idempotencyKey,
    );
  }

  @Post('offers/:offerId/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Permissions('order:write')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Rechazar oferta de reventa' })
  rejectOffer(
    @Param() params: ResaleOfferParamDto,
    @Req() req: { user: AuthenticatedUser },
  ) {
    return this.resaleService.rejectOffer(params.offerId, {
      userId: req.user.sub,
      role: req.user.role,
    });
  }

  @Post('listings/:listingId/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Permissions('order:write')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancelar anuncio de reventa' })
  cancelListing(
    @Param() params: ResaleListingParamDto,
    @Req() req: { user: AuthenticatedUser },
  ) {
    return this.resaleService.cancelListing(params.listingId, {
      userId: req.user.sub,
      role: req.user.role,
    });
  }

  @Get('listings')
  @ApiOperation({ summary: 'Listar anuncios activos de reventa' })
  listListings(@Query() query: ListResaleQueryDto) {
    return this.resaleService.listActiveListings({
      eventId: query.eventId,
      offerId: query.offerId,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get('events/:eventId/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @Permissions('event:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Estadísticas del marketplace de reventa' })
  getMarketplaceStats(@Param() params: ResaleEventParamDto) {
    return this.resaleService.getMarketplaceStats(params.eventId);
  }

  @Get('tickets/:ticketId/anti-scalping-check')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Permissions('order:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verificar restricciones anti-especulación' })
  performAntiScalpingCheck(@Param() params: ResaleTicketParamDto) {
    return this.resaleService.performAntiScalpingCheck(params.ticketId);
  }
}
