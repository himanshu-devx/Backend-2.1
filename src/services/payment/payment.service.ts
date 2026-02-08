import { TransactionModel, TransactionDocument } from "@/models/transaction.model";
import { NotFound } from "@/utils/error";
import { InitiatePayinDto } from "@/dto/payment/payin.dto";
import { InitiatePayoutDto } from "@/dto/payment/payout.dto";
import { mapTransactionAmountsToDisplay } from "@/utils/money.util";

export class PaymentService {
  async createPayin(
    merchant: any,
    data: InitiatePayinDto,
    requestIp: string
  ): Promise<TransactionDocument> {
    const { PayinWorkflow } = await import("@/workflows/payin.workflow");
    const workflow = new PayinWorkflow(merchant, requestIp);
    return workflow.execute(data);
  }

  async createPayout(
    merchant: any,
    data: InitiatePayoutDto,
    requestIp: string
  ): Promise<TransactionDocument> {
    const { PayoutWorkflow } = await import("@/workflows/payout.workflow");
    const workflow = new PayoutWorkflow(merchant, requestIp);
    return workflow.execute(data);
  }

  async getStatus(merchantId: string, orderId: string) {
    const { StatusSyncWorkflow } = await import("@/workflows/status-sync.workflow");
    const { CacheService } = await import("@/services/common/cache.service");
    const { TpsService } = await import("@/services/common/tps.service");
    const { ENV } = await import("@/config/env");

    await TpsService.system("STATUS", ENV.SYSTEM_TPS, ENV.SYSTEM_TPS_WINDOW);
    const merchant = await CacheService.getMerchant(merchantId);
    if (merchant?.payin?.tps) {
      await TpsService.merchant(merchantId, "PAYIN", merchant.payin.tps);
    }

    const workflow = new StatusSyncWorkflow();
    const result = await workflow.execute(merchantId, orderId);
    const payload = (result as any)?.toObject ? (result as any).toObject() : result;
    return mapTransactionAmountsToDisplay(payload);
  }

  async getStatusByType(
    merchantId: string,
    orderId: string,
    type: "PAYIN" | "PAYOUT"
  ) {
    const { StatusSyncWorkflow } = await import("@/workflows/status-sync.workflow");
    const { CacheService } = await import("@/services/common/cache.service");
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

    const workflow = new StatusSyncWorkflow();
    const result = await workflow.execute(merchantId, orderId);
    const payload = (result as any)?.toObject ? (result as any).toObject() : result;
    return mapTransactionAmountsToDisplay(payload);
  }
}

export const paymentService = new PaymentService();
