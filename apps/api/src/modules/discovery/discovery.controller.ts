import { Controller, Get, Headers, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DiscoveryService } from './discovery.service';
import { TenantService } from '../tenant/tenant.service';

@ApiTags('Discovery')
@Controller('discovery')
export class DiscoveryController {
  constructor(
    private discovery: DiscoveryService,
    private tenant: TenantService,
  ) {}

  @Get('events')
  async events(
    @Headers('host') host: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    const org = await this.tenant.resolveByHost(host || 'localhost');
    if (!org) return [];
    return this.discovery.listEvents({
      orgId: org.id,
      q,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('events/:slug')
  getEvent(@Param('slug') slug: string) {
    return this.discovery.getBySlug(slug);
  }
}


