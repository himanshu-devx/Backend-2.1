import {
  LEDGER_OPERATION,
  LEDGER_OPERATION_DEFAULT_TXN,
  LEDGER_OPERATION_META,
  LedgerOperationType,
} from "@/constants/ledger-operations.constant";
import {
  ENTITY_ACCOUNT_TYPE,
  ENTITY_TYPE,
} from "@/constants/ledger.constant";
import { TransactionPartyType } from "@/constants/transaction.constant";
import { BankAccountStatus } from "@/constants/utils.constant";
import { CreateLedgerOperationDTO } from "@/dto/ledger/ledger-operation.dto";
import { LedgerTransferService } from "@/services/ledger/ledger-transfer.service";
import { MerchantBankAccountModel } from "@/models/merchant-bank-account.model";
import { ProviderLegalEntityModel } from "@/models/provider-legal-entity.model";
import { LedgerUtils } from "@/utils/ledger.utils";
import { BadRequest, NotFound } from "@/utils/error";
import { AccountType } from "fintech-ledger";

type ActorContext = {
  id: string;
  email?: string;
  role?: string;
};

type MerchantAccountPurpose = "PAYIN" | "PAYOUT";

type ResolvedPle = {
  pleId: string;
  providerId: string;
  legalEntityId: string;
  payinAccountId: string;
  payoutAccountId: string;
  expenseAccountId: string;
};

export class LedgerOperationService {
  private static ensureRequired(
    op: LedgerOperationType,
    data: CreateLedgerOperationDTO
  ) {
    const required = LEDGER_OPERATION_META[op]?.required || [];
    for (const field of required) {
      if (!(data as any)[field]) {
        throw BadRequest(`Missing required field: ${field}`);
      }
    }
  }

  private static async resolveMerchantBankAccount(
    merchantId: string,
    bankAccountId?: string
  ) {
    if (!merchantId) throw BadRequest("merchantId is required");

    const query: any = {
      merchantId,
      status: BankAccountStatus.APPROVED,
      isActive: true,
    };

    if (bankAccountId) {
      query.id = bankAccountId;
    }

    const account = await MerchantBankAccountModel.findOne(query).lean();
    if (!account) {
      throw NotFound(
        bankAccountId
          ? "Merchant bank account not found or inactive"
          : "No active approved merchant bank account found"
      );
    }

    return {
      id: account.id,
      accountNumber: account.accountNumber,
      ifscCode: account.ifsc,
      bankName: account.bankName,
      beneficiaryName: account.beneficiaryName,
    };
  }

  private static async resolvePle(
    providerLegalEntityId: string
  ): Promise<ResolvedPle> {
    const ple = await ProviderLegalEntityModel.findOne({
      id: providerLegalEntityId,
    }).lean();
    if (!ple) throw NotFound("Provider legal entity not found");

    const providerId = ple.providerId;
    const legalEntityId = ple.legalEntityId;

    const payinAccountId =
      ple.accounts?.payinAccountId ||
      LedgerUtils.generateAccountId(
        ENTITY_TYPE.PROVIDER,
        providerId,
        AccountType.ASSET,
        ENTITY_ACCOUNT_TYPE.PAYIN
      );
    const payoutAccountId =
      ple.accounts?.payoutAccountId ||
      LedgerUtils.generateAccountId(
        ENTITY_TYPE.PROVIDER,
        providerId,
        AccountType.ASSET,
        ENTITY_ACCOUNT_TYPE.PAYOUT
      );
    const expenseAccountId =
      ple.accounts?.expenseAccountId ||
      LedgerUtils.generateAccountId(
        ENTITY_TYPE.PROVIDER,
        providerId,
        AccountType.EXPENSE,
        ENTITY_ACCOUNT_TYPE.EXPENSE
      );

    return {
      pleId: ple.id,
      providerId,
      legalEntityId,
      payinAccountId,
      payoutAccountId,
      expenseAccountId,
    };
  }

  private static resolveMerchantPurpose(
    accountType?: MerchantAccountPurpose
  ) {
    return accountType === "PAYOUT"
      ? ENTITY_ACCOUNT_TYPE.PAYOUT
      : ENTITY_ACCOUNT_TYPE.PAYIN;
  }

