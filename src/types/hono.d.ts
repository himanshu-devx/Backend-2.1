import "hono";

declare module "hono" {
  interface ContextVariableMap {
    body: unknown;
    rawBody?: string;
    bodyParseError?: boolean;
    query: unknown;
  }
}

declare module "hono" {
  interface HonoRequest {
    validatedBody?: any;
    validatedQuery: any;
  }
}
