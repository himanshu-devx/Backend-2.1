import { TransactionModel, TransactionDocument } from "@/models/transaction.model";
import { NotFound } from "@/utils/error";
import { InitiatePayinDto } from "@/dto/payment/payin.dto";
import { InitiatePayoutDto } from "@/dto/payment/payout.dto";
import { mapTransactionAmountsToDisplay } from "@/utils/money.util";
import { CacheService } from "@/services/common/cache.service";
import type {
  PayinInitiateResponse,
  PayoutInitiateResponse,
} from "@/services/payment/payment.types";

export class PaymentService {
  async createPayin(
    merchant: any,
    data: InitiatePayinDto,
    requestIp: string
  ): Promise<PayinInitiateResponse> {
    const { PayinWorkflow } = await import("@/workflows/payin.workflow");
    const workflow = new PayinWorkflow(merchant, requestIp);
    return workflow.execute(data);
  }

  async createPayout(
    merchant: any,
    data: InitiatePayoutDto,
    requestIp: string
  ): Promise<PayoutInitiateResponse> {
    const { PayoutWorkflow } = await import("@/workflows/payout.workflow");
    const workflow = new PayoutWorkflow(merchant, requestIp);
    return workflow.execute(data);
  }

  async getStatus(merchantId: string, orderId: string) {
    const { TpsService } = await import("@/services/common/tps.service");
    const { ENV } = await import("@/config/env");

    await TpsService.system("STATUS", ENV.SYSTEM_TPS, ENV.SYSTEM_TPS_WINDOW);
    const merchant = await CacheService.getMerchant(merchantId);
    if (merchant?.payin?.tps) {
      await TpsService.merchant(merchantId, "PAYIN", merchant.payin.tps);
    }

    const result = await this.getLocalStatus(merchantId, orderId);
    return mapTransactionAmountsToDisplay(result);
  }

  async getStatusByType(
    merchantId: string,
    orderId: string,
    type: "PAYIN" | "PAYOUT"
  ) {
    const { TpsService } = await import("@/services/common/tps.service");
    const { ENV } = await import("@/config/env");

    await TpsService.system(type, ENV.SYSTEM_TPS, ENV.SYSTEM_TPS_WINDOW);
    const merchant = await CacheService.getMerchant(merchantId);
    if (type === "PAYIN" && merchant?.payin?.tps) {
      await TpsService.merchant(merchantId, "PAYIN", merchant.payin.tps);
    }
    if (type === "PAYOUT" && merchant?.payout?.tps) {
      await TpsService.merchant(merchantId, "PAYOUT", merchant.payout.tps);
    }

    const result = await this.getLocalStatus(merchantId, orderId, type);
    return mapTransactionAmountsToDisplay(result);
  }

  private async getLocalStatus(
    merchantId: string,
    orderId: string,
    type?: "PAYIN" | "PAYOUT"
  ) {
    const cached = await CacheService.getCachedTransactionByOrder(
      merchantId,
      orderId
    );
    if (cached) {
      if (!type || cached.type === type) return cached;
    }

    const transaction = await TransactionModel.findOne({ orderId, merchantId });
    if (!transaction) throw NotFound("Transaction not found");
    if (type && transaction.type !== type) throw NotFound("Transaction not found");

    await CacheService.setTransactionCache(transaction);
    return (transaction as any)?.toObject ? (transaction as any).toObject() : transaction;
  }
}

export const paymentService = new PaymentService();
