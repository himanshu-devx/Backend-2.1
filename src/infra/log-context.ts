import { AsyncLocalStorage } from "node:async_hooks";

export type LogContext = {
  requestId?: string;
  correlationId?: string;
  traceId?: string;
  spanId?: string;
  actorId?: string;
  actorRole?: string;
  actorEmail?: string;
  actorType?: string;
  merchantId?: string;
  requestIp?: string;
  jobId?: string;
  jobType?: string;
  jobAttempt?: number;
  providerId?: string;
  legalEntityId?: string;
  pleId?: string;
  component?: string;
};

const storage = new AsyncLocalStorage<LogContext>();

export function getLogContext(): LogContext | undefined {
  return storage.getStore();
}

export function setLogContext(partial: LogContext) {
  const current = storage.getStore() || {};
  storage.enterWith({ ...current, ...partial });
}

export function runWithLogContext<T>(
  context: LogContext,
  fn: () => Promise<T>
): Promise<T> {
  return storage.run({ ...context }, fn);
}
