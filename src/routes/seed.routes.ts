import { Hono } from "hono";
import { SeedController } from "@/controllers/seed.controller";
import { handler } from "@/utils/handler";

const seedRoutes = new Hono();
const controller = new SeedController();

seedRoutes.post(
  "/transaction",
  handler((c) => controller.createTransaction(c))
);

export default seedRoutes;
