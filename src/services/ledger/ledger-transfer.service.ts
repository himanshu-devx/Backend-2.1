import { LedgerService } from "@/services/ledger/ledger.service";
import { AccountService } from "@/services/ledger/account.service";
import { TransactionModel, TransactionStatus } from "@/models/transaction.model";
import {
  TransactionType,
  TransactionPartyType,
} from "@/constants/transaction.constant";
import { ENTITY_ACCOUNT_TYPE, ENTITY_TYPE } from "@/constants/ledger.constant";
import { LedgerUtils } from "@/utils/ledger.utils";
import {
  getISTDate,
  getISTDayStart,
  getShiftedISTDate,
  validateDateFormat,
} from "@/utils/date.util";
import { BadRequest, NotFound } from "@/utils/error";
import { generateCustomId } from "@/utils/id.util";
import { ENV } from "@/config/env";
import {
  CreateLedgerTransferDTO,
  LedgerAccountRefDTO,
} from "@/dto/ledger/ledger-transfer.dto";
import { mapTransactionAmountsToDisplay, toStorageAmount } from "@/utils/money.util";

type ActorContext = {
  id: string;
  email?: string;
  role?: string;
};

export class LedgerTransferService {
  private static async resolveAccountId(
    ref: LedgerAccountRefDTO
  ): Promise<string> {
    if (ref.world) {
      const worldAccount = await AccountService.getSingleAccount(
        ENTITY_TYPE.WORLD,
        "WORLD",
        ENTITY_ACCOUNT_TYPE.WORLD
      );
      if (!worldAccount) {
        throw NotFound("World account not found");
      }
      return worldAccount.id;
    }

    if (ref.accountId) {
      const account = await LedgerService.getAccountById(ref.accountId);
      if (!account) throw NotFound(`Account not found: ${ref.accountId}`);
      return account.id;
    }

    if (ref.entityType && ref.entityId && ref.purpose) {
      const account = await AccountService.getSingleAccount(
        ref.entityType as any,
        ref.entityId,
        ref.purpose
      );
      if (!account) {
        throw NotFound(
          `Account not found for ${ref.entityType}:${ref.entityId}:${ref.purpose}`
        );
      }
      return account.id;
    }

    throw BadRequest("Invalid account reference provided");
  }

  private static parseValueDate(
    valueDate?: string
  ): { valueDate?: Date; valueDateKey?: string } {
    if (!valueDate) return {};

    if (validateDateFormat(valueDate)) {
      return {
        valueDate: getISTDayStart(valueDate),
        valueDateKey: valueDate,
      };
    }

    const parsed = new Date(valueDate);
    if (Number.isNaN(parsed.getTime())) {
      throw BadRequest(
        "Invalid valueDate format. Use YYYY-MM-DD or ISO timestamp."
      );
    }

    const shifted = getShiftedISTDate(parsed);
    const valueDateKey = shifted.toISOString().split("T")[0];
    return { valueDate: shifted, valueDateKey };
  }

  private static getTransactionPrefix(): string {
    const rawPrefix =
      ENV.APP_BRAND_PREFIX || ENV.APP_BRAND_NAME || "TXN";
    let prefix = rawPrefix
      .replace(/[^a-zA-Z]/g, "")
      .substring(0, 4)
      .toUpperCase();
    if (!prefix) prefix = "TXN";
    return prefix;
  }

  private static buildNarration(
    data: CreateLedgerTransferDTO,
    transactionId: string
  ): string {
    const parts: string[] = [];

    const type = data.type ?? TransactionType.INTERNAL_TRANSFER;
    parts.push(`TYPE:${type}`);
    parts.push(`TRANSACTION_ID:${transactionId}`);
    if (data.paymentMode) parts.push(`MODE:${data.paymentMode}`);
    if (data.utr) parts.push(`UTR:${data.utr}`);
    if (data.merchantId) parts.push(`MERCHANT:${data.merchantId}`);
    if (data.providerId) parts.push(`PROVIDER:${data.providerId}`);
    if (data.legalEntityId) parts.push(`LE:${data.legalEntityId}`);

    const party = data.party as any;
    if (party?.name) parts.push(`PARTY:${party.name}`);

    return parts.join(" | ");
  }

