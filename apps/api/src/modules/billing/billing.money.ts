import { Prisma } from '@prisma/client';

/** MXN amounts are always expressed with exactly two decimal places (centavos). */
export const MXN_CURRENCY = 'MXN' as const;

export type MoneyInput = Prisma.Decimal | number | string;

/** Convert a Decimal/number/string amount to integer centavos (half-up). */
export function toCentavos(amount: MoneyInput): number {
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) {
    throw new Error('Invalid monetary amount');
  }
  return Math.round(n * 100);
}

/** Convert integer centavos to a two-decimal MXN number. */
export function fromCentavos(centavos: number): number {
  if (!Number.isInteger(centavos)) {
    throw new Error('Centavos must be an integer');
  }
  return centavos / 100;
}

/** Round any float to two-decimal MXN using centavos half-up. */
export function roundMxn(amount: MoneyInput): number {
  return fromCentavos(toCentavos(amount));
}

/** Prisma Decimal with scale 2 for persistence. */
export function toDecimalMxn(amount: MoneyInput): Prisma.Decimal {
  return new Prisma.Decimal(roundMxn(amount).toFixed(2));
}

/**
 * Apply a commission rate to a gross amount in centavos.
 * Rate is a fraction (e.g. 0.15); result is rounded half-up to the nearest centavo.
 */
export function commissionCentavos(grossCentavos: number, rate: number): number {
  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error('Invalid commission rate');
  }
  return Math.round(grossCentavos * rate);
}

/** Format for CFDI XML attribute (always two decimals). */
export function formatMxnXml(amount: MoneyInput): string {
  return roundMxn(amount).toFixed(2);
}
