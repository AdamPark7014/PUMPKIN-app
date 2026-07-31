/**
 * Guards del embudo de pago. Pure functions, sin dependencias de React, para
 * que carrito y checkout puedan compartir la misma lógica de doble envío,
 * idempotencia y validación de formulario.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CheckoutForm = {
  name: string;
  email: string;
  holdIds: readonly string[];
  holdExpired: boolean;
};

export type CheckoutFormErrors = {
  name?: string;
  email?: string;
  holds?: string;
};

export function validateCheckoutForm(form: CheckoutForm): CheckoutFormErrors {
  const errors: CheckoutFormErrors = {};
  const name = form.name.trim();
  const email = form.email.trim().toLowerCase();

  if (!name) errors.name = 'Escribe tu nombre completo';
  else if (name.length < 2) errors.name = 'El nombre es demasiado corto';

  if (!email) errors.email = 'Escribe un email válido';
  else if (!EMAIL_RE.test(email)) errors.email = 'El email no parece válido';

  if (form.holdExpired) {
    errors.holds = 'Tu reserva expiró. Vuelve al evento y elige asientos de nuevo.';
  } else if (form.holdIds.length === 0) {
    errors.holds = 'No hay asientos reservados. Vuelve al mapa para continuar.';
  }

  return errors;
}

export function hasCheckoutErrors(errors: CheckoutFormErrors): boolean {
  return Boolean(errors.name || errors.email || errors.holds);
}

/**
 * Clave de idempotencia estable durante un intento de pago.
 *
 * Se genera una sola vez al montar el checkout y se reutiliza en reintentos del
 * mismo intento (mismo hold + mismo email). Al cambiar holds o email, se rota
 * para no colisionar con una orden anterior del mismo navegador.
 *
 * El backend deduplica por esta clave en `paymentIntent.idempotencyKey`.
 */
export function buildIdempotencySeed(input: {
  eventId: string;
  holdIds: readonly string[];
  email: string;
}): string {
  const holds = [...input.holdIds].sort().join(',');
  return `${input.eventId}|${holds}|${input.email.trim().toLowerCase()}`;
}

/** UUID v4 vía Web Crypto; fallback para entornos sin `crypto.randomUUID`. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Mensajes de pago amigables. Mapea códigos Nest conocidos a copy es-MX;
 * cualquier otro texto del backend se pasa tal cual (nunca se inventa).
 */
export function paymentErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'No pudimos procesar el pago. Inténtalo de nuevo.';

  const lower = raw.toLowerCase();
  if (lower.includes('hold') || lower.includes('expired') || lower.includes('expir')) {
    return 'Tu reserva de asientos expiró. Vuelve al evento y elige de nuevo.';
  }
  if (lower.includes('idempotency') || lower.includes('already')) {
    return 'Esta compra ya se procesó. Revisa tu email o Mi cuenta.';
  }
  if (lower.includes('offer') && lower.includes('available')) {
    return 'Algunos boletos ya no están disponibles. Elige otros asientos.';
  }
  if (
    lower.includes('network') ||
    lower.includes('fetch') ||
    lower.includes('conectar') ||
    lower.includes('conexión') ||
    lower.includes('conexion')
  ) {
    return 'Sin conexión. Revisa tu red e inténtalo de nuevo — no se cobró dos veces.';
  }
  if (lower.includes('fraud') || lower.includes('blocked')) {
    return 'No pudimos completar esta compra. Prueba otro método o contacta soporte.';
  }
  return raw;
}
