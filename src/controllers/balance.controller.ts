import type { Context } from "hono";
import { LedgerService } from "@/services/ledger/ledger.service";
import { respond } from "@/utils/result-http";
import { ok } from "@/utils/result";

export class BalanceController {
  static async getMerchantBalance(c: Context) {
    const id = c.get("id");

    const balances = await LedgerService.getBalances(id);
    return respond(c, ok(balances));
  }
}
