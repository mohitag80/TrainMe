import { Inject, Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { SERVICE_CONFIG } from '@trainme/service-kit';
import type { NotificationConfig } from '../config/notification.config.js';

/** SMTP sender (Mailpit in test, Amazon SES SMTP in beta). */
@Injectable()
export class Mailer {
  private readonly transport: Transporter;

  constructor(@Inject(SERVICE_CONFIG) private readonly config: NotificationConfig) {
    this.transport = nodemailer.createTransport(config.SMTP_URL);
  }

  async send(to: string, subject: string, text: string): Promise<void> {
    await this.transport.sendMail({ from: this.config.MAIL_FROM, to, subject, text });
  }
}
