import { Context } from "hono";
import { AccountManagerService } from "@/services/ledger/account-manager.service";
import { LedgerService } from "@/services/ledger/ledger.service";
import { ok } from "@/utils/result";
import { NotFound } from "@/utils/error";
import { err } from "@/utils/result";
import { rupeeToPaisa } from "@/utils/currency.util";
import { ACCOUNT_TYPE } from "@/constants/tigerbeetle.constant";
import { LedgerAccountModel } from "@/models/ledger-account.model";

export class AdminLedgerController {
  static async getOwnerAccounts(c: Context) {
    const ownerId = c.req.param("ownerId");

    // Get optional query filters
    const typeSlug = c.req.query("typeSlug");
    const currency = c.req.query("currency");
    const isActive = c.req.query("isActive");

    const filter: any = { ownerId };

    if (typeSlug) filter.typeSlug = typeSlug;
    if (currency) filter.currency = parseInt(currency);
    if (isActive !== undefined) filter.isActive = isActive === "true";

    const accounts = await AccountManagerService.getAccountsWithFilter(filter);
    return c.json(ok(accounts));
  }

  private static async resolveAccountId(id: string): Promise<string | null> {
    if (id === "SUPER_ADMIN_INCOME") {
      const account = await LedgerAccountModel.findOne({
        typeSlug: ACCOUNT_TYPE.SUPER_ADMIN_INCOME.slug,
      }).lean();
      return account ? account.accountId : null;
    }
    return id;
  }

  static async getAccountById(c: Context) {
    let accountId = c.req.param("accountId");
    const resolvedId = await AdminLedgerController.resolveAccountId(accountId);

    if (!resolvedId) {
      return c.json(err(NotFound("Account not found")), 404);
    }
    accountId = resolvedId;

    const account = await AccountManagerService.getAccountById(accountId);

    if (!account) {
      return c.json(err(NotFound("Account not found")), 404);
    }

    return c.json(ok(account));
  }

  static async getAccountsByType(c: Context) {
    let ownerType = c.req.param("type");

    // Normalize ownerType
    // Handle "PROVIDER" (short) and "PROVIDER_LEGAL_ENITY" (common typo)
    if (ownerType === "PROVIDER" || ownerType === "PROVIDER_LEGAL_ENITY") {
      ownerType = "PROVIDER_LEGAL_ENTITY";
    }

    // Validate ownerType
    if (
      !["MERCHANT", "LEGAL_ENTITY", "PROVIDER_LEGAL_ENTITY"].includes(ownerType)
    ) {
      return c.json(err(NotFound("Invalid owner type")), 400);
    }

    // Get optional query filters
    const typeSlug = c.req.query("typeSlug");
    const currency = c.req.query("currency");
    const isActive = c.req.query("isActive");

    const filter: any = { ownerType };

    if (typeSlug) filter.typeSlug = typeSlug;
    if (currency) filter.currency = parseInt(currency);
    if (isActive !== undefined) filter.isActive = isActive === "true";

    const accounts = await AccountManagerService.getAccountsWithFilter(filter);
    return c.json(ok(accounts));
  }

  static async getAccountsView(c: Context) {
    // Optional filters
    const ownerType = c.req.query("ownerType");
    const ownerId = c.req.query("ownerId");
    const typeSlug = c.req.query("typeSlug");
    const currency = c.req.query("currency");
    const isActive = c.req.query("isActive");

    const filter: any = {};
    if (ownerType) filter.ownerType = ownerType;
    if (ownerId) filter.ownerId = ownerId;
    if (typeSlug) filter.typeSlug = typeSlug;
    if (currency) filter.currency = parseInt(currency);
    if (isActive !== undefined) filter.isActive = isActive === "true";

    // Pagination could be added here, but starting with all
    const accounts = await AccountManagerService.getAccountsWithDetails(filter);
    return c.json(ok(accounts));
  }

