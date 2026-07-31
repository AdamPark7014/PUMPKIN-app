import {
  DEFAULT_CURRENCY,
  MAX_OCCURRENCES,
  PLATFORM_TIMEZONE,
  isValidTimezone,
  toMinorUnits,
  type RecurrenceFrequency,
  type SalePhaseKind,
  type Weekday,
} from '@boletera/shared';
import { z } from 'zod';
import { currencyCodeSchema, idSchema, requiredText } from './common';

const EVENT_KINDS = ['CONCERT', 'SPORTS', 'THEATER', 'FESTIVAL', 'CONFERENCE', 'OTHER'] as const;
const SALE_PHASE_KINDS = ['PRESALE', 'MEMBERS', 'PUBLIC', 'LAST_MINUTE', 'DOOR'] as const;
const RECURRENCE_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
const MONTHLY_MODES = ['DAY_OF_MONTH', 'NTH_WEEKDAY'] as const;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const timezoneSchema = z
  .string({
    required_error: 'La zona horaria es obligatoria',
    invalid_type_error: 'La zona horaria debe ser texto',
  })
  .trim()
  .min(1, 'La zona horaria es obligatoria')
  .max(100, 'La zona horaria no puede exceder 100 caracteres')
  .refine(isValidTimezone, 'Indica una zona horaria IANA válida (por ejemplo America/Mexico_City)')
  .default(PLATFORM_TIMEZONE);

const isoDateTimeSchema = z
  .string({
    required_error: 'La fecha es obligatoria',
    invalid_type_error: 'La fecha debe ser texto',
  })
  .trim()
  .min(1, 'La fecha es obligatoria')
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'Usa una fecha y hora válidas (ISO-8601)',
  });

const localDateSchema = z
  .string({ invalid_type_error: 'La fecha local debe ser texto' })
  .regex(LOCAL_DATE, 'Usa una fecha local con formato AAAA-MM-DD');

const localDateTimeSchema = z
  .string({
    required_error: 'La fecha local de inicio es obligatoria',
    invalid_type_error: 'La fecha local debe ser texto',
  })
  .regex(LOCAL_DATE_TIME, 'Usa fecha y hora local con formato AAAA-MM-DDTHH:mm');

const basePriceSchema = z
  .number({
    required_error: 'El precio base es obligatorio',
    invalid_type_error: 'El precio base debe ser numérico',
  })
  .finite('El precio base debe ser un número finito')
  .nonnegative('El precio base no puede ser negativo')
  .max(10_000_000, 'El precio base no puede exceder 10,000,000');

const capacitySchema = z
  .number({
    required_error: 'La capacidad es obligatoria',
    invalid_type_error: 'La capacidad debe ser numérica',
  })
  .int('La capacidad debe ser un entero')
  .min(1, 'La capacidad debe ser al menos 1')
  .max(1_000_000, 'La capacidad no puede exceder 1,000,000');

const weekdaySchema = z
  .number({ invalid_type_error: 'El día de la semana debe ser numérico' })
  .int('El día de la semana debe ser un entero')
  .min(0, 'El día de la semana debe estar entre 0 (domingo) y 6 (sábado)')
  .max(6, 'El día de la semana debe estar entre 0 (domingo) y 6 (sábado)') as z.ZodType<Weekday>;

export const recurrenceRuleSchema = z
  .object({
    frequency: z.enum(RECURRENCE_FREQUENCIES, {
      errorMap: () => ({ message: 'Selecciona una frecuencia de recurrencia válida' }),
    }) satisfies z.ZodType<RecurrenceFrequency>,
    startLocal: localDateTimeSchema,
    timezone: timezoneSchema,
    interval: z
      .number({ invalid_type_error: 'El intervalo debe ser numérico' })
      .int('El intervalo debe ser un entero')
      .min(1, 'El intervalo debe ser al menos 1')
      .max(52, 'El intervalo no puede exceder 52')
      .optional(),
    count: z
      .number({ invalid_type_error: 'El número de fechas debe ser numérico' })
      .int('El número de fechas debe ser un entero')
      .min(1, 'Debes generar al menos 1 fecha')
      .max(MAX_OCCURRENCES, `No puedes generar más de ${MAX_OCCURRENCES} fechas`)
      .optional(),
    untilLocal: localDateSchema.optional(),
    byWeekday: z
      .array(weekdaySchema, {
        invalid_type_error: 'Los días de la semana deben enviarse como lista',
      })
      .min(1, 'Selecciona al menos un día de la semana')
      .max(7, 'No puedes repetir más de 7 días')
      .optional(),
    monthlyMode: z
      .enum(MONTHLY_MODES, {
        errorMap: () => ({ message: 'Selecciona un modo mensual válido' }),
      })
      .optional(),
    nth: z
      .union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.literal(-1),
      ], {
        errorMap: () => ({
          message: 'Indica 1–4 para la semana del mes, o -1 para la última',
        }),
      })
      .optional(),
    nthWeekday: weekdaySchema.optional(),
    exceptions: z
      .array(localDateSchema, {
        invalid_type_error: 'Las excepciones deben enviarse como lista de fechas',
      })
      .max(500, 'No puedes indicar más de 500 excepciones')
      .optional(),
    extraDates: z
      .array(localDateTimeSchema, {
        invalid_type_error: 'Las fechas extra deben enviarse como lista',
      })
      .max(500, 'No puedes indicar más de 500 fechas extra')
      .optional(),
  })
  .superRefine((rule, ctx) => {
    if (rule.count !== undefined && rule.untilLocal !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['count'],
        message: 'Usa solo una condición de fin: número de fechas o fecha límite',
      });
    }
    if (rule.frequency === 'WEEKLY' && rule.byWeekday === undefined) {
      return;
    }
    if (rule.frequency !== 'WEEKLY' && rule.byWeekday !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['byWeekday'],
        message: 'Los días de la semana solo aplican a recurrencias semanales',
      });
    }
    if (rule.frequency !== 'MONTHLY' && (rule.monthlyMode || rule.nth !== undefined || rule.nthWeekday !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['monthlyMode'],
        message: 'Los campos mensuales solo aplican a recurrencias mensuales',
      });
    }
    if (rule.monthlyMode === 'NTH_WEEKDAY' && rule.nth === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nth'],
        message: 'Indica qué semana del mes usar (1–4 o -1)',
      });
    }
  });

