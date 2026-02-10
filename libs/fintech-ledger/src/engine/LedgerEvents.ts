import { EventEmitter } from 'events';
// import { LedgerEntry } from '../api/types';

export enum LedgerEventType {
  ENTRY_POSTED = 'ENTRY_POSTED',
  BALANCE_LOW = 'BALANCE_LOW',
}

export interface LedgerEventPayload {
  entryId: string;
  description: string;
  externalRef?: string;
  type?: string;
  lines: { accountId: string; amount: string }[];
}

class LedgerEventBus extends EventEmitter {}

export const ledgerEvents = new LedgerEventBus();

/**
 * Helper to emit posted event from Kernel
 */
export function emitEntryPosted(entry: LedgerEventPayload): void {
  ledgerEvents.emit(LedgerEventType.ENTRY_POSTED, entry);
}
