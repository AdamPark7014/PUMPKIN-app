import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SearchEventsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  query?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AutocompleteQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class TrendingQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class RecommendationsQueryDto {
  /**
   * Kept only so legacy clients are not rejected by whitelist validation.
   * Personalization always uses the authenticated subject.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;
}
