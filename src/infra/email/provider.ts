import nodemailer from "nodemailer";
import { SendMailClient } from "zeptomail";
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

export class ZeptoMailEmailProvider implements EmailProvider {
  private client: SendMailClient;

  constructor() {
    const url = ENV.ZEPTOMAIL_URL || "https://api.zeptomail.com/v1.1/email";
    const token = ENV.ZEPTOMAIL_API_KEY;

    if (!token) {
      throw new Error("ZEPTOMAIL_API_KEY is required for ZeptoMailEmailProvider");
    }

    this.client = new SendMailClient({ url, token });
  }

  async sendMail(payload: EmailPayload, logger?: Logger): Promise<void> {
    try {
      const fromEmail = ENV.ZEPTOMAIL_FROM_EMAIL || ENV.MAIL_FROM_EMAIL;
      const fromName = ENV.ZEPTOMAIL_FROM_NAME || ENV.MAIL_FROM_NAME || ENV.APP_BRAND_NAME || "App";
      const bounceAddress = ENV.ZEPTOMAIL_BOUNCE_ADDRESS;

      if (!fromEmail) {
        throw new Error("Sender email (ZEPTOMAIL_FROM_EMAIL or MAIL_FROM_EMAIL) is required");
      }

      const toList = Array.isArray(payload.to) ? payload.to : [payload.to];

      const mailConfig: any = {
        from: {
          address: fromEmail,
          name: fromName,
        },
        to: toList.map((email) => ({
          email_address: {
            address: email,
            name: email, // ZeptoMail likes names, we'll use email as name
          },
        })),
        subject: payload.subject,
        htmlbody: payload.html,
      };

      if (payload.text) {
        mailConfig.textbody = payload.text;
      }

      if (bounceAddress) {
        mailConfig.bounce_address = bounceAddress;
      }

      await this.client.sendMail(mailConfig);

      logger?.info(
        {
          to: payload.to,
          subject: payload.subject,
        },
        "Email sent via ZeptoMail API"
      );
    } catch (err) {
      logger?.error({ err }, "Failed to send email via ZeptoMail API");
      throw err;
    }
  }
}

export class SmtpEmailProvider implements EmailProvider {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: ENV.SMTP_HOST || "smtp.gmail.com",
      port: ENV.SMTP_PORT || 587,
      secure: ENV.SMTP_SECURE, // true for 465, false for other ports
      auth: {
        user: ENV.SMTP_USER,
        pass: ENV.SMTP_PASS,
      },
    });
  }

  async sendMail(payload: EmailPayload, logger?: Logger): Promise<void> {
    try {
      const fromEmail = ENV.MAIL_FROM_EMAIL || ENV.SMTP_USER;
      const fromName = ENV.MAIL_FROM_NAME || ENV.APP_BRAND_NAME || "App";

      const info = await this.transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: Array.isArray(payload.to) ? payload.to.join(", ") : payload.to,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      });

      logger?.info(
        {
          messageId: info.messageId,
          to: payload.to,
          subject: payload.subject,
        },
        "Email sent via SMTP"
      );
    } catch (err) {
      logger?.error({ err }, "Failed to send email via SMTP");
      throw err;
    }
  }
}

export class MailerSendEmailProvider implements EmailProvider {
  // Keeping as an option, but we will switch the index to use SMTP
  private client: any; // Using any to avoid mandatory mailersend import if not used
  private from: any;

  constructor() {
    // Lazy load or just keep for reference
    const { MailerSend, Sender } = require("mailersend");
    this.client = new MailerSend({ apiKey: (ENV as any).MAILERSEND_API_KEY });
    this.from = new Sender(
      (ENV as any).MAILERSEND_FROM_EMAIL,
      (ENV as any).MAILERSEND_FROM_NAME || ENV.APP_BRAND_NAME || "App"
    );
  }

  async sendMail(payload: EmailPayload, logger?: Logger): Promise<void> {
    const { EmailParams, Recipient } = require("mailersend");
    try {
      const toList = Array.isArray(payload.to) ? payload.to : [payload.to];
      const recipients = toList.map((email: string) => new Recipient(email, email));

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
