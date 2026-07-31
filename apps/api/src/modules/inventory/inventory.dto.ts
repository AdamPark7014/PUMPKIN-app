import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class EventIdParamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  eventId!: string;
}

export class HoldIdParamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  id!: string;
}

export class CreateHoldDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  eventId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  seatIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  offerId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  sessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  saleCode?: string;
}

export class CreateBestAvailableHoldDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  eventId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  offerId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  sessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;

  @IsOptional()
  @IsBoolean()
  contiguous?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  saleCode?: string;
}

export class ReleaseHoldQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  sessionId?: string;
}
