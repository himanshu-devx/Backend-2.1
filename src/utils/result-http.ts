import { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { isOk, Result } from "@/utils/result";
import { AppError } from "@/utils/error";

interface RespondOptions {
  successStatus?: ContentfulStatusCode;
  defaultErrorStatus?: ContentfulStatusCode;
}

export function respond<T>(
  c: Context,
  result: Result<T, AppError | string>,
  options: RespondOptions = {}
) {
  const successStatus: ContentfulStatusCode = options.successStatus ?? 200;
  const defaultErrorStatus: ContentfulStatusCode =
    options.defaultErrorStatus ?? 400;

  if (isOk(result)) {
    return c.json(
      {
        success: true,
        data: result.value,
      },
      successStatus
    );
  }

  const e = result.error;

  if (typeof e === "string") {
    return c.json(
      {
        success: false,
        error: { message: e },
      },
      defaultErrorStatus
    );
  }

  const status: ContentfulStatusCode = (e.status ??
    defaultErrorStatus) as ContentfulStatusCode;

  return c.json(
    {
      success: false,
      error: {
        message: e.message,
        code: e.code,
        details: e.details,
      },
    },
    status
  );
}
