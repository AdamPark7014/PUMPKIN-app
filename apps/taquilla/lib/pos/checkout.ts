import { apiFetch } from '../auth';
import {
  beginSaleAttempt,
  createClientSaleId,
  markSaleConfirmed,
  markSaleFailed,
} from './idempotency';
import {
  ensurePosSession,
  getCashierId,
  getSessionId,
  getTerminalId,
  resolveOrgId,
} from './session';
import type { PaymentMethod } from './types';

export type PosCheckoutResult = {
  orderId: string;
  publicId: string;
  total: number;
  processingTime: string;
  status: string;
  isComp?: boolean;
  holdExpiresAt?: string;
};

export type ExchangeOrderResult = {
  delta?: number;
  orderId?: string;
  publicId?: string;
  [key: string]: unknown;
};

export async function createPosHold(params: {
  terminalId: string;
  sessionId: string;
  eventId: string;
  offerId?: string;
  seatIds?: string[];
  quantity?: number;
}): Promise<{ holdIds: string[]; expiresAt: string; ttlSeconds: number }> {
  const res = await apiFetch('/taquilla/holds', {
    method: 'POST',
    body: JSON.stringify({ ...params, cashierId: getCashierId() }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ holdIds: string[]; expiresAt: string; ttlSeconds: number }>;
}

export async function releasePosHolds(holdIds: string[]): Promise<void> {
  if (!holdIds.length) return;
  await apiFetch('/taquilla/holds/release', {
    method: 'POST',
    body: JSON.stringify({ holdIds }),
  });
}

export async function posCheckout(params: {
  terminalId: string;
  sessionId: string;
  eventId: string;
  offerId: string;
  quantity?: number;
  seatIds?: string[];
  holdIds?: string[];
  paymentMethod: PaymentMethod;
  cashierId?: string;
  buyerName?: string;
  buyerEmail?: string;
  buyerPhone?: string;
  isComp?: boolean;
  compReason?: string;
  managerPin?: string;
  discountCode?: string;
  clientSaleId?: string;
  /** Voucher de la terminal bancaria física (obligatorios con CARD). */
  cardLast4?: string;
  cardAuthCode?: string;
}): Promise<PosCheckoutResult> {
  const clientSaleId = params.clientSaleId || createClientSaleId();
  beginSaleAttempt({
    clientSaleId,
    terminalId: params.terminalId,
    sessionId: params.sessionId,
  });

  try {
    const res = await apiFetch('/taquilla/checkout', {
      method: 'POST',
      body: JSON.stringify({
        terminalId: params.terminalId,
        sessionId: params.sessionId,
        checkoutData: {
          eventId: params.eventId,
          offerId: params.offerId,
          quantity: params.quantity,
          seatIds: params.seatIds,
          holdIds: params.holdIds,
          paymentMethod: params.paymentMethod,
          cashierId: params.cashierId ?? getCashierId(),
          buyerName: params.buyerName,
          buyerEmail: params.buyerEmail,
          buyerPhone: params.buyerPhone,
          isComp: params.isComp || params.paymentMethod === 'COMP',
          compReason: params.compReason,
          managerPin: params.managerPin,
          discountCode: params.discountCode,
          cardLast4: params.cardLast4,
          cardAuthCode: params.cardAuthCode,
          clientSaleId,
        },
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const result = (await res.json()) as PosCheckoutResult;
    markSaleConfirmed(result.orderId, result.publicId);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error de checkout';
    markSaleFailed(message);
    throw error;
  }
}

export async function scanTicket(barcode: string): Promise<Record<string, unknown>> {
  const terminalId = getTerminalId() || 'unknown';
  const res = await apiFetch('/taquilla/scan', {
    method: 'POST',
    body: JSON.stringify({ terminalId, barcode }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<Record<string, unknown>>;
}

export async function voidOrder(
  orderId: string,
  reason: string,
  managerPin?: string,
): Promise<Record<string, unknown>> {
  const res = await apiFetch('/taquilla/void', {
    method: 'POST',
    body: JSON.stringify({
      orderId,
      sessionId: getSessionId(),
      cashierId: getCashierId(),
      reason,
      managerPin,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<Record<string, unknown>>;
}

export async function exchangeOrder(params: {
  orderId: string;
  newOfferId?: string;
  newSeatIds?: string[];
  quantity?: number;
  paymentMethod: 'CASH' | 'CARD';
  managerPin?: string;
}): Promise<ExchangeOrderResult> {
  const { terminalId, sessionId } = await ensurePosSession(resolveOrgId(), getCashierId());
  const res = await apiFetch('/taquilla/exchange', {
    method: 'POST',
    body: JSON.stringify({
      ...params,
      terminalId,
      sessionId,
      cashierId: getCashierId(),
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<ExchangeOrderResult>;
}
