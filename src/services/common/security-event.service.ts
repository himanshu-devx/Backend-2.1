import { AuditService } from "@/services/common/audit.service";
import { ActorType } from "@/types/audit-log.types";
import { logger } from "@/infra/logger-instance";

export type SecurityEvent = {
  action: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  actorType?: ActorType;
  actorId?: string;
  actorName?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  correlationId?: string;
  metadata?: Record<string, any>;
  source?: string;
};

export class SecurityEventService {
  static async record(event: SecurityEvent) {
    try {
      await AuditService.record({
        actorType: event.actorType ?? "SYSTEM",
        actorId: event.actorId,
        actorName: event.actorName,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        action: event.action,
        metadata: {
          severity: event.severity,
          ...event.metadata,
        },
        requestId: event.requestId,
        correlationId: event.correlationId,
        source: event.source ?? "security",
      });
    } catch (err) {
      logger.warn({ err }, "security event record failed");
    }
  }
}
