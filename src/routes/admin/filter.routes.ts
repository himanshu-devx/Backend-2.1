import { Hono } from "hono";
import { FilterController } from "@/controllers/admin/filter.controller";
import { handler } from "@/utils/handler";

const adminFilterRoutes = new Hono();

adminFilterRoutes.get(
    "/",
    handler(FilterController.getFilters)
);

export default adminFilterRoutes;
