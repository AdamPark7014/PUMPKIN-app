import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const PAYMENT_METHODS = ['CASH', 'CARD', 'CHECK', 'COMP'] as const;
const LEGACY_PAYMENT_METHODS = ['CASH', 'CARD', 'CHECK'] as const;
const EXCHANGE_PAYMENT_METHODS = ['CASH', 'CARD'] as const;
const ANALYTICS_PERIODS = ['TODAY', 'WEEK', 'MONTH'] as const;

export class InitTerminalDto {
  @IsString()
  @MaxLength(64)
  organizationId!: string;

  @IsString()
  @MaxLength(120)
  locationName!: string;

  @IsString()
  @MaxLength(120)
  terminalName!: string;

  @IsOptional()
  hardwareConfig?: Record<string, string>;
}

export class StartSessionDto {
  @IsString()
  @MaxLength(64)
  terminalId!: string;

  @IsString()
  @MaxLength(64)
  cashierId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  openingCash?: number;
}

export class CheckoutDataDto {
  @IsString()
  @MaxLength(64)
  eventId!: string;

  @IsString()
  @MaxLength(64)
  offerId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  quantity?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  seatIds?: string[];

  @IsIn(PAYMENT_METHODS)
  paymentMethod!: (typeof PAYMENT_METHODS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  discountCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  cashierId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  buyerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  buyerEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  buyerPhone?: string;

  /**
   * Cobro con terminal bancaria física (no integrada): últimos 4 dígitos de
   * la tarjeta y número de autorización del voucher. Obligatorios cuando
   * paymentMethod es CARD — son la única liga entre la orden y el voucher
   * al conciliar el corte contra el estado de cuenta.
   */
  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'cardLast4 debe ser 4 dígitos' })
  cardLast4?: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9-]{4,20}$/, {
    message: 'cardAuthCode: 4-20 caracteres alfanuméricos',
  })
  cardAuthCode?: string;

  @IsOptional()
  @IsBoolean()
  isComp?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  compReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  managerPin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientSaleId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  holdIds?: string[];
}

export class QuickCheckoutDto {
  @IsString()
  @MaxLength(64)
  terminalId!: string;

  @IsString()
  @MaxLength(64)
  sessionId!: string;

  @ValidateNested()
  @Type(() => CheckoutDataDto)
  checkoutData!: CheckoutDataDto;
}

export class CreateHoldDto {
  @IsString()
  @MaxLength(64)
  terminalId!: string;

  @IsString()
  @MaxLength(64)
  sessionId!: string;

  @IsString()
  @MaxLength(64)
  eventId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  offerId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  seatIds?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  cashierId?: string;
}

export class ReleaseHoldsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  holdIds!: string[];
}

// Declare nested DTOs before parents so emitDecoratorMetadata does not hit TDZ.
export class CardDetailsDto {
  @IsString()
  @MaxLength(4)
  lastFour!: string;

  @IsString()
  @MaxLength(32)
  brand!: string;
}

export class PaymentDataDto {
  @IsIn(LEGACY_PAYMENT_METHODS)
  method!: (typeof LEGACY_PAYMENT_METHODS)[number];

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CardDetailsDto)
  cardDetails?: CardDetailsDto;
}

export class ProcessPaymentDto {
  @IsString()
  @MaxLength(64)
  orderId!: string;

  @ValidateNested()
  @Type(() => PaymentDataDto)
  paymentData!: PaymentDataDto;
}

export class OfflineTransactionDto {
  @ValidateNested()
  @Type(() => CheckoutDataDto)
  checkoutData!: CheckoutDataDto;

  @IsString()
  @MaxLength(64)
  sessionId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientSaleId?: string;
}

export class SyncOfflineDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OfflineTransactionDto)
  transactions!: OfflineTransactionDto[];
}

export class EndSessionDto {
  @IsString()
  @MaxLength(64)
  sessionId!: string;

  @IsString()
  @MaxLength(64)
  cashierId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  closingCashCounted?: number;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  managerPin?: string;
}

export class VoidOrderDto {
  @IsString()
  @MaxLength(64)
  orderId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  cashierId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  managerPin?: string;
}

export class WillcallLookupDto {
  @IsString()
  @MaxLength(200)
  q!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  organizationId?: string;
}

export class WillcallFulfillDto {
  @IsString()
  @MaxLength(64)
  orderId!: string;

  @IsString()
  @MaxLength(64)
  cashierId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  terminalId?: string;
}

export class ExchangeDto {
  @IsString()
  @MaxLength(64)
  orderId!: string;

  @IsString()
  @MaxLength(64)
  sessionId!: string;

  @IsString()
  @MaxLength(64)
  terminalId!: string;

  @IsString()
  @MaxLength(64)
  cashierId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  newOfferId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  newSeatIds?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  quantity?: number;

  @IsIn(EXCHANGE_PAYMENT_METHODS)
  paymentMethod!: (typeof EXCHANGE_PAYMENT_METHODS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(16)
  managerPin?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cashReceived?: number;
}

export class CashDropDto {
  @IsString()
  @MaxLength(64)
  sessionId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(1_000_000)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  @IsString()
  @MaxLength(64)
  cashierId!: string;
}

export class ManagerPinDto {
  @IsString()
  @MaxLength(64)
  organizationId!: string;

  @IsString()
  @MaxLength(16)
  pin!: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  currentPin?: string;
}

export class VerifyPinDto {
  @IsString()
  @MaxLength(64)
  organizationId!: string;

  @IsString()
  @MaxLength(16)
  pin!: string;
}

export class HandoffDto {
  @IsString()
  @MaxLength(64)
  sessionId!: string;

  @IsString()
  @MaxLength(64)
  fromCashierId!: string;

  @IsString()
  @MaxLength(64)
  toCashierId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  openingCash?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  closingCashCounted?: number;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  managerPin?: string;
}

export class ScanBarcodeDto {
  @IsString()
  @MaxLength(64)
  terminalId!: string;

  @IsString()
  @MaxLength(128)
  barcode!: string;
}

export class SyncInventoryDto {
  @IsString()
  @MaxLength(64)
  terminalId!: string;

  @IsString()
  @MaxLength(64)
  eventId!: string;
}

export class ZReportsQueryDto {
  @IsString()
  @MaxLength(64)
  organizationId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;
}

export class SessionSummaryQueryDto {
  @IsString()
  @MaxLength(64)
  sessionId!: string;
}

export class ReceiptQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  terminalId?: string;
}

export class OrderIdParamDto {
  @IsString()
  @MaxLength(64)
  orderId!: string;
}

export class TerminalIdParamDto {
  @IsString()
  @MaxLength(64)
  terminalId!: string;
}

export class AnalyticsParamsDto {
  @IsString()
  @MaxLength(64)
  terminalId!: string;

  @IsIn(ANALYTICS_PERIODS)
  period!: (typeof ANALYTICS_PERIODS)[number];
}
