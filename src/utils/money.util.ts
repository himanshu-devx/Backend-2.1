import { ENV } from "@/config/env";

const PAISA_FACTOR = 100;
const DEFAULT_UNIT = "PAISE";

const getUnit = () => (ENV as any).AMOUNT_UNIT || DEFAULT_UNIT;
const isPaise = () => String(getUnit()).toUpperCase() === "PAISE";

const toNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
};

export const toStorageAmount = (rupees: number): number => {
  if (!isPaise()) return Number(rupees);
  const num = Number(rupees);
  return Math.round((num + Number.EPSILON) * PAISA_FACTOR);
};

export const toDisplayAmount = (stored: number): number => {
  if (!isPaise()) return Number(stored);
  const num = Number(stored);
  return Number((num / PAISA_FACTOR).toFixed(2));
};

export const toDisplayAmountMaybe = (value: unknown): number | undefined => {
  const num = toNumber(value);
  if (num === undefined) return undefined;
  return toDisplayAmount(num);
};

// Ledger balances may already be normalized (decimal) even when AMOUNT_UNIT=PAISE.
// This helper preserves normalized values and only divides when the value looks like paise.
export const toDisplayAmountFromLedger = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  const num = toNumber(value);
  if (num === undefined) return 0;
  if (!isPaise()) return num;

  const isNormalized =
    (typeof value === "string" && value.includes(".")) ||
    (typeof value === "number" && !Number.isInteger(value));

  if (isNormalized) return num;
  return Number((num / PAISA_FACTOR).toFixed(2));
};

export const toStorageAmountMaybe = (value: unknown): number | undefined => {
  const num = toNumber(value);
  if (num === undefined) return undefined;
  return toStorageAmount(num);
};

export const mapFeeDetailToStorage = (fee: any) => {
  if (!fee) return fee;
  return {
    ...fee,
    flat: toStorageAmountMaybe(fee.flat) ?? fee.flat,
    percentage: toStorageAmountMaybe(fee.percentage) ?? fee.percentage,
    tax: toStorageAmountMaybe(fee.tax) ?? fee.tax,
    total: toStorageAmountMaybe(fee.total) ?? fee.total,
  };
};

export const mapFeeDetailToDisplay = (fee: any) => {
  if (!fee) return fee;
  return {
    ...fee,
    flat: toDisplayAmountMaybe(fee.flat) ?? fee.flat,
    percentage: toDisplayAmountMaybe(fee.percentage) ?? fee.percentage,
    tax: toDisplayAmountMaybe(fee.tax) ?? fee.tax,
    total: toDisplayAmountMaybe(fee.total) ?? fee.total,
  };
};

export const mapTransactionAmountsToDisplay = (txn: any) => {
  if (!txn) return txn;
  const next = { ...txn };
  if (next.amount !== undefined) next.amount = toDisplayAmountMaybe(next.amount) ?? next.amount;
  if (next.netAmount !== undefined) next.netAmount = toDisplayAmountMaybe(next.netAmount) ?? next.netAmount;
  if (next.fees) {
    next.fees = {
      ...next.fees,
      total: toDisplayAmountMaybe(next.fees.total) ?? next.fees.total,
      merchantFees: mapFeeDetailToDisplay(next.fees.merchantFees),
      providerFees: mapFeeDetailToDisplay(next.fees.providerFees),
    };
  }
  const normalizeTransfer = (transfer: any) => {
    if (!transfer) return transfer;
    const updated = { ...transfer };
    if (updated.amount !== undefined) {
      const converted = toDisplayAmountMaybe(updated.amount);
      if (converted !== undefined) updated.amount = converted;
    }
    return updated;
  };
  if (Array.isArray(next.ledgerTransfers)) {
    next.ledgerTransfers = next.ledgerTransfers.map(normalizeTransfer);
  }
  if (next.meta?.ledgerTransfers && Array.isArray(next.meta.ledgerTransfers)) {
    next.meta = {
      ...next.meta,
      ledgerTransfers: next.meta.ledgerTransfers.map(normalizeTransfer),
    };
  }
  return next;
};
