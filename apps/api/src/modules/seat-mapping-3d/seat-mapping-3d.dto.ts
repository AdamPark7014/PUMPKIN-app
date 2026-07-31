import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class RecommendSeatsDto {
  @IsOptional()
  @IsIn(['premium', 'standard', 'economy'])
  tier?: 'premium' | 'standard' | 'economy';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  count!: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  accessible?: boolean;

  @IsOptional()
  @IsIn(['best', 'good', 'any'])
  viewQuality?: 'best' | 'good' | 'any';
}

export class InteractiveQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  selectedSeat?: string;
}
