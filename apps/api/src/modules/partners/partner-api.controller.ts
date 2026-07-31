import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { PartnerOrgId } from './api-key.decorator';
import { ApiKeyGuard, RequireApiScopes } from './api-key.guard';
import { PaginationQueryDto } from './partners.dto';

/**
 * Public partner API — authenticated via X-Api-Key (blk_…).
 */
@ApiTags('Partner API')
@ApiHeader({ name: 'X-Api-Key', required: true })
@Controller('partner/v1')
@UseGuards(ApiKeyGuard)
export class PartnerApiController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('events')
  @RequireApiScopes('read:events')
  @ApiOperation({ summary: 'List published events for the API key organization' })
  async listEvents(
    @PartnerOrgId() orgId: string,
    @Query() query: PaginationQueryDto,
  ) {
    const limit = Math.min(100, Math.max(1, query.limit ?? 100));
    const page = Math.max(1, query.page ?? 1);
    return this.prisma.event.findMany({
      where: {
        organizationId: orgId,
        status: { in: ['SCHEDULED', 'LIVE'] },
      },
      select: {
        id: true,
        slug: true,
        title: true,
        startsAt: true,
        endsAt: true,
        status: true,
        category: true,
        venue: { select: { id: true, name: true, city: true } },
      },
      orderBy: { startsAt: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  @Get('events/:eventId/availability')
  @RequireApiScopes('read:inventory')
  @ApiOperation({ summary: 'Availability summary for an event' })
  async availability(@PartnerOrgId() orgId: string, @Param('eventId') eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId: orgId },
      select: { id: true, title: true, totalCapacity: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');

    const [available, held, sold] = await Promise.all([
      this.prisma.ticket.count({ where: { eventId, status: 'AVAILABLE' } }),
      this.prisma.ticket.count({ where: { eventId, status: 'HELD' } }),
      this.prisma.ticket.count({ where: { eventId, status: 'SOLD' } }),
    ]);

    return { event, available, held, sold };
  }

  @Get('me')
  @ApiOperation({ summary: 'API key / organization identity' })
  me(@PartnerOrgId() orgId: string) {
    return this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, slug: true, name: true, verified: true },
    });
  }
}