export const salePhaseSchema = z
  .object({
    id: idSchema.optional(),
    name: requiredText('El nombre de la fase', 120).optional(),
    kind: z.enum(SALE_PHASE_KINDS, {
      errorMap: () => ({ message: 'Selecciona un tipo de fase de venta válido' }),
    }) satisfies z.ZodType<SalePhaseKind>,
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema,
    code: z
      .string({ invalid_type_error: 'El código de fase debe ser texto' })
      .trim()
      .min(1, 'El código de fase no puede estar vacío')
      .max(64, 'El código de fase no puede exceder 64 caracteres')
      .nullable()
      .optional(),
    active: z
      .boolean({ invalid_type_error: 'El estado activo de la fase debe ser verdadero o falso' })
      .optional(),
  })
  .refine((phase) => new Date(phase.endsAt).getTime() > new Date(phase.startsAt).getTime(), {
    message: 'La fase de venta debe terminar después de iniciar',
    path: ['endsAt'],
  });

export const createEventSchema = z
  .object({
    title: requiredText('El título del evento', 160),
    description: z
      .string({
        required_error: 'La descripción es obligatoria',
        invalid_type_error: 'La descripción debe ser texto',
      })
      .trim()
      .min(1, 'La descripción es obligatoria')
      .max(10_000, 'La descripción no puede exceder 10,000 caracteres'),
    type: z.enum(EVENT_KINDS, {
      errorMap: () => ({ message: 'Selecciona un tipo de evento válido' }),
    }),
    startDate: isoDateTimeSchema,
    endDate: isoDateTimeSchema.optional(),
    venueId: idSchema,
    capacity: capacitySchema,
    basePrice: basePriceSchema,
    currency: currencyCodeSchema.default(DEFAULT_CURRENCY),
    imageUrl: z
      .string({ invalid_type_error: 'La URL de imagen debe ser texto' })
      .url('Escribe una URL de imagen válida')
      .max(2_048, 'La URL de imagen no puede exceder 2,048 caracteres')
      .optional(),
    timezone: timezoneSchema,
    announceAt: isoDateTimeSchema.optional(),
    publishAt: isoDateTimeSchema.optional(),
    salesStartAt: isoDateTimeSchema.optional(),
    salesEndAt: isoDateTimeSchema.optional(),
    phases: z
      .array(salePhaseSchema, {
        invalid_type_error: 'Las fases de venta deben enviarse como lista',
      })
      .max(20, 'No puedes definir más de 20 fases de venta')
      .optional(),
    recurrence: recurrenceRuleSchema.optional(),
  })
  .superRefine((event, ctx) => {
    if (event.endDate && new Date(event.endDate).getTime() < new Date(event.startDate).getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'La fecha de fin debe ser igual o posterior al inicio',
      });
    }
    if (
      event.salesStartAt &&
      event.salesEndAt &&
      new Date(event.salesEndAt).getTime() <= new Date(event.salesStartAt).getTime()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['salesEndAt'],
        message: 'El cierre de ventas debe ser posterior al inicio de ventas',
      });
    }
  })
  .transform((event) => ({
    ...event,
    basePriceMinor: toMinorUnits(event.basePrice, event.currency),
  }));

export const updateEventSchema = z
  .object({
    title: requiredText('El título del evento', 160).optional(),
    description: z
      .string({ invalid_type_error: 'La descripción debe ser texto' })
      .trim()
      .min(1, 'La descripción no puede estar vacía')
      .max(10_000, 'La descripción no puede exceder 10,000 caracteres')
      .optional(),
    startDate: isoDateTimeSchema.optional(),
    endDate: isoDateTimeSchema.optional(),
    capacity: capacitySchema.optional(),
    basePrice: basePriceSchema.optional(),
    currency: currencyCodeSchema.optional(),
    imageUrl: z
      .string({ invalid_type_error: 'La URL de imagen debe ser texto' })
      .url('Escribe una URL de imagen válida')
      .max(2_048, 'La URL de imagen no puede exceder 2,048 caracteres')
      .nullable()
      .optional(),
    timezone: timezoneSchema.optional(),
    announceAt: isoDateTimeSchema.nullable().optional(),
    publishAt: isoDateTimeSchema.nullable().optional(),
    salesStartAt: isoDateTimeSchema.nullable().optional(),
    salesEndAt: isoDateTimeSchema.nullable().optional(),
    phases: z
      .array(salePhaseSchema, {
        invalid_type_error: 'Las fases de venta deben enviarse como lista',
      })
      .max(20, 'No puedes definir más de 20 fases de venta')
      .optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Indica al menos un dato para actualizar',
  });

export type RecurrenceRuleInput = z.infer<typeof recurrenceRuleSchema>;
export type SalePhaseInput = z.infer<typeof salePhaseSchema>;
export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
