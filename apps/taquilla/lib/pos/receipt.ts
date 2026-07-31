import { apiFetch } from '../auth';
import { buildEscPosReceipt, printEscPos, printViaSerial } from '../thermal';
import { LAST_RECEIPT_KEY } from './keys';
import type { PosReceipt } from './types';

export function saveLastReceipt(receipt: PosReceipt): void {
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

export async function fetchReceipt(orderId: string, terminalId: string): Promise<PosReceipt> {
  const res = await apiFetch(
    `/taquilla/receipt/${orderId}?terminalId=${encodeURIComponent(terminalId)}`,
  );
  if (!res.ok) throw new Error('No se pudo generar recibo');
  const receipt = (await res.json()) as PosReceipt;
  return { ...receipt, orderId };
}

export async function printReceipt(receipt: PosReceipt): Promise<void> {
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
    ...receipt.ticketCodes.map((ticket) => `${ticket.seatInfo} · ${ticket.barcode}`),
    '',
    'Gracias por su compra',
  ];
  const payload = buildEscPosReceipt(lines);
  const serialOk = await printViaSerial(payload);
  if (!serialOk) printEscPos(payload);
}
