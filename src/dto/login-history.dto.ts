import { ActorType, LoginStatus } from "@/models/login-history.model";

export interface CreateLoginHistoryDTO {
  userId?: string;
  userType: ActorType;
  email: string;
  ipAddress: string;
  userAgent: string;
  status: LoginStatus;
  failureReason?: string;
  metadata?: Record<string, any>;
  deviceId?: string;
}

export interface ListLoginHistoryQueryDTO {
  userId?: string;
  userType?: ActorType;
  email?: string;
  status?: LoginStatus;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
  search?: string;
}
