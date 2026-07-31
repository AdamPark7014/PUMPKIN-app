/**
 * Monetary helpers for MXN — all arithmetic in integer centavos.
 * Never use IEEE-754 floats for money math.
 */

const CENTAVOS_PER_PESO = 100n;

export type Centavos = bigint;

export function pesosToCentavos(pesos: number | string): Centavos {
  if (typeof pesos === 'number') {
    if (!Number.isFinite(pesos)) throw new Error('Importe inválido');
    const sign = pesos < 0 ? -1n : 1n;
    const abs = Math.abs(pesos);
    const whole = Math.trunc(abs);
    const fracStr = abs.toFixed(2).split('.')[1] ?? '00';
    return sign * (BigInt(whole) * CENTAVOS_PER_PESO + BigInt(fracStr));
  }
  const trimmed = pesos.trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed) && !/^-?\d+\.\d{3,}$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isFinite(n)) throw new Error('Importe inválido');
    return pesosToCentavos(n);
  }
  const neg = trimmed.startsWith('-');
  const raw = neg ? trimmed.slice(1) : trimmed;
  const [w, f = ''] = raw.split('.');
  let fracDigits = (f + '00').slice(0, 2);
  let whole = BigInt(w || '0');
  // Round half-up when more than 2 decimal places are provided as a string.
  if (f.length > 2) {
    const third = Number(f[2] ?? '0');
    let frac = Number((f + '00').slice(0, 2));
    if (third >= 5) frac += 1;
    if (frac >= 100) {
      whole += 1n;
      frac = 0;
    }
    fracDigits = String(frac).padStart(2, '0');
  }
  const value = whole * CENTAVOS_PER_PESO + BigInt(fracDigits);
  return neg ? -value : value;
}

export function centavosToPesosNumber(centavos: Centavos): number {
  const neg = centavos < 0n;
  const abs = neg ? -centavos : centavos;
  const whole = abs / CENTAVOS_PER_PESO;
  const frac = abs % CENTAVOS_PER_PESO;
  const n = Number(whole) + Number(frac) / 100;
  return neg ? -n : n;
}

/** Decimal string with exactly 2 fraction digits (no float arithmetic). */
export function centavosToPesosString(centavos: Centavos): string {
  const neg = centavos < 0n;
  const abs = neg ? -centavos : centavos;
  const whole = abs / CENTAVOS_PER_PESO;
  const frac = abs % CENTAVOS_PER_PESO;
  const fracStr = frac.toString().padStart(2, '0');
  return `${neg ? '-' : ''}${whole.toString()}.${fracStr}`;
}

export function formatMxn(pesos: number | string | Centavos): string {
  const n =
    typeof pesos === 'bigint' ? centavosToPesosNumber(pesos) : Number(pesos);
  if (!Number.isFinite(n)) return '$0.00';
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function addCentavos(...parts: Centavos[]): Centavos {
  return parts.reduce((a, b) => a + b, 0n);
}

export function subCentavos(a: Centavos, b: Centavos): Centavos {
  return a - b;
}

/** Variance = counted − expected (positive = sobrante, negative = faltante) */
export function cashVarianceCentavos(countedPesos: number | string, expectedPesos: number | string): Centavos {
  return subCentavos(pesosToCentavos(countedPesos), pesosToCentavos(expectedPesos));
}

export function parseMoneyInput(raw: string): Centavos | null {
  const t = raw.trim().replace(/[$,\s]/g, '');
  if (!t) return null;
  try {
    return pesosToCentavos(t);
  } catch {
    return null;
  }
}

export function isZeroCentavos(c: Centavos): boolean {
  return c === 0n;
}
