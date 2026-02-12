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

  private static parseValueDate(valueDate?: string): Date | undefined {
    if (!valueDate) return undefined;

    if (validateDateFormat(valueDate)) {
      return getISTDayStart(valueDate);
    }

    const parsed = new Date(valueDate);
    if (Number.isNaN(parsed.getTime())) {
      throw BadRequest(
        "Invalid valueDate format. Use YYYY-MM-DD or ISO timestamp."
      );
    }

    return getShiftedISTDate(parsed);
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

    const valueDate = this.parseValueDate(data.valueDate);
    if (data.isBackDated && !valueDate) {
      throw BadRequest("isBackDated=true requires valueDate");
    }

    const inferredBackDate =
      valueDate && valueDate.getTime() < getISTDate().getTime();
    const isBackDated = data.isBackDated ?? inferredBackDate ?? false;

    const txId = await generateCustomId(
      this.getTransactionPrefix(),
      "transaction"
    );
    const orderId = data.orderId ?? (await generateCustomId("ORD", "order"));

    const narration =
      data.narration ||
      data.remarks ||
      `${data.type ?? TransactionType.INTERNAL_TRANSFER} Transfer`;

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
    if (!providerId) {
      providerId =
        (fromParts?.entityType === ENTITY_TYPE.PROVIDER
          ? fromParts.entityId
          : undefined) ||
        (toParts?.entityType === ENTITY_TYPE.PROVIDER
          ? toParts.entityId
          : undefined);
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
      insertedDate: isBackDated ? valueDate : undefined,
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
