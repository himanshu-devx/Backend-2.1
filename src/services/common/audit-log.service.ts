import { logger } from "@/infra/logger-instance";

export class AuditLogService {
    static async logFailure(action: string, error: any, metadata?: any, ip?: string) {
        try {
            // Serialize error if it's an Error object
            const errorData = error instanceof Error
                ? { message: error.message, name: error.name, stack: error.stack }
                : error;

            // Log to system logger only
            logger.error({ action, status: "FAILURE", metadata, ip, error: errorData }, `Audit Failure [${action}]`);
        } catch (e) {
            logger.error(e, "Failed to write audit log");
        }
    }

    static async logSuccess(action: string, metadata?: any, ip?: string) {
        try {
            logger.info({ action, status: "SUCCESS", metadata, ip }, `Audit Success [${action}]`);
        } catch (e) {
            logger.error(e, "Failed to write audit log");
        }
    }
}
