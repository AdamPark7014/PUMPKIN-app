import {
  type Centavos,
  cashVarianceCentavos,
  centavosToPesosNumber,
  formatMxn,
  isZeroCentavos,
  parseMoneyInput,
  pesosToCentavos,
} from '@/lib/pos/money';

export {
  cashVarianceCentavos,
  formatMxn,
  parseMoneyInput,
  pesosToCentavos,
  type Centavos,
};

/** Manager PIN required when absolute variance exceeds $50.00 MXN. */
export const VARIANCE_PIN_THRESHOLD_CENTAVOS: Centavos = pesosToCentavos(50);

export type VarianceKind = 'cuadrado' | 'sobrante' | 'faltante';

export function varianceKind(variance: Centavos): VarianceKind {
  if (isZeroCentavos(variance)) return 'cuadrado';
  return variance > 0n ? 'sobrante' : 'faltante';
}

export function varianceLabel(kind: VarianceKind): string {
  switch (kind) {
    case 'cuadrado':
      return 'Cuadrado';
    case 'sobrante':
      return 'Sobrante';
    case 'faltante':
      return 'Faltante';
  }
}

export function needsManagerPin(variance: Centavos): boolean {
  const abs = variance < 0n ? -variance : variance;
  return abs > VARIANCE_PIN_THRESHOLD_CENTAVOS;
}

export function pesosFromCentavos(centavos: Centavos): number {
  return centavosToPesosNumber(centavos);
}

export function formatDateTimeMx(value?: string | null): string {
  if (!value) return 'No disponible';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'No disponible';
  return parsed.toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export type MethodBucket = 'CASH' | 'CARD' | 'COMP' | 'OTHER';

export function classifyMethod(method: string): MethodBucket {
  const key = method.toUpperCase();
  if (key === 'CASH') return 'CASH';
  if (key === 'CARD') return 'CARD';
  if (key === 'COMP') return 'COMP';
  return 'OTHER';
}

export function methodLabel(method: string): string {
  switch (method.toUpperCase()) {
    case 'CASH':
      return 'Efectivo';
    case 'CARD':
      return 'Tarjeta';
    case 'COMP':
      return 'Cortesía';
    case 'TRANSFER':
      return 'Transferencia';
    default:
      return method;
  }
}

export function methodMeta(method: string): { label: string; color: string } {
  const bucket = classifyMethod(method);
  switch (bucket) {
    case 'CASH':
      return { label: 'Efectivo', color: '#86efac' };
    case 'CARD':
      return { label: 'Tarjeta', color: '#93c5fd' };
    case 'COMP':
      return { label: 'Cortesía', color: '#fcd34d' };
    default:
      return { label: methodLabel(method), color: '#a1a1aa' };
  }
}
