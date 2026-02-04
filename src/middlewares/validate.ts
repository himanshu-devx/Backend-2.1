// src/middlewares/validation.ts

import type { Context, Next, MiddlewareHandler } from "hono";
import type { ZodSchema } from "zod";
import { BadRequest } from "@/utils/error";

export const validateBody =
  <T>(schema: ZodSchema<T>): MiddlewareHandler =>
  async (c: Context, next: Next) => {
    try {
      const body = await c.req.json();
      console.log(
        "[DEBUG] ValidateBody received:",
        JSON.stringify(body, null, 2)
      );
      const result = schema.safeParse(body);
      if (!result.success) {
        console.log(
          "[DEBUG] Validation Error:",
          JSON.stringify(result.error.flatten(), null, 2)
        );
        throw BadRequest(
          `VALIDATION_FAILED: ${JSON.stringify(
            body
          )} | ERRORS: ${JSON.stringify(result.error.flatten().fieldErrors)}`,
          result.error.flatten().fieldErrors
        );
      }

      c.set("validatedBody", result.data);

      return next();
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw BadRequest("Malformed JSON body provided.");
      }
      throw error;
    }
  };

export const validateQuery =
  (schema: ZodSchema): MiddlewareHandler =>
  async (c: Context, next) => {
    const rawQuery = c.req.query();
    const safeParse = schema.safeParse(rawQuery);

    if (!safeParse.success) {
      throw BadRequest(
        "Invalid query parameters provided.",
        safeParse.error.flatten()
      );
    }

    c.set("validatedQuery", safeParse.data);

    await next();
  };