  static async createTransfer(
    data: CreateLedgerTransferDTO,
    actor: ActorContext
  ) {
    const amountStored = toStorageAmount(data.amount);
    const fromAccountId = await this.resolveAccountId(data.from);
    const toAccountId = await this.resolveAccountId(data.to);

    if (fromAccountId === toAccountId) {
      throw BadRequest("Source and destination accounts must be different");
    }

    const now = getISTDate();
    const nowKey = now.toISOString().split("T")[0];
    const { valueDate, valueDateKey } = this.parseValueDate(data.valueDate);
    if (data.isBackDated && !valueDate) {
      throw BadRequest("isBackDated=true requires valueDate");
    }
    if (valueDateKey && valueDateKey > nowKey) {
      throw BadRequest("valueDate cannot be in the future");
    }
    const inferredBackDate =
      !!valueDateKey && valueDateKey < nowKey;
    // Auto-detect backdated entries from valueDate, even if isBackDated not provided.
    const isBackDated = data.isBackDated === true || inferredBackDate;

    const txId = await generateCustomId(
      this.getTransactionPrefix(),
      "transaction"
    );
    const orderId = data.orderId ?? (await generateCustomId("ORD", "order"));

    const fromParts = LedgerUtils.parseAccountId(fromAccountId);
    const toParts = LedgerUtils.parseAccountId(toAccountId);

    let merchantId = data.merchantId;
    if (!merchantId) {
      merchantId =
        (fromParts?.entityType === ENTITY_TYPE.MERCHANT
          ? fromParts.entityId
          : undefined) ||
        (toParts?.entityType === ENTITY_TYPE.MERCHANT
          ? toParts.entityId
          : undefined);
    }

    let providerId = data.providerId;
    let providerLegalEntityId = data.providerLegalEntityId;

    const fromProviderId = fromParts?.entityType === ENTITY_TYPE.PROVIDER ? fromParts.entityId : undefined;
    const toProviderId = toParts?.entityType === ENTITY_TYPE.PROVIDER ? toParts.entityId : undefined;
    const resolvedProviderId = fromProviderId || toProviderId;

    if (resolvedProviderId) {
      if (!providerId) {
        providerId = resolvedProviderId.split('_')[0];
      }
      if (!providerLegalEntityId && resolvedProviderId.includes('_')) {
        providerLegalEntityId = resolvedProviderId;
      }
    }

    let legalEntityId = data.legalEntityId;
    if (!legalEntityId) {
      legalEntityId =
        (fromParts?.entityType === ENTITY_TYPE.LEGAL_ENTITY
          ? fromParts.entityId
          : undefined) ||
        (toParts?.entityType === ENTITY_TYPE.LEGAL_ENTITY
          ? toParts.entityId
          : undefined);
    }

    const narration = this.buildNarration(
      { ...data, merchantId, providerId, legalEntityId },
      txId
    );

    const party = data.party ? { ...data.party } : { type: TransactionPartyType.SYSTEM };
    if ("bankAccountId" in party) {
      delete (party as any).bankAccountId;
    }

    const transaction = new TransactionModel({
      id: txId,
      type: data.type ?? TransactionType.INTERNAL_TRANSFER,
      status:
        data.status === "PENDING"
          ? TransactionStatus.PENDING
          : TransactionStatus.SUCCESS,
      amount: amountStored,
      netAmount: amountStored,
      currency: data.currency || "INR",
      orderId,
      merchantId,
      providerId,
      legalEntityId,
      providerLegalEntityId: data.providerLegalEntityId,
      utr: data.utr,
      paymentMode: data.paymentMode,
      remarks: data.remarks ?? data.narration,
      party,
      isBackDated,
      createdAt: isBackDated && valueDate ? valueDate : undefined,
      insertedDate: isBackDated ? now : undefined,
      meta: {
        ...data.metadata,
        fromAccountId,
        toAccountId,
        fromDetails: data.fromDetails,
        toDetails: data.toDetails,
        actor: {
          id: actor.id,
          email: actor.email,
          role: actor.role,
        },
        correlationId: data.correlationId,
        idempotencyKey: data.idempotencyKey,
        externalRef: data.externalRef,
      },
      events: [
        {
          type: "LEDGER_TRANSFER_INITIATED",
          timestamp: getISTDate(),
          payload: {
            fromAccountId,
            toAccountId,
            amount: data.amount,
            status: data.status ?? "POSTED",
          },
        },
      ],
    });

    await transaction.save();

    if (amountStored === 0) {
      return {
        transaction: mapTransactionAmountsToDisplay(transaction.toObject ? transaction.toObject() : transaction),
        ledgerEntryId: undefined,
      };
    }

    try {
      const entryId = await LedgerService.transfer({
        narration,
        externalRef: data.externalRef ?? transaction.id,
        valueDate,
        idempotencyKey: data.idempotencyKey,
        correlationId: data.correlationId,
        metadata: {
          ...data.metadata,
          transactionId: transaction.id,
          orderId: transaction.orderId,
          utr: data.utr,
          fromAccountId,
          toAccountId,
          fromDetails: data.fromDetails,
          toDetails: data.toDetails,
        },
        debits: [{ accountId: fromAccountId, amount: data.amount as any }],
        credits: [{ accountId: toAccountId, amount: data.amount as any }],
        status: data.status ?? "POSTED",
        actorId: actor.email || actor.id || "system",
      });

      transaction.meta.set("ledgerEntryId", entryId);
      transaction.status =
        data.status === "PENDING"
          ? TransactionStatus.PENDING
          : TransactionStatus.SUCCESS;
      transaction.events.push({
        type:
          data.status === "PENDING"
            ? "LEDGER_TRANSFER_PENDING"
            : "LEDGER_TRANSFER_POSTED",
        timestamp: getISTDate(),
        payload: {
          entryId,
        },
      });

      await transaction.save();

      return {
        transaction: mapTransactionAmountsToDisplay(transaction.toObject ? transaction.toObject() : transaction),
        ledgerEntryId: entryId,
      };
    } catch (error: any) {
      transaction.status = TransactionStatus.FAILED;
      transaction.error = error?.message || "Ledger transfer failed";
      transaction.events.push({
        type: "LEDGER_TRANSFER_FAILED",
        timestamp: getISTDate(),
        payload: {
          error: error?.message || "Ledger transfer failed",
        },
      });
      await transaction.save();
      throw error;
    }
  }
}
