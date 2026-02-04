import { TransactionModel, TransactionDocument } from "@/models/transaction.model";
import { NotFound } from "@/utils/error";
import { InitiatePayinDto } from "@/dto/payment/payin.dto";
import { InitiatePayoutDto } from "@/dto/payment/payout.dto";

export class PaymentService {
  async createPayin(
    merchantId: string,
    data: InitiatePayinDto,
    requestIp: string
  ): Promise<TransactionDocument> {
    const { payinService } = await import("@/services/payment/payin.service");
    // Cast to any or verify PayinService accepts compatible types.
    // Ideally PayinService should accept InitiatePayinDto.
    return payinService.createPayin(merchantId, data as any, requestIp);
  }

  async createPayout(
    merchantId: string,
    data: InitiatePayoutDto,
    requestIp: string
  ): Promise<TransactionDocument> {
    const { payoutService } = await import("@/services/payment/payout.service");
    return payoutService.createPayout(merchantId, data as any, requestIp);
  }

  async getStatus(merchantId: string, orderId: string) {
    const txn = await TransactionModel.findOne({ orderId, merchantId });
    if (!txn) {
      throw NotFound("Transaction not found");
    }
    return txn;
  }
}

export const paymentService = new PaymentService();
