import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { CustomerSegment } from './pricing.types';

const SEGMENTS = ['EARLY_BUYER', 'REGULAR', 'VVIP'] as const;

export class CalculatePriceDto {
  @IsString()
  @MaxLength(64)
  eventId!: string;

  @IsString()
  @MaxLength(64)
  offerId!: string;

  @IsInt()
  @Min(1)
  @Max(100)
  quantity!: number;

  @IsOptional()
  @IsIn(SEGMENTS)
  customerSegment?: CustomerSegment;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  promotionCode?: string;
}

export class CartItemDto {
  @IsString()
  @MaxLength(64)
  offerId!: string;

  @IsInt()
  @Min(1)
  @Max(100)
  quantity!: number;
}

export class CalculateCartDto {
  @IsString()
  @MaxLength(64)
  eventId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items!: CartItemDto[];

  @IsOptional()
  @IsIn(SEGMENTS)
  customerSegment?: CustomerSegment;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  promotionCode?: string;
}

export class RecommendationQueryDto {
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  preview?: boolean;
}

export class ApplyRecommendationsDto {
  @IsOptional()
  @IsBoolean()
  /** When true, apply even if requiresApproval (explicit human confirmation via this flag). */
  confirmApproval?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  offerIds?: string[];
}

export class ApproveRecommendationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RejectRecommendationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class PriceHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class EventIdParamDto {
  @IsString()
  @MaxLength(64)
  eventId!: string;
}

export class OfferIdParamDto {
  @IsString()
  @MaxLength(64)
  offerId!: string;
}

export class RecommendationIdParamDto {
  @IsString()
  @MaxLength(64)
  recommendationId!: string;
}
