import type { HoldStatus, SalesChannel, SeatHold } from '@prisma/client';

export type CreateOrderInput = {
  eventId: string;
  offerId?: string;
  holdIds?: string[];
  items?: { offerId: string; holdIds: string[] }[];
  buyerName: string;
  buyerEmail: string;
  buyerPhone?: string;
  userId?: string;
  paymentMethod?: string;
  promotionCode?: string;
  channel?: SalesChannel;
  cashierId?: string;
  idempotencyKey?: string;
  ipAddress?: string;
  deviceFingerprint?: string;
  isComp?: boolean;
  compReason?: string;
  posOps?: Record<string, unknown>;
};

export type OrderLineGroup = {
  offerId: string;
  holdIds: string[];
  holds: SeatHold[];
};

export type PricedLine = {
  offerId: string;
  holdIds: string[];
  holds: SeatHold[];
  quantity: number;
  unitPrice: number;
  unitFees: number;
  subtotal: number;
  fees: number;
  taxes: number;
  total: number;
  discount: number;
  appliedRules: unknown;
};

export type HoldLookup = {
  id: string;
  eventId: string;
  seatId: string | null;
  offerId: string | null;
  status: HoldStatus;
  expiresAt: Date;
};
