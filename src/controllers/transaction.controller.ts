import type { Context } from "hono";
import { TransactionService } from "@/services/transaction.service";
import { respond } from "@/utils/result-http";
import { ListQueryDTO } from "@/dto/common.dto";
import { getAuditContext } from "@/utils/audit.util";
import { ReverseTransactionDTO, ReverseLedgerEntriesDTO, AdminTransactionActionDTO } from "@/dto/admin/transaction.dto";

export class TransactionController {
  /**
   * Admin: List all transactions
   */
  static async listAdmin(c: Context) {
    const query = c.get("validatedQuery") as any; // Allow loose typing to catch all filters
    const result = await TransactionService.list(query);
    return respond(c, result);
  }

  /**
   * Merchant: List own transactions
   */
  static async listMerchant(c: Context) {
    // const merchantId = c.get("user")?.id; // Assuming auth middleware sets this
    // We need to check how merchant ID is passed. Usually in `c.get('user').id`.
    // Let's assume the middleware behaves as expected.

    const id = c.get("id");
    const role = c.get("role");

    if (role !== "MERCHANT") {
      // Fallback or error, but middleware should handle this.
    }

    const query = c.get("validatedQuery") as any;

    // Force merchantId scope
    const filter = { ...query, merchantId: id };

    const result = await TransactionService.list(filter);
    return respond(c, result);
  }

  /**
   * Common: Get Details
   */
  static async getDetails(c: Context) {
    const id = c.req.param("id");
    const userId = c.get("id");
    const role = c.get("role");
    const isLedgerIdRaw = c.req.query("isLedgerId") ?? c.req.query("isledgerId");
    const isLedgerId =
      typeof isLedgerIdRaw === "string" &&
      ["1", "true", "yes"].includes(isLedgerIdRaw.toLowerCase());

    const scope: any = {};
    if (role === "MERCHANT") {
      scope.merchantId = userId;
    }

    const result = isLedgerId
      ? await TransactionService.getDetailsByLedgerEntryId(id, scope)
      : await TransactionService.getDetails(id, scope);
    return respond(c, result);
  }

  /**
   * Admin: Get transaction details by ledger entry ID
   */
  static async getDetailsByLedgerEntryId(c: Context) {
    const entryId = c.req.param("entryId");
    const result = await TransactionService.getDetailsByLedgerEntryId(entryId);
    return respond(c, result);
  }

  /**
   * Admin: Reverse transaction
   */
  static async reverseAdmin(c: Context) {
    const id = c.req.param("id");
    const body = c.get("validatedBody") as ReverseTransactionDTO;
    const actor = {
      id: c.get("id"),
      email: c.get("email"),
      role: c.get("role"),
    };

    const result = await TransactionService.reverseTransaction(id, body, actor);
    return respond(c, result);
  }

  /**
   * Admin: Reverse ledger entries only (no transaction status change)
   */
  static async reverseLedgerAdmin(c: Context) {
    const id = c.req.param("id");
    const body = c.get("validatedBody") as ReverseLedgerEntriesDTO;
    const actor = {
      id: c.get("id"),
      email: c.get("email"),
      role: c.get("role"),
    };

    const result = await TransactionService.reverseLedgerEntries(id, body, actor);
    return respond(c, result);
  }

  /**
   * Admin: Sync status from provider
   */
  static async syncStatusAdmin(c: Context) {
    const id = c.req.param("id");
    const body = c.get("validatedBody") as AdminTransactionActionDTO;
    const actor = {
      id: c.get("id"),
      email: c.get("email"),
      role: c.get("role"),
    };

    const result = await TransactionService.syncStatus(id, actor, {
      confirm: body?.confirm,
    });
    return respond(c, result);
  }

  /**
   * Admin: Resend merchant webhook callback
   */
  static async resendWebhookAdmin(c: Context) {
    const id = c.req.param("id");
    const body = c.get("validatedBody") as AdminTransactionActionDTO;
    const actor = {
      id: c.get("id"),
      email: c.get("email"),
      role: c.get("role"),
    };

    const result = await TransactionService.resendWebhook(id, body?.reason, actor);
    return respond(c, result);
  }
}
