import { z } from "zod";

export const CreateLegalEntitySchemaTemp = z.object({
  name: z.string().min(1),
  identifier: z.string().min(1),
  isActive: z.boolean().optional(),
});
