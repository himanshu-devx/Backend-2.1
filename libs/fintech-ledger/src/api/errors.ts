export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

export class InvalidCommandError extends LedgerError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCommandError';
  }
}

export class DoubleEntryError extends LedgerError {
  constructor(imbalance: bigint) {
    super(`Double entry imbalance. Net amount: ${imbalance}`);
    this.name = 'DoubleEntryError';
  }
}

export class ConcurrencyError extends LedgerError {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrencyError';
  }
}

export class AccountNotFoundError extends LedgerError {
  constructor(accountId: string) {
    super(`Account not found: ${accountId}`);
    this.name = 'AccountNotFoundError';
  }
}

export class InsufficientFundsError extends LedgerError {
  public accountId: string;
  public balance: bigint;
  public required: bigint;

  constructor(accountId: string, balance: bigint, required: bigint) {
    super(
      `Insufficient funds for account ${accountId}. Balance: ${balance}, Required: ${required}`,
    );
    this.name = 'InsufficientFundsError';
    this.accountId = accountId;
    this.balance = balance;
    this.required = required;
  }
}
