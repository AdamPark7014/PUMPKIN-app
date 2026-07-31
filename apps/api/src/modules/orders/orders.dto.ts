import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const PAYMENT_METHODS = ['CARD', 'SPEI', 'OXXO', 'CASH', 'COMP'] as const;

export class OrderLineItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  offerId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  holdIds!: string[];
}

export class CreateOrderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  eventId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  offerId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @IsString({ each: true })
  holdIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OrderLineItemDto)
  items?: OrderLineItemDto[];

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  buyerName!: string;

  @IsEmail()
  @MaxLength(255)
  buyerEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  buyerPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;

  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: (typeof PAYMENT_METHODS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  promotionCode?: string;

  @IsOptional()
  @IsBoolean()
  isComp?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  compReason?: string;
}

export class PublicIdParamDto {
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  publicId!: string;
}

export class ListMineQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class RequestCfdiDto {
  @IsString()
  @MinLength(12)
  @MaxLength(13)
  receptorRfc!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  receptorNombre!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  receptorUsoCfdi?: string;
}
