import { apiFetch, getCashierId as getAuthCashierId, getOrgId, getTaquillaUser } from './auth';
import { buildEscPosReceipt, printEscPos, printViaSerial } from './thermal';

const TERMINAL_KEY = 'boletera_terminal_id';
const SESSION_KEY = 'boletera_pos_session';
const CASHIER_KEY = 'boletera_cashier_id';
const OPENING_CASH_KEY = 'boletera_opening_cash';
const LAST_RECEIPT_KEY = 'boletera_last_receipt';
const LOCAL_QUOTA_KEY = 'boletera_offline_quota';
const FAILED_SYNC_KEY = 'boletera_failed_sync';

export type PosReceipt = {
  receiptNumber: string;
  orderId?: string;
  publicId?: string;
  timestamp: string;
  terminalId: string;
  eventName: string;
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

export function getTerminalId() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TERMINAL_KEY);
}

export function getSessionId() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(SESSION_KEY);
}

export function getCashierId() {
  if (typeof window === 'undefined') return 'cashier-1';
  return localStorage.getItem(CASHIER_KEY) || getAuthCashierId() || 'cashier-1';
}

export function setCashierId(id: string) {
  localStorage.setItem(CASHIER_KEY, id);
}

export function getOpeningCash(): number {
  if (typeof window === 'undefined') return 0;
  const v = Number(localStorage.getItem(OPENING_CASH_KEY) || '0');
  return Number.isFinite(v) ? v : 0;
}

export function setOpeningCash(amount: number) {
  localStorage.setItem(OPENING_CASH_KEY, String(amount));
}

export function saveLastReceipt(receipt: PosReceipt) {
  localStorage.setItem(LAST_RECEIPT_KEY, JSON.stringify(receipt));
}

export function getLastReceipt(): PosReceipt | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(LAST_RECEIPT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PosReceipt;
  } catch {
    return null;
  }
}

export async function ensurePosSession(
  organizationId: string,
  cashierId: string,
  openingCash = 0,
) {
  let terminalId = getTerminalId();
  if (!terminalId) {
    const res = await apiFetch('/taquilla/terminal/init-org', {
      method: 'POST',
      body: JSON.stringify({
        organizationId,
        locationName: 'Mostrador principal',
        terminalName: `POS-${typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 12) : 'term'}`,
      }),
    });
    if (!res.ok) throw new Error('No se pudo inicializar terminal');
    const terminal = await res.json();
    terminalId = terminal.id as string;
    localStorage.setItem(TERMINAL_KEY, terminalId);
  }

  let sessionId = getSessionId();
  if (!sessionId) {
    const res = await apiFetch('/taquilla/session/start', {
      method: 'POST',
      body: JSON.stringify({ terminalId, cashierId, openingCash }),
    });
    if (!res.ok) throw new Error('No se pudo abrir sesión');
    const session = await res.json();
    sessionId = session.sessionId as string;
    localStorage.setItem(SESSION_KEY, sessionId);
    setOpeningCash(Number(session.openingCash ?? openingCash));
  }

  setCashierId(cashierId);
  return { terminalId: terminalId!, sessionId: sessionId! };
}

export async function openShift(opts: {
  organizationId: string;
  cashierId: string;
  openingCash: number;
  forceNew?: boolean;
}) {
  if (opts.forceNew) localStorage.removeItem(SESSION_KEY);
  setOpeningCash(opts.openingCash);
  return ensurePosSession(opts.organizationId, opts.cashierId, opts.openingCash);
}

export async function createPosHold(params: {
  terminalId: string;
  sessionId: string;
  eventId: string;
  offerId?: string;
  seatIds?: string[];
  quantity?: number;
}) {
  const res = await apiFetch('/taquilla/holds', {
    method: 'POST',
    body: JSON.stringify({ ...params, cashierId: getCashierId() }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ holdIds: string[]; expiresAt: string; ttlSeconds: number }>;
}

export async function releasePosHolds(holdIds: string[]) {
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
  paymentMethod: 'CASH' | 'CARD' | 'COMP';
  cashierId?: string;
  buyerName?: string;
  buyerEmail?: string;
  buyerPhone?: string;
  isComp?: boolean;
  compReason?: string;
  managerPin?: string;
  discountCode?: string;
  clientSaleId?: string;
}) {
  const clientSaleId = params.clientSaleId || crypto.randomUUID();
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
        clientSaleId,
      },
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{
    orderId: string;
    publicId: string;
    total: number;
    processingTime: string;
    status: string;
    isComp?: boolean;
    holdExpiresAt?: string;
  }>;
}

export async function fetchReceipt(orderId: string, terminalId: string) {
  const res = await apiFetch(
    `/taquilla/receipt/${orderId}?terminalId=${encodeURIComponent(terminalId)}`,
  );
  if (!res.ok) throw new Error('No se pudo generar recibo');
  const rec = (await res.json()) as PosReceipt;
  return { ...rec, orderId };
}

export async function printReceipt(receipt: PosReceipt) {
  const lines = [
    receipt.receiptNumber,
    new Date(receipt.timestamp).toLocaleString('es-MX'),
    '',
    receipt.eventName,
    `Boletos: ${receipt.quantity}`,
    '',
    `Subtotal: $${receipt.subtotal.toFixed(2)}`,
    `Cargos: $${receipt.fees.toFixed(2)}`,
    `IVA: $${receipt.taxes.toFixed(2)}`,
    `TOTAL: $${receipt.total.toFixed(2)}`,
    `Pago: ${receipt.paymentMethod}`,
    '',
    ...receipt.ticketCodes.map((t) => `${t.seatInfo} · ${t.barcode}`),
    '',
    'Gracias por su compra',
  ];
  const payload = buildEscPosReceipt(lines);
  const serialOk = await printViaSerial(payload);
  if (!serialOk) printEscPos(payload);
}

