import type {
  SeatMapAisle,
  SeatMapBlock,
  SeatMapCadLocks,
  SeatMapData,
  SeatMapEgressPolicy,
  SeatMapExit,
  SeatMapFocusPoint,
  SeatMapFurniture,
  SeatMapLevel,
  SeatMapObstacle,
  SeatMapSeat,
  SeatMapSection,
  SeatMapShape,
  SeatMapStage,
  SeatMapStair,
  SeatMapVenueMeta,
  SeatVisibility,
} from '@boletera/shared';
import { z } from 'zod';
import { idSchema, requiredText } from './common';

const finiteNumber = (field: string) =>
  z
    .number({
      required_error: `${field} es obligatorio`,
      invalid_type_error: `${field} debe ser numérico`,
    })
    .finite(`${field} debe ser un número finito`);

const pointTupleSchema = z.tuple(
  [finiteNumber('La coordenada X'), finiteNumber('La coordenada Y')],
  {
    invalid_type_error: 'Cada punto debe ser un par [x, y]',
    required_error: 'Cada punto es obligatorio',
  },
);

const pointsSchema = z
  .array(pointTupleSchema, {
    invalid_type_error: 'Los puntos deben enviarse como lista',
  })
  .min(1, 'Debes indicar al menos un punto');

const seatVisibilitySchema = z.object({
  blocked: z.boolean().optional(),
  restrictedView: z.boolean().optional(),
  premiumView: z.boolean().optional(),
}) satisfies z.ZodType<SeatVisibility>;

const seatMapSeatSchema = z.object({
  id: idSchema,
  label: requiredText('La etiqueta del asiento', 64),
  row: z.string().trim().max(32, 'La fila no puede exceder 32 caracteres').optional(),
  x: finiteNumber('La coordenada X del asiento'),
  y: finiteNumber('La coordenada Y del asiento'),
  rotation: finiteNumber('La rotación del asiento').optional(),
  tier: z.string().trim().max(64, 'El tier no puede exceder 64 caracteres').optional(),
  coord3d: z
    .object({
      x: finiteNumber('La coordenada 3D X'),
      y: finiteNumber('La coordenada 3D Y'),
      z: finiteNumber('La coordenada 3D Z'),
      pitch: finiteNumber('El pitch').optional(),
      roll: finiteNumber('El roll').optional(),
    })
    .optional(),
  position: z
    .object({
      x: finiteNumber('La posición X'),
      y: finiteNumber('La posición Y'),
      z: finiteNumber('La posición Z'),
    })
    .optional(),
  rotation3d: z
    .object({
      x: finiteNumber('La rotación 3D X'),
      y: finiteNumber('La rotación 3D Y'),
      z: finiteNumber('La rotación 3D Z'),
    })
    .optional(),
  elevation: finiteNumber('La elevación del asiento').optional(),
  visibility: seatVisibilitySchema.optional(),
  levelId: idSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
}) satisfies z.ZodType<SeatMapSeat>;

const seatMapShapeSchema = z.object({
  points: pointsSchema.min(3, 'El contorno necesita al menos 3 puntos'),
}) satisfies z.ZodType<SeatMapShape>;

const seatMapBlockSchema = z.object({
  id: idSchema,
  label: z.string().trim().max(120, 'La etiqueta del bloque no puede exceder 120 caracteres').optional(),
  origin: z.object({
    x: finiteNumber('El origen X del bloque'),
    y: finiteNumber('El origen Y del bloque'),
  }),
  rows: z
    .number({ invalid_type_error: 'Las filas del bloque deben ser numéricas' })
    .int('Las filas del bloque deben ser un entero')
    .min(1, 'El bloque debe tener al menos 1 fila')
    .max(500, 'El bloque no puede tener más de 500 filas'),
  seatsPerRow: z
    .number({ invalid_type_error: 'Los asientos por fila deben ser numéricos' })
    .int('Los asientos por fila deben ser un entero')
    .min(1, 'Cada fila debe tener al menos 1 asiento')
    .max(500, 'Cada fila no puede tener más de 500 asientos'),
  seatPitch: finiteNumber('La separación entre asientos').positive(
    'La separación entre asientos debe ser mayor a cero',
  ),
  rowPitch: finiteNumber('La separación entre filas').positive(
    'La separación entre filas debe ser mayor a cero',
  ),
  rake: finiteNumber('El rake del bloque').optional(),
  curvature: finiteNumber('La curvatura del bloque').optional(),
  yaw: finiteNumber('El yaw del bloque').optional(),
  elevation: finiteNumber('La elevación del bloque').optional(),
  startRowLabel: z
    .string()
    .trim()
    .max(32, 'La etiqueta de fila inicial no puede exceder 32 caracteres')
    .optional(),
  tier: z.string().trim().max(64, 'El tier del bloque no puede exceder 64 caracteres').optional(),
  skipColumns: z
    .array(
      z
        .number({ invalid_type_error: 'Las columnas omitidas deben ser numéricas' })
        .int('Las columnas omitidas deben ser enteros')
        .nonnegative('Las columnas omitidas no pueden ser negativas'),
    )
    .optional(),
}) satisfies z.ZodType<SeatMapBlock>;

