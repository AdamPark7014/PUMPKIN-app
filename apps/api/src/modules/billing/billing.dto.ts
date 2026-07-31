import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Mexican RFC (persona moral 12 / física 13). */
const RFC_PATTERN = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i;

export class UpsertFiscalProfileDto {
  @ApiProperty({ example: 'AAA010101AAA' })
  @IsString()
  @Matches(RFC_PATTERN, { message: 'RFC inválido' })
  rfc!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  legalName!: string;

  @ApiPropertyOptional({ default: '601' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  regimenFiscal?: string;

  @ApiProperty({ example: '06600' })
  @IsString()
  @Matches(/^\d{5}$/, { message: 'codigoPostal must be 5 digits' })
  codigoPostal!: string;

  @ApiPropertyOptional({ default: 'A' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  serie?: string;

  @ApiPropertyOptional({ enum: ['sandbox', 'production'], default: 'sandbox' })
  @IsOptional()
  @IsIn(['sandbox', 'production'])
  pacMode?: 'sandbox' | 'production';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  pacProvider?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  pacApiKey?: string;
}

export class StampCfdiDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  orderId!: string;

  @ApiProperty({ example: 'XAXX010101000' })
  @IsString()
  @Matches(RFC_PATTERN, { message: 'receptorRfc inválido' })
  receptorRfc!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  receptorNombre!: string;

  @ApiPropertyOptional({ default: 'G03' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  receptorUsoCfdi?: string;
}

export class ListCfdiQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 100, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 100;
}
