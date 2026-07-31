export const SEED_VERSION = 'demo-v2';
export const SEED_PASSWORD = 'Admin123!';

/** Fixed epoch for reproducible relative dates (2026-07-30 local MX intent). */
export const SEED_NOW = new Date('2026-07-30T18:00:00-06:00');

export const DEMO_ORG_SLUGS = [
  'boletera-plataforma',
  'ocesa-live',
  'cie-espectaculos',
  'teatro-nacional-mx',
  'demo-boletera',
] as const;

export const FIRST_NAMES = [
  'María', 'José', 'Ana', 'Luis', 'Carlos', 'Sofía', 'Diego', 'Valentina',
  'Miguel', 'Camila', 'Fernando', 'Lucia', 'Ricardo', 'Andrea', 'Jorge',
  'Paola', 'Andrés', 'Daniela', 'Héctor', 'Fernanda', 'Roberto', 'Alejandra',
  'Eduardo', 'Gabriela', 'Santiago', 'Isabel', 'Francisco', 'Renata', 'Pablo',
  'Mariana', 'Ángel', 'Ximena', 'Raúl', 'Natalia', 'Emilio', 'Regina',
] as const;

export const LAST_NAMES = [
  'García', 'Hernández', 'López', 'Martínez', 'González', 'Pérez', 'Rodríguez',
  'Sánchez', 'Ramírez', 'Torres', 'Flores', 'Rivera', 'Gómez', 'Díaz',
  'Cruz', 'Morales', 'Reyes', 'Ortiz', 'Gutiérrez', 'Chávez', 'Ramos',
  'Vargas', 'Castillo', 'Jiménez', 'Moreno', 'Romero', 'Álvarez', 'Mendoza',
] as const;

export const MX_CITIES = [
  { city: 'Ciudad de México', state: 'CDMX' },
  { city: 'Guadalajara', state: 'Jalisco' },
  { city: 'Monterrey', state: 'Nuevo León' },
  { city: 'Puebla', state: 'Puebla' },
  { city: 'Querétaro', state: 'Querétaro' },
  { city: 'Tijuana', state: 'Baja California' },
  { city: 'León', state: 'Guanajuato' },
  { city: 'Mérida', state: 'Yucatán' },
] as const;

export function mxPhone(rng: { int: (a: number, b: number) => number }): string {
  const a = rng.int(55, 99);
  const b = rng.int(1000, 9999);
  const c = rng.int(1000, 9999);
  return `+52 ${a} ${b} ${c}`;
}

export function daysFromSeed(n: number, hour = 20, minute = 0): Date {
  const d = new Date(SEED_NOW);
  d.setDate(d.getDate() + n);
  d.setHours(hour, minute, 0, 0);
  return d;
}

export function monthsAgo(months: number, day = 15): Date {
  const d = new Date(SEED_NOW);
  d.setMonth(d.getMonth() - months);
  d.setDate(day);
  d.setHours(12, 0, 0, 0);
  return d;
}

/** Sales velocity curve: early spike at onsale, weekend boost, late rush. */
export function salesWeightAt(
  saleDay: number,
  totalSaleDays: number,
  weekday: number,
): number {
  const t = saleDay / Math.max(totalSaleDays, 1);
  const announceSpike = Math.exp(-Math.pow(t * 8, 2)) * 2.2;
  const mid = 0.35 + 0.25 * Math.sin(t * Math.PI);
  const lateRush = Math.exp(-Math.pow((1 - t) * 5, 2)) * 2.8;
  const weekend = weekday === 0 || weekday === 6 ? 1.45 : weekday === 5 ? 1.25 : 1;
  return Math.max(0.05, (announceSpike + mid + lateRush) * weekend);
}
