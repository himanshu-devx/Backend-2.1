import { AccountType } from '../api/types';

export type NormalBalanceSide = 'DEBIT' | 'CREDIT';

export function normalizeBalance(type: AccountType, amount: bigint): bigint {
  switch (type) {
    case AccountType.ASSET:
    case AccountType.EXPENSE:
    case AccountType.OFF_BALANCE:
      return amount;
    case AccountType.LIABILITY:
    case AccountType.EQUITY:
    case AccountType.INCOME:
      return -amount;
    default:
      return amount;
  }
}

export function normalBalanceSide(type: AccountType): NormalBalanceSide {
  switch (type) {
    case AccountType.ASSET:
    case AccountType.EXPENSE:
    case AccountType.OFF_BALANCE:
      return 'DEBIT';
    case AccountType.LIABILITY:
    case AccountType.EQUITY:
    case AccountType.INCOME:
      return 'CREDIT';
    default:
      return 'DEBIT';
  }
}
