import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  EventCategory,
  EventSeriesKind,
  EventSeriesStatus,
  EventStatus,
  SalePhaseKind,
  SalesChannel,
} from '@prisma/client';

const RECURRENCE_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
const MONTHLY_MODES = ['DAY_OF_MONTH', 'NTH_WEEKDAY'] as const;
const CURRENCIES = ['MXN', 'USD'] as const;

export class EventIdParamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  eventId!: string;
}

export class SeriesIdParamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  seriesId!: string;
}

export class VenueIdParamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  venueId!: string;
}

export class PhaseIdParamDto extends EventIdParamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  phaseId!: string;
}

export class BlackoutParamsDto extends VenueIdParamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  blackoutId!: string;
}

export class RecurrenceRuleDto {
  @IsIn(RECURRENCE_FREQUENCIES)
  frequency!: (typeof RECURRENCE_FREQUENCIES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  interval?: number;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  startLocal!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  timezone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  count?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  untilLocal?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  byWeekday?: number[];

  @IsOptional()
  @IsIn(MONTHLY_MODES)
  monthlyMode?: (typeof MONTHLY_MODES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([1, 2, 3, 4, -1])
  nth?: 1 | 2 | 3 | 4 | -1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  nthWeekday?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(366)
  @IsString({ each: true })
  exceptions?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  extraDates?: string[];
}

export class SeriesTemplateDto {
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
  @IsString()
  @MaxLength(120)
  zoneName?: string;

  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: (typeof CURRENCIES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_048)
  imageUrl?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 60)
  durationMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  doorsOffsetMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3_650)
  announceOffsetDays?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3_650)
  publishOffsetDays?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3_650)
  salesStartOffsetDays?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(24 * 365)
  salesEndOffsetHours?: number | null;
}

export class PartialSeriesTemplateDto {
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

  @IsOptional()
  @IsString()
  @MaxLength(120)
  zoneName?: string;

  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: (typeof CURRENCIES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_048)
  imageUrl?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 60)
  durationMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  doorsOffsetMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3_650)
  announceOffsetDays?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3_650)
  publishOffsetDays?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3_650)
  salesStartOffsetDays?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(24 * 365)
  salesEndOffsetHours?: number | null;
}

export class PhaseTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsEnum(SalePhaseKind)
  kind!: SalePhaseKind;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3_650)
  startOffsetDays!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3_650)
  endOffsetDays!: number;

  @IsOptional()
  @IsArray()
  @IsEnum(SalesChannel, { each: true })
  channels?: SalesChannel[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  allocationPercent?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  maxPerOrder?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(90)
  discountPercent?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  priority?: number;
}

export class PreviewScheduleDto {
  @ValidateNested()
  @Type(() => RecurrenceRuleDto)
  rule!: RecurrenceRuleDto;

  @IsString()
  @MaxLength(64)
  venueId!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PartialSeriesTemplateDto)
  template?: PartialSeriesTemplateDto;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  turnaroundMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  excludeSeriesId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  excludeEventIds?: string[];
}

export class CreateScheduledEventDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string;

  @IsOptional()
  @IsEnum(EventCategory)
  category?: EventCategory;

  @IsString()
  @MaxLength(64)
  venueId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  startLocal!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @ValidateNested()
  @Type(() => SeriesTemplateDto)
  template!: SeriesTemplateDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PhaseTemplateDto)
  phases?: PhaseTemplateDto[];

  @IsOptional()
  @IsBoolean()
  publish?: boolean;

  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  turnaroundMinutes?: number;
}

export class CreateSeriesDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string;

  @IsOptional()
  @IsEnum(EventSeriesKind)
  kind?: EventSeriesKind;

  @IsOptional()
  @IsEnum(EventCategory)
  category?: EventCategory;

  @IsString()
  @MaxLength(64)
  venueId!: string;

  @ValidateNested()
  @Type(() => RecurrenceRuleDto)
  rule!: RecurrenceRuleDto;

  @ValidateNested()
  @Type(() => SeriesTemplateDto)
  template!: SeriesTemplateDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PhaseTemplateDto)
  phases?: PhaseTemplateDto[];

  @IsOptional()
  @IsBoolean()
  publish?: boolean;

  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  turnaroundMinutes?: number;
}

export class UpdateSeriesDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string;

  @IsOptional()
  @IsEnum(EventSeriesStatus)
  status?: EventSeriesStatus;
}

export class ExtendSeriesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  count?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  untilLocal?: string;

  @IsOptional()
  @IsBoolean()
  publish?: boolean;

  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class SetSaleWindowsDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsDateString()
  announceAt?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsDateString()
  publishAt?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsDateString()
  salesStartAt?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsDateString()
  salesEndAt?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsDateString()
  doorsAt?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 60)
  durationMinutes?: number | null;
}

export class RescheduleEventDto {
  @IsDateString()
  startsAt!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 60)
  durationMinutes?: number;

  @IsOptional()
  @IsDateString()
  doorsAt?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @IsOptional()
  @IsBoolean()
  keepStatus?: boolean;
}

export class CancelEventDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class UpsertPhaseDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsEnum(SalePhaseKind)
  kind!: SalePhaseKind;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string | null;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsOptional()
  @IsArray()
  @IsEnum(SalesChannel, { each: true })
  channels?: SalesChannel[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  allocationPercent?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  maxPerOrder?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(90)
  discountPercent?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  priority?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  notes?: string | null;
}

export class CreateBlackoutDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsOptional()
  @IsBoolean()
  blocking?: boolean;
}

export class CalendarQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  venueId?: string;

  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000)
  limit = 500;
}

export class TransitionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  hours = 72;
}

export class ListSeriesQueryDto {
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
