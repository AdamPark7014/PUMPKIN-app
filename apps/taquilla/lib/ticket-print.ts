/**
 * Construcción de boletos térmicos individuales.
 *
 * Un boleto por asiento, con QR nativo de impresora y corte entre cada uno,
 * seguido de un comprobante de pago compacto. El QR lleva el `code` del
 * boleto: es lo que `POST /access/scan` acepta en puerta, así que el boleto
 * impreso se escanea tal cual.
 *
 * Datos en cada boleto: evento, sede/fecha, zona, localizador de orden,
 * código BLT, folio. La reimpresión SIEMPRE se marca.
 */

import { escpos, padBetween, padCenter } from './escpos';
import type { PosReceipt } from './pos/types';

const WIDTH = 42; // Fuente A en papel de 80 mm.

export type TicketPrintOptions = {
  /** Marca cada boleto como REIMPRESIÓN. */
  reprint?: boolean;
  /** Patea el cajón al final (ventas en efectivo). */
  kickDrawer?: boolean;
  /** Incluye el comprobante de pago después de los boletos. */
  withReceipt?: boolean;
};

export type TicketPrintJob = {
  /** ESC/POS listo para mandarse por serial. */
  bytes: Uint8Array;
  /** Texto plano equivalente para el fallback de impresión por ventana. */
  fallbackText: string;
};

function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-MX');
}

function formatEventWhen(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Boletos individuales + comprobante, en un solo trabajo de impresión.
 */
export function buildTicketsJob(
  receipt: PosReceipt,
  opts: TicketPrintOptions = {},
): TicketPrintJob {
  const { reprint = false, kickDrawer = false, withReceipt = true } = opts;
  const b = escpos();
  const fallback: string[] = [];
  const when = formatDate(receipt.timestamp);
  const localizador = (receipt.localizador || receipt.publicId || '').trim();
  const eventWhen = formatEventWhen(receipt.eventStartsAt);
  const venue = (receipt.venueLabel || '').trim();

  receipt.ticketCodes.forEach((ticket, i) => {
    const nOfM = `${i + 1}/${receipt.ticketCodes.length}`;

    if (reprint) {
      b.align('center').bold(true).size(2, 1).line('* REIMPRESION *').size(1, 1).bold(false);
      fallback.push(padCenter('* REIMPRESION *', WIDTH));
    }

    b.align('center')
      .bold(true)
      .size(2, 2)
      .line(receipt.eventName.toUpperCase().slice(0, 21))
      .size(1, 1)
      .bold(false)
      .line(`Boleto ${nOfM}`)
      .feed(1);

    if (eventWhen) b.line(eventWhen.slice(0, WIDTH));
    if (venue) b.line(venue.slice(0, WIDTH));

    b.feed(1)
      .bold(true)
      .size(1, 2)
      .line(ticket.seatInfo.slice(0, 21))
      .size(1, 1)
      .bold(false)
      .feed(1);

    if (localizador) {
      b.bold(true).line(`LOC ${localizador}`.slice(0, WIDTH)).bold(false).feed(1);
    }

    // El QR es el boleto: lo que la puerta escanea (código BLT-…).
    b.qr(ticket.barcode, 7, 'M')
      .feed(1)
      .line(ticket.barcode)
      .feed(1)
      .align('left')
      .line(padBetween(`Folio ${receipt.receiptNumber}`, when, WIDTH))
      .rule('-', WIDTH)
      .align('center')
      .line('Conserva este boleto. Una sola entrada.')
      .cut();

    fallback.push(
      padCenter(receipt.eventName.toUpperCase(), WIDTH),
      padCenter(`Boleto ${nOfM}`, WIDTH),
      eventWhen ? padCenter(eventWhen, WIDTH) : '',
      venue ? padCenter(venue, WIDTH) : '',
      '',
      padCenter(ticket.seatInfo, WIDTH),
      localizador ? padCenter(`LOC ${localizador}`, WIDTH) : '',
      padCenter(`[QR] ${ticket.barcode}`, WIDTH),
      '',
      padBetween(`Folio ${receipt.receiptNumber}`, when, WIDTH),
      '-'.repeat(WIDTH),
      '',
    );
  });

  if (withReceipt) {
    b.align('center')
      .bold(true)
      .line('COMPROBANTE DE PAGO')
      .bold(false)
      .line(receipt.receiptNumber)
      .line(when)
      .feed(1)
      .align('left');

    if (localizador) b.line(padBetween('Localizador', localizador.slice(0, 24), WIDTH));
    if (receipt.buyerName) {
      b.line(padBetween('Cliente', receipt.buyerName.slice(0, 28), WIDTH));
    }
    b.line(padBetween('Evento', receipt.eventName.slice(0, 28), WIDTH));
    if (venue) b.line(padBetween('Sede', venue.slice(0, 28), WIDTH));
    b.line(padBetween('Boletos', String(receipt.quantity), WIDTH))
      .rule('-', WIDTH)
      .line(padBetween('Subtotal', formatMoney(receipt.subtotal), WIDTH))
      .line(padBetween('Cargos', formatMoney(receipt.fees), WIDTH))
      .line(padBetween('IVA', formatMoney(receipt.taxes), WIDTH))
      .bold(true)
      .line(padBetween('TOTAL', formatMoney(receipt.total), WIDTH))
      .bold(false)
      .line(padBetween('Pago', receipt.paymentMethod, WIDTH))
      .feed(1)
      .align('center')
      .line('Gracias por su compra')
      .cut();

    fallback.push(
      padCenter('COMPROBANTE DE PAGO', WIDTH),
      padCenter(receipt.receiptNumber, WIDTH),
      padCenter(when, WIDTH),
      '',
      localizador ? padBetween('Localizador', localizador.slice(0, 24), WIDTH) : '',
      padBetween('Subtotal', formatMoney(receipt.subtotal), WIDTH),
      padBetween('Cargos', formatMoney(receipt.fees), WIDTH),
      padBetween('IVA', formatMoney(receipt.taxes), WIDTH),
      padBetween('TOTAL', formatMoney(receipt.total), WIDTH),
      padBetween('Pago', receipt.paymentMethod, WIDTH),
      '',
      padCenter('Gracias por su compra', WIDTH),
    );
  }

  if (kickDrawer) b.drawerKick();

  return { bytes: b.build(), fallbackText: fallback.join('\n') };
}
