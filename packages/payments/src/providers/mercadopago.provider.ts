/**
 * Mercado Pago — Checkout Pro (redirect).
 *
 * Flujo:
 *   createIntent  → crea una *preferencia* y devuelve `init_point` como
 *                   redirectUrl. El comprador paga en Mercado Pago (tarjeta,
 *                   OXXO, SPEI, saldo MP) y vuelve a `back_urls`.
 *   handleWebhook → MP notifica `type=payment` con `data.id`; se verifica la
 *                   firma x-signature y se consulta el pago a la API de MP.
 *                   La respuesta de la API es la fuente de verdad, no el body
 *                   del webhook: el body no se confía nunca.
 *   capture       → busca pagos aprobados de la preferencia (para el camino
 *                   síncrono, que con redirect casi no ocurre).
 *   refund        → POST /v1/payments/{id}/refunds.
 *
 * Sin SDK: la API REST de MP es pequeña y `fetch` nativo basta; así el
 * paquete no arrastra una dependencia más.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PaymentError } from '../errors';
import { getMercadoPagoConfig } from '../mercadopago/config';
import type {
  PaymentCaptureResult,
  PaymentContext,
  PaymentIntentResult,
  PaymentProvider,
  RefundResult,
  SalesChannelType,
  WebhookResult,
  WebhookStatus,
} from '../types';
import { resolveContextMoney } from '../types';

const MP_API = 'https://api.mercadopago.com';
/**
 * Preferencia viva mientras el hold de inventario (MP_PENDING_TTL_HOURS, default 24h).
 * date_of_expiration (voucher OXXO) usa el mismo techo — MP recomienda >= 3 días;
 * en boletera alineamos al hold para no sobrevender si el voucher vive más que el asiento.
 */
function pendingTtlMs(): number {
  const fromEnv = Number(process.env.MP_PENDING_TTL_HOURS);
  const hours = Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 24;
  return hours * 60 * 60 * 1000;
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: 'Comprador', lastName: 'Pumpkin' };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

type MpPreference = { id: string; init_point: string; sandbox_init_point?: string };

type MpPayment = {
  id: number | string;
  status: string;
  status_detail?: string;
  external_reference?: string;
  preference_id?: string;
  transaction_amount?: number;
  currency_id?: string;
  date_approved?: string | null;
  payment_method_id?: string;
  payment_type_id?: string;
};

/** Lo que la API le pasa al provider desde el controller del webhook. */
export type MercadoPagoWebhookPayload = {
  body: unknown;
  query: Record<string, string | undefined>;
  headers: { 'x-signature'?: string; 'x-request-id'?: string };
};

function mapStatus(status: string): WebhookStatus {
  switch (status) {
    case 'approved':
      return 'completed';
    case 'rejected':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'refunded':
    case 'charged_back':
      // La orden ya se completó; el reembolso se gestiona aparte.
      return 'cancelled';
    default:
      // pending, in_process, authorized, in_mediation
      return 'pending';
  }
}

export class MercadoPagoProvider implements PaymentProvider {
  readonly id = 'mercadopago' as const;
  readonly supportedChannels: SalesChannelType[] = ['WEB', 'API'];

  private get cfg() {
    return getMercadoPagoConfig();
  }

  private requireConfigured(): void {
    if (!this.cfg.isConfigured) {
      throw new PaymentError(
        'NOT_CONFIGURED',
        'Mercado Pago no está configurado: define MP_ACCESS_TOKEN.',
      );
    }
  }

