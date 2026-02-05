import {
  initLedgerModule,
  Ledger,
  AccountType,
  AccountStatus,
} from "fintech-ledger";
import { ENV } from "@/config/env";

export class LedgerService {
  private static module: ReturnType<typeof initLedgerModule> | null = null;

  static init(): void {
    if (this.module) return;
    this.module = initLedgerModule({
      db: {
        host: ENV.POSTGRES_HOST,
        port: Number(ENV.POSTGRES_PORT),
        user: ENV.POSTGRES_USER,
        password: ENV.POSTGRES_PASSWORD,
        database: ENV.POSTGRES_DB,
        max: Number(ENV.POSTGRES_POOL_MAX || "20"),
      },
      audit: {
        mode: "async",
        flushIntervalMs: 500,
        maxBatchSize: 200,
      },
      ledger: {
        displayMode: "normalized",
      },
    });
  }

  private static get ledger(): Ledger {
    if (!this.module) this.init();
    if (!this.module) throw new Error("Ledger module not initialized");
    return this.module.ledger;
  }

  static async createAccount(
    id: string,
    code: string,
    type: AccountType,
    allowOverdraft = false,
    parentId?: string,
    isHeader = false,
    status: AccountStatus = AccountStatus.ACTIVE,
    minBalance: string | number = "0",
    actorId = "system"
  ): Promise<void> {
    await this.ledger.createAccount(
      id,
      code,
      type,
      allowOverdraft,
      parentId,
      isHeader,
      status,
      minBalance,
      actorId
    );
  }

  static async getAccount(id: string) {
    return this.ledger.getAccount(id);
  }

  static async getAllAccounts() {
    return this.ledger.getAllAccounts();
  }
}
