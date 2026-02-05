import { query } from '../infra/postgres';

export type AuditLogRecord = {
    id: number;
    action: string;
    targetId: string | null;
    actorId: string | null;
    payload: any;
    createdAt: Date;
};

export type AuditLogMode = 'sync' | 'async' | 'disabled';

type AuditQueueItem = { action: string; targetId: string; actorId: string; payload: any };

let auditMode: AuditLogMode = 'sync';
let flushIntervalMs = 500;
let maxBatchSize = 100;
let queue: AuditQueueItem[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let disabledActions = new Set<string>(['TRANSFER_POSTED', 'TRANSFER_PENDING']);

function startFlushTimer() {
    if (flushTimer) return;
    flushTimer = setInterval(() => {
        void AuditService.flush();
    }, flushIntervalMs);
    flushTimer.unref?.();
}

function stopFlushTimer() {
    if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
    }
}

function serializePayload(payload: any): string {
    return JSON.stringify(payload, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
}

export class AuditService {
    static configure(options: {
        mode?: AuditLogMode;
        flushIntervalMs?: number;
        maxBatchSize?: number;
        disabledActions?: string[];
    }) {
        if (options.mode) auditMode = options.mode;
        if (options.flushIntervalMs) flushIntervalMs = options.flushIntervalMs;
        if (options.maxBatchSize) maxBatchSize = options.maxBatchSize;
        if (options.disabledActions) disabledActions = new Set(options.disabledActions);

        if (auditMode === 'async') {
            startFlushTimer();
        } else {
            stopFlushTimer();
        }
    }

    /**
     * Records an administrative action.
     */
    static async log(action: string, targetId: string, actorId: string, payload: any) {
        if (auditMode === 'disabled') return;
        if (disabledActions.has(action)) return;
        if (auditMode === 'async') {
            queue.push({ action, targetId, actorId, payload });
            if (queue.length >= maxBatchSize) {
                await AuditService.flush();
            }
            return;
        }
        try {
            await query(
                `INSERT INTO audit_logs (action, target_id, actor_id, payload) VALUES ($1, $2, $3, $4)`,
                [action, targetId, actorId, serializePayload(payload)]
            );
        } catch (e) {
            console.error('Failed to write audit log', e);
            // Audit failure should probably not block operation in MVP, 
            // but in strict mode it should throw.
        }
    }

    /**
     * Flush queued audit logs (async mode).
     */
    static async flush(): Promise<void> {
        if (queue.length === 0) return;
        const batch = queue.splice(0, maxBatchSize);
        const values: string[] = [];
        const params: any[] = [];
        let i = 1;
        for (const item of batch) {
            values.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
            params.push(item.action, item.targetId, item.actorId, serializePayload(item.payload));
        }
        try {
            await query(
                `INSERT INTO audit_logs (action, target_id, actor_id, payload) VALUES ${values.join(',')}`,
                params
            );
        } catch (e) {
            console.error('Failed to flush audit logs', e);
        }
    }

    static async shutdown(): Promise<void> {
        await AuditService.flush();
        stopFlushTimer();
    }

    /**
     * Viewer helpers
     */
    static async list(limit = 100, offset = 0): Promise<AuditLogRecord[]> {
        const res = await query(
            `SELECT id, action, target_id, actor_id, payload, created_at
             FROM audit_logs
             ORDER BY created_at DESC, id DESC
             LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
        return res.rows.map((r) => ({
            id: r.id,
            action: r.action,
            targetId: r.target_id,
            actorId: r.actor_id,
            payload: r.payload,
            createdAt: r.created_at,
        }));
    }

    static async findByTarget(targetId: string, limit = 100, offset = 0): Promise<AuditLogRecord[]> {
        const res = await query(
            `SELECT id, action, target_id, actor_id, payload, created_at
             FROM audit_logs
             WHERE target_id = $1
             ORDER BY created_at DESC, id DESC
             LIMIT $2 OFFSET $3`,
            [targetId, limit, offset]
        );
        return res.rows.map((r) => ({
            id: r.id,
            action: r.action,
            targetId: r.target_id,
            actorId: r.actor_id,
            payload: r.payload,
            createdAt: r.created_at,
        }));
    }

    static async findByActor(actorId: string, limit = 100, offset = 0): Promise<AuditLogRecord[]> {
        const res = await query(
            `SELECT id, action, target_id, actor_id, payload, created_at
             FROM audit_logs
             WHERE actor_id = $1
             ORDER BY created_at DESC, id DESC
             LIMIT $2 OFFSET $3`,
            [actorId, limit, offset]
        );
        return res.rows.map((r) => ({
            id: r.id,
            action: r.action,
            targetId: r.target_id,
            actorId: r.actor_id,
            payload: r.payload,
            createdAt: r.created_at,
        }));
    }
}
