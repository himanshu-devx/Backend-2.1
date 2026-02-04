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

export class ZohoEmailProvider implements EmailProvider {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  /**
   * Get or refresh Zoho access token
   */
  private async getAccessToken(): Promise<string> {
    // reuse token if still valid
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt) {
      return this.accessToken;
    }

    const params = new URLSearchParams({
      refresh_token: ENV.ZOHO_REFRESH_TOKEN || "",
      client_id: ENV.ZOHO_CLIENT_ID || "",
      client_secret: ENV.ZOHO_CLIENT_SECRET || "",
      grant_type: "refresh_token",
    });

    const res = await fetch(`${ENV.ZOHO_OAUTH_DOMAIN}/oauth/v2/token?${params.toString()}`, {
      method: "POST",
    });

    if (!res.ok) {
        throw new Error(`Failed to refresh token: ${res.statusText}`);
    }

    const data = await res.json() as any;

    this.accessToken = data.access_token;
    this.accessTokenExpiresAt = Date.now() + 55 * 60 * 1000; // 55 mins

    return this.accessToken!;
  }

  async sendMail(payload: EmailPayload, logger?: Logger): Promise<void> {
    try {
      const accessToken = await this.getAccessToken();
      const to = Array.isArray(payload.to) ? payload.to.join(",") : payload.to;

      const start = Date.now();

      const res = await fetch(ENV.ZOHO_MAIL_API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Zoho-oauthtoken ${accessToken}`,
        },
        body: JSON.stringify({
          fromAddress: ENV.ZOHO_FROM_EMAIL,
          toAddress: to,
          subject: payload.subject,
          content: payload.html,
          mailFormat: "html",
        }),
      });

      const duration = Date.now() - start;

      if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Zoho API Error: ${res.status} ${errText}`);
      }

      const data = await res.json() as any;

      logger?.info(
        {
          email: payload.to,
          subject: payload.subject,
          messageId: data?.data?.messageId,
          duration,
        },
        "Zoho email sent"
      );

      console.log(`✅ [ZohoEmailProvider] Email sent in ${duration}ms`);
    } catch (err: any) {
      console.error("❌ [ZohoEmailProvider] Failed to send email");
      console.error(err.message);

      logger?.error({ err }, "Zoho email failed");
      throw err;
    }
  }
}
