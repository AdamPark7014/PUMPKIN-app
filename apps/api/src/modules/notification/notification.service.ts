import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { Queue, Job } from 'bull';

export const NOTIFICATION_QUEUE = 'notifications';

export type NotificationJob =
  | { type: 'order.confirmation'; orderId: string; email: string; buyerName: string }
  | { type: 'ticket.pdf'; orderId: string; email: string }
  | { type: 'fraud.alert'; orderId: string; score: number; severity: string }
  | { type: 'refund.notification'; orderId: string; email: string; amount: number }
  | { type: 'resale.alert'; listingId: string; buyerEmail: string; eventTitle: string }
  | { type: 'payout.ready'; organizationId: string; amount: number; email: string }
  | { type: 'event.reminder'; eventId: string; userId: string; email: string; eventTitle: string }
  | {
      type: 'generic.email';
      to: string;
      subject: string;
      template: string;
      data: Record<string, unknown>;
    };

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectQueue(NOTIFICATION_QUEUE) private readonly queue: Queue,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  // ==================== ORDER NOTIFICATIONS ====================

  async enqueueOrderConfirmation(orderId: string, email: string, buyerName: string) {
    await this.queue.add(
      'dispatch',
      { type: 'order.confirmation', orderId, email, buyerName } as NotificationJob,
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true },
    );
    this.logger.log(`Queued order confirmation for ${orderId}`);
  }

  async enqueueTicketPDF(orderId: string, email: string) {
    await this.queue.add(
      'dispatch',
      { type: 'ticket.pdf', orderId, email } as NotificationJob,
      { attempts: 3, delay: 5000, removeOnComplete: true },
    );
    this.logger.log(`Queued ticket PDF generation for ${orderId}`);
  }

  // ==================== FRAUD NOTIFICATIONS ====================

  async enqueueFraudAlert(orderId: string, score: number, severity: string) {
    await this.queue.add(
      'dispatch',
      { type: 'fraud.alert', orderId, score, severity } as NotificationJob,
      { priority: 1, attempts: 5, removeOnComplete: true },
    );
    this.logger.warn(`Queued fraud alert for ${orderId} (score: ${score}, severity: ${severity})`);
  }

  // ==================== REFUND NOTIFICATIONS ====================

  async enqueueRefundNotification(orderId: string, email: string, amount: number) {
    await this.queue.add(
      'dispatch',
      { type: 'refund.notification', orderId, email, amount } as NotificationJob,
      { attempts: 3, removeOnComplete: true },
    );
    this.logger.log(`Queued refund notification for ${orderId}`);
  }

  // ==================== RESALE NOTIFICATIONS ====================

  async enqueueResaleAlert(listingId: string, buyerEmail: string, eventTitle: string) {
    await this.queue.add(
      'dispatch',
      { type: 'resale.alert', listingId, buyerEmail, eventTitle } as NotificationJob,
      { attempts: 3, removeOnComplete: true },
    );
    this.logger.log(`Queued resale alert for ${listingId}`);
  }

  // ==================== PAYOUT NOTIFICATIONS ====================

  async enqueuePayoutReady(organizationId: string, amount: number, email: string) {
    await this.queue.add(
      'dispatch',
      { type: 'payout.ready', organizationId, amount, email } as NotificationJob,
      { attempts: 3, removeOnComplete: true },
    );
    this.logger.log(`Queued payout notification for org ${organizationId}`);
  }

  // ==================== EVENT REMINDERS ====================

  async enqueueEventReminder(eventId: string, userId: string, email: string, eventTitle: string) {
    await this.queue.add(
      'dispatch',
      { type: 'event.reminder', eventId, userId, email, eventTitle } as NotificationJob,
      { delay: 24 * 60 * 60 * 1000, attempts: 2, removeOnComplete: true }, // 24h before
    );
    this.logger.log(`Queued event reminder for ${eventId}`);
  }

  async enqueueEmail(payload: {
    to: string;
    subject: string;
    template: string;
    data: Record<string, unknown>;
  }) {
    await this.queue.add(
      'dispatch',
      {
        type: 'generic.email',
        to: payload.to,
        subject: payload.subject,
        template: payload.template,
        data: payload.data,
      } as NotificationJob,
      { attempts: 3, removeOnComplete: true },
    );
    this.logger.log(`Queued generic email to ${payload.to} (${payload.template})`);
  }

  // ==================== QUEUE MANAGEMENT ====================

  async getQueueStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  async retryFailedJobs() {
    const failed = await this.queue.getFailed(0, -1);
    let retried = 0;

    for (const job of failed) {
      if (job.attemptsMade < 3) {
        await job.retry();
        retried++;
      }
    }

    this.logger.log(`Retried ${retried} failed jobs`);
    return { retried };
  }

  async clearQueue() {
    await this.queue.empty();
    this.logger.log('Queue cleared');
  }

  // ==================== NOTIFICATION TEMPLATES ====================

  getOrderConfirmationTemplate(buyerName: string, eventTitle: string, totalAmount: number) {
    return {
      subject: `¡Tu entrada a ${eventTitle} está confirmada!`,
      html: `
        <h1>Confirmación de Orden</h1>
        <p>Hola ${buyerName},</p>
        <p>Tu orden para <strong>${eventTitle}</strong> ha sido confirmada.</p>
        <p>Total: <strong>$${totalAmount}</strong></p>
        <p>Revisa tu correo para los detalles de tus entradas.</p>
      `,
    };
  }

  getFraudAlertTemplate(orderId: string, score: number, severity: string) {
    return {
      subject: `[ALERTA FRAUDE] Orden ${orderId}`,
      html: `
        <h1>Alerta de Fraude Detectada</h1>
        <p>Se ha detectado actividad sospechosa.</p>
        <p>Orden ID: ${orderId}</p>
        <p>Puntuación: ${score}/100</p>
        <p>Severidad: ${severity}</p>
        <p>Por favor, revisa esta orden en tu dashboard de administración.</p>
      `,
    };
  }

  getRefundTemplate(amount: number, reason: string) {
    return {
      subject: 'Tu reembolso ha sido procesado',
      html: `
        <h1>Reembolso Confirmado</h1>
        <p>Tu reembolso de $${amount} ha sido procesado exitosamente.</p>
        <p>Razón: ${reason}</p>
        <p>El dinero aparecerá en tu cuenta en 3-5 días hábiles.</p>
      `,
    };
  }
}


