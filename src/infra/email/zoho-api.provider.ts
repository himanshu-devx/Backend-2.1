import type { EmailPayload, EmailProvider } from "./provider";
import type { Logger } from "pino";
import { ENV } from "@/config/env";

export class ZohoApiEmailProvider implements EmailProvider {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0; // Timestamp when token expires
  private readonly TOKEN_BUFFER_MS = 60 * 1000; // Refresh 1 minute before expiry
  private accountId: string | null = null;

  /**
   * Retrieves a valid access token, performing a refresh if necessary.
   */
  private async getAccessToken(): Promise<string> {
    const NOW = Date.now();

    // If we have a valid token, return it
    if (this.accessToken && NOW < this.tokenExpiry) {
      return this.accessToken;
    }

    console.log("🔄 [ZohoProvider] Refreshing Access Token...");

    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: ENV.ZOHO_CLIENT_ID || "",
      client_secret: ENV.ZOHO_CLIENT_SECRET || "",
      refresh_token: ENV.ZOHO_REFRESH_TOKEN || "",
    });

    try {
      const response = await fetch(`${ENV.ZOHO_OAUTH_DOMAIN}/oauth/v2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
      }

      const data = await response.json();

      if (!data.access_token) {
        throw new Error(`Invalid token response: ${JSON.stringify(data)}`);
      }

      this.accessToken = data.access_token;
      // Default to 3600 seconds (1 hour) if not provided
      const expiresIn = data.expires_in || 3600;
      this.tokenExpiry = NOW + (expiresIn * 1000) - this.TOKEN_BUFFER_MS;

      console.log("✅ [ZohoProvider] Access Token refreshed successfully.");
      return this.accessToken!;

    } catch (error) {
      console.error("❌ [ZohoProvider] Failed to refresh token:", error);
      throw error;
    }
  }

  /**
   * Retrieves the Zoho Account ID.
   * If ZOHO_ACCOUNT_ID is set in env, uses that.
   * Otherwise, fetches it from the API using the access token.
   */
  private async getAccountId(token: string): Promise<string> {
    if (this.accountId) return this.accountId;
    if (ENV.ZOHO_ACCOUNT_ID) {
      this.accountId = ENV.ZOHO_ACCOUNT_ID;
      return this.accountId;
    }

    console.log("search [ZohoProvider] Fetching Account ID...");
    try {
      const response = await fetch(`${ENV.ZOHO_API_DOMAIN}/api/accounts`, {
        method: 'GET',
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch accounts: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      if (data.data && data.data.length > 0) {
        // Use the first account. Usually there's only one mainly used or the first one is primary.
        // Ideally we might want to match the FROM address if possible, but for now take first.
        const account = data.data.find((acc: any) => acc.isPrimary) || data.data[0];
        this.accountId = account.accountId;
        console.log(`✅ [ZohoProvider] Resolved Account ID: ${this.accountId}`);
        return this.accountId!;
      } else {
        throw new Error("No accounts found in Zoho response.");
      }

    } catch (error) {
      console.error("❌ [ZohoProvider] Failed to fetch Account ID", error);
      throw error;
    }
  }

  async sendMail(payload: EmailPayload, logger?: Logger): Promise<void> {
    try {
      if (!ENV.ZOHO_CLIENT_ID || !ENV.ZOHO_REFRESH_TOKEN) {
        throw new Error("Zoho credentials (CLIENT_ID, REFRESH_TOKEN) are not configured.");
      }

      console.log(`📧 [ZohoProvider] Attempting to send email to: ${payload.to}`);

      const token = await this.getAccessToken();
      const accountId = await this.getAccountId(token);

      const start = Date.now();

      // Construct URL: {API_DOMAIN}/api/accounts/{accountId}/messages
      const url = `${ENV.ZOHO_API_DOMAIN}/api/accounts/${accountId}/messages`;

      const body = {
        fromAddress: ENV.ZOHO_FROM_EMAIL || "no-reply@wisipay.com",
        toAddress: payload.to,
        subject: payload.subject,
        content: payload.html,
        mailFormat: "html",
      };

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const duration = Date.now() - start;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Zoho API Error: ${response.status} ${errorText}`);
      }

      const responseData = await response.json();
      console.log(`✅ [ZohoProvider] Email sent in ${duration}ms`);

      logger?.info(
        {
          email: payload.to,
          subject: payload.subject,
          duration,
          response: responseData
        },
        "Email sent via Zoho API"
      );

    } catch (err: any) {
      console.error(`❌ [ZohoProvider] Failed to send email to: ${payload.to}`, err);
      logger?.error({ err }, "Failed to send email");
      throw err;
    }
  }
}
