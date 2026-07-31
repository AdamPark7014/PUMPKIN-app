import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const IDENTIFIER = /^[A-Za-z0-9_-]{6,64}$/;
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const SUBDOMAIN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const VENUE_TEMPLATES = ['arena', 'theater', 'stadium', 'festival', 'blank'] as const;

function trim({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function trimLower({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export class AdminScopeQueryDto {
  @ApiPropertyOptional({ description: 'Target organization. Cross-tenant operators only.' })
  @IsOptional()
  @IsString()
  @Matches(IDENTIFIER)
  organizationId?: string;
}

export class AdminPagedQueryDto extends AdminScopeQueryDto {
  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'Id of the last row of the previous page.' })
  @IsOptional()
  @IsString()
  @Matches(IDENTIFIER)
  cursor?: string;
}

export class AdminSalesReportQueryDto extends AdminScopeQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class OrderIdParamDto {
  @ApiProperty()
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  @Matches(IDENTIFIER)
  id!: string;
}

export class PayoutIdParamDto {
  @ApiProperty()
  @IsString()
  @Matches(IDENTIFIER)
  payoutId!: string;
}

export class RefundOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CancelOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}

export class ProcessPayoutDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  referenceId?: string;
}

export class CompletePayoutDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  referenceId?: string;
}

export class CreateVenueDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2)
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500_000)
  totalCapacity?: number;

  @ApiPropertyOptional({ enum: VENUE_TEMPLATES })
  @IsOptional()
  @IsIn([...VENUE_TEMPLATES])
  template?: (typeof VENUE_TEMPLATES)[number];
}

export class UpdateBrandingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(HEX_COLOR)
  primaryColor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimLower)
  @IsString()
  @Matches(SUBDOMAIN)
  subdomain?: string;
}

export class SuggestLayoutDto {
  @ApiProperty()
  @IsString()
  @Matches(IDENTIFIER)
  venueId!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(8)
  @MaxLength(2000)
  planDescription!: string;
}
