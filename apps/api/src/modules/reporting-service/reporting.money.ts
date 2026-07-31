import { Prisma } from '@prisma/client';

export type MoneyInput = Prisma.Decimal | number | string;

export function toCentavos(amount: MoneyInput): number {
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function fromCentavos(centavos: number): number {
  return centavos / 100;
}

export function roundMxn(amount: MoneyInput): number {
  return fromCentavos(toCentavos(amount));
}

export function commissionCentavos(grossCentavos: number, rate: number): number {
  if (!Number.isFinite(rate) || rate < 0) return 0;
  return Math.round(grossCentavos * rate);
}
