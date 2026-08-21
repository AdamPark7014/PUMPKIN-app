/**
 * Boleto térmico Pumpkin Zone — formato arte 80 × 148 mm (8 × 14,8 cm).
 *
 * Papel: rollo Epson “80 mm” (79,5 ± 0,5 mm). Ancho útil ~72 mm / 42 cols Font A.
 * Alto: variable por corte; el layout apunta a ~148 mm por persona (ahorro de papel).
 *
 * Estructura alineada al PDF de diseño:
 *   marca → tagline → FECHA / HORARIO / LUGAR → acceso → LOC → QR BLT → folio
 *
 * El QR lleva el código durable `BLT-…` (mismo que PDA / PDF / correo).
 * Ver docs/research/BOLETO-TERMICO-EPSON.md
 */

import { escpos, padBetween, padCenter } from './escpos';
import type { PosReceipt } from './pos/types';

/** Columnas Font A en papel 80 mm (Epson TM). */
export const TICKET_COLS = 42;

/** Módulo QR: 5 ≈ legible PDA y cabe en el alto 148 mm. */
const QR_MODULE = 5;

export type TicketPrintOptions = {
  reprint?: boolean;
  kickDrawer?: boolean;
  /** Stub de pago corto al final de la venta (un corte extra). Default true. */
  withReceipt?: boolean;
};

export type TicketPrintJob = {
  bytes: Uint8Array;
  fallbackText: string;
};

function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatSaleWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-MX');
}

/** FECHA: 29 OCT - 2 NOV 2026 */
function formatFecha(startsAt?: string | null, endsAt?: string | null): string {
  if (!startsAt) return 'POR CONFIRMAR';
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return 'POR CONFIRMAR';
  const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' };
  const a = start.toLocaleDateString('es-MX', opts).toUpperCase();
  if (!endsAt) return a;
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return a;
  // Misma noche / medianoche: mostrar solo día de apertura si el fin es al día siguiente temprano.
  const b = end.toLocaleDateString('es-MX', opts).toUpperCase();
  return a === b ? a : `${a} - ${b}`;
}

/** HORARIO: 11:00 AM - MEDIANOCHE */
function formatHorario(
  startsAt?: string | null,
  endsAt?: string | null,
  hoursLabel?: string | null,
): string {
  if (hoursLabel?.trim()) return hoursLabel.trim().toUpperCase();
  if (!startsAt) return 'CONSULTAR';
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return 'CONSULTAR';
  const t0 = start.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  if (!endsAt) return t0;
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return t0;
  const hours = end.getHours();
  const mins = end.getMinutes();
  if (hours === 0 && mins === 0) return `${t0} - MEDIANOCHE`;
  const t1 = end.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  return `${t0} - ${t1}`;
}

function dashed(b: ReturnType<typeof escpos>, fb: string[]) {
  b.align('center').line('-'.repeat(TICKET_COLS));
  fb.push('-'.repeat(TICKET_COLS));
}

/**
 * Un boleto por acceso + stub de pago opcional (corto) al final.
 */
