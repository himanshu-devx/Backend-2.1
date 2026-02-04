import { TigerBeetleService } from "@/services/ledger/tigerbeetle.service";
import { Transfer, Account } from "tigerbeetle-node";
import { v4 as uuidv4 } from "uuid";
import {
  CURRENCY,
  ACCOUNT_TYPE,
  TB_ACCOUNT_FLAGS,
  TB_TRANSFER_FLAGS,
} from "@/constants/tigerbeetle.constant";

export class LedgerService {
  /**
   * Creates a new account in TigerBeetle (Generic).
   */
  static async createAccount(
    accountId: bigint,
    code: number,
    flags: number = TB_ACCOUNT_FLAGS.NONE
  ): Promise<string> {
    const account: Account = createTbAccount(accountId, code, flags);

    const errors = await TigerBeetleService.client.createAccounts([account]);

    if (errors.length > 0) {
      throw new Error(JSON.stringify(errors));
    }

    return accountId.toString();
  }

  /**
   * Transfers funds between two accounts and records metadata in MongoDB.
   */
  static async createTransfer(
    debitAccountId: string,
    creditAccountId: string,
    amount: bigint,
    code: number = CURRENCY.INR,
    metadata?: {
      actorId?: string;
      actorName?: string;
      actorType?: string;
      reason?: string;
      meta?: Record<string, any>;
      createdAt?: Date;
      isBackDated?: boolean;
    },
    flags: number = TB_TRANSFER_FLAGS.NONE
  ): Promise<Transfer> {
    const transferId = BigInt(uuidToBigInt(uuidv4()));

    const transfer: Transfer = {
      id: transferId,
      debit_account_id: BigInt(debitAccountId),
      credit_account_id: BigInt(creditAccountId),
      amount: amount,
      pending_id: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: CURRENCY.INR,
      code: code,
      flags: flags,
      timestamp: 0n,
    };

    const errors = await TigerBeetleService.client.createTransfers([transfer]);

    if (errors.length > 0) {
      const errorMsg = this.getTransferErrorMessage(errors[0].result);
      throw new Error(errorMsg);
    }

    // Auditing is now handled by business-level TransactionModel in controllers
    return transfer;
  }

  /**
   * Batch creates multiple transfers.
   */
  static async createTransfers(
    transfers: {
      debitAccountId: string;
      creditAccountId: string;
      amount: bigint;
      code?: number;
      flags?: number;
    }[]
  ): Promise<Transfer[]> {
    const batch: Transfer[] = transfers.map((t) => ({
      id: BigInt(uuidToBigInt(uuidv4())),
      debit_account_id: BigInt(t.debitAccountId),
      credit_account_id: BigInt(t.creditAccountId),
      amount: t.amount,
      pending_id: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: CURRENCY.INR,
      code: t.code || CURRENCY.INR,
      flags: t.flags || TB_TRANSFER_FLAGS.NONE,
      timestamp: 0n,
    }));

    const errors = await TigerBeetleService.client.createTransfers(batch);

    if (errors.length > 0) {
      const firstError = errors[0];
      const errorMsg = this.getTransferErrorMessage(firstError.result);
      throw new Error(errorMsg);
    }

    return batch;
  }

  /**
   * PURE: Creates a commission account for a Legal Entity (returns ID).
   */
  /**
   * PURE: Creates a commission account for a Legal Entity (returns ID).
   */
  static async createLegalEntityAccount(ownerId: string): Promise<string> {
    const mainAccountId = BigInt(uuidToBigInt(uuidv4()));

    const account = createTbAccount(
      mainAccountId,
      ACCOUNT_TYPE.LEGAL_ENTITY_MAIN.code,
      TB_ACCOUNT_FLAGS.HISTORY
    );

    const errors = await TigerBeetleService.client.createAccounts([account]);
    if (errors.length > 0) {
      throw new Error(
        `TigerBeetle Create LE Account Error: ${JSON.stringify(errors)}`
      );
    }

    return mainAccountId.toString();
  }