  static async transferFunds(c: Context) {
    const adminId = c.get("id"); // Captured from authMiddleware
    const body = await c.req.json();

    const missing = [];
    if (!body.fromAccountId && !body.fromWorld) missing.push("fromAccountId");
    if (!body.toAccountId && !body.toWorld) missing.push("toAccountId");
    if (!body.amount) missing.push("amount");
    if (!body.currency) missing.push("currency");
    if (!body.reason) missing.push("reason");

    if (missing.length > 0) {
      return c.json(
        err({
          message: `Missing required fields: ${missing.join(", ")}`,
          code: "VALIDATION_ERROR",
        }),
        400
      );
    }

    try {
      const { CURRENCY } = await import("@/constants/tigerbeetle.constant");
      const { TransactionModel, TransactionStatus } =
        await import("@/models/transaction.model");
      const { TransactionType } = await import("@/constants/transaction.constant");

      const fromAccountId = body.fromWorld ? "1" : body.fromAccountId;
      const toAccountId = body.toWorld ? "1" : body.toAccountId;

      const { AdminModel } = await import("@/models/admin.model");
      const admin = await AdminModel.findOne({ id: adminId });
      const actorName = admin?.displayName || admin?.name || "Unknown Admin";

      // const amount = rupeeToPaisa(body.amount);
      const amount = BigInt(body.amount);
      if (amount <= 0n) throw new Error("Amount must be greater than 0");

      const tbTransfer = await LedgerService.createTransfer(
        fromAccountId,
        toAccountId,
        rupeeToPaisa(body.amount),
        CURRENCY.INR,
        {
          actorId: adminId,
          actorName: actorName,
          actorType: "ADMIN",
          reason: body.reason,
          meta: body.metadata || {},
          isBackDated: !!body.isBackDated,
          createdAt: body.backDate ? new Date(body.backDate) : undefined
        }
      );

      // Resolve Owner Details for Enrichment
      const { AccountManagerService } = await import(
        "@/services/ledger/account-manager.service"
      );
      const accountMap = await AccountManagerService.resolveAccountDetails([
        fromAccountId,
        toAccountId,
      ]);

      const debitDetails = accountMap.get(fromAccountId);
      const creditDetails = accountMap.get(toAccountId);

      const { TransactionEntityType, TransactionPartyType } = await import("@/constants/transaction.constant");

      // Resolve Source/Dest Entities
      // If World (ID 1), we treat as WORLD entity (previously SYSTEM)
      const sourceEntityId = body.fromWorld ? "WORLD" : (debitDetails?.ownerId || "UNKNOWN");
      const sourceEntityType = body.fromWorld ? TransactionEntityType.WORLD : (debitDetails?.ownerType || "UNKNOWN");

      const destEntityId = body.toWorld ? "WORLD" : (creditDetails?.ownerId || "UNKNOWN");
      const destEntityType = body.toWorld ? TransactionEntityType.WORLD : (creditDetails?.ownerType || "UNKNOWN");

      // Create a business-level Transaction record for visibility
      const txnDoc: any = {
        // Double Entry Ownership
        sourceEntityId: sourceEntityId,
        sourceEntityType: sourceEntityType,

        destinationEntityId: destEntityId,
        destinationEntityType: destEntityType,

        type: body.type || TransactionType.INTERNAL_TRANSFER,
        status: TransactionStatus.SUCCESS,
        amount: Number(amount),
        netAmount: Number(amount),
        currency: "INR",

        providerRef: `MANUAL-${Date.now()}`, // Generic ref

        // Party: In internal transfer, who is the "party"?
        // If Admin is doing it, maybe "SELF" or "SYSTEM"?
        party: {
          type: TransactionPartyType.SELF,
          name: "Internal Transfer",
          details: {
            initiatorId: adminId,
            reason: body.reason
          }
        },

        paymentMode: "MANUAL_TRANSFER",

        meta: {
          ...body.metadata,
          reason: body.reason,
          actorId: adminId,
          actorName: actorName,
          actorType: "ADMIN",
          transferId: tbTransfer.id.toString(),
          ledgerTransfers: [
            {
              id: tbTransfer.id.toString(),
              debitAccountId: tbTransfer.debit_account_id.toString(),
              debitOwnerType: debitDetails?.ownerType,
              debitOwnerName: debitDetails?.ownerName,
              creditAccountId: tbTransfer.credit_account_id.toString(),
              creditOwnerType: creditDetails?.ownerType,
              creditOwnerName: creditDetails?.ownerName,
              amount: tbTransfer.amount.toString(),
              code: tbTransfer.code,
              flags: tbTransfer.flags,
              timestamp: tbTransfer.timestamp.toString(),
              isFee: false,
            },
          ],
        },
      };

      if (body.isBackDated && body.backDate) {
        const { getISTDate } = await import("@/utils/date.util");
        txnDoc.isBackDated = true;
        txnDoc.createdAt = new Date(body.backDate);
        txnDoc.insertedDate = getISTDate();
      }

      const txn = await TransactionModel.create(txnDoc);

      // 7. Audit Log
      const { AuditService } = await import("@/services/common/audit.service");
      await AuditService.record({
        action: "MANUAL_TRANSFER",
        actorId: adminId,
        actorType: "ADMIN",
        actorName: actorName,
        entityType: "TRANSACTION",
        entityId: txn.id,
        metadata: {
          fromAccountId,
          toAccountId,
          amount: Number(amount),
          reason: body.reason,
          orderId: txn.orderId
        }
      });

      // 8. Cache Invalidation
      const { CacheService } = await import("@/services/common/cache.service");
      const invalidateOwner = async (details: any) => {
        if (details?.ownerType === "MERCHANT") {
          await CacheService.invalidateMerchant(details.ownerId);
        }
      };
      await Promise.all([invalidateOwner(debitDetails), invalidateOwner(creditDetails)]);

      return c.json(
        ok({
          message: "Transfer successful",
          transferId: tbTransfer.id.toString(),
          orderId: txn.orderId,
        })
      );
    } catch (e: any) {
      console.error("Manual Transfer Failed:", e);
      return c.json(
        err({
          message: e.message || "Transfer failed",
          code: "TRANSFER_ERROR",
        }),
        400
      );
    }
  }

