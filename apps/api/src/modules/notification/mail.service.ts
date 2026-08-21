import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

type MailAttachment = { filename: string; content: Buffer };

/**
 * Envío transaccional: Brevo API (BREVO_API_KEY) o SMTP clásico.
 * La clave xkeysib- de Brevo es de API; no sirve sola como password SMTP.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(this.config.get('SMTP_PORT') ?? 587),
        secure: false,
        auth: {
          user: this.config.get('SMTP_USER'),
          pass: this.config.get('SMTP_PASSWORD'),
        },
      });
    }
  }

  private brevoKey() {
    return this.config.get<string>('BREVO_API_KEY')?.trim() || '';
  }

  private fromAddress() {
    return (
      this.config.get<string>('MAIL_FROM')?.trim() ||
      this.config.get<string>('SMTP_FROM')?.trim() ||
      'noreply@boletera.com'
    );
  }

  private fromName() {
    return this.brandName();
  }

  private brandName() {
    const branded = this.config.get<string>('MAIL_BRAND')?.trim();
    if (branded) return branded;
    const tenant = (this.config.get<string>('DEMO_TENANT_SLUG') ?? '').trim().toLowerCase();
    if (tenant === 'pumpkin-zone') return 'Pumpkin Zone';
    return 'BOLETERA';
  }

  wrapHtml(body: string, title: string) {
    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>${title}</title></head>
<body style="font-family:system-ui,sans-serif;background:#fafafa;margin:0;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:24px">
<p style="font-weight:700;font-size:18px;margin:0 0 16px">${this.brandName()}</p>
${body}
<p style="color:#737373;font-size:12px;margin-top:24px">Este correo es transaccional.</p>
</div></body></html>`;
  }

  async send(opts: {
    to: string;
    subject: string;
    html: string;
    attachments?: MailAttachment[];
    wrap?: boolean;
  }) {
    const html = opts.wrap !== false ? this.wrapHtml(opts.html, opts.subject) : opts.html;
    const key = this.brevoKey();

    if (key) {
      return this.sendViaBrevo({
        key,
        to: opts.to,
        subject: opts.subject,
        html,
        attachments: opts.attachments,
      });
    }

    if (!this.transporter) {
      this.logger.log(`[MAIL DEV] → ${opts.to}: ${opts.subject}`);
      return { sent: false, dev: true };
    }

    await this.transporter.sendMail({
      from: `${this.fromName()} <${this.fromAddress()}>`,
      to: opts.to,
      subject: opts.subject,
      html,
      attachments: opts.attachments,
    });
    return { sent: true };
  }

  private async sendViaBrevo(opts: {
    key: string;
    to: string;
    subject: string;
    html: string;
    attachments?: MailAttachment[];
  }) {
    const payload: Record<string, unknown> = {
      sender: { email: this.fromAddress(), name: this.fromName() },
      to: [{ email: opts.to }],
      subject: opts.subject,
      htmlContent: opts.html,
    };

    if (opts.attachments?.length) {
      payload.attachment = opts.attachments.map((a) => ({
        name: a.filename,
        content: a.content.toString('base64'),
      }));
    }

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': opts.key,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.error(`Brevo ${res.status}: ${detail.slice(0, 400)}`);
      throw new Error(`Brevo mail failed (${res.status})`);
    }

    return { sent: true };
  }
}
