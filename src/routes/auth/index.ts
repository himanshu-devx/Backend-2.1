import { Hono } from "hono";
import adminAuthRoutes from "./admin.routes";
import merchantAuthRoutes from "./merchant.route";

import { AuthController } from "@/controllers";
import { handler } from "@/utils/handler";

const authRoutes = new Hono();

authRoutes.route("/admin", adminAuthRoutes);
authRoutes.route("/merchant", merchantAuthRoutes);

authRoutes.post("/refresh", handler(AuthController.refresh));

export default authRoutes;
