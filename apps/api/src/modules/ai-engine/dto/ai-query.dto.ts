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

export enum AiAnomalyMetricDto {
  tickets_sold = 'tickets_sold',
  gross_revenue = 'gross_revenue',
  refund_amount = 'refund_amount',
  payment_approval_rate = 'payment_approval_rate',
  access_traffic = 'access_traffic',
}

export class AiRangeQueryDto {
  @ApiPropertyOptional({
    description: 'ISO start (inclusive). Defaults to start of month America/Mexico_City.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO end (exclusive). Defaults to now.' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Optional event scope' })
  @IsOptional()
  @IsString()
  eventId?: string;

  @ApiPropertyOptional({
    description: 'Required for SUPER_ADMIN; ignored for tenant-bound roles',
  })
  @IsOptional()
  @IsString()
  organizationId?: string;
}

export class AiForecastQueryDto {
  @ApiPropertyOptional({
    description: 'ISO start for observed sales curve (defaults to salesStartAt/createdAt)',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO end for observed sales curve (defaults to now)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description: 'Required for SUPER_ADMIN; ignored for tenant-bound roles',
  })
  @IsOptional()
  @IsString()
  organizationId?: string;
}

export class AiAnomaliesQueryDto extends AiRangeQueryDto {
  @ApiPropertyOptional({
    enum: AiAnomalyMetricDto,
    description: 'Limit detection to one metric; omit for all supported metrics',
  })
  @IsOptional()
  @IsEnum(AiAnomalyMetricDto)
  metric?: AiAnomalyMetricDto;

  @ApiPropertyOptional({
    description: 'Absolute z-score threshold (default 2.5)',
    default: 2.5,
  })
  @IsOptional()
  @Type(() => Number)
  @Min(1.5)
  @Max(5)
  zThreshold?: number = 2.5;
}

export class AiFraudQueryDto extends AiRangeQueryDto {
  @ApiPropertyOptional({ default: 50, description: 'Max scores to return' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}

export class AiRecommendationsQueryDto extends AiRangeQueryDto {
  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;
}

export class AiSegmentationQueryDto extends AiRangeQueryDto {
  @ApiPropertyOptional({ default: 100, description: 'Max customer rows to return' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 100;
}
