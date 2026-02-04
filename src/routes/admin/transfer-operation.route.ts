import { Hono } from "hono";
import { TransferOperationController } from "@/controllers/admin/transfer-operation.controller";

const transferOperationRoutes = new Hono();
const controller = new TransferOperationController();

transferOperationRoutes.get("/", (c) => controller.listOperations(c));
transferOperationRoutes.get("/available-for-entity", (c) => controller.getOperationsForEntity(c));
transferOperationRoutes.get("/:type/entities", (c) => controller.getOperationEntities(c));
transferOperationRoutes.post("/execute", (c) => controller.executeOperation(c));

export { transferOperationRoutes };