  /**
   * PURE: Creates accounts for Provider Legal Entity (returns IDs object).
   */
  static async createProviderLegalEntityAccounts(ownerId: string): Promise<{
    payinId: string;
    payoutId: string;
    expenseId: string;
  }> {
    const ids = {
      payinId: BigInt(uuidToBigInt(uuidv4())),
      payoutId: BigInt(uuidToBigInt(uuidv4())),
      expenseId: BigInt(uuidToBigInt(uuidv4())),
    };

    const accountsToCreate: Account[] = [
      createTbAccount(
        ids.payinId,
        ACCOUNT_TYPE.PROVIDER_PAYIN.code,
        TB_ACCOUNT_FLAGS.HISTORY
      ),
      createTbAccount(
        ids.payoutId,
        ACCOUNT_TYPE.PROVIDER_PAYOUT.code,
        TB_ACCOUNT_FLAGS.HISTORY
      ),
      createTbAccount(
        ids.expenseId,
        ACCOUNT_TYPE.PROVIDER_EXPENSE.code,
        TB_ACCOUNT_FLAGS.HISTORY
      ),
    ];

    const errors = await TigerBeetleService.client.createAccounts(
      accountsToCreate
    );
    if (errors.length > 0) {
      throw new Error(
        `TigerBeetle Create PLE Accounts Error: ${JSON.stringify(errors)}`
      );
    }

    return {
      payinId: ids.payinId.toString(),
      payoutId: ids.payoutId.toString(),
      expenseId: ids.expenseId.toString(),
    };
  }

  /**
   * PURE: Creates accounts for a Merchant (returns IDs object).
   */
  static async createMerchantAccounts(ownerId: string): Promise<{
    payinId: string;
    payoutId: string;
    holdId: string;
  }> {
    const ids = {
      payinId: BigInt(uuidToBigInt(uuidv4())),
      payoutId: BigInt(uuidToBigInt(uuidv4())),
      holdId: BigInt(uuidToBigInt(uuidv4())),
    };

    const accountsToCreate: Account[] = [
      createTbAccount(
        ids.payinId,
        ACCOUNT_TYPE.MERCHANT_PAYIN.code,
        TB_ACCOUNT_FLAGS.HISTORY | TB_ACCOUNT_FLAGS.DEBITS_MUST_NOT_EXCEED_CREDITS
      ),
      createTbAccount(
        ids.payoutId,
        ACCOUNT_TYPE.MERCHANT_PAYOUT.code,
        TB_ACCOUNT_FLAGS.HISTORY | TB_ACCOUNT_FLAGS.DEBITS_MUST_NOT_EXCEED_CREDITS
      ),
      createTbAccount(
        ids.holdId,
        ACCOUNT_TYPE.MERCHANT_HOLD.code,
        TB_ACCOUNT_FLAGS.HISTORY | TB_ACCOUNT_FLAGS.DEBITS_MUST_NOT_EXCEED_CREDITS
      ),
    ];

    const errors = await TigerBeetleService.client.createAccounts(
      accountsToCreate
    );
    if (errors.length > 0) {
      throw new Error(
        `TigerBeetle Create Merchant Accounts Error: ${JSON.stringify(errors)}`
      );
    }

    return {
      payinId: ids.payinId.toString(),
      payoutId: ids.payoutId.toString(),
      holdId: ids.holdId.toString(),
    };
  }

  /**
   * PURE: Creates a Super Admin account (returns ID).
   */
  static async createSuperAdminAccount(ownerId: string): Promise<string> {
    const incomeAccountId = BigInt(uuidToBigInt(uuidv4()));

    const account = createTbAccount(
      incomeAccountId,
      ACCOUNT_TYPE.SUPER_ADMIN_INCOME.code,
      TB_ACCOUNT_FLAGS.HISTORY
    );

    const errors = await TigerBeetleService.client.createAccounts([account]);
    if (errors.length > 0) {
      throw new Error(
        `TigerBeetle Create Super Admin Account Error: ${JSON.stringify(errors)}`
      );
    }

    return incomeAccountId.toString();
  }

  /**
   * PURE: Creates a World/External account (returns ID).
   */
  static async createWorldAccount(): Promise<string> {
    const worldAccountId = BigInt(uuidToBigInt(uuidv4()));

    const account = createTbAccount(
      worldAccountId,
      ACCOUNT_TYPE.WORLD.code,
      TB_ACCOUNT_FLAGS.HISTORY | TB_ACCOUNT_FLAGS.DEBITS_MUST_NOT_EXCEED_CREDITS // Logic: World can't go negative? Or actually World CAN go negative (it's the source of funds). 
      // Actually usually World is infinite source. No flags.
      // But let's keep History.
    );
    // Override flags for World: NONE (Allow negative balance to represent money supply)
    account.flags = TB_ACCOUNT_FLAGS.HISTORY;

    const errors = await TigerBeetleService.client.createAccounts([account]);
    if (errors.length > 0) {
      throw new Error(
        `TigerBeetle Create World Account Error: ${JSON.stringify(errors)}`
      );
    }

    return worldAccountId.toString();
  }

