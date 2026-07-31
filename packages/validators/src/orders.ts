import { PaymentMethod } from '@boletera/shared';
import { z } from 'zod';
import {
  emailSchema,
  idSchema,
  orderStatusSchema,
  paymentMethodSchema,
  phoneSchema,
  requiredText,
  salesChannelSchema,
} from './common';

const orderItemSchema = z.object({
  offerId: idSchema,
  holdIds: z
    .array(idSchema, {
      required_error: 'Debes indicar los holds del artículo',
      invalid_type_error: 'Los holds del artículo deben enviarse como lista',
    })
    .min(1, 'Cada artículo necesita al menos un hold'),
});

export const createOrderSchema = z.object({
  eventId: idSchema,
  holdIds: z
    .array(idSchema, {
      required_error: 'Debes indicar al menos un hold',
      invalid_type_error: 'Los holds deben enviarse como lista',
    })
    .min(1, 'Selecciona al menos un hold para crear la orden'),
  items: z
    .array(orderItemSchema, {
      invalid_type_error: 'Los artículos deben enviarse como lista',
    })
    .min(1, 'Agrega al menos un artículo a la orden')
    .optional(),
  buyerName: requiredText('El nombre del comprador', 160),
  buyerEmail: emailSchema,
  buyerPhone: phoneSchema.optional(),
  promotionCode: z
    .string({ invalid_type_error: 'El código promocional debe ser texto' })
    .trim()
    .min(1, 'El código promocional no puede estar vacío')
    .max(64, 'El código promocional no puede exceder 64 caracteres')
    .optional(),
  paymentMethod: paymentMethodSchema.default(PaymentMethod.CARD),
  channel: salesChannelSchema.optional(),
});

export const updateOrderStatusSchema = z.object({
  orderId: idSchema,
  status: orderStatusSchema,
  reason: z
    .string({ invalid_type_error: 'El motivo debe ser texto' })
    .trim()
    .min(1, 'El motivo no puede estar vacío')
    .max(500, 'El motivo no puede exceder 500 caracteres')
    .optional(),
});

export const cancelOrderSchema = z.object({
  orderId: idSchema,
  reason: z
    .string({
      required_error: 'El motivo de cancelación es obligatorio',
      invalid_type_error: 'El motivo de cancelación debe ser texto',
    })
    .trim()
    .min(3, 'Describe el motivo de cancelación (mínimo 3 caracteres)')
    .max(500, 'El motivo no puede exceder 500 caracteres'),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;
