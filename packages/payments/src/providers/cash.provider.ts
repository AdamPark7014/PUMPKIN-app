import type { SalesChannelType } from '../types';
import type {
  PaymentCaptureResult,
  PaymentContext,
  PaymentIntentResult,
  PaymentProvider,
  RefundResult,
} from '../types';

export class CashProvider implements PaymentProvider {
  readonly id = 'cash' as const;
  readonly supportedChannels: SalesChannelType[] = ['TAQUILLA', 'ADMIN'];

  async createIntent(ctx: PaymentContext): Promise<PaymentIntentResult> {
    const intentId = `cash_${ctx.orderId}`;
    return {
      intentId,
      status: 'completed',
      metadata: { channel: ctx.channel },
    };
  }

  async capture(intentId: string): Promise<PaymentCaptureResult> {
    return { success: true, externalId: intentId, paidAt: new Date() };
  }

  async refund(_paymentId: string, _amount: number): Promise<RefundResult> {
    return { success: true, refundId: `cash_ref_${Date.now()}` };
  }
}
