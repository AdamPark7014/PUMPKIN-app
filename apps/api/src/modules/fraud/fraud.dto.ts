import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FraudSeverity, FraudStatus, FraudType, SalesChannel } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsIP,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const upperCase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const lowerCase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Statuses an operator may set when closing a flag. */
export enum FlagResolutionStatus {
  RESOLVED = 'RESOLVED',
  FALSE_POSITIVE = 'FALSE_POSITIVE',
}

export class AnalyzeFraudDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  orderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  eventId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIP()
  ipAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  deviceFingerprint?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerCase)
  @IsEmail()
  @MaxLength(255)
  buyerEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(upperCase)
  @IsString()
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional({ enum: SalesChannel })
  @IsOptional()
  @Transform(upperCase)
  @IsEnum(SalesChannel)
  channel?: SalesChannel;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(upperCase)
  @IsString()
  @MaxLength(32)
  paymentMethod?: string;
}

export class CreateFlagDto {
  @ApiProperty({ enum: FraudType })
  @Transform(upperCase)
  @IsEnum(FraudType)
  type!: FraudType;

  @ApiProperty({ enum: FraudSeverity })
  @Transform(upperCase)
  @IsEnum(FraudSeverity)
  severity!: FraudSeverity;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  score?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  orderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  eventId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ticketId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIP()
  ipAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  deviceFingerprint?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ListFlagsQueryDto {
  @ApiPropertyOptional({ enum: FraudSeverity })
  @IsOptional()
  @Transform(upperCase)
  @IsEnum(FraudSeverity)
  severity?: FraudSeverity;

  @ApiPropertyOptional({ enum: FraudStatus })
  @IsOptional()
  @Transform(upperCase)
  @IsEnum(FraudStatus)
  status?: FraudStatus;

  @ApiPropertyOptional({ enum: FraudType })
  @IsOptional()
  @Transform(upperCase)
  @IsEnum(FraudType)
  type?: FraudType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  eventId?: string;

  @ApiPropertyOptional({ description: 'Only flags created at or after this instant.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Only flags created before this instant.' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description: 'Id of the last row of the previous page. Beats offset on deep pages.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  offset?: number;
}

export class ResolveFlagDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  resolution!: string;

  @ApiPropertyOptional({ enum: FlagResolutionStatus, default: FlagResolutionStatus.RESOLVED })
  @IsOptional()
  @Transform(upperCase)
  @IsEnum(FlagResolutionStatus)
  status?: FlagResolutionStatus;
}

export class FlagIdParamDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  flagId!: string;
}

export class UserIdParamDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  userId!: string;
}

export class OrganizationIdParamDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  organizationId!: string;
}

export class KycCheckDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;

  @ApiProperty({ description: 'ISO date of birth' })
  @IsDateString()
  dateOfBirth!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  address!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  city!: string;

  @ApiProperty({ description: 'ISO 3166-1 alpha-2 or alpha-3 country code' })
  @Transform(upperCase)
  @IsString()
  @MinLength(2)
  @MaxLength(3)
  country!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  documentNumber!: string;

  @ApiProperty()
  @Transform(upperCase)
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  documentType!: string;
}

export class AmlCheckDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ description: 'ISO 3166-1 alpha-2 or alpha-3 country code' })
  @Transform(upperCase)
  @IsString()
  @MinLength(2)
  @MaxLength(3)
  country!: string;
}
