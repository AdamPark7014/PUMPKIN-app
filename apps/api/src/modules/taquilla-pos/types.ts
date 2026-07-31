import type { PaymentMethod, Prisma } from '@prisma/client';

export const DEFAULT_PAGE_SIZE = 30;
export const MAX_PAGE_SIZE = 100;
export const WILLCALL_PAGE_SIZE = 20;
export const IDEMPOTENCY_CLAIM_TTL_MS = 15 * 60 * 1000;
export const CLIENT_SALE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
export const VARIANCE_PIN_THRESHOLD = 50;

export type PosPaymentMethod = 'CASH' | 'CARD' | 'CHECK' | 'COMP';
export type PosAnalyticsPeriod = 'TODAY' | 'WEEK' | 'MONTH';

export type PosOps = {
  clientSaleId?: string;
  terminalId?: string;
  sessionId?: string;
  seatIds?: string[];
  discountPercent?: number;
  isComp?: boolean;
  compReason?: string;
  pickedUpAt?: string;
  pickedUpBy?: string;
  pickupTerminalId?: string;
  exchangedFrom?: string;
  voidReason?: string;
  voidedAt?: string;
  voidedBy?: string;
};

export type SessionMetadata = {
  openingCash?: number;
  transactionCount?: number;
  cashDrops?: CashDropEntry[];
  totalTransactions?: number;
  totalRevenue?: number;
  byMethod?: Record<string, number>;
  cashSales?: number;
  cardSales?: number;
  compCount?: number;
  dropsTotal?: number;
  expectedCash?: number;
  closingCashCounted?: number;
  variance?: number;
  zReport?: boolean;
  status?: string;
  sessionId?: string;
  cashierId?: string;
  startTime?: Date | string;
  endTime?: string;
  terminalId?: string;
};

export type CashDropEntry = {
  amount: number;
  note?: string;
  cashierId: string;
  at: string;
};

export type OrgPosSettings = {
  managerPinHash?: string;
  varianceThreshold?: number;
};

export type CheckoutResult = {
  orderId: string;
  publicId: string;
  total: number;
  subtotal: number;
  fees: number;
  taxes: number;
  quantity: number;
  processingTime: string;
  paymentMethod: PosPaymentMethod;
  status: string;
  holdExpiresAt: Date;
  isComp: boolean;
};

export type SessionStartResult = {
  sessionId: string;
  status: string;
  startedAt: Date;
  openingCash: number;
  resumed: boolean;
};

export type HoldResult = {
  holdIds: string[];
  expiresAt: Date;
  ttlSeconds: number;
};

export type ZReportRow = {
  sessionId: string;
  terminalId: string;
  terminalName: string | undefined;
  cashierId: string;
  endedAt: Date | null;
  report: Prisma.JsonValue;
};

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function asPosOps(value: unknown): PosOps {
  return asRecord(value) as PosOps;
}

export function asSessionMetadata(value: unknown): SessionMetadata {
  return asRecord(value) as SessionMetadata;
}

export function asOrgSettings(value: unknown): OrgPosSettings {
  return asRecord(value) as OrgPosSettings;
}

export function clampPageSize(limit: number | undefined, max = MAX_PAGE_SIZE): number {
  if (limit === undefined || !Number.isFinite(limit) || limit < 1) {
    return Math.min(DEFAULT_PAGE_SIZE, max);
  }
  return Math.min(Math.floor(limit), max);
}

export function seatLabel(
  section: string | null | undefined,
  row: string | null | undefined,
  seatNumber: string | null | undefined,
): string {
  return [section, row, seatNumber].filter(Boolean).join('-') || 'GA';
}

export function mapPosPaymentMethod(
  method: PosPaymentMethod,
  isComp: boolean,
): Extract<PaymentMethod, 'CASH' | 'CARD'> | 'COMP' {
  if (isComp || method === 'COMP') return 'COMP';
  if (method === 'CHECK') return 'CASH';
  return method;
}

export function idempotencyKeyForSale(organizationId: string, clientSaleId: string): string {
  return `pos-sale:${organizationId}:${clientSaleId}`;
}

export function idempotencyKeyForVoid(organizationId: string, orderId: string, reason: string): string {
  return `pos-void:${organizationId}:${orderId}:${reason.slice(0, 64)}`;
}
