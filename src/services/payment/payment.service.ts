import { TransactionModel, TransactionDocument } from "@/models/transaction.model";
import { NotFound } from "@/utils/error";
import { InitiatePayinDto } from "@/dto/payment/payin.dto";
import { InitiatePayoutDto } from "@/dto/payment/payout.dto";

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
    const workflow = new StatusSyncWorkflow();
    return workflow.execute(merchantId, orderId);
  }
}

export const paymentService = new PaymentService();
