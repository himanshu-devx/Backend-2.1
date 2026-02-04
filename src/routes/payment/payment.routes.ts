import { Hono } from "hono";
import { PaymentController } from "@/controllers/payment/payment.controller";

import { validateBody } from "@/middlewares/validate";
import { InitiatePayinSchema } from "@/dto/payment/payin.dto";
import { InitiatePayoutSchema } from "@/dto/payment/payout.dto";

import { extractPaymentIp } from "@/middlewares/ip-extractor.middleware";

const paymentRoutes = new Hono();
const controller = new PaymentController();

paymentRoutes.post("/payin", extractPaymentIp, validateBody(InitiatePayinSchema), (c) => controller.payin(c));
paymentRoutes.post("/payout", extractPaymentIp, validateBody(InitiatePayoutSchema), (c) => controller.payout(c));
paymentRoutes.get("/status/:orderId", (c) => controller.checkStatus(c));

export default paymentRoutes;
