import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const CURRENCIES = ['MXN', 'USD', 'EUR'] as const;

export class CreateResaleListingDto {
  @ValidateIf((o: CreateResaleListingDto) => !o.ticketCode)
  @IsString()
  @MaxLength(64)
  ticketId?: string;

  @ValidateIf((o: CreateResaleListingDto) => !o.ticketId)
  @IsString()
  @MaxLength(64)
  ticketCode?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000)
  askingPrice!: number;

  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: (typeof CURRENCIES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sellerName?: string;
}

export class MakeResaleOfferDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000)
  offerPrice!: number;
}

export class ResaleListingParamDto {
  @IsString()
  @MaxLength(64)
  listingId!: string;
}

export class ResaleOfferParamDto {
  @IsString()
  @MaxLength(64)
  offerId!: string;
}

export class ResaleEventParamDto {
  @IsString()
  @MaxLength(64)
  eventId!: string;
}

export class ResaleTicketParamDto {
  @IsString()
  @MaxLength(64)
  ticketId!: string;
}

export class ListResaleQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  eventId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  offerId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number;
}
