import { trace, context } from "@opentelemetry/api";
import { AuditEvent } from "@/types/audit-log.types";
import { logger } from "@/infra/logger-instance";
import { AuditLogModel } from "@/models/audit-log.model";
import { getLogContext } from "@/infra/log-context";

import { getISTDate } from "@/utils/date.util";

const auditLog = logger.child({ type: "audit" });

export class AuditService {
  /**
   * Records an audit event to structured logs.
   */
  static async record(event: AuditEvent) {
    const { traceId, spanId } = this.currentTraceContext();
    const logCtx = getLogContext();
    const requestId = event.requestId || logCtx?.requestId;
    const correlationId = event.correlationId || logCtx?.correlationId;

    // 1) Write structured log immediately (non-blocking IO usually)
    auditLog.info(
      {
        event: "audit.record",
        component: "audit",
        ts: getISTDate().toISOString(),
        action: event.action,
        actorId: event.actorId,
        actorType: event.actorType,
        actorName: event.actorName,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        entityType: event.entityType,
        entityId: event.entityId,
        prevValue: event.prevValue,
        newValue: event.newValue,
        requestId,
        correlationId,
        traceId: traceId || logCtx?.traceId,
        spanId: spanId || logCtx?.spanId,
        metadata: event.metadata,
        source: event.source,
      },
      "audit-event"
    );

    // 1.5) Persist audit event to DB (best-effort)
    try {
      await AuditLogModel.create({
        action: event.action,
        actorId: event.actorId || logCtx?.actorId,
        actorType: event.actorType || logCtx?.actorType,
        actorName: event.actorName,
        actorRole: logCtx?.actorRole,
        actorEmail: logCtx?.actorEmail,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        entityType: event.entityType,
        entityId: event.entityId,
        prevValue: event.prevValue,
        newValue: event.newValue,
        requestId,
        correlationId,
        traceId: traceId || logCtx?.traceId,
        spanId: spanId || logCtx?.spanId,
        metadata: event.metadata,
        source: event.source,
      });
    } catch (err: any) {
      logger.error(
        {
          event: "audit.persist_failed",
          component: "audit",
          action: event.action,
          error: err?.message,
        },
        "Failed to persist audit log"
      );
    }

    // 2) Attach OTel span event for trace timeline (if span exists)
    const span = trace.getSpan(context.active());
    try {
      if (span) {
        span.addEvent("audit.event", {
          action: event.action,
          actorId: event.actorId,
          actorType: event.actorType,
          entityType: event.entityType || "UNKNOWN",
          entityId: event.entityId || "UNKNOWN",
          requestId: event.requestId || "UNKNOWN",
        });
      }
    } catch (err) {
      // swallow: OTEL operations must not break business logic
    }
  }

  private static currentTraceContext() {
    const span = trace.getSpan(context.active());
    if (!span) return { traceId: undefined, spanId: undefined };
    const ctx = span.spanContext();
    return { traceId: ctx.traceId, spanId: ctx.spanId };
  }
}
