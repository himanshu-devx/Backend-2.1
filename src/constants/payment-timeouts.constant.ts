import { ENV } from "@/config/env";

export const PAYMENT_TIMEOUTS = {
  PAYIN_EXPIRE_MS: ENV.PAYIN_EXPIRE_MS, // 25 minutes default
  PAYOUT_STATUS_POLL_INTERVAL_MS: ENV.PAYOUT_STATUS_POLL_INTERVAL_MS, // 5 minutes default
  PAYOUT_STATUS_MAX_POLLS: ENV.PAYOUT_STATUS_MAX_POLLS, // 30 minutes total default
} as const;
