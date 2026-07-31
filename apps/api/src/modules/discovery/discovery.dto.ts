import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { EventCategory } from '@prisma/client';

const EVENT_CATEGORIES = [...Object.values(EventCategory), 'ALL'] as string[];
const WHEN_VALUES = ['ALL', 'WEEK', 'WEEKEND', 'MONTH'] as const;

export class DiscoverySuggestQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  limit?: number;
}

export class DiscoveryVenuesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;
}

export class DiscoveryEventsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsIn(EVENT_CATEGORIES)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  venueSlug?: string;

  @IsOptional()
  @IsIn(WHEN_VALUES)
  when?: (typeof WHEN_VALUES)[number];

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;
}

export class DiscoverySlugParamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  slug!: string;
}
