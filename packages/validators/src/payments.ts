import {
  DEFAULT_CURRENCY,
  PaymentMethod,
  toMinorUnits,
} from '@boletera/shared';
import { z } from 'zod';
import {
  currencyCodeSchema,
  emailSchema,
  idSchema,
  moneyAmountSchema,
  paymentMethodSchema,
  requiredText,
} from './common';

const positiveMajorAmount = z
  .number({
    required_error: 'El importe es obligatorio',
    invalid_type_error: 'El importe debe ser numérico',
  })
  .finite('El importe debe ser un número finito')
  .positive('El importe debe ser mayor a cero')
  .max(10_000_000, 'El importe no puede exceder 10,000,000');

export const createPaymentIntentSchema = z
  .object({
    orderId: idSchema,
    amount: positiveMajorAmount,
    currency: currencyCodeSchema.default(DEFAULT_CURRENCY),
    buyerEmail: emailSchema,
    buyerName: requiredText('El nombre del comprador', 160),
    paymentMethod: paymentMethodSchema.default(PaymentMethod.CARD),
    publicId: z
      .string({ invalid_type_error: 'El identificador público debe ser texto' })
      .trim()
      .min(1, 'El identificador público no puede estar vacío')
      .max(64, 'El identificador público no puede exceder 64 caracteres')
      .optional(),
  })
  .transform((payment) => ({
    ...payment,
    amountMinor: toMinorUnits(payment.amount, payment.currency),
    money: {
      amountMinor: toMinorUnits(payment.amount, payment.currency),
      currency: payment.currency,
    },
  }));

export const confirmPaymentSchema = z
  .object({
    orderId: idSchema,
    intentId: idSchema.optional(),
    externalId: z
      .string({ invalid_type_error: 'La referencia externa debe ser texto' })
      .trim()
      .min(1, 'La referencia externa no puede estar vacía')
      .max(128, 'La referencia externa no puede exceder 128 caracteres')
      .optional(),
  })
  .refine((input) => !!input.intentId || !!input.externalId, {
    message: 'Indica el intentId o la referencia externa del pago',
    path: ['intentId'],
  });

export const createRefundSchema = z
  .object({
    orderId: idSchema,
    reason: z
      .string({
        required_error: 'El motivo del reembolso es obligatorio',
        invalid_type_error: 'El motivo del reembolso debe ser texto',
      })
      .trim()
      .min(3, 'Describe el motivo del reembolso (mínimo 3 caracteres)')
      .max(500, 'El motivo no puede exceder 500 caracteres'),
    amount: positiveMajorAmount.optional(),
    currency: currencyCodeSchema.default(DEFAULT_CURRENCY),
    notes: z
      .string({ invalid_type_error: 'Las notas deben ser texto' })
      .trim()
      .max(1_000, 'Las notas no pueden exceder 1,000 caracteres')
      .optional(),
  })
  .transform((refund) => ({
    ...refund,
    amountMinor:
      refund.amount === undefined ? undefined : toMinorUnits(refund.amount, refund.currency),
    money:
      refund.amount === undefined
        ? undefined
        : {
            amountMinor: toMinorUnits(refund.amount, refund.currency),
            currency: refund.currency,
          },
  }));

export const moneyPayloadSchema = moneyAmountSchema;

export type CreatePaymentIntentInput = z.infer<typeof createPaymentIntentSchema>;
export type ConfirmPaymentInput = z.infer<typeof confirmPaymentSchema>;
export type CreateRefundInput = z.infer<typeof createRefundSchema>;
