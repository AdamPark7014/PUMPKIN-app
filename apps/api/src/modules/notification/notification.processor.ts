import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bull';
import { buildQrPayload } from '@boletera/crypto';
import QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from './mail.service';
import { NOTIFICATION_QUEUE, NotificationJob } from './notification.service';
import { TicketPdfService } from './ticket-pdf.service';

@Processor(NOTIFICATION_QUEUE)
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private ticketPdf: TicketPdfService,
    private config: ConfigService,
    @InjectQueue(NOTIFICATION_QUEUE) private readonly queue: Queue,
  ) {}

  @Process('dispatch')
  async handle(job: Job<NotificationJob>) {
    const payload = job.data;
    switch (payload.type) {
      case 'order.confirmation':
        return this.sendOrderConfirmation(payload);
      case 'ticket.pdf':
        return this.sendTicketPdf(payload);
      case 'fraud.alert':
        return this.sendFraudAlert(payload);
      case 'refund.notification':
        return this.sendRefund(payload);
      case 'resale.alert':
        return this.sendResaleAlert(payload);
      case 'payout.ready':
        return this.sendPayoutReady(payload);
      case 'event.reminder':
        return this.sendEventReminder(payload);
      case 'generic.email':
        return this.sendGenericEmail(payload);
      default:
        break;
    }
  }

  private async sendGenericEmail(payload: Extract<NotificationJob, { type: 'generic.email' }>) {
    const d = payload.data;
    let html = `<p>${payload.subject}</p>`;
    if (payload.template === 'waitlist-available') {
      html = `
        <h1>¡Hay boletos disponibles!</h1>
        <p>El evento <strong>${d.eventTitle}</strong> tiene disponibilidad.</p>
        <p><a href="${d.eventUrl}">Comprar ahora</a></p>
      `;
    } else if (payload.template === 'password-reset') {
      html = `
        <h1>Restablecer contraseña</h1>
        <p>Hola ${d.firstName || ''},</p>
        <p><a href="${d.resetUrl}">Haz clic aquí para elegir una nueva contraseña</a></p>
        <p>El enlace expira en 1 hora.</p>
      `;
    } else if (payload.template === 'ticket-transfer') {
      html = `
        <h1>Te transfirieron un boleto</h1>
        <p>Evento: <strong>${d.eventTitle}</strong></p>
        <p>Código: <strong>${d.transferCode}</strong></p>
        <p><a href="${d.acceptUrl}">Aceptar transferencia</a></p>
        ${d.message ? `<p>Mensaje: ${d.message}</p>` : ''}
      `;
    }
    await this.mail.send({ to: payload.to, subject: payload.subject, html });
  }

  private qrSecret(): string {
    const secret = this.config.get('TICKET_QR_SECRET') ?? this.config.get('JWT_SECRET');
    if (!secret) {
      throw new Error('Neither TICKET_QR_SECRET nor JWT_SECRET is configured.');
    }
    return secret;
  }

  private async loadOrder(orderId: string) {
    return this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { tickets: true } }, event: true },
    });
  }

  private async sendOrderConfirmation(payload: Extract<NotificationJob, { type: 'order.confirmation' }>) {
    const order = await this.loadOrder(payload.orderId);
    if (!order) return;

    const tickets = order.items.flatMap((i) => i.tickets);
    const secret = this.qrSecret();
    const qrBlocks = await Promise.all(
      tickets.map(async (t) => {
        const payloadQr = buildQrPayload(t.id, order.eventId, secret);
        const img = await QRCode.toDataURL(payloadQr, { width: 120 });
        return `<p><strong>${t.code}</strong><br/><img src="${img}" alt="QR" width="120"/></p>`;
      }),
    );

    await this.mail.send({
      to: payload.email,
      subject: `Confirmación · ${order.event.title}`,
      html: `
        <h1>¡Listo, ${payload.buyerName}!</h1>
        <p>Tu orden <strong>${order.publicId}</strong> para <strong>${order.event.title}</strong> está confirmada.</p>
        <p>Total: <strong>$${order.totalAmount}</strong></p>
        <h2>Tus boletos (${tickets.length})</h2>
        ${qrBlocks.join('')}
        <p>Presenta el QR en la entrada.</p>
      `,
    });

    await this.queue.add(
      'dispatch',
      { type: 'ticket.pdf', orderId: payload.orderId, email: payload.email } satisfies NotificationJob,
      { delay: 3000, attempts: 3, removeOnComplete: true },
    );
  }

  private async sendTicketPdf(payload: Extract<NotificationJob, { type: 'ticket.pdf' }>) {
    const order = await this.loadOrder(payload.orderId);
    if (!order) return;

    const tickets = order.items.flatMap((i) => i.tickets);
    const pdf = await this.ticketPdf.buildPdfBuffer({
      eventTitle: order.event.title,
      publicId: order.publicId,
      buyerName: order.buyerName,
      eventId: order.eventId,
      tickets: tickets.map((t) => ({
        id: t.id,
        code: t.code,
        section: t.section,
        row: t.row,
        seatNumber: t.seatNumber,
      })),
    });

    await this.mail.send({
      to: payload.email,
      subject: `Boletos PDF · ${order.event.title}`,
      html: `<p>Adjunto: ${tickets.length} boleto(s) para ${order.event.title}.</p>`,
      attachments: [{ filename: `boletos-${order.publicId}.pdf`, content: pdf }],
    });
  }

  private async sendFraudAlert(payload: Extract<NotificationJob, { type: 'fraud.alert' }>) {
    const order = await this.prisma.order.findUnique({
      where: { id: payload.orderId },
      include: { event: { include: { organization: true } } },
    });
    const adminEmail =
      this.config.get('FRAUD_ALERT_EMAIL') ??
      order?.event?.organization?.email;
    if (!adminEmail) {
      this.logger.warn(`Fraud alert ${payload.orderId} — sin email admin`);
      return;
    }
    await this.mail.send({
      to: adminEmail,
      subject: `[FRAUDE] Orden ${order?.publicId ?? payload.orderId}`,
      html: `<p>Score ${payload.score} · severidad ${payload.severity}</p>`,
    });
  }

  private async sendRefund(payload: Extract<NotificationJob, { type: 'refund.notification' }>) {
    await this.mail.send({
      to: payload.email,
      subject: 'Reembolso procesado',
      html: `<p>Tu reembolso de $${payload.amount} ha sido registrado.</p>`,
    });
  }

  private async sendResaleAlert(payload: Extract<NotificationJob, { type: 'resale.alert' }>) {
    await this.mail.send({
      to: payload.buyerEmail,
      subject: `Reventa · ${payload.eventTitle}`,
      html: `<p>Actividad en tu publicación ${payload.listingId}.</p>`,
    });
  }

  private async sendPayoutReady(payload: Extract<NotificationJob, { type: 'payout.ready' }>) {
    await this.mail.send({
      to: payload.email,
      subject: 'Liquidación disponible',
      html: `<p>Liquidación de $${payload.amount} lista.</p>`,
    });
  }

  private async sendEventReminder(payload: Extract<NotificationJob, { type: 'event.reminder' }>) {
    await this.mail.send({
      to: payload.email,
      subject: `Recordatorio · ${payload.eventTitle}`,
      html: `<p>Pronto es tu evento. ¡Lleva tus boletos!</p>`,
    });
  }
}