  static async createOperation(
    data: CreateLedgerOperationDTO,
    actor: ActorContext
  ) {
    const op = data.operation as LedgerOperationType;
    this.ensureRequired(op, data);

    const metadata = {
      ...(data.metadata || {}),
      operation: op,
    };

    let from: any;
    let to: any;
    let fromDetails = data.fromDetails;
    let toDetails = data.toDetails;
    let party;
    let merchantId = data.merchantId;
    let providerId = data.providerId;
    let legalEntityId = data.legalEntityId;
    let providerLegalEntityId = data.providerLegalEntityId;

    switch (op) {
      case LEDGER_OPERATION.MERCHANT_SETTLEMENT_PAYOUT: {
        if (!merchantId) throw BadRequest("merchantId is required");
        from = {
          entityType: ENTITY_TYPE.MERCHANT,
          entityId: merchantId,
          purpose: ENTITY_ACCOUNT_TYPE.PAYIN,
        };
        to = {
          entityType: ENTITY_TYPE.MERCHANT,
          entityId: merchantId,
          purpose: ENTITY_ACCOUNT_TYPE.PAYOUT,
        };
        party = { type: TransactionPartyType.MERCHANT };
        break;
      }
      case LEDGER_OPERATION.MERCHANT_SETTLEMENT_BANK: {
        if (!merchantId) throw BadRequest("merchantId is required");
        const bank = await this.resolveMerchantBankAccount(
          merchantId,
          data.bankAccountId
        );
        from = {
          entityType: ENTITY_TYPE.MERCHANT,
          entityId: merchantId,
          purpose: ENTITY_ACCOUNT_TYPE.PAYIN,
        };
        to = { world: true };
        toDetails = toDetails || bank;
        metadata.bankAccountId = bank.id;
        party = { type: TransactionPartyType.WORLD };
        break;
      }
      case LEDGER_OPERATION.MERCHANT_DEPOSIT: {
        if (!merchantId) throw BadRequest("merchantId is required");
        const bank = await this.resolveMerchantBankAccount(
          merchantId,
          data.bankAccountId
        );
        from = { world: true };
        to = {
          entityType: ENTITY_TYPE.MERCHANT,
          entityId: merchantId,
          purpose: ENTITY_ACCOUNT_TYPE.PAYOUT,
        };
        fromDetails = fromDetails || bank;
        metadata.bankAccountId = bank.id;
        party = { type: TransactionPartyType.WORLD };
        break;
      }
      case LEDGER_OPERATION.MERCHANT_WITHDRAWAL:
      case LEDGER_OPERATION.MERCHANT_DEDUCT:
      case LEDGER_OPERATION.MERCHANT_REFUND: {
        if (!merchantId) throw BadRequest("merchantId is required");
        const purpose = this.resolveMerchantPurpose(
          data.accountType as MerchantAccountPurpose
        );
        metadata.accountType = data.accountType || "PAYIN";
        const counterparty = data.counterparty || "WORLD";
        metadata.counterparty = counterparty;
        from = {
          entityType: ENTITY_TYPE.MERCHANT,
          entityId: merchantId,
          purpose,
        };
        if (counterparty === "INCOME") {
          to = {
            entityType: ENTITY_TYPE.INCOME,
            entityId: "INCOME",
            purpose: ENTITY_ACCOUNT_TYPE.INCOME,
          };
        } else {
          to = { world: true };
        }
        if (counterparty === "WORLD" && data.bankAccountId) {
          const bank = await this.resolveMerchantBankAccount(
            merchantId,
            data.bankAccountId
          );
          toDetails = toDetails || bank;
          metadata.bankAccountId = bank.id;
        }
        party =
          counterparty === "INCOME"
            ? { type: TransactionPartyType.SYSTEM }
            : { type: TransactionPartyType.WORLD };
        break;
      }
      case LEDGER_OPERATION.MERCHANT_HOLD: {
        if (!merchantId) throw BadRequest("merchantId is required");
        const holdType =
          (data.accountType as MerchantAccountPurpose) || "PAYOUT";
        const purpose = this.resolveMerchantPurpose(holdType);
        metadata.accountType = holdType;
        from = {
          entityType: ENTITY_TYPE.MERCHANT,
          entityId: merchantId,
          purpose,
        };
        to = {
          entityType: ENTITY_TYPE.MERCHANT,
          entityId: merchantId,
          purpose: ENTITY_ACCOUNT_TYPE.HOLD,
        };
        party = { type: TransactionPartyType.MERCHANT };
        break;
      }
      case LEDGER_OPERATION.MERCHANT_RELEASE: {
        if (!merchantId) throw BadRequest("merchantId is required");
        const holdType =
          (data.accountType as MerchantAccountPurpose) || "PAYOUT";
        const purpose = this.resolveMerchantPurpose(holdType);
        metadata.accountType = holdType;
        from = {
          entityType: ENTITY_TYPE.MERCHANT,
          entityId: merchantId,
          purpose: ENTITY_ACCOUNT_TYPE.HOLD,
        };
        to = {
          entityType: ENTITY_TYPE.MERCHANT,
          entityId: merchantId,
          purpose,
        };
        party = { type: TransactionPartyType.MERCHANT };
        break;
      }
      case LEDGER_OPERATION.MERCHANT_FEES: {
        if (!merchantId) throw BadRequest("merchantId is required");
        const purpose = this.resolveMerchantPurpose(
          data.accountType as MerchantAccountPurpose
        );
        metadata.accountType = data.accountType || "PAYIN";
        from = {
          entityType: ENTITY_TYPE.MERCHANT,
          entityId: merchantId,
          purpose,
        };
        to = {
          entityType: ENTITY_TYPE.INCOME,
          entityId: "INCOME",
          purpose: ENTITY_ACCOUNT_TYPE.INCOME,
        };
        party = { type: TransactionPartyType.SYSTEM };
        break;
      }
      case LEDGER_OPERATION.INCOME_SETTLEMENT_TO_MERCHANT: {
        if (!merchantId) throw BadRequest("merchantId is required");
        const targetPurpose = this.resolveMerchantPurpose(
          data.targetAccountType as MerchantAccountPurpose
        );
        metadata.targetAccountType = data.targetAccountType || "PAYIN";
        from = {
          entityType: ENTITY_TYPE.INCOME,
          entityId: "INCOME",
          purpose: ENTITY_ACCOUNT_TYPE.INCOME,
        };
        to = {
          entityType: ENTITY_TYPE.MERCHANT,
          entityId: merchantId,
          purpose: targetPurpose,
        };
        party = { type: TransactionPartyType.MERCHANT };
        break;
      }
      case LEDGER_OPERATION.LEGAL_ENTITY_SETTLEMENT:
      case LEDGER_OPERATION.LEGAL_ENTITY_DEPOSIT:
      case LEDGER_OPERATION.PLE_SETTLEMENT:
      case LEDGER_OPERATION.PLE_DEPOSIT:
      case LEDGER_OPERATION.PLE_EXPENSE_SETTLEMENT:
      case LEDGER_OPERATION.PLE_EXPENSE_CHARGE: {
        const pleId = providerLegalEntityId;
        if (!pleId) {
          throw BadRequest("providerLegalEntityId is required");
        }
        const ple = await this.resolvePle(pleId);
        providerId = providerId || ple.providerId;
        legalEntityId = legalEntityId || ple.legalEntityId;
        providerLegalEntityId = ple.pleId;
        metadata.providerLegalEntityId = ple.pleId;
        metadata.providerId = providerId;
        metadata.legalEntityId = legalEntityId;

        if (
          op === LEDGER_OPERATION.LEGAL_ENTITY_SETTLEMENT ||
          op === LEDGER_OPERATION.PLE_SETTLEMENT
        ) {
          from = { accountId: ple.payinAccountId };
          to = {
            entityType: ENTITY_TYPE.LEGAL_ENTITY,
            entityId: legalEntityId,
            purpose: ENTITY_ACCOUNT_TYPE.BANK,
          };
        } else if (
          op === LEDGER_OPERATION.LEGAL_ENTITY_DEPOSIT ||
          op === LEDGER_OPERATION.PLE_DEPOSIT
        ) {
          from = {
            entityType: ENTITY_TYPE.LEGAL_ENTITY,
            entityId: legalEntityId,
            purpose: ENTITY_ACCOUNT_TYPE.BANK,
          };
          to = { accountId: ple.payoutAccountId };
        } else if (op === LEDGER_OPERATION.PLE_EXPENSE_SETTLEMENT) {
          from = { accountId: ple.expenseAccountId };
          to = {
            entityType: ENTITY_TYPE.INCOME,
            entityId: "INCOME",
            purpose: ENTITY_ACCOUNT_TYPE.INCOME,
          };
        } else if (op === LEDGER_OPERATION.PLE_EXPENSE_CHARGE) {
          from = { world: true };
          to = { accountId: ple.expenseAccountId };
        }

        party = { type: TransactionPartyType.PROVIDER_LEGAL_ENTITY };
        break;
      }
      case LEDGER_OPERATION.LEGAL_ENTITY_DEDUCT: {
        if (!legalEntityId) throw BadRequest("legalEntityId is required");
        from = {
          entityType: ENTITY_TYPE.LEGAL_ENTITY,
          entityId: legalEntityId,
          purpose: ENTITY_ACCOUNT_TYPE.BANK,
        };
        to = { world: true };
        party = { type: TransactionPartyType.WORLD };
        break;
      }
      default: {
        throw BadRequest("Unsupported operation");
      }
    }

    return LedgerTransferService.createTransfer(
      {
        type: LEDGER_OPERATION_DEFAULT_TXN[op],
        amount: data.amount,
        currency: data.currency,
        narration: data.narration,
        remarks: data.remarks,
        paymentMode: data.paymentMode,
        utr: data.utr,
        orderId: data.orderId,
        valueDate: data.valueDate,
        isBackDated: data.isBackDated,
        status: data.status,
        idempotencyKey: data.idempotencyKey,
        correlationId: data.correlationId,
        externalRef: data.externalRef,
        merchantId,
        providerId,
        legalEntityId,
        providerLegalEntityId,
        from,
        to,
        metadata,
        fromDetails,
        toDetails,
        party,
      },
      actor
    );
  }
}
