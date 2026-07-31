/**
 * Formatters compartidos del storefront (es-MX / MXN).
 *
 * Todas las fechas se formatean con zona horaria fija de México para que el
 * HTML del servidor y el del cliente coincidan byte a byte. Sin esto, cada
 * página con una fecha genera un mismatch de hidratación.
 */

export const LOCALE = 'es-MX';
export const TIME_ZONE = 'America/Mexico_City';
export const DEFAULT_CURRENCY = 'MXN';

const moneyCache = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string, decimals: boolean): Intl.NumberFormat {
  const key = `${currency}:${decimals ? 'd' : 'i'}`;
  const cached = moneyCache.get(key);
  if (cached) return cached;
  const fmt = new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  });
  moneyCache.set(key, fmt);
  return fmt;
}

/** Convierte strings decimales de la API (`"1234.50"`) a número seguro. */
export function toAmount(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** `$1,250 MXN` — para precios de catálogo y totales redondos. */
export function money(
  value: string | number | null | undefined,
  currency: string = DEFAULT_CURRENCY,
): string {
  return moneyFormatter(currency, false).format(toAmount(value));
}

/** `$1,250.50 MXN` — para desgloses de cobro donde los centavos importan. */
export function moneyExact(
  value: string | number | null | undefined,
  currency: string = DEFAULT_CURRENCY,
): string {
  return moneyFormatter(currency, true).format(toAmount(value));
}

/** `Desde $890` — precio de entrada de un evento. */
export function fromPrice(
  value: string | number | null | undefined,
  currency: string = DEFAULT_CURRENCY,
): string {
  return `Desde ${money(value, currency)}`;
}

const dateCache = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  const cached = dateCache.get(key);
  if (cached) return cached;
  const fmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, ...options });
  dateCache.set(key, fmt);
  return fmt;
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `sábado, 14 de marzo de 2026` */
export function fullDate(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  return dateFormatter({
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

/** `sáb 14 mar` */
export function shortDate(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  return dateFormatter({ weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}

/** `20:30 h` */
export function timeOfDay(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  return `${dateFormatter({ hour: '2-digit', minute: '2-digit', hour12: false }).format(d)} h`;
}

/** `sáb 14 mar · 20:30 h` */
export function dateTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  return `${shortDate(d)} · ${timeOfDay(d)}`;
}

/** `sábado, 14 de marzo de 2026 · 20:30 h` — encabezados de evento y orden. */
export function longDateTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  return `${fullDate(d)} · ${timeOfDay(d)}`;
}

/** Partes sueltas para tiles tipo calendario (`14` / `mar`). */
export function calendarParts(
  value: string | number | Date | null | undefined,
): { day: string; month: string; weekday: string } | null {
  const d = toDate(value);
  if (!d) return null;
  return {
    day: dateFormatter({ day: '2-digit' }).format(d),
    month: dateFormatter({ month: 'short' }).format(d).replace('.', ''),
    weekday: dateFormatter({ weekday: 'short' }).format(d).replace('.', ''),
  };
}

/** `2026-03-14` — atributo `dateTime` de `<time>` en zona de México. */
export function isoDateAttr(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  const parts = dateFormatter({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** `05:00` a partir de segundos — cuenta regresiva de holds. */
export function countdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** `4 minutos 12 segundos` — texto para lectores de pantalla. */
export function countdownSpoken(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  if (m === 0) return `${s} segundo${s === 1 ? '' : 's'}`;
  if (s === 0) return `${m} minuto${m === 1 ? '' : 's'}`;
  return `${m} minuto${m === 1 ? '' : 's'} ${s} segundo${s === 1 ? '' : 's'}`;
}

/** `3 boletos` / `1 boleto` */
export function plural(count: number, singular: string, pluralForm?: string): string {
  const word = count === 1 ? singular : (pluralForm ?? `${singular}s`);
  return `${count.toLocaleString(LOCALE)} ${word}`;
}

/** Número simple con separadores de miles. */
export function count(value: number): string {
  return value.toLocaleString(LOCALE);
}

export const CATEGORY_LABEL: Readonly<Record<string, string>> = {
  MUSIC: 'Conciertos',
  SPORTS: 'Deportes',
  THEATER: 'Artes y teatro',
  COMEDY: 'Comedia',
  FESTIVAL: 'Festivales',
  FAMILY: 'Familiares',
  STANDUP: 'Stand-up',
  CINEMA: 'Cine',
  OTHER: 'Eventos',
};

/** Etiqueta singular para migas de pan y encabezados de evento. */
export const CATEGORY_LABEL_SINGULAR: Readonly<Record<string, string>> = {
  MUSIC: 'Concierto',
  SPORTS: 'Deportes',
  THEATER: 'Teatro',
  COMEDY: 'Comedia',
  FESTIVAL: 'Festival',
  FAMILY: 'Familiar',
  STANDUP: 'Stand-up',
  CINEMA: 'Cine',
  OTHER: 'Evento',
};

export function categoryLabel(key: string | null | undefined, singular = false): string {
  if (!key) return singular ? 'Evento' : 'Eventos';
  const table = singular ? CATEGORY_LABEL_SINGULAR : CATEGORY_LABEL;
  return table[key] ?? key;
}

export const ORDER_STATUS_LABEL: Readonly<Record<string, string>> = {
  PENDING: 'Pago pendiente',
  COMPLETED: 'Confirmada',
  CANCELLED: 'Cancelada',
  REFUNDED: 'Reembolsada',
  EXPIRED: 'Expirada',
  FAILED: 'Pago fallido',
};

export function orderStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Desconocido';
  return ORDER_STATUS_LABEL[status] ?? status;
}

export const PAYMENT_METHOD_LABEL: Readonly<Record<string, string>> = {
  CARD: 'Tarjeta',
  SPEI: 'SPEI',
  OXXO: 'OXXO',
  CASH: 'Efectivo',
};

export function paymentMethodLabel(method: string | null | undefined): string {
  if (!method) return 'Pago en línea';
  return PAYMENT_METHOD_LABEL[method] ?? method;
}
