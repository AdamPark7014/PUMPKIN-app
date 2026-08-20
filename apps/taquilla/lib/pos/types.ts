export type PosReceipt = {
  receiptNumber: string;
  orderId?: string;
  publicId?: string;
  /** Alias explícito del localizador de orden (mismo valor que publicId). */
  localizador?: string;
  timestamp: string;
  terminalId: string;
  eventName: string;
  eventStartsAt?: string | null;
  venueLabel?: string | null;
  buyerName?: string | null;
  quantity: number;
  subtotal: number;
  fees: number;
  taxes: number;
  total: number;
  paymentMethod: string;
  ticketCodes: { barcode: string; seatInfo: string }[];
};

export type OfflinePosPayload = {
  type: 'pos';
  terminalId: string;
  sessionId: string;
  clientSaleId: string;
  checkoutData: {
    eventId: string;
    offerId: string;
    quantity?: number;
    seatIds?: string[];
    paymentMethod: 'CASH' | 'CARD' | 'COMP';
    cashierId?: string;
    buyerName?: string;
    buyerEmail?: string;
    buyerPhone?: string;
    clientSaleId?: string;
    isComp?: boolean;
    compReason?: string;
  };
};

export type SessionSummary = {
  totalTransactions: number;
  totalRevenue: number;
  byMethod: Record<string, number>;
  cashSales: number;
  cardSales: number;
  compCount?: number;
  openingCash: number;
  cashDrops?: Array<{ amount: number; note?: string; at?: string }>;
  dropsTotal?: number;
  expectedCash: number;
  startTime: string;
  endTime: string;
  recentSales: Array<{
    orderId: string;
    publicId: string;
    eventTitle: string;
    total: number;
    paymentMethod: string;
    quantity: number;
    createdAt: string;
    isComp?: boolean;
  }>;
};

export type PaymentMethod = 'CASH' | 'CARD' | 'COMP';

export type PendingSaleState = {
  clientSaleId: string;
  terminalId: string;
  sessionId: string;
  status: 'submitting' | 'queued_offline' | 'confirmed' | 'failed';
  createdAt: string;
  orderId?: string;
  publicId?: string;
  error?: string;
};

export type CloseIntentState = {
  sessionId: string;
  closingCashCounted: number;
  managerPin?: string;
  startedAt: string;
  status: 'pending' | 'confirmed' | 'failed';
  result?: Record<string, unknown>;
  error?: string;
};
