import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

abstract class AllocatedChannelDto {
  @IsBoolean()
  enabled!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  allocation!: number;
}

export class WebChannelDto extends AllocatedChannelDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discount?: number;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  activeHours?: string;
}

export class TaquillaChannelDto extends AllocatedChannelDto {
  @IsArray()
  @IsString({ each: true })
  locations!: string[];
}

export class ApiChannelDto extends AllocatedChannelDto {
  @IsArray()
  @IsString({ each: true })
  partners!: string[];
}

export class PhoneChannelDto extends AllocatedChannelDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  hours?: string;
}

export class ChannelConfigDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => WebChannelDto)
  web?: WebChannelDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => TaquillaChannelDto)
  taquilla?: TaquillaChannelDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ApiChannelDto)
  api?: ApiChannelDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PhoneChannelDto)
  phone?: PhoneChannelDto;
}

export class AllocateInventoryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  totalTickets!: number;
}

export class ApiPartnerDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsString()
  @Length(16, 512)
  apiKey!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  allocation?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  rateLimit?: number;
}

export class TaquillaLocationDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsString()
  @Length(1, 250)
  address!: string;

  @IsString()
  @Length(1, 100)
  city!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000)
  terminals!: number;

  @IsArray()
  @IsString({ each: true })
  staff!: string[];

  @IsOptional()
  @IsString()
  @Length(1, 100)
  activeHours?: string;
}
