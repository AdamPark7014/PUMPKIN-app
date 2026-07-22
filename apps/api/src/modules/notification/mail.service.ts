import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

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

  private from() {
    return this.config.get('MAIL_FROM') ?? 'noreply@boletera.com';
  }

  wrapHtml(body: string, title: string) {
    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>${title}</title></head>
<body style="font-family:system-ui,sans-serif;background:#fafafa;margin:0;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:24px">
<p style="font-weight:700;font-size:18px;margin:0 0 16px">BOLETERA</p>
${body}
<p style="color:#737373;font-size:12px;margin-top:24px">Este correo es transaccional.</p>
</div></body></html>`;
  }

  async send(opts: {
    to: string;
    subject: string;
    html: string;
    attachments?: { filename: string; content: Buffer }[];
    wrap?: boolean;
  }) {
    const html = opts.wrap !== false ? this.wrapHtml(opts.html, opts.subject) : opts.html;
    if (!this.transporter) {
      this.logger.log(`[MAIL DEV] → ${opts.to}: ${opts.subject}`);
      return { sent: false, dev: true };
    }
    await this.transporter.sendMail({
      from: this.from(),
      to: opts.to,
      subject: opts.subject,
      html,
      attachments: opts.attachments,
    });
    return { sent: true };
  }
}


