import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SearchService } from './search.service';

/** Query filters for SQL facet search (not an AI ranking engine). */
export type SearchEventsQuery = {
  q?: string;
  query?: string;
  city?: string;
  category?: string;
  limit?: string;
};

@ApiTags('Search & Discovery')
@Controller('search')
export class SearchController {
  constructor(private searchService: SearchService) {}

  @Get('events')
  @ApiOperation({
    summary: 'Search events via SQL filters and simple popularity ranking',
    description:
      'Uses Prisma/SQL contains filters and order counts — not an ML/AI ranking engine.',
  })
  async searchEvents(@Query() filters: SearchEventsQuery) {
    return await this.searchService.searchEvents({
      query: filters.q || filters.query,
      cities: filters.city ? [filters.city] : undefined,
      categories: filters.category ? [filters.category] : undefined,
      limit: filters.limit ? Number(filters.limit) : undefined,
    });
  }

  @Get('facets')
  @ApiOperation({ summary: 'Get SQL facet counts for filtering (city, category)' })
  async getFacets(@Query() filters: SearchEventsQuery) {
    return await this.searchService.getSearchFacets({
      query: filters.q || filters.query,
      cities: filters.city ? [filters.city] : undefined,
      categories: filters.category ? [filters.category] : undefined,
    });
  }

  @Get('autocomplete')
  @ApiOperation({ summary: 'Autocomplete suggestions from event titles (SQL ILIKE)' })
  async getAutocomplete(@Query('q') query: string) {
    return await this.searchService.getAutocomplete(query);
  }

  @Get('trending')
  @ApiOperation({ summary: 'Events ordered by recent order volume' })
  async getTrending(@Query('limit') limit?: number) {
    return await this.searchService.getTrendingEvents(limit || 10);
  }

  @Get('recommendations')
  @ApiOperation({
    summary: 'Heuristic recommendations (same-city / popular)',
    description: 'Deterministic SQL heuristics — not personalized ML.',
  })
  async getRecommendations(@Query('userId') userId?: string) {
    return await this.searchService.getSmartRecommendations(userId);
  }
}
