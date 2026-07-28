import type { SalesChannelType } from '../types';
import type {
  PaymentCaptureResult,
  PaymentContext,
  PaymentIntentResult,
  PaymentProvider,
  RefundResult,
  WebhookResult,
} from '../types';
import { getBanorteConfig } from '../banorte/config';
import {
  buildPayworksRedirectUrl,
  buildSpeiReference,
  queryBanorteTransactionStatus,
  verifyBanorteWebhookSignature,
} from '../banorte/payworks';

export class BanorteProvider implements PaymentProvider {
  readonly id = 'banorte' as const;
  readonly supportedChannels: SalesChannelType[] = ['WEB', 'TAQUILLA', 'API'];

  /** Web card/SPEI/OXXO se confirman vía Payworks o IPN; taquilla cobra al momento. */
  requiresAsyncCapture(ctx: PaymentContext): boolean {
    const method = ctx.paymentMethod ?? 'CARD';
    if (method === 'CASH') return false;
    return ctx.channel === 'WEB';
  }

  async createIntent(ctx: PaymentContext): Promise<PaymentIntentResult> {
    const cfg = getBanorteConfig();
    const intentId = `banorte_${ctx.orderId}_${Date.now()}`;
    const method = (ctx.paymentMethod ?? 'CARD').toUpperCase();
    const publicId = ctx.metadata?.publicId ?? ctx.orderId;

    if (cfg.isDemo) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'Banorte no está configurado: define BANORTE_MERCHANT_ID y credenciales Payworks. El modo demo no está permitido en producción.',
        );
      }
      return this.createDemoIntent(intentId, ctx, method, publicId);
    }

    if (method === 'SPEI') {
      if (!cfg.accountClabe) {
        throw new Error('BANORTE_ACCOUNT_CLABE required for SPEI');
      }
      const spei = buildSpeiReference(publicId, cfg.accountClabe);
      return {
        intentId,
        externalId: intentId,
        status: 'requires_action',
        reference: spei.reference,
        metadata: {
          type: 'SPEI',
          clabe: spei.clabe,
          concept: spei.concept,
          reference: spei.reference,
          merchantId: cfg.merchantId,
          orderId: ctx.orderId,
        },
      };
    }

    if (method === 'OXXO') {
      const oxxoRef = `OXXO${publicId.replace(/[^A-Z0-9]/gi, '').slice(-10)}`;
      return {
        intentId,
        externalId: intentId,
        status: 'requires_action',
        reference: oxxoRef,
        metadata: {
          type: 'OXXO',
          reference: oxxoRef,
          merchantId: cfg.merchantId,
          orderId: ctx.orderId,
        },
      };
    }

    const redirectUrl = buildPayworksRedirectUrl(cfg, {
      orderId: ctx.orderId,
      publicId,
      amount: ctx.amount,
      currency: ctx.currency,
      buyerEmail: ctx.buyerEmail,
      buyerName: ctx.buyerName,
    });

    return {
      intentId,
      externalId: intentId,
      status: 'requires_action',
      redirectUrl,
      metadata: {
        type: 'CARD',
        merchantId: cfg.merchantId,
        affiliation: cfg.affiliation,
        orderId: ctx.orderId,
        settlement: 'direct_banorte_account',
      },
    };
  }

  private createDemoIntent(
    intentId: string,
    _ctx: PaymentContext,
    method: string,
    publicId: string,
  ): PaymentIntentResult {
    const cfg = getBanorteConfig();
    if (method === 'SPEI') {
      const spei = buildSpeiReference(publicId, cfg.accountClabe || '012180001234567890');
      return {
        intentId,
        externalId: intentId,
        status: 'requires_action',
        reference: spei.reference,
        metadata: { type: 'SPEI', demo: true, ...spei },
      };
    }
    if (method === 'OXXO') {
      const ref = `OXXO${publicId.slice(-8)}`;
      return {
        intentId,
        externalId: intentId,
        status: 'requires_action',
        reference: ref,
        metadata: { type: 'OXXO', demo: true, reference: ref },
      };
    }
    return {
      intentId,
      externalId: intentId,
      status: 'requires_action',
      redirectUrl: `${cfg.returnUrl.replace(/\/$/, '')}/orders/${publicId}/pago?result=ok&demo=1`,
      metadata: { type: 'CARD', demo: true },
    };
  }

  async getPaymentStatus(externalId: string): Promise<{ status: 'completed' | 'pending' | 'failed' }> {
    const cfg = getBanorteConfig();
    if (cfg.isDemo) return { status: 'pending' };
    return queryBanorteTransactionStatus(cfg, externalId);
  }

  async capture(intentId: string, externalId?: string): Promise<PaymentCaptureResult> {
    const cfg = getBanorteConfig();
    if (cfg.isDemo) {
      return { success: true, externalId: externalId ?? intentId, paidAt: new Date() };
    }
    return {
      success: false,
      externalId: externalId ?? intentId,
      error: 'Awaiting Banorte confirmation (Payworks/IPN)',
    };
  }

  async refund(paymentId: string, amount: number): Promise<RefundResult> {
    const cfg = getBanorteConfig();
    if (cfg.isDemo) {
      return { success: true, refundId: `banorte_ref_${paymentId}` };
    }
    return {
      success: false,
      refundId: '',
      error: `Solicitar devolución ${amount} en portal Banorte comercios — pago ${paymentId}`,
    };
  }

  async handleWebhook(payload: unknown, signature?: string): Promise<WebhookResult> {
    const cfg = getBanorteConfig();
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    if (!verifyBanorteWebhookSignature(raw, signature, cfg.webhookSecret)) {
      throw new Error('Invalid Banorte webhook signature');
    }

    const body =
      typeof payload === 'object' && payload !== null
        ? (payload as Record<string, string>)
        : (JSON.parse(raw) as Record<string, string>);

    const status = (body.status ?? body.ESTATUS ?? body.response ?? '').toLowerCase();
    const orderId = body.orderId ?? body.REFERENCIA ?? body.metadata_orderId;
    const intentId = body.intentId ?? body.transaction_id;

    const approved =
      status === 'approved' ||
      status === 'aprobada' ||
      status === 'success' ||
      status === '00' ||
      body.resultado === 'A';

    if (approved) {
      return { orderId, intentId, status: 'completed' };
    }
    if (status === 'declined' || status === 'rechazada' || status === 'failed') {
      return { orderId, intentId, status: 'failed' };
    }
    return { orderId, intentId, status: 'pending' };
  }
}
