import {
  DEFAULT_CURRENCY,
  ORDER_STATUS_VALUES,
  PAYMENT_METHOD_VALUES,
  PAYMENT_STATUS_VALUES,
  SALES_CHANNEL_VALUES,
  TICKET_STATUS_VALUES,
  USER_ROLE_VALUES,
  isCurrencyCode,
  toMinorUnits,
  type CurrencyCode,
  type MoneyAmount,
  type OrderStatusValue,
  type PaymentMethodValue,
  type PaymentStatusValue,
  type SalesChannelValue,
  type TicketStatusValue,
  type UserRoleValue,
} from '@boletera/shared';
import { z } from 'zod';

const requiredText = (field: string, maximum: number) =>
  z
    .string({
      required_error: `${field} es obligatorio`,
      invalid_type_error: `${field} debe ser texto`,
    })
    .trim()
    .min(1, `${field} es obligatorio`)
    .max(maximum, `${field} no puede exceder ${maximum} caracteres`);

export const idSchema = requiredText('El identificador', 128);

export const emailSchema = z
  .string({ required_error: 'El correo electrónico es obligatorio' })
  .trim()
  .email('Escribe un correo electrónico válido')
  .max(255, 'El correo electrónico no puede exceder 255 caracteres')
  .transform((value) => value.toLowerCase());

export const phoneSchema = z
  .string({ invalid_type_error: 'El teléfono debe ser texto' })
  .trim()
  .min(8, 'El teléfono debe tener al menos 8 dígitos')
  .max(20, 'El teléfono no puede exceder 20 caracteres')
  .regex(/^\+?[\d\s()-]+$/, 'Escribe un teléfono válido');

function enumSchema<T extends string>(values: readonly T[], message: string): z.ZodType<T> {
  const [first, ...rest] = values;
  if (!first) {
    throw new Error('Se requiere al menos un valor de enumeración');
  }
  return z.enum([first, ...rest], {
    errorMap: () => ({ message }),
  });
}

export const salesChannelSchema = enumSchema<SalesChannelValue>(
  SALES_CHANNEL_VALUES,
  'Selecciona un canal de venta válido',
);
export const userRoleSchema = enumSchema<UserRoleValue>(
  USER_ROLE_VALUES,
  'Selecciona un rol de usuario válido',
);
export const ticketStatusSchema = enumSchema<TicketStatusValue>(
  TICKET_STATUS_VALUES,
  'Selecciona un estado de boleto válido',
);
export const orderStatusSchema = enumSchema<OrderStatusValue>(
  ORDER_STATUS_VALUES,
  'Selecciona un estado de orden válido',
);
export const paymentStatusSchema = enumSchema<PaymentStatusValue>(
  PAYMENT_STATUS_VALUES,
  'Selecciona un estado de pago válido',
);
export const paymentMethodSchema = enumSchema<PaymentMethodValue>(
  PAYMENT_METHOD_VALUES,
  'Selecciona un método de pago válido',
);

export const currencyCodeSchema = z
  .string({
    required_error: 'La moneda es obligatoria',
    invalid_type_error: 'La moneda debe ser texto',
  })
  .trim()
  .transform((value, ctx): CurrencyCode => {
    const upper = value.toUpperCase();
    if (!isCurrencyCode(upper)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Usa una moneda admitida: MXN o USD',
      });
      return z.NEVER;
    }
    return upper;
  });

export const moneyAmountSchema = z.object({
  amountMinor: z
    .number({
      required_error: 'El importe en centavos es obligatorio',
      invalid_type_error: 'El importe en centavos debe ser numérico',
    })
    .int('El importe debe expresarse en centavos enteros')
    .safe('El importe está fuera del rango permitido')
    .nonnegative('El importe no puede ser negativo'),
  currency: currencyCodeSchema.default(DEFAULT_CURRENCY),
});

export const majorMoneySchema = z
  .object({
    amount: z
      .number({
        required_error: 'El importe es obligatorio',
        invalid_type_error: 'El importe debe ser numérico',
      })
      .finite('El importe debe ser un número finito')
      .nonnegative('El importe no puede ser negativo'),
    currency: currencyCodeSchema.default(DEFAULT_CURRENCY),
  })
  .transform(({ amount, currency }): MoneyAmount => ({
    amountMinor: toMinorUnits(amount, currency),
    currency,
  }));

export { requiredText };

/** Parse helper that returns typed data or Spanish Zod issues. */
export function parseInput<T>(
  schema: z.ZodType<T>,
  input: unknown,
): { success: true; data: T } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: result.error };
}

export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });
}
