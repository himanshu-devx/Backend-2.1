import type { TransactionStatus } from "@/models/transaction.model";

export type PayinInitiateResponse = {
  orderId: string;
  transactionId: string;
  paymentUrl?: string;
  amount: number;
  status: TransactionStatus;
};

export type PayoutInitiateResponse = {
  transactionId: string;
  orderId: string;
  status: TransactionStatus;
  utr?: string;
};
