import { z } from "zod";

export const ProviderProxyRequestSchema = z
  .object({
    method: z.string().optional(),
    url: z.union([z.string(), z.record(z.any())]).optional(),
    headers: z.any().optional(),
    header: z.any().optional(),
    body: z.any().optional(),
    data: z.any().optional(),
    timeoutMs: z.number().int().positive().max(60000).optional(),
    responseType: z.enum(["json", "text"]).optional(),
    request: z.any().optional(),
  })
  .passthrough()
  .refine((val) => val.url || val.request?.url, {
    message: "url is required",
    path: ["url"],
  });

export type ProviderProxyRequestDto = z.infer<typeof ProviderProxyRequestSchema>;
