import { Context } from "hono";
import {
  PaymentService,
  paymentService,
} from "@/services/payment/payment.service";
import { AppError, InternalError, BadRequest, Conflict } from "@/utils/error";
import { AuditLogService } from "@/services/common/audit-log.service";
import { PaymentError } from "@/utils/payment-errors.util";

export class PaymentController {
  private service: PaymentService;

  constructor() {
    this.service = paymentService;
  }

  async payin(c: Context) {
    let merchantId = "";
    let body: any;
    const ip = c.get("requestIp"); // Populated by ip-extractor

    try {
      body = c.get("req_body") || await c.req.json(); // Use body from middleware if available
      const merchant = c.get("merchant"); // Populated by paymentSecurityMiddleware

      if (!merchant) {
        // Should be caught by middleware, but safety check
        throw InternalError("Merchant context missing");
      }
      merchantId = merchant.id;

      // Pass merchant object to service to avoid re-fetching
      const result = await this.service.createPayin(merchant, body, ip);
      return c.json({ success: true, data: result });

    } catch (error: any) {
      // Audit Log might need merchantId even if context fail, try header
      const logMerchantId = merchantId || c.req.header("x-merchant-id") || "UNKNOWN";

      await AuditLogService.logFailure("PAYIN_INITIATE", error, { merchantId: logMerchantId, orderId: body?.orderId }, ip);

      if (error instanceof PaymentError || error?.name === "PaymentError") {
        const payload = (error as PaymentError).toMerchantJSON();
        return c.json({ success: false, ...payload }, (error as PaymentError).httpStatus || 400);
      }
      if (error.code === 11000) {
        throw Conflict("Order ID already exists. Please use a unique Order ID.");
      }
      if (error instanceof AppError || error.name === "AppError") {
        throw error;
      }

      console.error("Payin Unexpected Error:", error);
      throw InternalError(error.message || "Payment request processing failed.");
    }
  }

  async payout(c: Context) {
    let merchantId = "";
    let body: any;
    const ip = c.get("requestIp");

    try {
      body = c.get("req_body") || await c.req.json();
      const merchant = c.get("merchant");

      if (!merchant) {
        throw InternalError("Merchant context missing");
      }
      merchantId = merchant.id;

      const result = await this.service.createPayout(merchant, body, ip);
      return c.json({ success: true, data: result });
    } catch (error: any) {
      const logMerchantId = merchantId || c.req.header("x-merchant-id") || "UNKNOWN";

      await AuditLogService.logFailure("PAYOUT_INITIATE", error, { merchantId: logMerchantId, orderId: body?.orderId }, ip);

      if (error instanceof PaymentError || error?.name === "PaymentError") {
        const payload = (error as PaymentError).toMerchantJSON();
        return c.json({ success: false, ...payload }, (error as PaymentError).httpStatus || 400);
      }
      if (error.code === 11000) {
        throw Conflict("Order ID already exists. Please use a unique Order ID.");
      }
      if (error instanceof AppError || error.name === "AppError") {
        throw error;
      }

      console.error("Payout Unexpected Error:", error);
      throw InternalError(error.message || "Payout request processing failed.");
    }
  }

  async checkStatus(c: Context) {
    try {
      const orderId = c.req.param("orderId");
      const merchant = c.get("merchant");

      if (!merchant) throw InternalError("Merchant context missing");

      const result = await this.service.getStatus(merchant.id, orderId);
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

  async checkPayinStatus(c: Context) {
    try {
      const orderId = c.req.param("orderId");
      const merchant = c.get("merchant");

      if (!merchant) throw InternalError("Merchant context missing");

      const result = await this.service.getStatusByType(merchant.id, orderId, "PAYIN");
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

  async checkPayoutStatus(c: Context) {
    try {
      const orderId = c.req.param("orderId");
      const merchant = c.get("merchant");

      if (!merchant) throw InternalError("Merchant context missing");

      const result = await this.service.getStatusByType(merchant.id, orderId, "PAYOUT");
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
