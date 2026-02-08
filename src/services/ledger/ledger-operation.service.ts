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

  private static resolveAccountContext(accountId: string) {
    const parts = LedgerUtils.parseAccountId(accountId);
    if (!parts) return null;

    let purpose: MerchantAccountPurpose | undefined;
    if (parts.purpose === ENTITY_ACCOUNT_TYPE.PAYIN) purpose = "PAYIN";
    if (parts.purpose === ENTITY_ACCOUNT_TYPE.PAYOUT) purpose = "PAYOUT";

    return {
      merchantId:
        parts.entityType === ENTITY_TYPE.MERCHANT ? parts.entityId : undefined,
      providerId:
        parts.entityType === ENTITY_TYPE.PROVIDER ? parts.entityId : undefined,
      legalEntityId:
        parts.entityType === ENTITY_TYPE.LEGAL_ENTITY
          ? parts.entityId
          : undefined,
      accountPurpose: purpose,
    };
  }

  private static async prepareMerchantSettlementBank(
    merchantId: string,
    bankAccountId?: string
  ) {
    if (!merchantId) throw BadRequest("merchantId is required");
    const bank = await this.resolveMerchantBankAccount(
      merchantId,
      bankAccountId
    );
    const { beneficiaryName, ...bankDetails } = bank;
    return {
      from: {
        entityType: ENTITY_TYPE.MERCHANT,
        entityId: merchantId,
        purpose: ENTITY_ACCOUNT_TYPE.PAYIN,
      },
      to: { world: true },
      party: {
        type: TransactionPartyType.WORLD,
        name: beneficiaryName,
        ...bankDetails,
      },
    };
  }

  private static async prepareMerchantDeposit(
    merchantId: string,
    bankAccountId?: string
  ) {
    if (!merchantId) throw BadRequest("merchantId is required");
    const bank = await this.resolveMerchantBankAccount(
      merchantId,
      bankAccountId
    );
    const { beneficiaryName, ...bankDetails } = bank;
    return {
      from: { world: true },
      to: {
        entityType: ENTITY_TYPE.MERCHANT,
        entityId: merchantId,
        purpose: ENTITY_ACCOUNT_TYPE.PAYOUT,
      },
      party: {
        type: TransactionPartyType.WORLD,
        name: beneficiaryName,
        ...bankDetails,
      },
    };
  }

  private static prepareMerchantHoldOrRelease(
    op: LedgerOperationType,
    merchantId: string,
    accountType?: string,
    derivedType?: string
  ) {
    if (!merchantId) throw BadRequest("merchantId is required");
    const holdType =
      (accountType as MerchantAccountPurpose) || derivedType || "PAYOUT";
    const purpose = this.resolveMerchantPurpose(holdType);

    const isHold = op === LEDGER_OPERATION.MERCHANT_HOLD;

    const merchantAccount = {
      entityType: ENTITY_TYPE.MERCHANT,
      entityId: merchantId,
      purpose,
    };
    const holdAccount = {
      entityType: ENTITY_TYPE.MERCHANT,
      entityId: merchantId,
      purpose: ENTITY_ACCOUNT_TYPE.HOLD,
    };

    return {
      from: isHold ? merchantAccount : holdAccount,
      to: isHold ? holdAccount : merchantAccount,
      metadata: { accountType: holdType },
      party: { type: TransactionPartyType.MERCHANT },
    };
  }

  private static async preparePleOperation(
    op: LedgerOperationType,
    providerLegalEntityId?: string,
    providerId?: string,
    legalEntityId?: string
  ) {
    const pleId = providerLegalEntityId;
    if (!pleId) {
      throw BadRequest("providerLegalEntityId is required");
    }
    const ple = await this.resolvePle(pleId);
    const pid = providerId || ple.providerId;
    const leid = legalEntityId || ple.legalEntityId;

    const metadata = {
      providerLegalEntityId: ple.pleId,
      providerId: pid,
      legalEntityId: leid
    };

    let from: any, to: any;

    if (
      op === LEDGER_OPERATION.LEGAL_ENTITY_SETTLEMENT ||
      op === LEDGER_OPERATION.PLE_SETTLEMENT
    ) {
      from = { accountId: ple.payinAccountId };
      to = {
        entityType: ENTITY_TYPE.LEGAL_ENTITY,
        entityId: leid,
        purpose: ENTITY_ACCOUNT_TYPE.BANK,
      };
    } else if (
      op === LEDGER_OPERATION.LEGAL_ENTITY_DEPOSIT ||
      op === LEDGER_OPERATION.PLE_DEPOSIT
    ) {
      from = {
        entityType: ENTITY_TYPE.LEGAL_ENTITY,
        entityId: leid,
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
    } else if (op === LEDGER_OPERATION.LEGAL_ENTITY_DEDUCT) {
      if (!leid) throw BadRequest("legalEntityId is required");
      from = {
        entityType: ENTITY_TYPE.LEGAL_ENTITY,
        entityId: leid,
        purpose: ENTITY_ACCOUNT_TYPE.BANK,
      };
      to = { world: true };
      return {
        from, to,
        metadata: {},
        party: { type: TransactionPartyType.WORLD },
        providerId: pid,
        legalEntityId: leid,
        providerLegalEntityId: ple.pleId
      };
    }

    return {
      from, to,
      metadata,
      party: { type: TransactionPartyType.PROVIDER_LEGAL_ENTITY },
      providerId: pid,
      legalEntityId: leid,
      providerLegalEntityId: ple.pleId
    };
  }

  static async createOperation(
    data: CreateLedgerOperationDTO,
    actor: ActorContext
  ) {
    const op = data.operation as LedgerOperationType;
    this.ensureRequired(op, data);

    let metadata: any = {
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
    const counterpartyParty =
      data.counterparty === "WORLD"
        ? { type: TransactionPartyType.WORLD }
        : data.counterparty === "INCOME"
          ? { type: TransactionPartyType.INCOME }
          : undefined;

    // Resolve context from accountId if available
    let derivedAccountPurpose: MerchantAccountPurpose | undefined;

    if (data.accountId) {
      const ctx = LedgerOperationService.resolveAccountContext(data.accountId);
      if (ctx) {
        if (!merchantId && ctx.merchantId) merchantId = ctx.merchantId;
        if (!providerId && ctx.providerId) providerId = ctx.providerId;
        if (!legalEntityId && ctx.legalEntityId)
          legalEntityId = ctx.legalEntityId;
        if (ctx.accountPurpose) derivedAccountPurpose = ctx.accountPurpose;
      }
    }

    let prepResult: any = {};

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
        prepResult = await this.prepareMerchantSettlementBank(merchantId!, data.bankAccountId);
        break;
      }
      case LEDGER_OPERATION.MERCHANT_DEPOSIT: {
        prepResult = await this.prepareMerchantDeposit(merchantId!, data.bankAccountId);
        break;
      }
      case LEDGER_OPERATION.MERCHANT_HOLD:
      case LEDGER_OPERATION.MERCHANT_RELEASE: {
        prepResult = this.prepareMerchantHoldOrRelease(op, merchantId!, data.accountType, derivedAccountPurpose);
        break;
      }

      case LEDGER_OPERATION.INCOME_SETTLEMENT_TO_MERCHANT: {
        if (!merchantId) throw BadRequest("merchantId is required");
        const targetType =
          (data.targetAccountType as MerchantAccountPurpose) ||
          derivedAccountPurpose ||
          "PAYIN";
        const targetPurpose = this.resolveMerchantPurpose(targetType);
        metadata.targetAccountType = targetType;
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
      case LEDGER_OPERATION.PLE_EXPENSE_CHARGE:
      case LEDGER_OPERATION.LEGAL_ENTITY_DEDUCT: {
        prepResult = await this.preparePleOperation(op, providerLegalEntityId, providerId, legalEntityId);
        if (prepResult.providerId) providerId = prepResult.providerId;
        if (prepResult.legalEntityId) legalEntityId = prepResult.legalEntityId;
        if (prepResult.providerLegalEntityId) providerLegalEntityId = prepResult.providerLegalEntityId;
        break;
      }
      default: {
        // Fallback or leave as is for un-refactored parts?
        // I should have covered everything except:
        // MERCHANT_SETTLEMENT_PAYOUT (kept inline for simplicity as it has no deps)
        // INCOME_SETTLEMENT_TO_MERCHANT (kept inline)
        // LEGAL_ENTITY_DEDUCT (handled in preparePleOperation?)
        throw BadRequest("Unsupported operation");
      }
    }

    if (prepResult.from) from = prepResult.from;
    if (prepResult.to) to = prepResult.to;
    if (prepResult.party) party = prepResult.party;
    if (prepResult.metadata) Object.assign(metadata, prepResult.metadata);
    if (prepResult.fromDetails) fromDetails = prepResult.fromDetails;
    if (prepResult.toDetails) toDetails = prepResult.toDetails;
    if (!party && counterpartyParty) party = counterpartyParty;

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