  private async mpFetch<T>(
    path: string,
    init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.accessToken}`,
      'Content-Type': 'application/json',
    };
    if (init.idempotencyKey) headers['X-Idempotency-Key'] = init.idempotencyKey;

    const res = await fetch(`${MP_API}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
    });

    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      const msg =
        (data as { message?: string } | null)?.message ??
        `Mercado Pago respondió ${res.status}`;
      throw new PaymentError('PROVIDER_ERROR', `Mercado Pago: ${msg}`);
    }
    return data as T;
  }

  async createIntent(ctx: PaymentContext): Promise<PaymentIntentResult> {
    this.requireConfigured();
    const money = resolveContextMoney(ctx);
    if (money.amountMinor <= 0) {
      throw new PaymentError('INVALID_AMOUNT', 'El monto debe ser mayor a cero');
    }

    const publicId = String(ctx.metadata?.publicId ?? ctx.orderId);
    const orderUrl = `${this.cfg.webUrl}/orders/${encodeURIComponent(publicId)}`;
    const ttlMs = pendingTtlMs();
    const expiresAt = new Date(Date.now() + ttlMs);
    const { firstName, lastName } = splitName(ctx.buyerName ?? '');
    const eventName = ctx.metadata?.eventName?.trim() || 'Boletos';
    const ticketQty = Number(ctx.metadata?.ticketQty) || 1;
    const unitPrice = Number((money.amountMinor / 100).toFixed(2));
    const eventDate = ctx.metadata?.eventDate?.trim();

    const item: Record<string, unknown> = {
      id: ctx.orderId,
      title: `${eventName} · orden ${publicId}`,
      description: `${ticketQty} acceso(s) · ${eventName}`,
      // Industria tickets (mejora aprobación; docs MP tickets & entertainment).
      category_id: 'tickets',
      quantity: 1,
      currency_id: money.currency,
      unit_price: unitPrice,
    };
    if (eventDate) item.event_date = eventDate;

    const preference = await this.mpFetch<MpPreference>('/checkout/preferences', {
      method: 'POST',
      idempotencyKey: ctx.idempotencyKey,
      body: {
        items: [item],
        payer: {
          email: ctx.buyerEmail,
          name: firstName,
          surname: lastName,
        },
        // Con esto el webhook nos devuelve la orden sin tablas de cruce.
        external_reference: ctx.orderId,
        back_urls: {
          success: `${orderUrl}?pago=ok`,
          pending: `${orderUrl}?pago=pendiente`,
          failure: `${orderUrl}?pago=error`,
        },
        auto_return: 'approved',
        notification_url: `${this.cfg.apiUrl}/api/v1/payments/webhooks/mercadopago`,
        statement_descriptor: this.cfg.statementDescriptor,
        expires: true,
        expiration_date_to: expiresAt.toISOString(),
        // Voucher OXXO/efectivo: mismo techo que el hold (ver docs MP expiration-date).
        date_of_expiration: expiresAt.toISOString(),
        metadata: {
          order_id: ctx.orderId,
          public_id: publicId,
          channel: ctx.channel,
          event_id: ctx.metadata?.eventId ?? '',
        },
      },
    });

    return {
      intentId: preference.id,
      externalId: preference.id,
      redirectUrl: preference.init_point,
      status: 'requires_action',
      metadata: {
        type: 'MERCADOPAGO',
        preferenceId: preference.id,
        // Para "reintentar pago" desde la orden sin crear otra preferencia.
        redirectUrl: preference.init_point,
        expiresAt: expiresAt.toISOString(),
        test: this.cfg.isTest,
      },
    };
  }

  /**
   * Camino síncrono: busca un pago aprobado de la preferencia. Con redirect
   * normalmente no hay ninguno todavía, así que devuelve AWAITING_CONFIRMATION.
   */
  async capture(intentId: string): Promise<PaymentCaptureResult> {
    this.requireConfigured();
    const search = await this.mpFetch<{ results?: MpPayment[] }>(
      `/v1/payments/search?preference_id=${encodeURIComponent(intentId)}&sort=date_created&criteria=desc`,
    );
    const approved = (search.results ?? []).find((p) => p.status === 'approved');
    if (!approved) {
      return {
        success: false,
        externalId: intentId,
        errorCode: 'AWAITING_CONFIRMATION',
        error: 'El pago aún no está confirmado en Mercado Pago',
      };
    }
    return {
      success: true,
      externalId: String(approved.id),
      paidAt: approved.date_approved ? new Date(approved.date_approved) : new Date(),
    };
  }

  async refund(paymentId: string, amount: number): Promise<RefundResult> {
    this.requireConfigured();
    try {
      const body = amount > 0 ? { amount: Number(amount.toFixed(2)) } : {};
      const res = await this.mpFetch<{ id: number | string; status?: string }>(
        `/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
        {
          method: 'POST',
          body,
          idempotencyKey: `refund-${paymentId}-${amount}`,
        },
      );
      return { success: true, refundId: String(res.id) };
    } catch (error) {
      return {
        success: false,
        refundId: '',
        errorCode: 'PROVIDER_ERROR',
        error: error instanceof Error ? error.message : 'Error al reembolsar',
      };
    }
  }

  /**
   * Verifica `x-signature` según el esquema de MP:
   *   manifest = "id:{data.id};request-id:{x-request-id};ts:{ts};"
   *   v1 = HMAC_SHA256(secret, manifest) en hex
   * `data.id` se normaliza a minúsculas si es alfanumérico (regla de MP).
   */
  private verifySignature(
    dataId: string,
    requestId: string | undefined,
    signature: string | undefined,
  ): boolean {
    const secret = this.cfg.webhookSecret;
    if (!secret) {
      // Sin secreto: en producción se rechaza; en desarrollo se permite
      // porque el pago se valida igual contra la API de MP.
      return process.env.NODE_ENV !== 'production';
    }
    if (!signature) return false;

    const parts = Object.fromEntries(
      signature.split(',').map((kv) => {
        const [k, ...rest] = kv.trim().split('=');
        return [k, rest.join('=')];
      }),
    ) as { ts?: string; v1?: string };
    if (!parts.ts || !parts.v1) return false;

    const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
    const manifest = `id:${id};${requestId ? `request-id:${requestId};` : ''}ts:${parts.ts};`;
    const expected = createHmac('sha256', secret).update(manifest).digest('hex');

    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(parts.v1, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async handleWebhook(payload: unknown): Promise<WebhookResult> {
    this.requireConfigured();
    const { body, query, headers } = (payload ?? {}) as Partial<MercadoPagoWebhookPayload>;
    const q = query ?? {};
    const b = (body ?? {}) as { type?: string; action?: string; data?: { id?: string | number } };

    // Formato nuevo (Webhooks) y legado (IPN) comparten este parseo.
    const type = q.type ?? q.topic ?? b.type ?? '';
    const dataId = String(q['data.id'] ?? b.data?.id ?? q.id ?? '').trim();

    // merchant_order, chargebacks, etc. no cambian el estado de la orden.
    if (type !== 'payment' || !dataId) {
      return { status: 'pending' };
    }

    if (!this.verifySignature(dataId, headers?.['x-request-id'], headers?.['x-signature'])) {
      throw new PaymentError('INVALID_SIGNATURE', 'Firma de webhook de Mercado Pago inválida');
    }

    // Fuente de verdad: la API de MP, nunca el cuerpo del webhook.
    const payment = await this.mpFetch<MpPayment>(`/v1/payments/${encodeURIComponent(dataId)}`);

    return {
      orderId: payment.external_reference || undefined,
      intentId: String(payment.id),
      status: mapStatus(payment.status),
    };
  }
}
