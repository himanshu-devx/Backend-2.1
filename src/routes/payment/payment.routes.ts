import { Hono } from "hono";
import { extractPaymentIp } from "@/middlewares/ip-extractor.middleware";
import { paymentSecurityMiddleware } from "@/middlewares/payment-security.middleware";
import { validateBody } from "@/middlewares/validate";
import { InitiatePayinSchema } from "@/dto/payment/payin.dto";
import { PaymentController } from "@/controllers/payment/payment.controller";
import { InitiatePayoutSchema } from "@/dto/payment/payout.dto";

const paymentRoutes = new Hono();
const controller = new PaymentController();

paymentRoutes.post(
    "/payin/initiate",
    extractPaymentIp,
    paymentSecurityMiddleware("PAYIN"),
    validateBody(InitiatePayinSchema),
    (c) => controller.payin(c)
);

paymentRoutes.post(
    "/uat/payin/initiate",
    extractPaymentIp,
    paymentSecurityMiddleware("PAYIN"),
    validateBody(InitiatePayinSchema),
    (c) => controller.payinUat(c)
);

paymentRoutes.post(
    "/payout/initiate",
    extractPaymentIp,
    paymentSecurityMiddleware("PAYOUT"),
    validateBody(InitiatePayoutSchema),
    (c) => controller.payout(c)
);

paymentRoutes.post(
    "/uat/payout/initiate",
    extractPaymentIp,
    paymentSecurityMiddleware("PAYOUT"),
    validateBody(InitiatePayoutSchema),
    (c) => controller.payoutUat(c)
);

paymentRoutes.get(
    "/:orderId",
    extractPaymentIp,
    paymentSecurityMiddleware("STATUS"),
    (c) => controller.checkStatus(c)
);

paymentRoutes.get(
    "/uat/:orderId",
    extractPaymentIp,
    paymentSecurityMiddleware("STATUS"),
    (c) => controller.checkStatusUat(c)
);

paymentRoutes.get(
    "/payin/status/:orderId",
    extractPaymentIp,
    paymentSecurityMiddleware("PAYIN"),
    (c) => controller.checkPayinStatus(c)
);

paymentRoutes.get(
    "/uat/payin/status/:orderId",
    extractPaymentIp,
    paymentSecurityMiddleware("PAYIN"),
    (c) => controller.checkPayinStatusUat(c)
);

paymentRoutes.get(
    "/payout/status/:orderId",
    extractPaymentIp,
    paymentSecurityMiddleware("PAYOUT"),
    (c) => controller.checkPayoutStatus(c)
);

paymentRoutes.get(
    "/uat/payout/status/:orderId",
    extractPaymentIp,
    paymentSecurityMiddleware("PAYOUT"),
    (c) => controller.checkPayoutStatusUat(c)
);

export default paymentRoutes;
