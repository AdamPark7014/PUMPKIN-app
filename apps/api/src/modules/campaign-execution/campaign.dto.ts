import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateCampaignDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsString()
  @Length(1, 50)
  type!: string;

  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  endsAt!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  allocation!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantityPerUser!: number;

  @IsIn(['percentage', 'fixed'])
  discountType!: 'percentage' | 'fixed';

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discountValue!: number;
}

export type ValidatedCreateCampaign = Omit<CreateCampaignDto, 'startsAt' | 'endsAt'> & {
  startsAt: Date;
  endsAt: Date;
};

export class ApplyDiscountDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  basePrice!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class ValidatePresaleCodeDto {
  @IsString()
  @Length(1, 128)
  code!: string;

  @IsString()
  @Length(1, 64)
  eventId!: string;

  @IsString()
  @Length(1, 64)
  userId!: string;
}

export class AwardLoyaltyPointsDto {
  @IsString()
  @Length(1, 64)
  eventId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  points!: number;
}

export class CampaignListQueryDto {
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
