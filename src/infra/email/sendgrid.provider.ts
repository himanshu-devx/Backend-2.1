import type { EmailPayload, EmailProvider } from "./provider";
import type { Logger } from "pino";
import { ENV } from "@/config/env";

export class SendGridEmailProvider implements EmailProvider {
  async sendMail(payload: EmailPayload, logger?: Logger): Promise<void> {
    try {
      if (!ENV.SENDGRID_API_KEY) {
        throw new Error("SendGrid API Key is not configured.");
      }

      console.log(`📧 [SendGrid] Sending email to: ${payload.to}`);
      const start = Date.now();

      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ENV.SENDGRID_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [
            {
              to: [{ email: payload.to }],
            },
          ],
          from: {
            email: ENV.SENDGRID_FROM_EMAIL || "no-reply@wisipay.com",
            name: ENV.APP_BRAND_NAME || "Wisipay Fintech",
          },
          subject: payload.subject,
          content: [
            {
              type: "text/html",
              value: payload.html,
            },
          ],
        }),
      });

      const duration = Date.now() - start;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`SendGrid API Error: ${response.status} ${errorText}`);
      }

      console.log(`✅ [SendGrid] Email sent successfully in ${duration}ms`);

      logger?.info(
        {
          email: payload.to,
          subject: payload.subject,
          duration,
        },
        "Email sent via SendGrid API"
      );
    } catch (err: any) {
      console.error(`❌ [SendGrid] Failed to send email to: ${payload.to}`, err);
      logger?.error({ err }, "Failed to send email");
      throw err;
    }
  }
}