const seatMapSectionSchema = z.object({
  id: idSchema,
  name: requiredText('El nombre de la sección', 120),
  slug: requiredText('El slug de la sección', 120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'El slug solo puede usar minúsculas, números y guiones'),
  color: z
    .string({
      required_error: 'El color de la sección es obligatorio',
      invalid_type_error: 'El color de la sección debe ser texto',
    })
    .trim()
    .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Usa un color hexadecimal válido (#RGB o #RRGGBB)'),
  seats: z.array(seatMapSeatSchema, {
    required_error: 'La sección debe incluir asientos',
    invalid_type_error: 'Los asientos deben enviarse como lista',
  }),
  shape: seatMapShapeSchema.optional(),
  blocks: z.array(seatMapBlockSchema).optional(),
  rake: finiteNumber('El rake de la sección').optional(),
  seatPitch: finiteNumber('La separación entre asientos').optional(),
  rowPitch: finiteNumber('La separación entre filas').optional(),
  curvature: finiteNumber('La curvatura de la sección').optional(),
  levelId: idSchema.optional(),
  locked: z.boolean().optional(),
}) satisfies z.ZodType<SeatMapSection>;

const seatMapStageSchema = z.object({
  x: finiteNumber('La coordenada X del escenario'),
  y: finiteNumber('La coordenada Y del escenario'),
  width: finiteNumber('El ancho del escenario').positive('El ancho del escenario debe ser mayor a cero'),
  rotation: finiteNumber('La rotación del escenario').optional(),
  elevation: finiteNumber('La elevación del escenario').optional(),
}) satisfies z.ZodType<SeatMapStage>;

const seatMapFurnitureSchema = z.object({
  id: idSchema,
  type: z.enum(['led', 'speaker', 'door'], {
    errorMap: () => ({ message: 'Selecciona un tipo de mobiliario válido' }),
  }),
  x: finiteNumber('La coordenada X del mobiliario'),
  y: finiteNumber('La coordenada Y del mobiliario'),
  rotation: finiteNumber('La rotación del mobiliario').optional(),
  levelId: idSchema.optional(),
}) satisfies z.ZodType<SeatMapFurniture>;

const seatMapLevelSchema = z.object({
  id: idSchema,
  name: requiredText('El nombre del nivel', 120),
  elevation: finiteNumber('La elevación del nivel'),
  zIndex: z
    .number({ invalid_type_error: 'El zIndex debe ser numérico' })
    .int('El zIndex debe ser un entero'),
}) satisfies z.ZodType<SeatMapLevel>;

const seatMapAisleSchema = z.object({
  id: idSchema,
  points: pointsSchema.min(2, 'Un pasillo necesita al menos 2 puntos'),
  width: finiteNumber('El ancho del pasillo').positive('El ancho del pasillo debe ser mayor a cero').optional(),
  levelId: idSchema.optional(),
}) satisfies z.ZodType<SeatMapAisle>;

const seatMapObstacleSchema = z.object({
  id: idSchema,
  type: requiredText('El tipo de obstáculo', 64),
  points: pointsSchema.min(3, 'Un obstáculo necesita al menos 3 puntos'),
  height: finiteNumber('La altura del obstáculo').optional(),
  levelId: idSchema.optional(),
}) satisfies z.ZodType<SeatMapObstacle>;

const seatMapStairSchema = z.object({
  id: idSchema,
  kind: z
    .enum(['stairs', 'vomitoria', 'ramp'], {
      errorMap: () => ({ message: 'Selecciona un tipo de escalera o rampa válido' }),
    })
    .optional(),
  points: pointsSchema.min(2, 'Una escalera o rampa necesita al menos 2 puntos'),
  fromLevelId: idSchema.optional(),
  toLevelId: idSchema.optional(),
  width: finiteNumber('El ancho de la escalera').positive('El ancho debe ser mayor a cero').optional(),
}) satisfies z.ZodType<SeatMapStair>;

const seatMapExitSchema = z.object({
  id: idSchema,
  points: pointsSchema,
  label: z.string().trim().max(120, 'La etiqueta de salida no puede exceder 120 caracteres').optional(),
  width: finiteNumber('El ancho de la salida').positive('El ancho de la salida debe ser mayor a cero').optional(),
  levelId: idSchema.optional(),
}) satisfies z.ZodType<SeatMapExit>;

const seatMapFocusPointSchema = z.object({
  id: idSchema,
  label: z.string().trim().max(120, 'La etiqueta del foco no puede exceder 120 caracteres').optional(),
  x: finiteNumber('La coordenada X del foco'),
  y: finiteNumber('La coordenada Y del foco'),
  z: finiteNumber('La coordenada Z del foco').optional(),
  levelId: idSchema.optional(),
}) satisfies z.ZodType<SeatMapFocusPoint>;

const seatMapCadLocksSchema = z.object({
  aisles: z.boolean().optional(),
  obstacles: z.boolean().optional(),
  stairs: z.boolean().optional(),
  stage: z.boolean().optional(),
  furniture: z.boolean().optional(),
  exits: z.boolean().optional(),
  focusPoints: z.boolean().optional(),
  strictOverlaps: z.boolean().optional(),
}) satisfies z.ZodType<SeatMapCadLocks>;

const seatMapEgressPolicySchema = z.object({
  longPathUnits: finiteNumber('El umbral de trayectoria larga').positive().optional(),
  slowClearanceMinutes: finiteNumber('El umbral de desalojo lento').positive().optional(),
  bottleneckUtilization: z
    .number({ invalid_type_error: 'La utilización de cuello de botella debe ser numérica' })
    .min(0, 'La utilización debe estar entre 0 y 1')
    .max(1, 'La utilización debe estar entre 0 y 1')
    .optional(),
  bottleneckSeatLoad: z
    .number({ invalid_type_error: 'La carga de asientos debe ser numérica' })
    .int('La carga de asientos debe ser un entero')
    .positive('La carga de asientos debe ser mayor a cero')
    .optional(),
}) satisfies z.ZodType<SeatMapEgressPolicy>;

const seatMapVenueMetaSchema = z.object({
  stage: seatMapStageSchema.optional(),
  furniture: z.array(seatMapFurnitureSchema).optional(),
  levels: z.array(seatMapLevelSchema).optional(),
  aisles: z.array(seatMapAisleSchema).optional(),
  obstacles: z.array(seatMapObstacleSchema).optional(),
  stairs: z.array(seatMapStairSchema).optional(),
  exits: z.array(seatMapExitSchema).optional(),
  units: z
    .enum(['map', 'meters'], {
      errorMap: () => ({ message: 'Las unidades deben ser map o meters' }),
    })
    .optional(),
  scale: finiteNumber('La escala del mapa').positive('La escala debe ser mayor a cero').optional(),
  snapPitch: finiteNumber('El snap del editor').positive('El snap debe ser mayor a cero').optional(),
  cadLocks: seatMapCadLocksSchema.optional(),
  focusPoints: z.array(seatMapFocusPointSchema).optional(),
  egressPolicy: seatMapEgressPolicySchema.optional(),
}) satisfies z.ZodType<SeatMapVenueMeta>;

export const seatMapDataSchema = z
  .object({
    version: z
      .union([z.literal(1), z.literal(2), z.literal(3)], {
        errorMap: () => ({ message: 'La versión del mapa debe ser 1, 2 o 3' }),
      })
      .optional(),
    sections: z
      .array(seatMapSectionSchema, {
        required_error: 'El mapa debe incluir secciones',
        invalid_type_error: 'Las secciones deben enviarse como lista',
      })
      .min(1, 'Agrega al menos una sección al mapa'),
    viewport: z
      .object({
        width: finiteNumber('El ancho del viewport').positive('El ancho del viewport debe ser mayor a cero'),
        height: finiteNumber('El alto del viewport').positive('El alto del viewport debe ser mayor a cero'),
        minX: finiteNumber('El minX del viewport').optional(),
        minY: finiteNumber('El minY del viewport').optional(),
      })
      .optional(),
    venue: seatMapVenueMetaSchema.optional(),
  })
  .superRefine((map, ctx) => {
    const seatIds = new Set<string>();
    for (const [sectionIndex, section] of map.sections.entries()) {
      for (const [seatIndex, seat] of section.seats.entries()) {
        if (seatIds.has(seat.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['sections', sectionIndex, 'seats', seatIndex, 'id'],
            message: `El asiento "${seat.id}" está duplicado en el mapa`,
          });
        }
        seatIds.add(seat.id);
      }
    }
  }) satisfies z.ZodType<SeatMapData>;

export const venueLayoutSchema = z.object({
  name: requiredText('El nombre del recinto', 120),
  mapData: seatMapDataSchema,
});

export const createVenueSchema = z.object({
  name: requiredText('El nombre del recinto', 160),
  address: requiredText('La dirección del recinto', 255),
  city: requiredText('La ciudad', 120),
  timezone: z
    .string({
      required_error: 'La zona horaria es obligatoria',
      invalid_type_error: 'La zona horaria debe ser texto',
    })
    .trim()
    .min(1, 'La zona horaria es obligatoria')
    .max(100, 'La zona horaria no puede exceder 100 caracteres'),
  capacity: z
    .number({
      required_error: 'La capacidad es obligatoria',
      invalid_type_error: 'La capacidad debe ser numérica',
    })
    .int('La capacidad debe ser un entero')
    .min(1, 'La capacidad debe ser al menos 1')
    .max(1_000_000, 'La capacidad no puede exceder 1,000,000')
    .optional(),
  layout: venueLayoutSchema.optional(),
});

export type SeatMapDataInput = z.infer<typeof seatMapDataSchema>;
export type VenueLayoutInput = z.infer<typeof venueLayoutSchema>;
export type CreateVenueInput = z.infer<typeof createVenueSchema>;
