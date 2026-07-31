import {
  addCentavos,
  type Centavos,
  centavosToPesosNumber,
  pesosToCentavos,
} from '@/lib/pos/money';

/** Mexican peso cash denominations commonly used at box office. */
export const MXN_DENOMS_CENTAVOS: readonly Centavos[] = [
  pesosToCentavos(1000),
  pesosToCentavos(500),
  pesosToCentavos(200),
  pesosToCentavos(100),
  pesosToCentavos(50),
  pesosToCentavos(20),
  pesosToCentavos(10),
  pesosToCentavos(5),
  pesosToCentavos(2),
  pesosToCentavos(1),
  pesosToCentavos(0.5),
] as const;

export type DenomCounts = Record<string, number>;

export function emptyDenomCounts(): DenomCounts {
  const counts: DenomCounts = {};
  for (const d of MXN_DENOMS_CENTAVOS) {
    counts[d.toString()] = 0;
  }
  return counts;
}

export function denomLabel(centavos: Centavos): string {
  const pesos = centavosToPesosNumber(centavos);
  if (pesos >= 1) {
    return `$${pesos.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
  }
  return `${Math.round(pesos * 100)}¢`;
}

export function totalFromDenomCounts(counts: DenomCounts): Centavos {
  let total: Centavos = 0n;
  for (const d of MXN_DENOMS_CENTAVOS) {
    const n = counts[d.toString()] ?? 0;
    if (n > 0) {
      total = addCentavos(total, d * BigInt(n));
    }
  }
  return total;
}

export function bumpDenom(counts: DenomCounts, denomKey: string, delta: number): DenomCounts {
  const next = { ...counts };
  const current = next[denomKey] ?? 0;
  next[denomKey] = Math.max(0, current + delta);
  return next;
}

export function setDenomCount(counts: DenomCounts, denomKey: string, value: number): DenomCounts {
  const next = { ...counts };
  next[denomKey] = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return next;
}
