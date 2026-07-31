import { Controller, Get, Headers, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  DiscoveryEventsQueryDto,
  DiscoverySlugParamDto,
  DiscoverySuggestQueryDto,
  DiscoveryVenuesQueryDto,
} from './discovery.dto';
import { DiscoveryService } from './discovery.service';
import { TenantService } from '../tenant/tenant.service';

@ApiTags('Discovery')
@Controller('discovery')
export class DiscoveryController {
  constructor(
    private discovery: DiscoveryService,
    private tenant: TenantService,
  ) {}

  @Get('suggest')
  async suggest(
    @Headers('host') host: string,
    @Query() query: DiscoverySuggestQueryDto,
  ) {
    if (!query.q?.trim()) return [];
    const orgIds = await this.tenant.discoveryOrgIds(host || 'localhost');
    return this.discovery.suggest({
      orgId: orgIds,
      q: query.q,
      limit: query.limit ?? 8,
    });
  }

  @Get('facets')
  async facets(@Headers('host') host: string) {
    const orgIds = await this.tenant.discoveryOrgIds(host || 'localhost');
    return this.discovery.facets(orgIds);
  }

  @Get('venues')
  async venues(
    @Headers('host') host: string,
    @Query() query: DiscoveryVenuesQueryDto,
  ) {
    const orgIds = await this.tenant.discoveryOrgIds(host || 'localhost');
    return this.discovery.listVenues({
      orgId: orgIds,
      limit: query.limit,
      city: query.city && query.city !== 'ALL' ? query.city : undefined,
    });
  }

  @Get('venues/:slug')
  async venueBySlug(
    @Headers('host') host: string,
    @Param() params: DiscoverySlugParamDto,
  ) {
    const orgIds = await this.tenant.discoveryOrgIds(host || 'localhost');
    return this.discovery.getVenueBySlug(params.slug, orgIds);
  }

  @Get('events')
  async events(
    @Headers('host') host: string,
    @Query() query: DiscoveryEventsQueryDto,
  ) {
    const orgIds = await this.tenant.discoveryOrgIds(host || 'localhost');
    return this.discovery.listEvents({
      orgId: orgIds,
      q: query.q,
      city: query.city && query.city !== 'ALL' ? query.city : undefined,
      category: query.category && query.category !== 'ALL' ? query.category : undefined,
      venueSlug: query.venueSlug,
      when: query.when,
      from: query.from,
      to: query.to,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  @Get('events/:slug')
  async getEvent(
    @Headers('host') host: string,
    @Param() params: DiscoverySlugParamDto,
  ) {
    const orgIds = await this.tenant.discoveryOrgIds(host || 'localhost');
    if (!orgIds.length) throw new NotFoundException('Tenant not found');
    return this.discovery.getBySlug(params.slug, orgIds);
  }
}
