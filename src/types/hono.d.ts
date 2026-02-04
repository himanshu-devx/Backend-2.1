import "hono";

declare module "hono" {
  interface ContextVariableMap {
    body: unknown;
    query: unknown;
  }
}

declare module "hono" {
  interface HonoRequest {
    validatedBody?: any;
    validatedQuery: any;
  }
}
