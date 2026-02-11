// src/infra/email/provider.ts
import { EmailParams, MailerSend, Recipient, Sender } from "mailersend";
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

export class MailerSendEmailProvider implements EmailProvider {
  private client: MailerSend;
  private from: Sender;

  constructor() {
    if (!ENV.MAILERSEND_API_KEY) {
      throw new Error("MAILERSEND_API_KEY is required");
    }

    if (!ENV.MAILERSEND_FROM_EMAIL) {
      throw new Error("MAILERSEND_FROM_EMAIL is required");
    }

    this.client = new MailerSend({ apiKey: ENV.MAILERSEND_API_KEY });
    this.from = new Sender(
      ENV.MAILERSEND_FROM_EMAIL,
      ENV.MAILERSEND_FROM_NAME || ENV.APP_BRAND_NAME || "App"
    );
  }

  async sendMail(payload: EmailPayload, logger?: Logger): Promise<void> {
    try {
      const toList = Array.isArray(payload.to) ? payload.to : [payload.to];
      const recipients = toList.map((email) => new Recipient(email, email));

      const emailParams = new EmailParams()
        .setFrom(this.from)
        .setTo(recipients)
        .setReplyTo(this.from)
        .setSubject(payload.subject)
        .setHtml(payload.html);

      if (payload.text) {
        emailParams.setText(payload.text);
      }

      await this.client.email.send(emailParams);

      logger?.info(
        {
          email: payload.to,
          subject: payload.subject,
        },
        "Email sent via MailerSend"
      );
    } catch (err) {
      logger?.error({ err }, "Failed to send email via MailerSend");
      throw err;
    }
  }
}
