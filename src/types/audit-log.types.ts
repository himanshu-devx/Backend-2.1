export type ActorType =
  | "ADMIN"
  | "MERCHANT"
  | "CUSTOMER"
  | "SYSTEM"
  | "UNKNOWN";

export interface AuditEvent {
  actorId?: string;
  actorType: ActorType;
  actorName?: string;

  ipAddress?: string;
  userAgent?: string;

  action: string;

  entityType?: string;
  entityId?: string;

  prevValue?: any;
  newValue?: any;
  metadata?: Record<string, any>;

  requestId?: string;
  correlationId?: string;
  source?: string;
}
