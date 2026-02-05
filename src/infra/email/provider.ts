// src/infra/email/provider.ts
import nodemailer from "nodemailer";
import type { Logger } from "pino";
import { ENV } from "@/config/env";

export interface EmailPayload {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

export interface EmailProvider {
  sendMail(payload: EmailPayload, logger?: Logger): Promise<void>;
}

export class SmtpEmailProvider implements EmailProvider {
  private transporter = nodemailer.createTransport({
    host: ENV.SMTP_HOST,
    port: ENV.SMTP_PORT,
    secure: ENV.SMTP_SECURE,
    auth: {
      user: ENV.SMTP_USER,
      pass: ENV.SMTP_PASS,
    },
  });

  async sendMail(payload: EmailPayload, logger?: Logger): Promise<void> {
    try {
      const info = await this.transporter.sendMail({
        from: ENV.SMTP_USER,
        ...payload,
      });

      logger?.info(
        {
          email: payload.to,
          subject: payload.subject,
          messageId: info.messageId,
        },
        "Email sent"
      );
    } catch (err) {
      logger?.error({ err }, "Failed to send email");
      throw err;
    }
  }
}