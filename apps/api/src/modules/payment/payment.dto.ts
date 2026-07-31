import {
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

const PAYMENT_METHODS = ['CARD', 'SPEI', 'OXXO', 'CASH'] as const;
const REFUND_REASONS = [
  'CUSTOMER_REQUEST',
  'PAYMENT_ERROR',
  'DUPLICATE',
  'FRAUD',
  'EVENT_CANCELLED',
  'TICKET_NOT_RECEIVED',
  'CUSTOMER_CHANGED_MIND',
] as const;

export class CreatePaymentIntentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  orderId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  amount!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currency!: string;

  @IsEmail()
  @MaxLength(255)
  buyerEmail!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  buyerName!: string;

  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: (typeof PAYMENT_METHODS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  publicId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class ConfirmPaymentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  orderId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  intentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalId?: string;
}

export class CreateRefundDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  reason!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10_000_000)
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsIn(REFUND_REASONS)
  reasonCode?: (typeof REFUND_REASONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class CompleteManualRefundDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  banorteReference?: string;
}

export class OrderIdParamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  orderId!: string;
}

export class RefundIdParamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  refundId!: string;
}