  static async getBalances(accountIds: bigint[]): Promise<Account[]> {
    if (accountIds.length === 0) return [];
    const balances = await TigerBeetleService.client.lookupAccounts(accountIds);
    return balances;
  }

  /**
   * Fetches transfers for a specific TigerBeetle account using getAccountTransfers.
   * @deprecated Use queryTransfers for more flexibility
   */
  static async getAccountTransfers(
    accountId: string | bigint
  ): Promise<Transfer[]> {
    const id = typeof accountId === "string" ? BigInt(accountId) : accountId;
    return TigerBeetleService.client.getAccountTransfers({
      account_id: id,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      code: 0,
      timestamp_min: 0n,
      timestamp_max: 0n,
      limit: 100,
      flags: 3, // Debits | Credits
    });
  }

  /**
   * Query transfers with flexible filtering using TigerBeetle's queryTransfers API.
   * This is more efficient and flexible than getAccountTransfers.
   */
  static async queryTransfers(filter: {
    accountId?: string | bigint;
    userdata128?: bigint;
    userdata64?: bigint;
    userdata32?: number;
    code?: number;
    ledger?: number;
    timestampMin?: bigint;
    timestampMax?: bigint;
    limit?: number;
    reversed?: boolean;
  }): Promise<Transfer[]> {
    const queryFilter: any = {
      user_data_128: filter.userdata128 || 0n,
      user_data_64: filter.userdata64 || 0n,
      user_data_32: filter.userdata32 || 0,
      code: filter.code || 0,
      ledger: filter.ledger || 0,
      timestamp_min: filter.timestampMin || 0n,
      timestamp_max: filter.timestampMax || 0n,
      limit: filter.limit || 100,
      flags: filter.reversed ? 1 : 0, // QueryFilterFlags.reversed = 1
    };

    // If accountId is provided, use getAccountTransfers instead
    if (filter.accountId) {
      const id = typeof filter.accountId === "string" ? BigInt(filter.accountId) : filter.accountId;

      // Calculate specific flags for getAccountTransfers
      // 1 = Debits, 2 = Credits
      // User requested "reversed remove, always fetch all". 
      // We interpret this as always fetching Debits | Credits (3) without the Reversed (4) flag.
      const accountFlags = 1 | 2;

      return TigerBeetleService.client.getAccountTransfers({
        account_id: id,
        user_data_128: queryFilter.user_data_128,
        user_data_64: queryFilter.user_data_64,
        user_data_32: queryFilter.user_data_32,
        code: queryFilter.code,
        timestamp_min: queryFilter.timestamp_min,
        timestamp_max: queryFilter.timestamp_max,
        limit: queryFilter.limit,
        flags: accountFlags,
      });
    }

    // Otherwise use queryTransfers for global queries
    return TigerBeetleService.client.queryTransfers(queryFilter);
  }

  /**
   * Lookups specific transfers by ID.
   */
  static async lookupTransfers(ids: bigint[]): Promise<Transfer[]> {
    if (ids.length === 0) return [];
    return TigerBeetleService.client.lookupTransfers(ids);
  }

