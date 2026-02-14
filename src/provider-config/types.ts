export type ProviderStatus = "SUCCESS" | "FAILED" | "PENDING" | "EXPIRED";

export interface ProviderCredentials {
  apiKey?: string;
  apiSecret?: string;
  apiSalt?: string;
  merchantId?: string;
  webhookSecret?: string;
  baseUrl?: string;
  mode?: string;
  currency?: string;
  city?: string;
  country?: string;
  zipCode?: string;
  returnUrl?: string;
  returnUrlFailure?: string;
  description?: string;
  [key: string]: string | undefined;
}

export interface ProviderConfig {
  pleId: string;
  providerId: string;
  legalEntityId: string;
  credentials: ProviderCredentials;
}

export interface PayinRequest {
  amount: number;
  transactionId: string;
  orderId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  callbackUrl?: string;
  redirectUrl?: string;
  returnUrl?: string;
  returnUrlFailure?: string;
  remarks?: string;
  description?: string;
  paymentMode?: string;
  mode?: string;
  currency?: string;
  city?: string;
  country?: string;
  zipCode?: string;
  company?: string;
}

export interface PayoutRequest {
  amount: number;
  transactionId: string;
  beneficiaryName?: string;
  beneficiaryAccountNumber?: string;
  beneficiaryBankIfsc?: string;
  beneficiaryBankName?: string;
  beneficiaryPhone?: string;
  mode?: string;
  remarks?: string;
}

export interface StatusRequest {
  transactionId: string;
  providerTransactionId?: string;
}

export interface ProviderPayinResult {
  type: "payin";
  success: boolean;
  status: ProviderStatus;
  message?: string;
  providerMsg?: string;
  transactionId: string;
  providerTransactionId?: string;
  amount: number;
  result?: string;
  error?: unknown;
}

export interface ProviderPayoutResult {
  type: "payout";
  success: boolean;
  status: ProviderStatus;
  message?: string;
  providerMsg?: string;
  transactionId: string;
  providerTransactionId?: string;
  amount: number;
  utr?: string;
  error?: unknown;
}

export interface ProviderStatusResult {
  status: ProviderStatus;
  message?: string;
  utr?: string;
}

export interface ProviderWebhookInput {
  rawBody: string;
}

export interface ProviderWebhookResult {
  type: "webhook";
  success: boolean;
  status: ProviderStatus;
  message?: string;
  providerMsg?: string;
  transactionId: string;
  providerTransactionId?: string;
  amount?: number;
  utr?: string;
  error?: unknown;
  metadata?: Record<string, string | undefined>;
}
