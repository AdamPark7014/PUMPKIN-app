import { buildEscPosReceipt, printEscPos } from './thermal';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

const TERMINAL_KEY = 'boletera_terminal_id';
const SESSION_KEY = 'boletera_pos_session';
const CASHIER_KEY = 'boletera_cashier_id';

export type PosReceipt = {
  receiptNumber: string;
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
  checkoutData: {
    eventId: string;
    offerId: string;
    quantity: number;
    paymentMethod: 'CASH' | 'CARD';
    cashierId?: string;
  };
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
  return localStorage.getItem(CASHIER_KEY) || 'cashier-1';
}

export function setCashierId(id: string) {
  localStorage.setItem(CASHIER_KEY, id);
}

export async function ensurePosSession(organizationId: string, cashierId: string) {
  let terminalId = getTerminalId();
  if (!terminalId) {
    const res = await fetch(`${API}/taquilla/terminal/init-org`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        locationName: 'Mostrador principal',
        terminalName: `POS-${navigator.userAgent.slice(0, 12)}`,
      }),
    });
    if (!res.ok) throw new Error('No se pudo inicializar terminal');
    const terminal = await res.json();
    terminalId = terminal.id as string;
    localStorage.setItem(TERMINAL_KEY, terminalId);
  }

  let sessionId = getSessionId();
  if (!sessionId) {
    const res = await fetch(`${API}/taquilla/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terminalId, cashierId }),
    });
    if (!res.ok) throw new Error('No se pudo abrir sesión');
    const session = await res.json();
    sessionId = session.sessionId as string;
    localStorage.setItem(SESSION_KEY, sessionId);
  }

  return { terminalId: terminalId!, sessionId: sessionId! };
}

export async function posCheckout(params: {
  terminalId: string;
  sessionId: string;
  eventId: string;
  offerId: string;
  quantity: number;
  paymentMethod: 'CASH' | 'CARD';
  cashierId?: string;
}) {
  const res = await fetch(`${API}/taquilla/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      terminalId: params.terminalId,
      sessionId: params.sessionId,
      checkoutData: {
        eventId: params.eventId,
        offerId: params.offerId,
        quantity: params.quantity,
        paymentMethod: params.paymentMethod,
        cashierId: params.cashierId ?? getCashierId(),
      },
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{
    orderId: string;
    publicId: string;
    total: number;
    processingTime: string;
  }>;
}

export async function fetchReceipt(orderId: string, terminalId: string) {
  const res = await fetch(
    `${API}/taquilla/receipt/${orderId}?terminalId=${encodeURIComponent(terminalId)}`,
  );
  if (!res.ok) throw new Error('No se pudo generar recibo');
  return res.json() as Promise<PosReceipt>;
}

export function printReceipt(receipt: PosReceipt) {
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
  printEscPos(buildEscPosReceipt(lines));
}

export async function syncOfflineSales(transactions: OfflinePosPayload[]) {
  const terminalId = getTerminalId();
  if (!terminalId || !transactions.length) return { synced: 0 };
  const res = await fetch(`${API}/taquilla/offline/sync/${terminalId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactions }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ synced: number }>;
}
