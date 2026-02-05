import { Context } from "hono";
import {
  PaymentService,
  paymentService,
} from "@/services/payment/payment.service";
import { AppError, InternalError, BadRequest, Conflict } from "@/utils/error";
import { AuditLogService } from "@/services/common/audit-log.service";

export class PaymentController {
  private service: PaymentService;

  constructor() {
    this.service = paymentService;
  }

  async payin(c: Context) {
    let merchantId = c.req.header("x-merchant-id");
    let body: any;
    const ip = c.get("requestIp");

    try {
      body = c.get("validatedBody");
      merchantId = c.req.header("x-merchant-id");

      if (!merchantId) {
        throw BadRequest("Merchant ID missing in headers");
      }
      const result = await this.service.createPayin(merchantId, body, ip);
      return c.json({ success: true, data: result });

    } catch (error: any) {
      await AuditLogService.logFailure("PAYIN_INITIATE", error, { merchantId, orderId: body?.orderId }, ip);

      if (error.code === 11000) {
        throw Conflict("Order ID already exists. Please use a unique Order ID.");
      }
      if (error instanceof AppError || error.name === "AppError") {
        throw error;
      }

      // Log full error internally
      console.error("Payin Unexpected Error:", error);

      // Return Customer Centric Message (or Exact Error as requested)
      throw InternalError(error.message || "Payment request processing failed.");
    }
  }

  async payout(c: Context) {
    let merchantId = c.req.header("x-merchant-id");
    let body: any;
    const ip = c.get("requestIp");


    try {
      body = c.get("validatedBody");

      if (!merchantId) {
        throw BadRequest("Merchant ID missing in headers");
      }

      const result = await this.service.createPayout(merchantId, body, ip);
      return c.json({ success: true, data: result });
    } catch (error: any) {
      await AuditLogService.logFailure("PAYOUT_INITIATE", error, { merchantId, orderId: body?.orderId }, ip);

      if (error.code === 11000) {
        throw Conflict("Order ID already exists. Please use a unique Order ID.");
      }
      if (error instanceof AppError || error.name === "AppError") {
        throw error;
      }

      console.error("Payout Unexpected Error:", error);
      // Return exact error as requested
      throw InternalError(error.message || "Payout request processing failed.");
    }
  }

  async checkStatus(c: Context) {
    try {
      const orderId = c.req.param("orderId");
      const merchantId = c.req.header("x-merchant-id");

      if (!merchantId) {
        throw BadRequest("Merchant ID missing in headers");
      }

      const result = await this.service.getStatus(merchantId, orderId);
      return c.json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof AppError || error.name === "AppError") {
        throw error;
      }
      console.error("Status Error:", error);
      const msg = error.message || "Unknown error";
      throw InternalError("Status check failed: " + msg);
    }
  }
}
