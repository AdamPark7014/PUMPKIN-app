import { createHmac } from 'node:crypto';
import {
  CURRENCY_NUMERIC_CODES,
  toCurrencyCode,
  toGatewayAmountString,
  toMinorUnits,
  moneyFromMinor,
  type CurrencyCode,
  type MoneyAmount,
} from '@boletera/shared';
import type { BanorteConfig } from './config';
import { parseBanorteStatusText } from './webhook';
import type { WebhookStatus } from '../types';

export type PayworksChargeParams = {
  orderId: string;
  publicId: string;
  /** Major-unit amount (legacy). Prefer amountMinor when available. */
  amount: number;
  amountMinor?: number;
  currency: string;
  buyerEmail: string;
  buyerName: string;
};

export { verifyBanorteWebhookSignature, parseBanorteStatusText } from './webhook';

function resolveMoney(params: PayworksChargeParams): MoneyAmount {
  const currency: CurrencyCode = toCurrencyCode(params.currency);
  if (params.amountMinor !== undefined) {
    return moneyFromMinor(params.amountMinor, currency);
  }
  return moneyFromMinor(toMinorUnits(params.amount, currency), currency);
}

/**
 * Build Payworks 3-D Secure redirect URL.
 *
 * WARNING: The URL query includes USUARIO (and optionally FIRMA).
 * Never log the returned URL — use `redactForLog` if you must record metadata.
 */
export function buildPayworksRedirectUrl(cfg: BanorteConfig, params: PayworksChargeParams): string {
  const money = resolveMoney(params);
  const currency = money.currency;
  const importe = toGatewayAmountString(money);
  const reference = params.publicId.replace(/[^A-Za-z0-9]/g, '').slice(0, 20);

  const query = new URLSearchParams({
    ID_AFILIACION: cfg.affiliation,
    ID_TERMINAL: cfg.terminal,
    USUARIO: cfg.user,
    REFERENCIA: reference,
    IMPORTE: importe,
    MONEDA: CURRENCY_NUMERIC_CODES[currency],
    CORREO: params.buyerEmail,
    NOMBRE: params.buyerName.slice(0, 60),
    URL_RESPUESTA: `${cfg.returnUrl.replace(/\/$/, '')}/orders/${params.publicId}/pago?result=ok`,
    URL_CANCELACION: `${cfg.cancelUrl.replace(/\/$/, '')}/orders/${params.publicId}/pago?result=cancel`,
    CMD_TRANS: 'VENTA',
    METODO_PAGO: 'TC',
  });

  if (cfg.password) {
    const sig = signPayworksPayload(query.toString(), cfg.password);
    query.set('FIRMA', sig);
  }

  const base = cfg.payworksUrl.includes('?') ? cfg.payworksUrl : `${cfg.payworksUrl}?`;
  return `${base}${query.toString()}`;
}

function signPayworksPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export type BanorteQueryStatus = WebhookStatus;

/** Consulta estado de transacción (ajusta URL según manual Payworks de tu afiliación). */
export async function queryBanorteTransactionStatus(
  cfg: BanorteConfig,
  reference: string,
): Promise<{ status: BanorteQueryStatus }> {
  if (cfg.isDemo || !cfg.user || !cfg.password) {
    return { status: 'pending' };
  }

  const queryUrl =
    process.env.BANORTE_QUERY_URL ??
    'https://eps.banorte.com/secure3d/consultaTransaccion.htm';

  try {
    const params = new URLSearchParams({
      ID_AFILIACION: cfg.affiliation,
      USUARIO: cfg.user,
      REFERENCIA: reference.replace(/[^A-Za-z0-9]/g, '').slice(0, 20),
    });
    if (cfg.password) {
      params.set('FIRMA', signPayworksPayload(params.toString(), cfg.password));
    }

    const res = await fetch(`${queryUrl}?${params.toString()}`, { method: 'GET' });
    const text = await res.text();
    return { status: parseBanorteStatusText(text) };
  } catch {
    return { status: 'pending' };
  }
}

/** Referencia SPEI única ligada a la orden (abono a cuenta Banorte). */
export function buildSpeiReference(publicId: string, accountClabe: string): {
  clabe: string;
  concept: string;
  reference: string;
} {
  const reference = publicId.replace(/[^A-Z0-9]/gi, '').slice(-12).toUpperCase();
  return {
    clabe: accountClabe,
    concept: `BOLETERA ${reference}`,
    reference,
  };
}
