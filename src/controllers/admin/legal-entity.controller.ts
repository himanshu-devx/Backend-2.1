import { Context } from "hono";
import { LegalEntityService } from "@/services/legal-entity/legal-entity.service";
import { respond as handleResult } from "@/utils/result-http";
import { getAuditContext } from "@/utils/audit.util";
import { z } from "zod";

const InlineCreateLegalEntitySchema = z.object({
  name: z.string().min(1),
  identifier: z.string().min(1),
  gstin: z.string().optional(),
  bankAccount: z
    .object({
      accountNumber: z.string(),
      ifsc: z.string(),
      bankName: z.string(),
      beneficiaryName: z.string(),
    })
    .optional(),
  isActive: z.boolean().optional(),
});

export class LegalEntityController {
  static async create(c: Context) {
    const ctx = getAuditContext(c);
    let body = c.get("validatedBody");

    if (!body) {
      try {
        body = await c.req.json();
      } catch (e) {
        body = {};
      }
    }

    // INLINE MANUAL VALIDATION
    // Necessary to bypass import corruption issues with DTOs
    const validation = InlineCreateLegalEntitySchema.safeParse(body);
    if (!validation.success) {
      return handleResult(
        c,
        {
          success: false,
          error: {
            message: "Validation Error",
            code: "BAD_REQUEST",
            details: validation.error.flatten().fieldErrors,
          },
        } as any,
        { defaultErrorStatus: 400 }
      );
    }

    const validatedData = validation.data;
    const result = await LegalEntityService.create(validatedData, ctx);
    return handleResult(c, result, { successStatus: 201 });
  }

  static async list(c: Context) {
    const query = c.req.query();
    const result = await LegalEntityService.list(query);
    return handleResult(c, result);
  }

  static async getById(c: Context) {
    const id = c.req.param("id");
    const result = await LegalEntityService.getById(id);
    return handleResult(c, result);
  }

  static async update(c: Context) {
    const ctx = getAuditContext(c);
    const id = c.req.param("id");
    const body = c.get("validatedBody") || (await c.req.json());
    const result = await LegalEntityService.update(id, body, ctx);
    return handleResult(c, result);
  }

}
