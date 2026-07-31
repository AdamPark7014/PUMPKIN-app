import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { EventStatus } from '@prisma/client';

const EVENT_KINDS = ['single', 'series', 'residency'] as const;
const FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly'] as const;
const CAMPAIGN_TYPES = ['presale', 'early_bird', 'vip', 'group', 'loyalty'] as const;
const DISCOUNT_TYPES = ['percentage', 'fixed'] as const;

export class EventIdParamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  eventId!: string;
}

export class OfferParamsDto extends EventIdParamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  offerId!: string;
}

export class CreateEventDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @IsString()
  @MaxLength(10_000)
  description!: string;

  @IsIn(EVENT_KINDS)
  type!: (typeof EVENT_KINDS)[number];

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsString()
  @MaxLength(64)
  venueId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  capacity!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  basePrice!: number;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2_048)
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;
}

export class SeriesOccurrenceDto {
  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  capacity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  basePrice?: number;
}

export class CreateEventSeriesDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  seriesName!: string;

  @IsString()
  @MaxLength(10_000)
  description!: string;

  @IsString()
  @MaxLength(64)
  venueId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SeriesOccurrenceDto)
  occurrences!: SeriesOccurrenceDto[];
}

export class CreateResidencyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsString()
  @MaxLength(64)
  venueId!: string;

  @IsDateString()
  startDate!: string;

  @IsIn(FREQUENCIES)
  frequency!: (typeof FREQUENCIES)[number];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  occurrenceCount!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  capacity!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  basePrice!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsDateString({}, { each: true })
  exceptions?: string[];
}

export class UpdateOfferDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  basePrice?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}

export class SurgeTierDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  occupancy!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(10)
  multiplier!: number;
}

export class TimeRuleDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3_650)
  daysUntilEvent!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(10)
  multiplier!: number;
}

export class SetPricingRulesDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  basePrice!: number;

  @IsBoolean()
  dynamicPricingEnabled!: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SurgeTierDto)
  surgeTiers?: SurgeTierDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TimeRuleDto)
  timeBasedRules?: TimeRuleDto[];

  @IsOptional()
  @IsObject()
  segmentPricing?: Record<string, number>;

  @IsOptional()
  @IsObject()
  customZonePricing?: Record<string, number>;
}

export class ChannelAllocationDto {
  @IsBoolean()
  enabled!: boolean;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  allocation!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  discount?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  locations?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  partners?: string[];
}

export class AllocateChannelsDto {
  @ValidateNested()
  @Type(() => ChannelAllocationDto)
  web!: ChannelAllocationDto;

  @ValidateNested()
  @Type(() => ChannelAllocationDto)
  taquilla!: ChannelAllocationDto;

  @ValidateNested()
  @Type(() => ChannelAllocationDto)
  api!: ChannelAllocationDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelAllocationDto)
  phone?: ChannelAllocationDto;
}

export class CreateCampaignDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsIn(CAMPAIGN_TYPES)
  type!: (typeof CAMPAIGN_TYPES)[number];

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  allocation!: number;

  @IsIn(DISCOUNT_TYPES)
  discountType!: (typeof DISCOUNT_TYPES)[number];

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discountValue!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  quantityPerUser?: number;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;
}

export class CalendarParamsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2200)
  year!: number;
}

export class BulkPricingDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  eventIds!: string[];

  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(10)
  priceMultiplier!: number;
}

export class SearchEventsQueryDto {
  @IsOptional()
  @IsDateString()
  start?: string;

  @IsOptional()
  @IsDateString()
  end?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  venueId?: string;

  @IsOptional()
  @IsIn(EVENT_KINDS)
  type?: (typeof EVENT_KINDS)[number];

  @IsOptional()
  @IsIn(Object.values(EventStatus))
  status?: EventStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minCapacity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxCapacity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;
}
