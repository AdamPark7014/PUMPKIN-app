import { apiFetch } from '../auth';
import { buildTicketsJob } from '../ticket-print';
import { printJobSafe } from '../thermal';
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

export type PrintReceiptOptions = {
  /** Marca todos los boletos como REIMPRESIÓN. Úsalo en todo lo que no sea la primera impresión. */
  reprint?: boolean;
};

export type PrintReceiptResult = {
  ok: boolean;
  via?: 'serial' | 'bridge' | 'popup';
  error?: string;
};

/**
 * Imprime la venta completa: un boleto por asiento (QR nativo, corte entre
 * cada uno) y el comprobante de pago al final. El cajón sólo se patea en
 * ventas en efectivo — en tarjeta no hay cambio que dar.
 *
 * Nunca lanza: la venta ya está cobrada cuando esto corre, y un error de
 * impresora no debe leerse como venta fallida. El resultado dice qué pasó
 * para que la UI avise y ofrezca reimprimir.
 */
export async function printReceipt(
  receipt: PosReceipt,
  opts: PrintReceiptOptions = {},
): Promise<PrintReceiptResult> {
  const job = buildTicketsJob(receipt, {
    reprint: opts.reprint ?? false,
    kickDrawer: receipt.paymentMethod === 'CASH',
    withReceipt: true,
  });
  try {
    const via = await printJobSafe(job.bytes, job.fallbackText);
    return { ok: true, via };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : 'No se pudo imprimir',
    };
  }
}
