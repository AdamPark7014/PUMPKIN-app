import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

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

  private brandName() {
    const branded = this.config.get<string>('MAIL_BRAND')?.trim();
    if (branded) return branded;
    const tenant = (this.config.get<string>('DEMO_TENANT_SLUG') ?? '').trim().toLowerCase();
    if (tenant === 'pumpkin-zone') return 'Pumpkin Zone';
    return 'BOLETERA';
  }

  async buildPdfBuffer(opts: {
    eventTitle: string;
    publicId: string;
    buyerName: string;
    eventId: string;
    tickets: TicketPdfRow[];
  }): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    doc.fontSize(20).text(this.brandName(), { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).text(opts.eventTitle, { align: 'center' });
    doc.fontSize(11).text(`Localizador ${opts.publicId}`, { align: 'center' });
    doc.fontSize(10).text(opts.buyerName, { align: 'center' });
    doc.moveDown(1);

    for (const t of opts.tickets) {
      const seatLabel = [t.section, t.row, t.seatNumber].filter(Boolean).join(' · ') || 'General';
      // Mismo payload que el boleto térmico Epson / PDA: código BLT-…
      const qrPayload = t.code;

      doc.addPage();
      doc.fontSize(12).text(`Boleto ${t.code}`, { underline: true });
      doc.text(`Localizador: ${opts.publicId}`);
      doc.text(`Asiento: ${seatLabel}`);
      doc.moveDown(0.5);

      const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 180, margin: 1 });
      const base64 = qrDataUrl.replace(/^data:image\/png;base64,/, '');
      doc.image(Buffer.from(base64, 'base64'), { width: 140, align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(10).text(t.code, { align: 'center' });
    }

    doc.end();
    return done;
  }
}
