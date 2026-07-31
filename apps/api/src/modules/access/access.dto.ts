import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { SalesChannel } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

const upperCase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ScanTicketDto {
  @ApiPropertyOptional({ description: 'Human readable ticket code. Required when qrPayload is absent.' })
  @ValidateIf((dto: ScanTicketDto) => dto.qrPayload === undefined)
  @Transform(trim)
  @IsString({ message: 'ticketCode or qrPayload is required' })
  @MinLength(1)
  @MaxLength(64)
  ticketCode?: string;

  @ApiPropertyOptional({ description: 'Signed rotating QR payload produced by the ticket issuer.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  qrPayload?: string;

  @ApiPropertyOptional({ description: 'Access zone of the venue where the gate is placed.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  zoneId?: string;

  @ApiPropertyOptional({
    description:
      'Station label for operational reporting. The operator identity always comes from the token.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  scannedBy?: string;

  @ApiPropertyOptional({ enum: SalesChannel, default: SalesChannel.TAQUILLA })
  @IsOptional()
  @Transform(upperCase)
  @IsEnum(SalesChannel)
  channel?: SalesChannel;
}

export class TicketIdParamDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  id!: string;
}
