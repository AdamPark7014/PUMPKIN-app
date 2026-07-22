export type InitTerminalDto = {
  organizationId: string;
  locationName: string;
  terminalName: string;
  hardwareConfig?: Record<string, string>;
};

export type ProcessPaymentDto = {
  orderId: string;
  paymentData: {
    method: 'CASH' | 'CARD' | 'CHECK';
    amount: number;
    cardDetails?: { lastFour: string; brand: string };
  };
};

export type OfflineTransactionDto = {
  checkoutData: unknown;
  sessionId: string;
};

export type SyncOfflineDto = {
  transactions: OfflineTransactionDto[];
};
