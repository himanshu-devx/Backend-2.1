import { LEDGER_OPERATION, LEDGER_OPERATION_META, LedgerOperationType, OPERATION_ACCOUNT_SCOPES } from "@/constants/ledger-operations.constant";

export type EntityType = 'MERCHANT' | 'PROVIDER' | 'LEGAL_ENTITY' | 'INCOME';

/**
 * Maps entity types to their available operations
 */
export const ENTITY_OPERATIONS_MAP: Record<EntityType, LedgerOperationType[]> = {
    MERCHANT: [
        LEDGER_OPERATION.MERCHANT_SETTLEMENT_PAYOUT,
        LEDGER_OPERATION.MERCHANT_SETTLEMENT_BANK,
        LEDGER_OPERATION.MERCHANT_DEPOSIT,
        LEDGER_OPERATION.MERCHANT_HOLD,
        LEDGER_OPERATION.MERCHANT_RELEASE,
        LEDGER_OPERATION.INCOME_SETTLEMENT_TO_MERCHANT,
    ],
    PROVIDER: [
        LEDGER_OPERATION.PLE_SETTLEMENT,
        LEDGER_OPERATION.PLE_DEPOSIT,
        LEDGER_OPERATION.PLE_EXPENSE_SETTLEMENT,
        LEDGER_OPERATION.PLE_EXPENSE_CHARGE,
    ],
    LEGAL_ENTITY: [
        LEDGER_OPERATION.LEGAL_ENTITY_SETTLEMENT,
        LEDGER_OPERATION.LEGAL_ENTITY_DEPOSIT,
        LEDGER_OPERATION.LEGAL_ENTITY_DEDUCT,
    ],
    INCOME: [
        LEDGER_OPERATION.INCOME_SETTLEMENT_TO_MERCHANT,
    ],
};



/**
 * Get available operations for a specific entity type
 */
export function getOperationsByEntityType(entityType: EntityType, accountType?: string) {
    let operations = ENTITY_OPERATIONS_MAP[entityType] || [];

    if (accountType) {
        const normalizedAccountType = accountType.toUpperCase();
        operations = operations.filter(op => {
            const scopes = OPERATION_ACCOUNT_SCOPES[op] || [];
            return scopes.includes(normalizedAccountType);
        });
    }

    return operations.map(op => ({
        operation: op,
        description: LEDGER_OPERATION_META[op]?.description || '',
        required: LEDGER_OPERATION_META[op]?.required || [],
        optional: LEDGER_OPERATION_META[op]?.optional || [],
    }));
}

/**
 * Get all entity types with their operation counts
 */
export function getAllEntityTypes() {
    return Object.entries(ENTITY_OPERATIONS_MAP).map(([entityType, operations]) => ({
        entityType,
        operationCount: operations.length,
        operations: operations,
    }));
}
