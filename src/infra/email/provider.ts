import axios from "axios";
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

export type EmailProviderName = "zeptomail" | "maileroo";

export const EMAIL_PROVIDER_NAMES: readonly EmailProviderName[] = [
  "zeptomail",
  "maileroo",
];

export function createEmailProvider(name: EmailProviderName): EmailProvider {
  switch (name) {
    case "zeptomail":
      return new ZeptoMailEmailProvider();
    case "maileroo":
      return new MailerooEmailProvider();
    default:
      throw new Error(`Unsupported email provider: ${name}`);
  }
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
      const fromName =
        ENV.ZEPTOMAIL_FROM_NAME ||
        ENV.MAIL_FROM_NAME ||
        ENV.APP_BRAND_NAME ||
        "App";
      const bounceAddress = ENV.ZEPTOMAIL_BOUNCE_ADDRESS;

      if (!fromEmail) {
        throw new Error(
          "Sender email (ZEPTOMAIL_FROM_EMAIL or MAIL_FROM_EMAIL) is required"
        );
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
            name: email,
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

export class MailerooEmailProvider implements EmailProvider {
  private client = axios.create({
    baseURL: ENV.MAILEROO_URL || "https://smtp.maileroo.com/api/v2",
    timeout: 15000,
  });

  private apiKey: string;
  private fromEmail: string;
  private fromName: string;

  constructor() {
    const apiKey = ENV.MAILEROO_API_KEY;

    if (!apiKey) {
      throw new Error("MAILEROO_API_KEY is required for MailerooEmailProvider");
    }

    const fromEmail = ENV.MAILEROO_FROM_EMAIL || ENV.MAIL_FROM_EMAIL;
    const fromName =
      ENV.MAILEROO_FROM_NAME ||
      ENV.MAIL_FROM_NAME ||
      ENV.APP_BRAND_NAME ||
      "App";

    if (!fromEmail) {
      throw new Error(
        "Sender email (MAILEROO_FROM_EMAIL or MAIL_FROM_EMAIL) is required"
      );
    }

    this.apiKey = apiKey;
    this.fromEmail = fromEmail;
    this.fromName = fromName;
  }

  async sendMail(payload: EmailPayload, logger?: Logger): Promise<void> {
    try {
      const toList = Array.isArray(payload.to) ? payload.to : [payload.to];
      const body: Record<string, unknown> = {
        from: {
          address: this.fromEmail,
          display_name: this.fromName,
        },
        to: toList.map((email) => ({
          address: email,
          display_name: email,
        })),
        subject: payload.subject,
        html: payload.html,
      };

      if (payload.text) {
        body.plain = payload.text;
      }

      const response = await this.client.post("/emails", body, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (response?.data?.success === false) {
        const message =
          response?.data?.message || "Maileroo API returned success=false";
        throw new Error(message);
      }

      logger?.info(
        {
          to: payload.to,
          subject: payload.subject,
        },
        "Email sent via Maileroo API"
      );
    } catch (err) {
      logger?.error({ err }, "Failed to send email via Maileroo API");
      throw err;
    }
  }
}