  static async listTransfers(c: Context) {
    const fromAccountId = c.req.query("fromAccountId");
    const toAccountId = c.req.query("toAccountId");
    const adminId = c.req.query("adminId");

    // Strategy: Route to appropriate service based on filter priority
    // 1. Specific Account ID (TigerBeetle direct with query params)
    const accountId = c.req.query("accountId");
    const targetAccountId = accountId || fromAccountId || toAccountId;

    if (targetAccountId) {
      try {
        // Parse query parameters for TigerBeetle filtering
        const limit = parseInt(c.req.query("limit") || "100");
        const reversed = c.req.query("reversed") === "true";
        const timestampMin = c.req.query("timestampMin");
        const timestampMax = c.req.query("timestampMax");

        let result = await AccountManagerService.getTransfersByAccountId(
          targetAccountId,
          {
            limit,
            reversed,
            timestampMin: timestampMin ? BigInt(timestampMin) : undefined,
            timestampMax: timestampMax ? BigInt(timestampMax) : undefined,
          }
        );

        // Filter if both accounts provided
        if (fromAccountId && toAccountId) {
          result = result.filter(
            (t) =>
              t.debitAccountId === fromAccountId &&
              t.creditAccountId === toAccountId
          );
        } else if (fromAccountId) {
          result = result.filter((t: any) => t.debitAccountId === fromAccountId);
        } else if (toAccountId) {
          result = result.filter((t: any) => t.creditAccountId === toAccountId);
        }

        return c.json(ok(result));
      } catch (err: any) {
        return c.json(ok([]));
      }
    }

    const ownerId = c.req.query("ownerId");
    const ownerType = c.req.query("ownerType");

    // 2. Owner ID (All accounts for this owner)
    if (ownerId) {
      const transfers = await AccountManagerService.getTransfersByOwner(ownerId);
      return c.json(ok(transfers));
    }

    // 3. Owner Type (All accounts for this type - expensive!)
    if (ownerType) {
      const transfers = await AccountManagerService.getTransfersByType(ownerType);
      return c.json(ok(transfers));
    }

    // Default: List recent transactions and flatten their ledger transfers
    const { TransactionModel } = await import("@/models/transaction.model");
    const limit = parseInt(c.req.query("limit") || "20");

    const filter: any = {};
    if (adminId) {
      filter["party.details.initiatorId"] = adminId;
    }

    // Find transactions that have ledger transfers recorded in meta
    const transactions = await TransactionModel.find({
      ...filter,
      "meta.ledgerTransfers": { $exists: true, $not: { $size: 0 } },
    })
      .sort({ createdAt: -1 })
      .limit(limit);

    // Flatten transactions into a list of ledger transfers
    const flattenedTransfers = transactions.flatMap((txn) => {
      const tbTransfers = (txn.meta?.ledgerTransfers || []) as any[];
      return tbTransfers.map((t) => ({
        ...t,
        orderId: txn.orderId,
        txnId: txn.id,
        txnType: txn.type,
        createdAt: txn.createdAt,
      }));
    });

    return c.json(ok(flattenedTransfers.slice(0, limit)));
  }

  static async getTransfersByOwner(c: Context) {
    const ownerId = c.req.param("ownerId");
    try {
      const transfers = await AccountManagerService.getTransfersByOwner(ownerId);
      return c.json(ok(transfers));
    } catch (e: any) {
      return c.json(err(e), 500);
    }
  }

  static async getAccountTransfers(c: Context) {
    let accountId = c.req.param("accountId");
    const resolvedId = await AdminLedgerController.resolveAccountId(accountId);

    if (!resolvedId) {
      return c.json(err(NotFound("Account not found")), 404);
    }
    accountId = resolvedId;
    try {
      // Parse query parameters
      const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : 100;
      const reversed = c.req.query("reversed") !== "false"; // Default true
      const timestampMin = c.req.query("timestampMin") ? BigInt(c.req.query("timestampMin")!) : undefined;
      const timestampMax = c.req.query("timestampMax") ? BigInt(c.req.query("timestampMax")!) : undefined;

      const transfers = await AccountManagerService.getTransfersByAccountId(
        accountId,
        { limit, reversed, timestampMin, timestampMax }
      );
      return c.json(ok(transfers));
    } catch (e: any) {
      return c.json(err(e), 500);
    }
  }
}