export async function fetchSessionSummary(sessionId: string) {
  const res = await apiFetch(`/taquilla/session/summary?sessionId=${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error('No se pudo cargar resumen de turno');
  return res.json() as Promise<SessionSummary>;
}

export async function endSession(sessionId: string, closingCashCounted: number, managerPin?: string) {
  const res = await apiFetch('/taquilla/session/end', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      cashierId: getCashierId(),
      closingCashCounted,
      managerPin,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function addCashDrop(amount: number, note?: string) {
  const sessionId = getSessionId();
  if (!sessionId) throw new Error('Sin sesión');
  const res = await apiFetch('/taquilla/session/cash-drop', {
    method: 'POST',
    body: JSON.stringify({ sessionId, amount, note, cashierId: getCashierId() }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<SessionSummary>;
}

export async function scanTicket(barcode: string) {
  const terminalId = getTerminalId() || 'unknown';
  const res = await apiFetch('/taquilla/scan', {
    method: 'POST',
    body: JSON.stringify({ terminalId, barcode }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function voidOrder(orderId: string, reason: string, managerPin?: string) {
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
  return res.json();
}

export async function willcallLookup(q: string) {
  const res = await apiFetch('/taquilla/willcall/lookup', {
    method: 'POST',
    body: JSON.stringify({ q, organizationId: resolveOrgId() }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function willcallFulfill(orderId: string) {
  const res = await apiFetch('/taquilla/willcall/fulfill', {
    method: 'POST',
    body: JSON.stringify({
      orderId,
      cashierId: getCashierId(),
      terminalId: getTerminalId(),
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function exchangeOrder(params: {
  orderId: string;
  newOfferId?: string;
  newSeatIds?: string[];
  quantity?: number;
  paymentMethod: 'CASH' | 'CARD';
  managerPin?: string;
}) {
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
  return res.json();
}

export async function syncOfflineSales(transactions: OfflinePosPayload[]) {
  const terminalId = getTerminalId();
  if (!terminalId || !transactions.length) return { synced: 0 };
  const res = await apiFetch(`/taquilla/offline/sync/${terminalId}`, {
    method: 'POST',
    body: JSON.stringify({
      transactions: transactions.map((t) => ({
        sessionId: t.sessionId,
        clientSaleId: t.clientSaleId,
        checkoutData: { ...t.checkoutData, clientSaleId: t.clientSaleId },
      })),
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ synced: number; failed?: number }>;
}

export async function syncInventoryCache(eventId: string) {
  const terminalId = getTerminalId();
  if (!terminalId) return null;
  const res = await apiFetch('/taquilla/sync-inventory', {
    method: 'POST',
    body: JSON.stringify({ terminalId, eventId }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const quotas = getLocalQuotas();
  const remaining = (data.tickets || []).filter(
    (t: { status: string }) => String(t.status).toUpperCase() === 'AVAILABLE',
  ).length;
  quotas[eventId] = remaining;
  localStorage.setItem(LOCAL_QUOTA_KEY, JSON.stringify(quotas));
  return data;
}

export function getLocalQuotas(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_QUOTA_KEY) || '{}');
  } catch {
    return {};
  }
}

export function reserveLocalQuota(eventId: string, qty: number): boolean {
  const quotas = getLocalQuotas();
  const avail = quotas[eventId] ?? 0;
  if (avail < qty) return false;
  quotas[eventId] = avail - qty;
  localStorage.setItem(LOCAL_QUOTA_KEY, JSON.stringify(quotas));
  return true;
}

export function pushFailedSync(item: { clientSaleId: string; error: string }) {
  const list = getFailedSync();
  list.push({ ...item, at: new Date().toISOString() });
  localStorage.setItem(FAILED_SYNC_KEY, JSON.stringify(list.slice(-20)));
}

export function getFailedSync(): Array<{ clientSaleId: string; error: string; at: string }> {
  try {
    return JSON.parse(localStorage.getItem(FAILED_SYNC_KEY) || '[]');
  } catch {
    return [];
  }
}

export function clearFailedSync() {
  localStorage.removeItem(FAILED_SYNC_KEY);
}

export function resolveOrgId() {
  return getOrgId() || getTaquillaUser()?.organizationId || 'org-demo';
}

export async function handoffShift(opts: {
  toCashierId: string;
  closingCashCounted: number;
  openingCash?: number;
  managerPin?: string;
}) {
  const sessionId = getSessionId();
  if (!sessionId) throw new Error('Sin sesión activa');
  const res = await apiFetch('/taquilla/session/handoff', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      fromCashierId: getCashierId(),
      toCashierId: opts.toCashierId,
      closingCashCounted: opts.closingCashCounted,
      openingCash: opts.openingCash,
      managerPin: opts.managerPin,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  if (data.next?.sessionId) {
    localStorage.setItem(SESSION_KEY, data.next.sessionId);
    setCashierId(opts.toCashierId);
    if (data.next.openingCash != null) setOpeningCash(Number(data.next.openingCash));
  }
  return data as {
    closed: Record<string, unknown>;
    next: { sessionId: string; openingCash?: number };
  };
}
