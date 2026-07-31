import { Controller, Get, Headers, NotFoundException, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/auth.types';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { TenantService } from '../tenant/tenant.service';
import {
  AutocompleteQueryDto,
  RecommendationsQueryDto,
  SearchEventsQueryDto,
  TrendingQueryDto,
} from './search.dto';
import { SearchService } from './search.service';

@ApiTags('Search & Discovery')
@Controller('search')
@UseGuards(OptionalJwtAuthGuard)
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly tenantService: TenantService,
  ) {}

  private async organizationId(host: string | undefined) {
    const organization = await this.tenantService.resolveByHost(host || 'localhost');
    if (!organization) throw new NotFoundException('Tenant not found');
    return organization.id;
  }

  @Get('events')
  @ApiOperation({
    summary: 'Search events via SQL filters and simple popularity ranking',
    description:
      'Uses Prisma/SQL contains filters and order counts — not an ML/AI ranking engine.',
  })
  async searchEvents(
    @Headers('host') host: string | undefined,
    @Query() filters: SearchEventsQueryDto,
    @Request() request: { user?: AuthenticatedUser },
  ) {
    const organizationId = await this.organizationId(host);
    return this.searchService.searchEvents({
      organizationId,
      query: filters.q || filters.query,
      cities: filters.city ? [filters.city] : undefined,
      categories: filters.category ? [filters.category] : undefined,
      limit: filters.limit,
    }, request.user?.sub);
  }

  @Get('facets')
  @ApiOperation({ summary: 'Get SQL facet counts for filtering (city, category)' })
  async getFacets(
    @Headers('host') host: string | undefined,
    @Query() filters: SearchEventsQueryDto,
    @Request() request: { user?: AuthenticatedUser },
  ) {
    const organizationId = await this.organizationId(host);
    return this.searchService.getSearchFacets({
      organizationId,
      query: filters.q || filters.query,
      cities: filters.city ? [filters.city] : undefined,
      categories: filters.category ? [filters.category] : undefined,
    });
  }

  @Get('autocomplete')
  @ApiOperation({ summary: 'Autocomplete suggestions from event titles (SQL ILIKE)' })
  async getAutocomplete(
    @Headers('host') host: string | undefined,
    @Query() query: AutocompleteQueryDto,
    @Request() request: { user?: AuthenticatedUser },
  ) {
    const organizationId = await this.organizationId(host);
    return this.searchService.getAutocomplete(query.q, organizationId);
  }

  @Get('trending')
  @ApiOperation({ summary: 'Events ordered by recent order volume' })
  async getTrending(
    @Headers('host') host: string | undefined,
    @Query() query: TrendingQueryDto,
    @Request() request: { user?: AuthenticatedUser },
  ) {
    const organizationId = await this.organizationId(host);
    return this.searchService.getTrendingEvents(organizationId, query.limit ?? 10);
  }

  @Get('recommendations')
  @ApiOperation({
    summary: 'Heuristic recommendations (same-city / popular)',
    description: 'Deterministic SQL heuristics — not personalized ML.',
  })
  async getRecommendations(
    @Headers('host') host: string | undefined,
    @Query() _query: RecommendationsQueryDto,
    @Request() request: { user?: AuthenticatedUser },
  ) {
    const organizationId = await this.organizationId(host);
    return this.searchService.getSmartRecommendations(organizationId, request.user?.sub);
  }
}