export function buildTicketsJob(
  receipt: PosReceipt,
  opts: TicketPrintOptions = {},
): TicketPrintJob {
  const { reprint = false, kickDrawer = false, withReceipt = true } = opts;
  const b = escpos();
  const fallback: string[] = [];
  const localizador = (receipt.localizador || receipt.publicId || '').trim();
  const fecha = formatFecha(receipt.eventStartsAt, receipt.eventEndsAt);
  const horario = formatHorario(receipt.eventStartsAt, receipt.eventEndsAt, receipt.hoursLabel);
  const lugar = (receipt.venueLabel || '').trim().toUpperCase() || 'SEDE POR CONFIRMAR';
  const saleWhen = formatSaleWhen(receipt.timestamp);
  const folioShort = (receipt.receiptNumber || localizador || '—').replace(/^RCP-/i, '');

  receipt.ticketCodes.forEach((ticket, i) => {
    const nOfM = `${i + 1}/${receipt.ticketCodes.length}`;
    const acceso = (ticket.seatInfo || 'GENERAL').toUpperCase();

    if (reprint) {
      b.align('center').bold(true).size(2, 1).line('* REIMPRESION *').size(1, 1).bold(false);
      fallback.push(padCenter('* REIMPRESION *', TICKET_COLS));
    }

    // —— Cabecera (arte: marca + tagline) ——
    b.align('center')
      .bold(true)
      .size(2, 2)
      .line('PUMPKIN ZONE')
      .size(1, 1)
      .bold(false)
      .line('DISFRUTA LA TEMPORADA');
    fallback.push(padCenter('PUMPKIN ZONE', TICKET_COLS), padCenter('DISFRUTA LA TEMPORADA', TICKET_COLS));
    dashed(b, fallback);

    // —— Datos del evento ——
    b.align('left')
      .bold(true)
      .line(`FECHA: ${fecha}`.slice(0, TICKET_COLS))
      .bold(false);
    fallback.push(`FECHA: ${fecha}`.slice(0, TICKET_COLS));
    dashed(b, fallback);

    b.bold(true).line(`HORARIO: ${horario}`.slice(0, TICKET_COLS)).bold(false);
    fallback.push(`HORARIO: ${horario}`.slice(0, TICKET_COLS));
    dashed(b, fallback);

    b.bold(true).line(`LUGAR: ${lugar}`.slice(0, TICKET_COLS)).bold(false);
    fallback.push(`LUGAR: ${lugar}`.slice(0, TICKET_COLS));
    dashed(b, fallback);

    b.bold(true)
      .line(`ACCESO: ${acceso}`.slice(0, TICKET_COLS))
      .bold(false)
      .line(`BOLETO ${nOfM}`.slice(0, TICKET_COLS));
    fallback.push(`ACCESO: ${acceso}`.slice(0, TICKET_COLS), `BOLETO ${nOfM}`);

    if (localizador) {
      b.bold(true).line(`LOC: ${localizador}`.slice(0, TICKET_COLS)).bold(false);
      fallback.push(`LOC: ${localizador}`.slice(0, TICKET_COLS));
    }
    dashed(b, fallback);

    // —— QR de acceso (BLT) ——
    b.align('center')
      .qr(ticket.barcode, QR_MODULE, 'M')
      .line(ticket.barcode)
      .line('ESCANEA EN LA ENTRADA');
    fallback.push(padCenter(`[QR] ${ticket.barcode}`, TICKET_COLS), padCenter('ESCANEA EN LA ENTRADA', TICKET_COLS));
    dashed(b, fallback);

    // —— Pie folio / gracias (arte) ——
    b.align('left')
      .line(padBetween(`FOLIO ${folioShort}`.slice(0, 18), 'GRACIAS POR SER PARTE'.slice(0, 22), TICKET_COLS))
      .align('center')
      .line('Conserva este boleto. Reingreso solo con salida registrada.')
      .cut();

    fallback.push(
      padBetween(`FOLIO ${folioShort}`.slice(0, 18), 'GRACIAS'.slice(0, 22), TICKET_COLS),
      padCenter('Conserva este boleto. Reingreso solo con salida registrada.', TICKET_COLS),
      '',
    );
  });

  // Stub de pago: un solo corte corto al final (ahorra vs comprobante largo por boleto).
  if (withReceipt) {
    b.align('center').bold(true).line('COMPROBANTE').bold(false).line(saleWhen);
    fallback.push(padCenter('COMPROBANTE', TICKET_COLS), padCenter(saleWhen, TICKET_COLS));
    b.align('left');
    if (localizador) {
      b.line(padBetween('Localizador', localizador.slice(0, 22), TICKET_COLS));
      fallback.push(padBetween('Localizador', localizador.slice(0, 22), TICKET_COLS));
    }
    b.line(padBetween('Boletos', String(receipt.quantity), TICKET_COLS))
      .bold(true)
      .line(padBetween('TOTAL', formatMoney(receipt.total), TICKET_COLS))
      .bold(false)
      .line(padBetween('Pago', receipt.paymentMethod, TICKET_COLS))
      .align('center')
      .line('Gracias por su compra')
      .cut();
    fallback.push(
      padBetween('Boletos', String(receipt.quantity), TICKET_COLS),
      padBetween('TOTAL', formatMoney(receipt.total), TICKET_COLS),
      padBetween('Pago', receipt.paymentMethod, TICKET_COLS),
      padCenter('Gracias por su compra', TICKET_COLS),
    );
  }

  if (kickDrawer) b.drawerKick();

  return { bytes: b.build(), fallbackText: fallback.join('\n') };
}
