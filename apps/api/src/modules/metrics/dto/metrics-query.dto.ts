import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { MetricsGranularity } from '@boletera/shared';

export enum MetricsGranularityDto {
  hour = 'hour',
  day = 'day',
  week = 'week',
  month = 'month',
}

export class MetricsRangeQueryDto {
  @ApiPropertyOptional({ description: 'ISO start (inclusive). Defaults to start of month Mexico City.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO end (exclusive). Defaults to now.' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Override org for SUPER_ADMIN / ADMIN only' })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  eventId?: string;
}

export class MetricsPagedQueryDto extends MetricsRangeQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 25;
}

export class MetricsTimeSeriesQueryDto extends MetricsRangeQueryDto {
  @ApiPropertyOptional({ enum: MetricsGranularityDto, default: MetricsGranularityDto.day })
  @IsOptional()
  @IsEnum(MetricsGranularityDto)
  granularity?: MetricsGranularity = 'day';

  @ApiPropertyOptional({
    description: 'Metric key: revenue | orders | tickets | refunds | checkins',
    default: 'revenue',
  })
  @IsOptional()
  @IsString()
  metric?: string = 'revenue';
}
