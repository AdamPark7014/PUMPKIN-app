import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

const API_SCOPES = ['read:events', 'read:inventory', 'write:orders'] as const;

export class CreateApiKeyDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(API_SCOPES.length)
  @IsIn(API_SCOPES, { each: true })
  scopes?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  rateLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3_650)
  expiresInDays?: number;
}

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
