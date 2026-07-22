export type SalesChannelType = 'WEB' | 'TAQUILLA' | 'API' | 'ADMIN';

export type PaymentProviderId =
  | 'stripe'
  | 'banorte'
  | 'cash'
  | 'oxxo'
  | 'clip'
  | 'spei';

export type BanortePaymentMethod = 'CARD' | 'SPEI' | 'OXXO' | 'CASH';

export interface PaymentContext {
  amount: number;
  currency: string;
  orderId: string;
  channel: SalesChannelType;
  buyerEmail: string;
  buyerName: string;
  paymentMethod?: BanortePaymentMethod;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
}

export interface PaymentIntentResult {
  intentId: string;
  externalId?: string;
  clientSecret?: string;
  redirectUrl?: string;
  reference?: string;
  status: 'pending' | 'requires_action' | 'completed';
  metadata?: Record<string, unknown>;
}

export interface PaymentCaptureResult {
  success: boolean;
  externalId: string;
  paidAt?: Date;
  error?: string;
}

export interface RefundResult {
  success: boolean;
  refundId: string;
  error?: string;
}

export interface WebhookResult {
  orderId?: string;
  intentId?: string;
  status: 'completed' | 'failed' | 'pending';
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  readonly supportedChannels: SalesChannelType[];
  createIntent(ctx: PaymentContext): Promise<PaymentIntentResult>;
  capture(intentId: string, externalId?: string): Promise<PaymentCaptureResult>;
  refund(paymentId: string, amount: number): Promise<RefundResult>;
  handleWebhook?(payload: unknown, signature?: string): Promise<WebhookResult>;
}
