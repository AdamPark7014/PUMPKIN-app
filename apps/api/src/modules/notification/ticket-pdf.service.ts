import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { buildQrPayload } from '@boletera/crypto';

export type TicketPdfRow = {
  id: string;
  code: string;
  section?: string | null;
  row?: string | null;
  seatNumber?: string | null;
};

@Injectable()
export class TicketPdfService {
  constructor(private readonly config: ConfigService) {}

  async buildPdfBuffer(opts: {
    eventTitle: string;
    publicId: string;
    buyerName: string;
    eventId: string;
    tickets: TicketPdfRow[];
  }): Promise<Buffer> {
    const secret = this.config.get('TICKET_QR_SECRET') ?? this.config.get('JWT_SECRET');
    if (!secret) {
      throw new Error('Neither TICKET_QR_SECRET nor JWT_SECRET is configured.');
    }

    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    doc.fontSize(20).text('BOLETERA', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).text(opts.eventTitle, { align: 'center' });
    doc.fontSize(10).text(`Orden ${opts.publicId} · ${opts.buyerName}`, { align: 'center' });
    doc.moveDown(1);

    for (const t of opts.tickets) {
      const seatLabel = [t.section, t.row, t.seatNumber].filter(Boolean).join(' · ') || 'General';
      const qrPayload = buildQrPayload(t.id, opts.eventId, secret);

      doc.addPage();
      doc.fontSize(12).text(`Boleto ${t.code}`, { underline: true });
      doc.text(`Asiento: ${seatLabel}`);
      doc.moveDown(0.5);

      const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 180, margin: 1 });
      const base64 = qrDataUrl.replace(/^data:image\/png;base64,/, '');
      doc.image(Buffer.from(base64, 'base64'), { width: 140, align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(8).text(qrPayload, { align: 'center' });
    }

    doc.end();
    return done;
  }
}