  /**
   * Maps TigerBeetle CreateTransferResult codes to human-readable strings.
   */
  private static getTransferErrorMessage(result: number): string {
    const resultMap: Record<number, string> = {
      0: "OK",
      1: "Linked event failed",
      2: "Linked event chain open",
      3: "Timestamp must be zero",
      4: "Reserved flag",
      5: "ID must not be zero",
      6: "ID must not be int max",
      7: "Flags are mutually exclusive",
      8: "Debit account ID must not be zero",
      9: "Debit account ID must not be int max",
      10: "Credit account ID must not be zero",
      11: "Credit account ID must not be int max",
      12: "Accounts must be different",
      13: "Pending ID must be zero",
      14: "Pending ID must not be zero",
      15: "Pending ID must not be int max",
      16: "Pending ID must be different",
      17: "Timeout reserved for pending transfer",
      19: "Ledger must not be zero",
      20: "Code must not be zero",
      21: "Debit account not found",
      22: "Credit account not found",
      23: "Accounts must have the same ledger",
      24: "Transfer must have the same ledger as accounts",
      25: "Pending transfer not found",
      26: "Pending transfer not pending",
      27: "Pending transfer has different debit account ID",
      28: "Pending transfer has different credit account ID",
      29: "Pending transfer has different ledger",
      30: "Pending transfer has different code",
      31: "Exceeds pending transfer amount",
      32: "Pending transfer has different amount",
      33: "Pending transfer already posted",
      34: "Pending transfer already voided",
      35: "Pending transfer expired",
      36: "Exists with different flags",
      37: "Exists with different debit account ID",
      38: "Exists with different credit account ID",
      39: "Exists with different amount",
      40: "Exists with different pending ID",
      41: "Exists with different user data 128",
      42: "Exists with different user data 64",
      43: "Exists with different user data 32",
      44: "Exists with different timeout",
      45: "Exists with different code",
      46: "Transfer already exists",
      47: "Overflows debits pending",
      48: "Overflows credits pending",
      49: "Overflows debits posted",
      50: "Overflows credits posted",
      51: "Overflows debits",
      52: "Overflows credits",
      53: "Overflows timeout",
      54: "Insufficient balance", // Was: Exceeds Credits
      55: "Insufficient balance", // Was: Exceeds Debits
      56: "Imported event expected",
      57: "Imported event not expected",
      58: "Imported event timestamp out of range",
      59: "Imported event timestamp must not advance",
      60: "Imported event timestamp must not regress",
      61: "Imported event timestamp must postdate debit account",
      62: "Imported event timestamp must postdate credit account",
      63: "Imported event timeout must be zero",
      64: "Closing transfer must be pending",
      65: "Debit account already closed",
      66: "Credit account already closed",
      67: "Exists with different ledger",
      68: "ID already failed",
    };

    return resultMap[result] || `Unknown TigerBeetle Error (${result})`;
  }

  /**
   * Posts (Commits) a pending transfer.
   */
  static async postTransfer(transferId: string): Promise<void> {
    const id = BigInt(transferId);
    // 1. Lookup Original to match Code/Ledger (Required by TB)
    const originals = await this.lookupTransfers([id]);
    if (originals.length === 0) throw new Error("Original Pending Transfer not found");
    const original = originals[0];

    // 2. Create Post Transfer
    const postTransfer: Transfer = {
      id: BigInt(uuidToBigInt(uuidv4())),
      pending_id: id,
      debit_account_id: original.debit_account_id,
      credit_account_id: original.credit_account_id,
      amount: original.amount, // Post Full Amount explicitly
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: original.ledger,
      code: original.code,
      flags: TB_TRANSFER_FLAGS.POST_PENDING_TRANSFER,
      timestamp: 0n,
    };

    const errors = await TigerBeetleService.client.createTransfers([postTransfer]);
    if (errors.length > 0) {
      const errorMsg = this.getTransferErrorMessage(errors[0].result);
      throw new Error(errorMsg);
    }
  }

  /**
   * Voids (Cancels) a pending transfer.
   */
  static async voidTransfer(transferId: string): Promise<void> {
    const id = BigInt(transferId);
    // 1. Lookup Original
    const originals = await this.lookupTransfers([id]);
    if (originals.length === 0) throw new Error("Original Pending Transfer not found");
    const original = originals[0];

    // 2. Create Void Transfer
    const voidTransfer: Transfer = {
      id: BigInt(uuidToBigInt(uuidv4())),
      pending_id: id,
      debit_account_id: original.debit_account_id,
      credit_account_id: original.credit_account_id,
      amount: 0n, // 0 = Void Full Amount
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: original.ledger,
      code: original.code,
      flags: TB_TRANSFER_FLAGS.VOID_PENDING_TRANSFER,
      timestamp: 0n,
    };

    const errors = await TigerBeetleService.client.createTransfers([voidTransfer]);
    if (errors.length > 0) {
      const errorMsg = this.getTransferErrorMessage(errors[0].result);
      throw new Error(errorMsg);
    }
  }
}

// Helper for consistent account creation struct
function createTbAccount(id: bigint, code: number, flags: number): Account {
  return {
    id,
    debits_pending: 0n,
    debits_posted: 0n,
    credits_pending: 0n,
    credits_posted: 0n,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    reserved: 0,
    ledger: CURRENCY.INR,
    code,
    flags,
    timestamp: 0n,
  };
}

// Helper: Convert UUID v4 to BigInt
export function uuidToBigInt(uuid: string): bigint {
  const hex = uuid.replace(/-/g, "");
  return BigInt("0x" + hex);
}
