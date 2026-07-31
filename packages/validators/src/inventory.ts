import { z } from 'zod';
import { idSchema, ticketStatusSchema } from './common';

export const createHoldSchema = z
  .object({
    eventId: idSchema,
    seatIds: z
      .array(idSchema, {
        invalid_type_error: 'Los asientos deben enviarse como lista',
      })
      .min(1, 'Selecciona al menos un asiento')
      .max(100, 'No puedes reservar más de 100 asientos a la vez')
      .optional(),
    offerId: idSchema.optional(),
    quantity: z
      .number({
        invalid_type_error: 'La cantidad debe ser numérica',
      })
      .int('La cantidad debe ser un entero')
      .min(1, 'La cantidad debe ser al menos 1')
      .max(20, 'No puedes reservar más de 20 boletos a la vez')
      .default(1),
    sessionId: z
      .string({ invalid_type_error: 'El identificador de sesión debe ser texto' })
      .trim()
      .min(1, 'El identificador de sesión no puede estar vacío')
      .max(128, 'El identificador de sesión no puede exceder 128 caracteres')
      .optional(),
    durationMinutes: z
      .number({ invalid_type_error: 'La duración debe ser numérica' })
      .int('La duración debe ser un entero en minutos')
      .min(1, 'La duración debe ser al menos 1 minuto')
      .max(120, 'La duración no puede exceder 120 minutos')
      .optional(),
  })
  .refine((input) => (input.seatIds?.length ?? 0) > 0 || !!input.offerId, {
    message: 'Indica asientos (seatIds) o una oferta (offerId) para crear la retención',
  });

export const releaseHoldSchema = z.object({
  holdIds: z
    .array(idSchema, {
      required_error: 'Debes indicar los holds a liberar',
      invalid_type_error: 'Los holds deben enviarse como lista',
    })
    .min(1, 'Selecciona al menos un hold para liberar')
    .max(100, 'No puedes liberar más de 100 holds a la vez'),
});

export const scanTicketSchema = z.object({
  ticketCode: z
    .string({
      required_error: 'El código del boleto es obligatorio',
      invalid_type_error: 'El código del boleto debe ser texto',
    })
    .trim()
    .min(4, 'El código del boleto es demasiado corto')
    .max(128, 'El código del boleto no puede exceder 128 caracteres'),
  eventId: idSchema.optional(),
  gateId: idSchema.optional(),
});

export const updateTicketStatusSchema = z.object({
  ticketId: idSchema,
  status: ticketStatusSchema,
  reason: z
    .string({ invalid_type_error: 'El motivo debe ser texto' })
    .trim()
    .min(1, 'El motivo no puede estar vacío')
    .max(500, 'El motivo no puede exceder 500 caracteres')
    .optional(),
});

export const transferTicketSchema = z.object({
  ticketId: idSchema,
  recipientEmail: z
    .string({
      required_error: 'El correo del destinatario es obligatorio',
      invalid_type_error: 'El correo del destinatario debe ser texto',
    })
    .trim()
    .email('Escribe un correo electrónico válido para el destinatario')
    .max(255, 'El correo no puede exceder 255 caracteres')
    .transform((value) => value.toLowerCase()),
  recipientName: z
    .string({
      required_error: 'El nombre del destinatario es obligatorio',
      invalid_type_error: 'El nombre del destinatario debe ser texto',
    })
    .trim()
    .min(1, 'El nombre del destinatario es obligatorio')
    .max(160, 'El nombre del destinatario no puede exceder 160 caracteres'),
});

export type CreateHoldInput = z.infer<typeof createHoldSchema>;
export type ReleaseHoldInput = z.infer<typeof releaseHoldSchema>;
export type ScanTicketInput = z.infer<typeof scanTicketSchema>;
export type UpdateTicketStatusInput = z.infer<typeof updateTicketStatusSchema>;
export type TransferTicketInput = z.infer<typeof transferTicketSchema>;
